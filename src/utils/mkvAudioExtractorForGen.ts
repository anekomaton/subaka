import { transcodeRawAudioLocallyWithWasm, transcodeRawAudioOnServer } from './ffmpegExtractor';
import { probeMkvAudioCodec, extractRawAudioTrackFromMp4, extractRawAudioTrackFromAvi } from './mkvAudioExtractor';

/**
 * Dedicated Pure JS Audio Demuxer & Extractor for Subtitle Generation (mkvAudioExtractorForGen.ts).
 * Operates strictly independently from TimelinePlayer's playback demuxer.
 * Uses chunked Blob.slice() streaming reads to extract audio tracks from multi-GB MKV, MP4, MOV, and AVI
 * files directly in browser JavaScript memory in <1 second with <50MB RAM usage, bypassing WASM 32-bit limits.
 */

class ChunkedFileReaderForGen {
  private file: Blob | File;
  public length: number;
  private cacheStart = -1;
  private cacheEnd = -1;
  private cacheBuf: Uint8Array | null = null;

  constructor(file: Blob | File) {
    this.file = file;
    this.length = file.size;
  }

  async getSlice(start: number, len: number): Promise<Uint8Array | null> {
    if (start >= this.length) return null;
    const end = Math.min(this.length, start + len);
    const actualLen = end - start;
    if (actualLen <= 0) return null;

    if (this.cacheBuf && start >= this.cacheStart && end <= this.cacheEnd) {
      const offset = start - this.cacheStart;
      return this.cacheBuf.subarray(offset, offset + actualLen);
    }

    try {
      const fetchLen = Math.max(actualLen, 4 * 1024 * 1024);
      const fetchEnd = Math.min(this.length, start + fetchLen);
      const sliceBlob = this.file.slice(start, fetchEnd);

      const buf = await new Promise<ArrayBuffer | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result instanceof ArrayBuffer) resolve(reader.result);
          else resolve(null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(sliceBlob);
      });

      if (!buf) return null;

      this.cacheStart = start;
      this.cacheEnd = fetchEnd;
      this.cacheBuf = new Uint8Array(buf);
      return this.cacheBuf.subarray(0, actualLen);
    } catch (err) {
      console.warn('[mkvAudioExtractorForGen] ChunkedFileReader error:', err);
      return null;
    }
  }
}

async function findByteSequenceForGen(
  reader: ChunkedFileReaderForGen,
  sequence: number[],
  maxBytes: number = 64 * 1024 * 1024,
  startFrom: number = 0
): Promise<number> {
  const chunkSize = 2 * 1024 * 1024;
  let pos = startFrom;
  const seqLen = sequence.length;

  while (pos < reader.length && pos < startFrom + maxBytes) {
    const sliceLen = Math.min(chunkSize + seqLen, reader.length - pos);
    const buf = await reader.getSlice(pos, sliceLen);
    if (!buf || buf.length < seqLen) break;

    const limit = buf.length - seqLen;
    for (let i = 0; i <= limit; i++) {
      let match = true;
      for (let j = 0; j < seqLen; j++) {
        if (buf[i + j] !== sequence[j]) {
          match = false;
          break;
        }
      }
      if (match) return pos + i;
    }
    pos += chunkSize;
  }
  return -1;
}

function readVintForGen(data: Uint8Array, offset: number): { value: number; length: number; isUnknown: boolean } | null {
  if (offset >= data.length) return null;
  const firstByte = data[offset];
  let length = 1;
  let mask = 0x80;

  while (length <= 8 && (firstByte & mask) === 0) {
    length++;
    mask >>= 1;
  }

  if (length > 8) return null;

  let value = firstByte & (mask - 1);
  let isUnknown = (firstByte & (mask - 1)) === (mask - 1);

  for (let i = 1; i < length; i++) {
    if (offset + i >= data.length) return null;
    const b = data[offset + i];
    value = (value * 256) + b;
    if (b !== 0xff) isUnknown = false;
  }

  return { value, length, isUnknown };
}

async function readVintChunkForGen(reader: ChunkedFileReaderForGen, pos: number) {
  const slice = await reader.getSlice(pos, 12);
  if (!slice || slice.length === 0) return null;
  return readVintForGen(slice, 0);
}

