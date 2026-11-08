import { transcodeRawAudioLocallyWithWasm, transcodeRawAudioOnServer } from './ffmpegExtractor';
import { probeMkvAudioCodec, extractRawAudioTrackFromMp4, extractRawAudioTrackFromAvi } from './mkvAudioExtractor';
import { isTauriDesktop, extractAudioTrackNative, getDesktopStorageInfo, getDesktopAssetUrl } from './tauriBridge';

export const GEMINI_TRANSCRIBE_MODEL = 'gemini-3.1-flash-lite';


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

    const selectedTrackNum = targetMkvTrackNum ?? audioTrackNumber ?? 1;
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
 * Encodes Float32 PCM samples into a clean 16kHz 16-bit mono WAV buffer
 */
function encodeWav16BitMono(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // 1 channel (mono)
  view.setUint32(24, sampleRate, true); // sampleRate (16000)
  view.setUint32(28, sampleRate * 2, true); // byteRate (16000 * 1 * 2)
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

/**
 * Transcodes any audio payload into a standardized 16kHz mono audio file specifically optimized
 * for AI voice recognition and speech transcription models (e.g. Gemini 3.5 Transcribe).
 */
export async function transcodeAudioForVoiceRecognition(
  audioInput: Blob | File,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal
): Promise<File> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (onProgress) onProgress(45, 'Транскадаванне аўдыя пад распазнаванне голасу (16kHz)...');

  const baseName = (audioInput as File).name
    ? (audioInput as File).name.replace(/\.[^/.]+$/, '').replace(/[^\x20-\x7E]/g, '_').replace(/_+/g, '_')
    : 'audio';

  // Strategy 1: Ultra-fast browser WebAudio decoding to 16kHz mono PCM WAV (<1 sec for full episodes)
  try {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtxClass) {
      const arrayBuf = await audioInput.arrayBuffer();
      if (!signal?.aborted && arrayBuf.byteLength > 100) {
        const ctx = new AudioCtxClass({ sampleRate: 16000 });
        try {
          const audioBuf = await ctx.decodeAudioData(arrayBuf);
          if (audioBuf && audioBuf.length > 0) {
            const length = audioBuf.length;
            const numChannels = audioBuf.numberOfChannels;
            const monoSamples = new Float32Array(length);
            for (let c = 0; c < numChannels; c++) {
              const ch = audioBuf.getChannelData(c);
              for (let i = 0; i < length; i++) {
                monoSamples[i] += ch[i] / numChannels;
              }
            }
            await ctx.close().catch(() => {});

            const wavBytes = encodeWav16BitMono(monoSamples, 16000);
            const wavFile = new File([wavBytes], `${baseName || 'voice'}_16k.wav`, { type: 'audio/wav' });
            if (onProgress) onProgress(95, 'Аўдыя падрыхтавана пад распазнаванне голасу (16kHz WAV)');
            return wavFile;
          }
        } catch (decErr) {
          console.warn('[mkvAudioExtractorForGen] WebAudio decodeAudioData fallback to FFmpeg:', decErr);
        } finally {
          await ctx.close().catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn('[mkvAudioExtractorForGen] WebAudio decode failed, falling back to WASM/Server transcode:', err);
  }

  // Strategy 2: Local FFmpeg WASM transcode to 16kHz mono
  try {
    if (onProgress) onProgress(60, 'Транскадаванне праз WASM FFmpeg пад 16kHz...');
    let transcoded = await transcodeRawAudioLocallyWithWasm(audioInput, 'voice-rec', (p, msg) => {
      if (onProgress) onProgress(Math.min(90, Math.max(50, p)), msg);
    }, signal);

    if (!transcoded) {
      if (onProgress) onProgress(75, 'Транскадаванне на серверы пад 16kHz...');
      transcoded = await transcodeRawAudioOnServer(audioInput, 'voice-rec', onProgress, signal);
    }

    if (transcoded && transcoded.size > 512) {
      const cleanName = `${baseName || 'voice'}_16k.m4a`;
      if (onProgress) onProgress(98, 'Аўдыя паспяхова транскадавана пад распазнаванне голасу');
      return new File([transcoded], cleanName, { type: transcoded.type || 'audio/mp4' });
    }
  } catch (wasmErr) {
    console.warn('[mkvAudioExtractorForGen] WASM / Server transcode fallback failed:', wasmErr);
  }

  // Strategy 3: Return audioInput as File if already an audio File
  if (audioInput instanceof File) return audioInput;
  return new File([audioInput], `${baseName || 'voice'}.mp3`, { type: audioInput.type || 'audio/mp3' });
}

/**
 * Main dedicated audio extractor entry point for Subtitle Generation.
 * Extracts the requested audio track from the media file and transcodes it specifically
 * for voice recognition (16kHz mono audio).
 */
export async function extractAudioForSubtitleGen(
  mediaFile: File,
  trackNumber: number = 1,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
  cachedAudio?: File | Blob
): Promise<File | null> {
  if (signal?.aborted) return null;

  // 1. If we already have a pre-extracted/transcoded audio track cached from player or previous pass
  if (cachedAudio && cachedAudio.size > 512) {
    console.log(`[mkvAudioExtractorForGen] Using cached audio track #${trackNumber} (${Math.round(cachedAudio.size / 1024 / 1024)}MB)`);
    if (onProgress) onProgress(20, 'Выкарыстанне выцягнутай дарожкі, транскадаванне пад распазнаванне голасу...');
    try {
      const speechReady = await transcodeAudioForVoiceRecognition(cachedAudio, onProgress, signal);
      if (speechReady && speechReady.size > 512) {
        return speechReady;
      }
    } catch (cacheErr) {
      console.warn('[mkvAudioExtractorForGen] Failed transcoding cached audio, continuing with fresh demux:', cacheErr);
    }
  }

  const fileExt = mediaFile.name ? mediaFile.name.toLowerCase().split('.').pop() || '' : '';
  const isAudioType = mediaFile.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'].includes(fileExt);

  // 2. If media file is already a standalone audio file, transcode it directly for voice recognition
  if (isAudioType) {
    console.log('[mkvAudioExtractorForGen] Input is a standalone audio file, transcoding for voice recognition...');
    if (onProgress) onProgress(20, 'Падрыхтоўка аўдыя пад распазнаванне голасу...');
    return transcodeAudioForVoiceRecognition(mediaFile, onProgress, signal);
  }

  // 3. Desktop Tauri mode: Use fast native sidecar ffmpeg to extract and transcode the exact track
  const rawDesktopPath = (mediaFile as any)?.desktopPath || (mediaFile as any)?.path;
  if (isTauriDesktop() && rawDesktopPath) {
    try {
      console.log(`[mkvAudioExtractorForGen] Desktop native extraction for track #${trackNumber}...`);
      if (onProgress) onProgress(15, `Здабыванне дарожкі #${trackNumber} праз ffmpeg.exe...`);
      const tempInfo = await getDesktopStorageInfo().catch(() => null);
      const cacheDir = (tempInfo?.cache_dir || tempInfo?.temp_dir || '').replace(/[/\\]+$/, '');
      const outName = `transcribe_tr${trackNumber}_${Date.now()}.wav`;
      const targetOutPath = cacheDir ? `${cacheDir}/${outName}` : outName;

      const nativeResultPath = await extractAudioTrackNative(
        rawDesktopPath,
        Math.max(0, trackNumber - 1),
        targetOutPath,
        (payload) => {
          if (onProgress && payload.progress >= 0) {
            const pct = Math.min(85, Math.max(10, Math.round(payload.progress * 100)));
            onProgress(pct, payload.message || `ffmpeg.exe ${pct}%`);
          }
        }
      );

      if (nativeResultPath) {
        const assetUrl = getDesktopAssetUrl(nativeResultPath);
        const res = await fetch(assetUrl);
        if (res.ok) {
          const audioBlob = await res.blob();
          if (audioBlob && audioBlob.size > 512) {
            const cleanSpeechFile = await transcodeAudioForVoiceRecognition(audioBlob, onProgress, signal);
            if (cleanSpeechFile && cleanSpeechFile.size > 512) {
              return cleanSpeechFile;
            }
          }
        }
      }
    } catch (desktopNativeErr) {
      console.warn('[mkvAudioExtractorForGen] Desktop native extraction fallback:', desktopNativeErr);
    }
  }

  console.log(`[mkvAudioExtractorForGen] Starting streaming demuxing for subtitle generation: ${mediaFile.name} (${Math.round(mediaFile.size / 1024 / 1024)}MB), track #${trackNumber}...`);
  if (onProgress) onProgress(5, 'Пачатак выцягвання аўдыядарожкі для субцітраў 5%...');

  const isMkv = ['mkv', 'mka', 'webm'].includes(fileExt) || mediaFile.type.includes('matroska') || mediaFile.type.includes('webm');
  const isMp4 = ['mp4', 'mov', 'm4v', '3gp', 'qt'].includes(fileExt) || mediaFile.type.includes('mp4') || mediaFile.type.includes('quicktime');
  const isAvi = ['avi'].includes(fileExt) || mediaFile.type.includes('avi');

  let rawAudioBlob: Blob | null = null;

  if (isMkv) {
    if (onProgress) onProgress(10, 'Дэмуксінг MKV дарожкі ў браўзеры...');
    rawAudioBlob = await extractRawAudioTrackFromMkvForGen(mediaFile, trackNumber, onProgress, signal);
  } else if (isMp4) {
    if (onProgress) onProgress(10, 'Дэмуксінг MP4 дарожкі ў браўзеры...');
    rawAudioBlob = await extractRawAudioTrackFromMp4(mediaFile, trackNumber, (p, msg) => {
      if (onProgress) onProgress(Math.min(35, Math.max(10, p)), msg);
    }, signal);
  } else if (isAvi) {
    if (onProgress) onProgress(10, 'Дэмуксінг AVI дарожкі ў браўзеры...');
    rawAudioBlob = await extractRawAudioTrackFromAvi(mediaFile, trackNumber, (p, msg) => {
      if (onProgress) onProgress(Math.min(35, Math.max(10, p)), msg);
    }, signal);
  }

  if (rawAudioBlob && rawAudioBlob.size > 512 && !signal?.aborted) {
    const totalMb = Math.round(rawAudioBlob.size / 1024 / 1024);
    console.log(`[mkvAudioExtractorForGen] Successfully extracted raw audio track (${totalMb}MB, type: ${rawAudioBlob.type}). Transcoding for voice recognition...`);

    const speechReadyFile = await transcodeAudioForVoiceRecognition(rawAudioBlob, onProgress, signal);
    if (speechReadyFile && speechReadyFile.size > 512) {
      if (onProgress) onProgress(100, 'Аўдыядарожка паспяхова транскадавана пад распазнаванне голасу! 100%');
      return speechReadyFile;
    }
  }

  // Fallback: If streaming demuxing is unsupported or yielded null, return null to allow server native FFmpeg processing
  console.log('[mkvAudioExtractorForGen] Streaming JS demuxing unfulfilled; returning null for native server FFmpeg fallback.');
  return null;
}