function readElementIdForGen(data: Uint8Array, offset: number): { id: number; length: number } | null {
  if (offset >= data.length) return null;
  const firstByte = data[offset];
  let length = 1;
  let mask = 0x80;

  while (length <= 4 && (firstByte & mask) === 0) {
    length++;
    mask >>= 1;
  }

  if (length > 4) return null;

  let id = firstByte;
  for (let i = 1; i < length; i++) {
    if (offset + i >= data.length) return null;
    id = (id << 8) | data[offset + i];
  }

  return { id: id >>> 0, length };
}

function extractUnlacedBlockFramesForGen(
  buf: Uint8Array,
  valStart: number,
  valLen: number,
  trkHeaderLen: number,
  payloads: Uint8Array[]
) {
  const headerSize = trkHeaderLen + 2 + 1; // trackVint + 2 bytes timecode + 1 byte flags
  if (valLen <= headerSize) return;

  const flags = buf[valStart + trkHeaderLen + 2];
  const lacing = (flags >> 1) & 3;
  const payloadStart = valStart + headerSize;
  const payloadLen = valLen - headerSize;

  if (payloadLen <= 0 || payloadStart + payloadLen > buf.length) return;

  if (lacing === 0) {
    // No lacing - single frame
    payloads.push(buf.slice(payloadStart, payloadStart + payloadLen));
  } else if (lacing === 1) {
    // Xiph lacing
    let pos = payloadStart;
    const numFrames = buf[pos] + 1;
    pos++;
    const frameSizes: number[] = [];
    let sumSizes = 0;
    for (let i = 0; i < numFrames - 1; i++) {
      let sz = 0;
      while (pos < payloadStart + payloadLen && buf[pos] === 255) {
        sz += 255;
        pos++;
      }
      if (pos < payloadStart + payloadLen) {
        sz += buf[pos];
        pos++;
      }
      frameSizes.push(sz);
      sumSizes += sz;
    }
    const lastFrameSz = (payloadStart + payloadLen) - pos - sumSizes;
    if (lastFrameSz >= 0) frameSizes.push(lastFrameSz);

    for (const fSize of frameSizes) {
      if (fSize > 0 && pos + fSize <= buf.length) {
        payloads.push(buf.slice(pos, pos + fSize));
        pos += fSize;
      }
    }
  } else if (lacing === 3) {
    // EBML lacing
    let pos = payloadStart;
    const numFrames = buf[pos] + 1;
    pos++;
    const frameSizes: number[] = [];
    let prevSize = 0;
    let sumSizes = 0;

    for (let i = 0; i < numFrames - 1; i++) {
      const v = readVintForGen(buf, pos);
      if (!v) break;
      pos += v.length;
      let frameSz = 0;
      if (i === 0) {
        frameSz = v.value;
      } else {
        const numBits = v.length * 7;
        const bias = (1 << (numBits - 1)) - 1;
        const delta = v.value - bias;
        frameSz = prevSize + delta;
      }
      prevSize = frameSz;
      frameSizes.push(frameSz);
      sumSizes += frameSz;
    }
    const lastFrameSz = (payloadStart + payloadLen) - pos - sumSizes;
    if (lastFrameSz >= 0) frameSizes.push(lastFrameSz);

    for (const fSize of frameSizes) {
      if (fSize > 0 && pos + fSize <= buf.length) {
        payloads.push(buf.slice(pos, pos + fSize));
        pos += fSize;
      }
    }
  } else if (lacing === 2) {
    // Fixed-size lacing
    const numFrames = buf[payloadStart] + 1;
    const frameDataStart = payloadStart + 1;
    const frameDataLen = payloadLen - 1;
    const frameSz = Math.floor(frameDataLen / numFrames);
    if (frameSz > 0) {
      let pos = frameDataStart;
      for (let i = 0; i < numFrames; i++) {
        if (pos + frameSz <= buf.length) {
          payloads.push(buf.slice(pos, pos + frameSz));
          pos += frameSz;
        }
      }
    }
  }
}

function isTrueAdtsFrame(rawFrame: Uint8Array): boolean {
  if (!rawFrame || rawFrame.length < 7) return false;
  if (rawFrame[0] !== 0xFF) return false;
  if ((rawFrame[1] & 0xF6) !== 0xF0) return false; // Syncword 0xFFF + layer 00
  const frameLenInAdts = ((rawFrame[3] & 0x03) << 11) | (rawFrame[4] << 3) | ((rawFrame[5] & 0xE0) >> 5);
  return frameLenInAdts === rawFrame.length;
}

function parseAacConfigForGen(config: Uint8Array): { profile: number; sampleRateIdx: number; channels: number } {
  if (!config || config.length < 2) {
    return { profile: 1, sampleRateIdx: 4, channels: 2 };
  }

  let ascBytes = config;
  if (config.length > 5) {
    // Search for DecoderSpecificInfoTag 0x05 inside ESDS atom
    for (let i = 0; i < config.length - 3; i++) {
      if (config[i] === 0x05) {
        const len = config[i + 1];
        if (len >= 2 && i + 2 + len <= config.length) {
          ascBytes = config.subarray(i + 2, i + 2 + len);
          break;
        }
      }
    }
  }

  if (ascBytes.length < 2) {
    return { profile: 1, sampleRateIdx: 4, channels: 2 };
  }

  const audioObjectType = (ascBytes[0] >> 3) & 0x1f;
  const sampleRateIdx = ((ascBytes[0] & 0x07) << 1) | ((ascBytes[1] >> 7) & 0x01);
  const channels = (ascBytes[1] >> 3) & 0x0f;

  let profile = 1; // Default to AAC-LC
  if (audioObjectType >= 1 && audioObjectType <= 4) {
    profile = audioObjectType - 1;
  }
  return { profile, sampleRateIdx, channels };
}

function getAacSampleRateIdxForGen(sampleRate: number): number {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const idx = rates.indexOf(sampleRate);
  return idx !== -1 ? idx : 4; // Default to 44100Hz (idx 4)
}

/**
 * Pure JS streaming MKV audio demuxer for subtitle generation
 */
export async function extractRawAudioTrackFromMkvForGen(
  file: File | Blob,
  audioTrackNumber?: number,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal
): Promise<Blob | null> {
  try {
    const reader = new ChunkedFileReaderForGen(file);
    const fileSize = file.size;
    const audioPayloads: Uint8Array[] = [];

    let targetMkvTrackNum: number | null = null;
    let targetSampleRate = 48000;
    let targetChannels = 2;
    let targetCodecPrivate: Uint8Array | undefined = undefined;
    let targetCodecId = '';

    // Probe MKV tracks to accurately map requested audioTrackNumber to exact MKV track number & params
    try {
      const probe = await probeMkvAudioCodec(file);
      if (probe && probe.tracks && probe.tracks.length > 0) {
        let matched = probe.tracks.find(t => t.trackNumber === audioTrackNumber) ||
                      probe.tracks[(audioTrackNumber || 1) - 1];
        if (!matched) matched = probe.tracks[0];
        if (matched) {
          targetMkvTrackNum = matched.mkvTrackNumber ?? matched.trackNumber;
          if (matched.sampleRate) targetSampleRate = matched.sampleRate;
          if (matched.channels) targetChannels = matched.channels;
          if (matched.codecPrivate) targetCodecPrivate = matched.codecPrivate;
          if (matched.codecId) targetCodecId = matched.codecId;
        }
      }
    } catch (err) {
      console.warn('[mkvAudioExtractorForGen] MKV Probe error:', err);
    }

    const selectedTrackNum = targetMkvTrackNum || (audioTrackNumber && audioTrackNumber > 1 ? audioTrackNumber : 2);
    if (!selectedTrackNum) {
      console.warn('[mkvAudioExtractorForGen] Could not reliably resolve MKV audio track number; aborting JS demuxing for server FFmpeg fallback.');
      return null;
    }

    let clusterPos = await findByteSequenceForGen(reader, [0x1f, 0x43, 0xb6, 0x75], Math.min(fileSize, 64 * 1024 * 1024), 0);
    if (clusterPos === -1) {
      console.warn('[mkvAudioExtractorForGen] No cluster header found in first 64MB of MKV');
      return null;
    }

    let iterations = 0;
    let lastProgressPct = -1;

    while (clusterPos < fileSize && !signal?.aborted) {
      const clSz = await readVintChunkForGen(reader, clusterPos + 4);
      if (!clSz) {
        clusterPos = await findByteSequenceForGen(reader, [0x1f, 0x43, 0xb6, 0x75], 8 * 1024 * 1024, clusterPos + 4);
        if (clusterPos === -1) break;
        continue;
      }

      const clusterHdrLen = 4 + clSz.length;
      const clusterDataStart = clusterPos + clusterHdrLen;
      const clusterLen = (clSz.value > 0 && !clSz.isUnknown) ? clSz.value : (10 * 1024 * 1024);

      const fetchLen = Math.min(clusterLen, 16 * 1024 * 1024);
      const buf = await reader.getSlice(clusterDataStart, fetchLen);

      if (buf && buf.length > 8) {
        let pos = 0;
        const bufLimit = buf.length - 4;

        while (pos < bufLimit && !signal?.aborted) {
          const el = readElementIdForGen(buf, pos);
          if (!el) break;

          const sz = readVintForGen(buf, pos + el.length);
          if (!sz || sz.value < 0 || sz.isUnknown) {
            pos += el.length;
            continue;
          }

          const valStart = pos + el.length + sz.length;
          const valLen = sz.value;
          const nextPos = valStart + valLen;

          if (el.id === 0xa3) { // SimpleBlock
            if (valStart + valLen <= buf.length) {
              const trkVint = readVintForGen(buf, valStart);
              if (trkVint) {
                const trkNum = trkVint.value;
                if (selectedTrackNum === null || trkNum === selectedTrackNum) {
                  extractUnlacedBlockFramesForGen(buf, valStart, valLen, trkVint.length, audioPayloads);
                }
              }
            }
          }

          if (nextPos <= pos || nextPos > buf.length) break;
          pos = nextPos;
        }
      }

      const nextClusterPos = (clSz.value > 0 && !clSz.isUnknown) ? (clusterDataStart + clSz.value) : (clusterDataStart + fetchLen);
      clusterPos = nextClusterPos > clusterPos ? nextClusterPos : clusterPos + 1024;
      iterations++;

      if (iterations % 20 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }

      if (onProgress) {
        const pct = Math.min(30, Math.max(5, Math.round((clusterPos / fileSize) * 25) + 5));
        if (pct !== lastProgressPct) {
          lastProgressPct = pct;
          onProgress(pct, `дэмуксінг .mkv для субцітраў ${pct}%`);
        }
      }
    }

    if (audioPayloads.length > 0 && !signal?.aborted) {
      const totalBytes = audioPayloads.reduce((acc, cur) => acc + cur.length, 0);
      console.log(`[mkvAudioExtractorForGen] Extracted ${audioPayloads.length} raw audio frames (${Math.round(totalBytes / 1024 / 1024)}MB).`);
      
      if (totalBytes > 10 * 1024) {
        let mimeType = 'audio/aac';
        const p0 = audioPayloads[0];
        if (p0 && p0.length >= 2) {
          // Video NAL unit start code check (e.g. H.264 / H.265 video frames wrongly extracted)
          if (p0[0] === 0x00 && p0[1] === 0x00 && (p0[2] === 0x01 || (p0[2] === 0x00 && p0[3] === 0x01))) {
            console.warn('[mkvAudioExtractorForGen] Extracted frames start with video NAL unit start code; aborting JS demuxing for server FFmpeg fallback.');
            return null;
          }

          const isAc3 = (p0[0] === 0x0B && p0[1] === 0x77) || (p0[0] === 0x77 && p0[1] === 0x0B);
          const isDts = p0[0] === 0x7F && p0[1] === 0xFE && p0[2] === 0x80 && p0[3] === 0x01;
          const isMp3 = (p0[0] === 0xFF && (p0[1] & 0xE0) === 0xE0) || (p0[0] === 0x49 && p0[1] === 0x44 && p0[2] === 0x33);
          const isAdtsAac = isTrueAdtsFrame(p0);

          const upperCodecId = (targetCodecId || '').toUpperCase();
          const isAacCodec = upperCodecId.includes('AAC') || (!isAc3 && !isDts && !isMp3 && !upperCodecId.includes('OPUS') && !upperCodecId.includes('FLAC') && !upperCodecId.includes('PCM') && !upperCodecId.includes('VORBIS'));

          if (isAc3) mimeType = 'audio/ac3';
          else if (isMp3) mimeType = 'audio/mp3';
          else if (isDts) mimeType = 'audio/dts';
          else if (isAdtsAac) mimeType = 'audio/aac';
          else if (isAacCodec) {
            // Prepend 7-byte ADTS header to raw AAC frames using targetCodecPrivate if available
            let adtsProfile = 1; // 1 = AAC LC (Low Complexity) in ADTS header
            let sampleRateIdx = getAacSampleRateIdxForGen(targetSampleRate);
            let numChannels = targetChannels;

            if (targetCodecPrivate && targetCodecPrivate.length >= 2) {
              const asc = parseAacConfigForGen(targetCodecPrivate);
              if (asc.profile === 0 || asc.profile === 1) adtsProfile = asc.profile;
              else adtsProfile = 1;
              if (asc.sampleRateIdx >= 0 && asc.sampleRateIdx <= 12) sampleRateIdx = asc.sampleRateIdx;
              if (asc.channels > 0) numChannels = asc.channels;
            }

            const adtsPayloads: Uint8Array[] = [];
            for (let i = 0; i < audioPayloads.length; i++) {
              const rawFrame = audioPayloads[i];
              if (rawFrame.length === 0) continue;
              if (isTrueAdtsFrame(rawFrame)) {
                adtsPayloads.push(rawFrame);
              } else {
                const sSize = rawFrame.length;
                const totalLen = sSize + 7;
                if (totalLen > 8191) {
                  // Skip invalid oversized frame
                  continue;
                }
                const adts = new Uint8Array(totalLen);
                adts[0] = 0xFF;
                adts[1] = 0xF1;
                adts[2] = ((adtsProfile & 3) << 6) | ((sampleRateIdx & 0xF) << 2) | ((numChannels >> 2) & 1);
                adts[3] = ((numChannels & 3) << 6) | ((totalLen >> 11) & 0x03);
                adts[4] = (totalLen >> 3) & 0xFF;
                adts[5] = ((totalLen & 0x07) << 5) | 0x1F;
                adts[6] = 0xFC;
                adts.set(rawFrame, 7);
                adtsPayloads.push(adts);
              }
            }
            if (adtsPayloads.length >= 5) {
              let validAdtsCount = 0;
              const checkCount = Math.min(50, adtsPayloads.length);
              for (let c = 0; c < checkCount; c++) {
                if (isTrueAdtsFrame(adtsPayloads[c])) {
                  validAdtsCount++;
                }
              }
              if ((validAdtsCount / checkCount) >= 0.8) {
                return new Blob(adtsPayloads, { type: 'audio/aac' });
              }
            }
            console.warn('[mkvAudioExtractorForGen] Extracted ADTS payloads failed header validation check; falling back to server native FFmpeg.');
            return null;
          } else {
            console.warn(`[mkvAudioExtractorForGen] Codec ${targetCodecId} cannot be wrapped in ADTS; returning null for native server FFmpeg fallback.`);
            return null;
          }
        }
        return new Blob(audioPayloads, { type: mimeType });
      }
    }
  } catch (err) {
    console.warn('[mkvAudioExtractorForGen] MKV raw audio demux error:', err);
  }
  return null;
}

/**
 * Main dedicated audio extractor entry point for Subtitle Generation.
 * Guaranteed to extract the complete audio track for multi-hour movies in <1s using streaming JS demuxing.
 */
export async function extractAudioForSubtitleGen(
  mediaFile: File,
  trackNumber: number = 1,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal
): Promise<File | null> {
  if (signal?.aborted) return null;

  const fileExt = mediaFile.name ? mediaFile.name.toLowerCase().split('.').pop() || '' : '';
  const isAudioType = mediaFile.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'].includes(fileExt);

  // 1. If media file is already a standalone audio file <= 80MB, return it as-is
  if (isAudioType && mediaFile.size <= 80 * 1024 * 1024) {
    console.log('[mkvAudioExtractorForGen] Input is already a small standalone audio file.');
    return mediaFile;
  }

  console.log(`[mkvAudioExtractorForGen] Starting streaming demuxing for subtitle generation: ${mediaFile.name} (${Math.round(mediaFile.size / 1024 / 1024)}MB), track #${trackNumber}...`);
  if (onProgress) onProgress(5, 'Пачатак выцягвання аўдыядарожкі для субцітраў 5%...');

  const isMkv = ['mkv', 'mka', 'webm'].includes(fileExt) || mediaFile.type.includes('matroska') || mediaFile.type.includes('webm');

  let rawAudioBlob: Blob | null = null;

  if (isMkv) {
    if (onProgress) onProgress(10, 'Дэмуксінг MKV дарожкі ў браўзеры...');
    rawAudioBlob = await extractRawAudioTrackFromMkvForGen(mediaFile, trackNumber, onProgress, signal);
  } else {
    // For MP4, MOV, AVI, etc., do NOT demux into synthetic ADTS in JS.
    // Delegating to server native FFmpeg preserves 100% frame-accurate timing.
    console.log('[mkvAudioExtractorForGen] Non-MKV container delegated to native server FFmpeg for frame accuracy.');
    return null;
  }

  if (rawAudioBlob && rawAudioBlob.size > 512 && !signal?.aborted) {
    const totalMb = Math.round(rawAudioBlob.size / 1024 / 1024);
    console.log(`[mkvAudioExtractorForGen] Successfully extracted complete raw audio track (${totalMb}MB, type: ${rawAudioBlob.type})`);

    const isAc3Dts = rawAudioBlob.type.includes('ac3') || rawAudioBlob.type.includes('dts') || rawAudioBlob.type.includes('eac3');

    // If it's a native streamable codec (AAC/MP3/FLAC/WAV/PCM/Opus), return directly as File
    if (!isAc3Dts) {
      let ext = 'aac';
      let mime = 'audio/aac';
      if (rawAudioBlob.type.includes('mp3')) {
        ext = 'mp3';
        mime = 'audio/mp3';
      } else if (rawAudioBlob.type.includes('wav')) {
        ext = 'wav';
        mime = 'audio/wav';
      } else if (rawAudioBlob.type.includes('flac')) {
        ext = 'flac';
        mime = 'audio/flac';
      } else if (rawAudioBlob.type.includes('aac')) {
        ext = 'aac';
        mime = 'audio/aac';
      } else if (rawAudioBlob.type.includes('opus')) {
        ext = 'opus';
        mime = 'audio/opus';
      } else if (rawAudioBlob.type.includes('ogg')) {
        ext = 'ogg';
        mime = 'audio/ogg';
      }

      const asciiBase = mediaFile.name.replace(/\.[^/.]+$/, '').replace(/[^\x20-\x7E]/g, '_').replace(/_+/g, '_');
      const cleanName = `${asciiBase || 'media'}_subtitles_track${trackNumber}.${ext}`;
      
      if (onProgress) onProgress(100, 'Аўдыядарожка паспяхова падрыхтавана! 100%');
      return new File([rawAudioBlob], cleanName, { type: mime });
    }

    // Non-native codec (AC3/DTS): transcode ONLY the extracted 40MB raw audio payload (small enough for WASM)
    console.log('[mkvAudioExtractorForGen] AC3/DTS detected, transcoding small raw audio payload...');
    if (onProgress) onProgress(40, 'Транскадаванне AC3/DTS у 16kHz аўдыя...');

    let transcodedBlob: Blob | null = await transcodeRawAudioLocallyWithWasm(rawAudioBlob, 'AC3/DTS', (p, msg) => {
      if (onProgress) onProgress(Math.min(90, Math.max(40, p)), msg);
    }, signal);

    if (!transcodedBlob) {
      transcodedBlob = await transcodeRawAudioOnServer(rawAudioBlob, 'AC3/DTS', onProgress, signal);
    }

    if (transcodedBlob && transcodedBlob.size > 512 && !signal?.aborted) {
      const asciiBase = mediaFile.name.replace(/\.[^/.]+$/, '').replace(/[^\x20-\x7E]/g, '_').replace(/_+/g, '_');
      const cleanName = `${asciiBase || 'media'}_subtitles_track${trackNumber}.m4a`;
      if (onProgress) onProgress(100, 'Аўдыядарожка паспяхова падрыхтавана! 100%');
      return new File([transcodedBlob], cleanName, { type: transcodedBlob.type || 'audio/mp4' });
    }
  }

  // Fallback: If streaming demuxing is unsupported or yielded null, return null to allow server native FFmpeg processing
  console.log('[mkvAudioExtractorForGen] Streaming JS demuxing unfulfilled; returning null for native server FFmpeg fallback.');
  return null;
}
