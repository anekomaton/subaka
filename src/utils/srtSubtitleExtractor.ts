/**
 * Pure JavaScript & FFmpeg Matroska/Media Subtitle Extractor (srtSubtitleExtractor)
 * Extracts embedded text subtitles (.srt / S_TEXT_UTF8 / S_TEXT_ASS / S_TEXT_SRT)
 * directly from video files (MKV, MP4, WebM, TS, AVI, MOV, etc.) and downloads them as .srt files.
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { readFileAsUint8Array, getFFmpeg } from './ffmpegExtractor';
import { saveFileUniversal } from './tauriBridge';

export interface ExtractedSrtResult {
  srtContent: string;
  fileName: string;
  subtitleCount: number;
  codecId?: string;
}

export interface SubtitleTrackInfo {
  trackNumber: number;
  language?: string;
  trackName?: string;
  codecId?: string;
  codecPrivate?: Uint8Array;
}

/**
 * Checks whether the subtitle track codec format is supported for extraction (.srt or .ass)
 */
export function isSupportedSubtitleCodec(codecId?: string, trackName?: string): boolean {
  const c = `${codecId || ''} ${trackName || ''}`.toUpperCase().trim();
  if (!c) return true; // Default assume supported if unknown text format

  // Unsupported image-based or incompatible subtitle codecs
  if (
    c.includes('VOBSUB') ||
    c.includes('HDMV_PGS') ||
    c.includes('PGS') ||
    c.includes('S_HDMV') ||
    c.includes('DVBSUB') ||
    c.includes('DVB_SUBTITLE') ||
    c.includes('DVD_SUBTITLE') ||
    c.includes('XSUB') ||
    c.includes('BITMAP')
  ) {
    return false;
  }

  // Supported text formats: SRT (S_TEXT/UTF8, S_TEXT/ASCII, subrip), ASS/SSA (S_TEXT/ASS, S_TEXT/SSA), WebVTT (S_TEXT/WEBVTT, text/vtt), etc.
  const isSupported =
    c.includes('SRT') ||
    c.includes('SUBRIP') ||
    c.includes('UTF8') ||
    c.includes('ASCII') ||
    c.includes('ASS') ||
    c.includes('SSA') ||
    c.includes('TEXT') ||
    c.includes('MOV_TEXT') ||
    c.includes('WEBVTT') ||
    c.includes('VTT') ||
    c.includes('TX3G');

  return isSupported;
}

export interface SubtitleProbeResult {
  hasSubtitles: boolean;
  codecId?: string;
  trackName?: string;
  trackNumber?: number;
  tracks?: SubtitleTrackInfo[];
}

/**
 * Chunked File Reader for streaming small sections of a file via Blob.slice()
 */
class ChunkedFileReader {
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
      const fetchLen = Math.max(actualLen, 2 * 1024 * 1024);
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
    } catch {
      return null;
    }
  }
}

/**
 * Helper to scan sequence of bytes in ChunkedFileReader
 */
async function findByteSequence(
  reader: ChunkedFileReader,
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

function readVint(data: Uint8Array, offset: number): { value: number; length: number; isUnknown: boolean } | null {
  if (offset >= data.length) return null;
  const firstByte = data[offset];
  if (firstByte === 0) return null;

  let length = 1;
  let mask = 0x80;
  while ((firstByte & mask) === 0) {
    length++;
    mask >>= 1;
  }

  if (offset + length > data.length) return null;

  let value = firstByte & (mask - 1);
  let allOnes = (firstByte & (mask - 1)) === (mask - 1);

  for (let i = 1; i < length; i++) {
    const b = data[offset + i];
    if (b !== 0xff) allOnes = false;
    value = (value * 256) + b;
  }

  if (allOnes) {
    return { value: -1, length, isUnknown: true };
  }

  return { value, length, isUnknown: false };
}

function readElementId(data: Uint8Array, offset: number): { id: number; length: number } | null {
  if (offset >= data.length) return null;
  const firstByte = data[offset];
  if (firstByte === 0) return null;

  let length = 1;
  let mask = 0x80;
  while ((firstByte & mask) === 0) {
    length++;
    mask >>= 1;
  }

  if (offset + length > data.length) return null;

  let id = firstByte;
  for (let i = 1; i < length; i++) {
    id = (id * 256) + data[offset + i];
  }

  return { id, length };
}

function readEbmlUint(data: Uint8Array, offset: number, size: number): number {
  let val = 0;
  for (let i = 0; i < size && (offset + i) < data.length; i++) {
    val = (val * 256) + data[offset + i];
  }
  return val;
}

/**
 * Format total seconds to standard SRT timestamp format (00:01:02,345)
 */
export function formatSecondsToSrtTime(totalSec: number): string {
  if (totalSec < 0 || isNaN(totalSec)) totalSec = 0;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  const ms = Math.floor((totalSec % 1) * 1000);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`;
}

/**
 * Clean ASS/SSA format text into plain text
 */
function cleanAssSubText(rawText: string): string {
  if (!rawText) return '';
  let text = rawText.trim();

  // ASS event format: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text
  // Text is after the 8th comma (9th field)
  const parts = text.split(',');
  if (parts.length >= 9 && /^\d+$/.test(parts[0].trim())) {
    text = parts.slice(8).join(',');
  }

  // Replace ASS line breaks \N or \n
  text = text.replace(/\\N/g, '\n').replace(/\\n/g, '\n');

  // Remove ASS style tags like {\pos(100,200)} or {\b1} or {\c&H...&}
  text = text.replace(/\{[^}]*\}/g, '');

  // Strip <font ...> and </font> tags
  text = text.replace(/<\/?font[^>]*>/gi, '');

  return text.trim();
}

interface InternalSubItem {
  startTimeSec: number;
  endTimeSec: number;
  text: string;
}

async function readVintChunk(reader: ChunkedFileReader, offset: number): Promise<{ value: number; length: number; isUnknown: boolean } | null> {
  const buf = await reader.getSlice(offset, 8);
  if (!buf) return null;
  return readVint(buf, 0);
}

/**
 * Searches SeekHead (0x114D9B74) for Tracks element (0x1654AE6B) position for instant lookup
 */
async function findTracksViaSeekHead(reader: ChunkedFileReader): Promise<number> {
  try {
    const segmentPos = await findByteSequence(reader, [0x18, 0x53, 0x80, 0x67], 64 * 1024, 0);
    if (segmentPos === -1) return -1;

    const segSz = await readVintChunk(reader, segmentPos + 4);
    if (!segSz) return -1;

    const segmentDataStart = segmentPos + 4 + segSz.length;

    // Look for SeekHead (0x114D9B74) near segment data start
    const seekHeadPos = await findByteSequence(reader, [0x11, 0x4D, 0x9B, 0x74], 4 * 1024 * 1024, segmentDataStart);
    if (seekHeadPos === -1) return -1;

    const shSz = await readVintChunk(reader, seekHeadPos + 4);
    if (!shSz) return -1;

    const shStart = seekHeadPos + 4 + shSz.length;
    const shLen = (shSz.value > 0 && !shSz.isUnknown) ? shSz.value : 64 * 1024;
    const shBuf = await reader.getSlice(shStart, Math.min(shLen, 256 * 1024));
    if (!shBuf) return -1;

    let offset = 0;
    while (offset < shBuf.length) {
      const el = readElementId(shBuf, offset);
      if (!el) break;
      const sz = readVint(shBuf, offset + el.length);
      if (!sz) break;
      const vStart = offset + el.length + sz.length;
      const vLen = (sz.value >= 0 && !sz.isUnknown) ? sz.value : 0;
      const vEnd = vStart + vLen;

      if (el.id === 0x4dbb) { // Seek
        let seekOffset = vStart;
        let seekId: Uint8Array | null = null;
        let seekPosVal = -1;

        while (seekOffset < vEnd && seekOffset < shBuf.length) {
          const sEl = readElementId(shBuf, seekOffset);
          if (!sEl) break;
          const sSz = readVint(shBuf, seekOffset + sEl.length);
          if (!sSz) break;
          const sValStart = seekOffset + sEl.length + sSz.length;

          if (sEl.id === 0x53ab) { // SeekID
            seekId = shBuf.subarray(sValStart, sValStart + Math.min(sSz.value, 8));
          } else if (sEl.id === 0x53ac) { // SeekPosition
            seekPosVal = readEbmlUint(shBuf, sValStart, sSz.value);
          }

          seekOffset = sValStart + (sSz.isUnknown ? 1 : sSz.value);
        }

        if (seekId && seekId.length === 4 && seekPosVal >= 0) {
          if (seekId[0] === 0x16 && seekId[1] === 0x54 && seekId[2] === 0xae && seekId[3] === 0x6b) {
            return segmentDataStart + seekPosVal;
          }
        }
      }

      offset = (vLen <= 0 || sz.isUnknown) ? offset + 1 : vEnd;
    }
  } catch (err) {
    console.warn("[srtSubtitleExtractor] SeekHead parsing warning:", err);
  }
  return -1;
}

/**
 * Universal video & media subtitle probe (MKV, MP4, MOV, TS, AVI, WebM, etc.)
 */
export async function probeMkvSubtitles(fileObj: File): Promise<SubtitleProbeResult> {
  const ext = fileObj.name.split('.').pop()?.toLowerCase() || '';
  const isMkvExt = ['mkv', 'mka', 'webm'].includes(ext);

  let isEbml = isMkvExt;
  if (!isEbml && fileObj.size > 4) {
    try {
      const readerHeader = new ChunkedFileReader(fileObj);
      const headBuf = await readerHeader.getSlice(0, 4);
      if (headBuf && headBuf.length >= 4 && headBuf[0] === 0x1a && headBuf[1] === 0x45 && headBuf[2] === 0xdf && headBuf[3] === 0xa3) {
        isEbml = true;
      }
    } catch {}
  }

  if (isEbml) {
    try {
      const reader = new ChunkedFileReader(fileObj);

      // 1. SeekHead fast lookup
      let tracksPos = await findTracksViaSeekHead(reader);

      // 2. Scan up to 128MB from start
      if (tracksPos === -1) {
        tracksPos = await findByteSequence(reader, [0x16, 0x54, 0xAE, 0x6B], 128 * 1024 * 1024, 0);
      }

      // 3. Scan last 32MB from tail
      if (tracksPos === -1 && reader.length > 8 * 1024 * 1024) {
        const tailStart = Math.max(0, reader.length - 32 * 1024 * 1024);
        tracksPos = await findByteSequence(reader, [0x16, 0x54, 0xAE, 0x6B], 32 * 1024 * 1024, tailStart);
      }

      if (tracksPos !== -1) {
        const sz = readVint(await reader.getSlice(tracksPos + 4, 8) || new Uint8Array(), 0);
        if (sz) {
          const tracksDataStart = tracksPos + 4 + sz.length;
          const tracksDataLen = (sz.value > 0 && !sz.isUnknown && sz.value < 200 * 1024 * 1024) ? sz.value : 16 * 1024 * 1024;
          const tracksBuf = await reader.getSlice(tracksDataStart, tracksDataLen);
          if (tracksBuf) {
            const foundTracks: SubtitleTrackInfo[] = [];
            let trkOffset = 0;
            while (trkOffset < tracksBuf.length) {
              const trkEl = readElementId(tracksBuf, trkOffset);
              if (!trkEl) break;
              const trkSz = readVint(tracksBuf, trkOffset + trkEl.length);
              if (!trkSz) break;

              const valStart = trkOffset + trkEl.length + trkSz.length;
              const valLen = (trkSz.value >= 0 && !trkSz.isUnknown) ? trkSz.value : Math.min(64 * 1024, tracksBuf.length - valStart);
              const valEnd = Math.min(tracksBuf.length, valStart + valLen);

              if (trkEl.id === 0xae || trkEl.id === 0x4e70) {
                let subOffset = valStart;
                let currentTrackType = 0;
                let currentTrackNumber = 0;
                let currentCodecId = '';
                let currentTrackName = '';
                let currentLanguage = '';
                let currentCodecPrivate: Uint8Array | undefined = undefined;

                while (subOffset < valEnd && subOffset < tracksBuf.length) {
                  const subEl = readElementId(tracksBuf, subOffset);
                  if (!subEl) break;
                  const subSz = readVint(tracksBuf, subOffset + subEl.length);
                  if (!subSz) break;

                  const subValStart = subOffset + subEl.length + subSz.length;

                  if (subEl.id === 0x83) { // TrackType (17 = Subtitle, 0x11)
                    currentTrackType = readEbmlUint(tracksBuf, subValStart, subSz.value);
                  } else if (subEl.id === 0xd7) { // TrackNumber
                    currentTrackNumber = readEbmlUint(tracksBuf, subValStart, subSz.value);
                  } else if (subEl.id === 0x86) { // CodecID
                    const bytes = tracksBuf.subarray(subValStart, subValStart + Math.min(subSz.value, 128));
                    currentCodecId = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
                  } else if (subEl.id === 0x63a2) { // CodecPrivate
                    const privateBytes = tracksBuf.subarray(subValStart, subValStart + Math.min(subSz.value, 1024 * 1024));
                    currentCodecPrivate = new Uint8Array(privateBytes);
                  } else if (subEl.id === 0x536e || subEl.id === 0x258688) { // Name / CodecName
                    const bytes = tracksBuf.subarray(subValStart, subValStart + Math.min(subSz.value, 128));
                    currentTrackName = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
                  } else if (subEl.id === 0x22b59c || subEl.id === 0x22b59d) { // Language / LanguageIETF
                    const bytes = tracksBuf.subarray(subValStart, subValStart + Math.min(subSz.value, 64));
                    currentLanguage = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
                  }

                  subOffset = subValStart + (subSz.isUnknown ? 1 : Math.max(1, subSz.value));
                }

                const upperCodecId = currentCodecId.toUpperCase();
                
                // TrackType 17 (0x11) is strictly Subtitle in Matroska specification
                // TrackType 1 is Video, TrackType 2 is Audio
                const isExplicitSubTrack = (currentTrackType === 17 || currentTrackType === 0x11);
                const isCodecSubTrack = upperCodecId.startsWith('S_') ||
                                       upperCodecId.includes('S_TEXT') ||
                                       upperCodecId.includes('S_HDMV') ||
                                       upperCodecId.includes('S_VOBSUB');

                const isSubTrack = (isExplicitSubTrack || isCodecSubTrack) && currentTrackType !== 1 && currentTrackType !== 2;

                if (isSubTrack) {
                  foundTracks.push({
                    trackNumber: currentTrackNumber || (foundTracks.length + 1),
                    language: currentLanguage || undefined,
                    trackName: currentTrackName || undefined,
                    codecId: currentCodecId || 'S_TEXT/UTF8',
                    codecPrivate: currentCodecPrivate,
                  });
                }
              }

              trkOffset = (valLen <= 0 || trkSz.isUnknown) ? trkOffset + 1 : Math.max(trkOffset + 1, valEnd);
            }

            if (foundTracks.length > 0) {
              return {
                hasSubtitles: true,
                codecId: foundTracks[0].codecId,
                trackName: foundTracks[0].trackName || 'Убудаваныя субцітры',
                trackNumber: foundTracks[0].trackNumber,
                tracks: foundTracks,
              };
            }
          }
        }
      }

      // If it is an EBML / MKV / WebM container, finish here - do NOT scan for MP4/MOV atoms!
      return { hasSubtitles: false, tracks: [] };
    } catch (e) {
      console.warn('[srtSubtitleExtractor] Probe failed:', e);
      return { hasSubtitles: false, tracks: [] };
    }
  }

  // Non-MKV: Check if file is MP4 / MOV container before scanning for MP4 atoms
  const mp4Exts = ['mp4', 'm4v', 'mov', '3gp', 'qt', 'mp4a'];
  let isMp4 = mp4Exts.includes(ext);

  if (!isMp4 && fileObj.size > 8) {
    try {
      const readerHeader = new ChunkedFileReader(fileObj);
      const head8 = await readerHeader.getSlice(0, 16);
      if (head8 && head8.length >= 8) {
        const atomType = String.fromCharCode(head8[4], head8[5], head8[6], head8[7]);
        if (['ftyp', 'moov', 'mdat', 'free', 'wide'].includes(atomType)) {
          isMp4 = true;
        }
      }
    } catch {}
  }

  if (isMp4) {
    try {
      const reader = new ChunkedFileReader(fileObj);
      const atomSequences = [
        [0x73, 0x62, 0x74, 0x6C], // 'sbtl'
        [0x74, 0x78, 0x33, 0x67], // 'tx3g'
        [0x77, 0x76, 0x74, 0x74], // 'wvtt'
        [0x73, 0x74, 0x70, 0x70], // 'stpp'
        [0x63, 0x36, 0x30, 0x38], // 'c608'
        [0x63, 0x37, 0x30, 0x38]  // 'c708'
      ];

      let foundAtom = false;
      // Scan moov atom in header or tail (max 8MB)
      const scanLimit = Math.min(reader.length, 8 * 1024 * 1024);
      for (const seq of atomSequences) {
        const headPos = await findByteSequence(reader, seq, scanLimit, 0);
        if (headPos !== -1) {
          foundAtom = true;
          break;
        }
        if (reader.length > 8 * 1024 * 1024) {
          const tailStart = Math.max(0, reader.length - 8 * 1024 * 1024);
          const tailPos = await findByteSequence(reader, seq, 8 * 1024 * 1024, tailStart);
          if (tailPos !== -1) {
            foundAtom = true;
            break;
          }
        }
      }

      if (foundAtom) {
        return {
          hasSubtitles: true,
          codecId: 'MOV_TEXT/MP4',
          trackName: 'Убудаваныя субцітры (MP4/MOV)',
          tracks: [
            { trackNumber: 1, language: 'und', trackName: 'Субцітры MP4 (Дарожка 1)', codecId: 'MOV_TEXT' }
          ]
        };
      }
    } catch (e) {
      console.warn('[srtSubtitleExtractor] MP4 probe error:', e);
    }
  }

  return { hasSubtitles: false, tracks: [] };
}

export const probeSubtitles = probeMkvSubtitles;

/**
 * Pure JS Matroska (.mkv) subtitle demuxer
 */
export async function extractMkvSrtPureJs(
  fileObj: File,
  targetTrackNumber?: number,
  onProgress?: (pct: number, msg: string) => void,
  signal?: AbortSignal
): Promise<string | null> {
  const probe = await probeMkvSubtitles(fileObj);
  if (!probe.hasSubtitles) return null;

  const chosenTrackNumber = targetTrackNumber ?? probe.trackNumber ?? 1;
  const reader = new ChunkedFileReader(fileObj);
  const items: InternalSubItem[] = [];

  let timecodeScale = 1000000; // default 1ms

  // Step 1: Read Segment Info for TimecodeScale
  try {
    const infoPos = await findByteSequence(reader, [0x15, 0x49, 0xA9, 0x66], 16 * 1024 * 1024, 0);
    if (infoPos !== -1) {
      const sz = readVint(await reader.getSlice(infoPos + 4, 8) || new Uint8Array(), 0);
      if (sz) {
        const infoBuf = await reader.getSlice(infoPos + 4 + sz.length, Math.min(64 * 1024, sz.value || 64 * 1024));
        if (infoBuf) {
          let p = 0;
          while (p < infoBuf.length) {
            const el = readElementId(infoBuf, p);
            if (!el) break;
            const elSz = readVint(infoBuf, p + el.length);
            if (!elSz) break;
            const vStart = p + el.length + elSz.length;
            if (el.id === 0x2ad7b1) { // TimecodeScale
              timecodeScale = readEbmlUint(infoBuf, vStart, elSz.value) || 1000000;
              break;
            }
            p = vStart + (elSz.isUnknown ? 1 : Math.max(1, elSz.value));
          }
        }
      }
    }
  } catch {}

  // Step 2: Scan Cluster blocks for subtitle track
  let currentClusterTimecode = 0;
  let pos = 0;
  const totalLen = fileObj.size;
  const decoder = new TextDecoder('utf-8');

  while (pos < totalLen) {
    if (signal?.aborted) return null;

    // Report progress
    const pct = Math.min(95, Math.round(10 + (pos / totalLen) * 85));
    if (onProgress) onProgress(pct, `апрацоўка субцітраў ${pct}%...`);

    // Find next Cluster (0x1F43B675)
    const clusterPos = await findByteSequence(reader, [0x1F, 0x43, 0xB6, 0x75], 32 * 1024 * 1024, pos);
    if (clusterPos === -1) break;

    const clusterSz = readVint(await reader.getSlice(clusterPos + 4, 8) || new Uint8Array(), 0);
    if (!clusterSz) {
      pos = clusterPos + 4;
      continue;
    }

    const clusterHeaderLen = 4 + clusterSz.length;
    const clusterDataStart = clusterPos + clusterHeaderLen;
    const clusterDataLen = (clusterSz.value > 0 && !clusterSz.isUnknown) ? clusterSz.value : 4 * 1024 * 1024;

    const clusterBuf = await reader.getSlice(clusterDataStart, Math.min(clusterDataLen, 8 * 1024 * 1024));
    if (!clusterBuf) {
      pos = clusterDataStart + clusterDataLen;
      continue;
    }

    let cOffset = 0;
    while (cOffset < clusterBuf.length) {
      const cEl = readElementId(clusterBuf, cOffset);
      if (!cEl) break;
      const cSz = readVint(clusterBuf, cOffset + cEl.length);
      if (!cSz) break;

      const valStart = cOffset + cEl.length + cSz.length;
      const valLen = (cSz.value >= 0 && !cSz.isUnknown) ? cSz.value : Math.min(64 * 1024, clusterBuf.length - valStart);

      if (cEl.id === 0xe7) { // Timecode
        currentClusterTimecode = readEbmlUint(clusterBuf, valStart, cSz.value);
      } else if (cEl.id === 0xa3 || cEl.id === 0xa1 || cEl.id === 0xa0) { // SimpleBlock, Block, or BlockGroup
        let blockValStart = valStart;
        let blockValLen = valLen;
        let blockDurationVal = 0;

        if (cEl.id === 0xa0) { // BlockGroup container
          let bgOffset = valStart;
          const bgEnd = Math.min(clusterBuf.length, valStart + valLen);
          while (bgOffset < bgEnd) {
            const bgEl = readElementId(clusterBuf, bgOffset);
            if (!bgEl) break;
            const bgSz = readVint(clusterBuf, bgOffset + bgEl.length);
            if (!bgSz) break;
            const bgValStart = bgOffset + bgEl.length + bgSz.length;
            if (bgEl.id === 0xa1) { // Block
              blockValStart = bgValStart;
              blockValLen = (bgSz.value >= 0 && !bgSz.isUnknown) ? bgSz.value : 64 * 1024;
            } else if (bgEl.id === 0x9b) { // BlockDuration
              blockDurationVal = readEbmlUint(clusterBuf, bgValStart, bgSz.value);
            }
            bgOffset = bgValStart + (bgSz.isUnknown ? 1 : Math.max(1, bgSz.value));
          }
        }

        const trkVint = readVint(clusterBuf, blockValStart);
        if (trkVint && trkVint.value === chosenTrackNumber) {
          const hdrLen = trkVint.length + 3; // trkVint + 2B relTimecode + 1B flags
          if (blockValLen > hdrLen) {
            const p = blockValStart + trkVint.length;
            // Read 16-bit signed relative timecode
            const relTimecode = (clusterBuf[p] << 24 >> 16) | clusterBuf[p + 1];

            const startTimeSec = ((currentClusterTimecode + relTimecode) * timecodeScale) / 1e9;
            let durationSec = blockDurationVal > 0 ? (blockDurationVal * timecodeScale) / 1e9 : 3.0;

            const payloadBytes = clusterBuf.subarray(blockValStart + hdrLen, Math.min(clusterBuf.length, blockValStart + blockValLen));
            let rawText = decoder.decode(payloadBytes);
            let cleanedText = cleanAssSubText(rawText);

            if (cleanedText && startTimeSec >= 0) {
              items.push({
                startTimeSec,
                endTimeSec: startTimeSec + durationSec,
                text: cleanedText
              });
            }
          }
        }
      }

      cOffset = valStart + (cSz.isUnknown ? 1 : Math.max(1, cSz.value));
    }

    pos = clusterDataStart + Math.min(clusterDataLen, clusterBuf.length);
  }

  if (items.length === 0) return null;

  // Sort by startTimeSec
  items.sort((a, b) => a.startTimeSec - b.startTimeSec);

  // Fix duration overlaps
  for (let i = 0; i < items.length - 1; i++) {
    if (items[i].endTimeSec > items[i + 1].startTimeSec) {
      items[i].endTimeSec = Math.max(items[i].startTimeSec + 0.5, items[i + 1].startTimeSec - 0.05);
    }
  }

  // Generate SRT format
  const srtLines: string[] = [];
  items.forEach((item, idx) => {
    const startStr = formatSecondsToSrtTime(item.startTimeSec);
    const endStr = formatSecondsToSrtTime(item.endTimeSec);
    srtLines.push(`${idx + 1}\n${startStr} --> ${endStr}\n${item.text}`);
  });

  return srtLines.join('\n\n');
}

/**
 * FFmpeg WASM Subtitle Extractor (universal fallback for MP4, TS, AVI, MOV, MKV, etc.)
 */
export async function extractSrtWithFFmpegWasm(
  fileObj: File,
  targetTrackIndex?: number,
  onProgress?: (pct: number, msg: string) => void,
  signal?: AbortSignal
): Promise<string | null> {
  let ffmpeg: FFmpeg | null = null;
  const ext = fileObj.name.split('.').pop()?.toLowerCase() || 'mkv';
  const inputName = `input_sub.${ext}`;
  const outputName = 'output_extracted.srt';

  try {
    if (onProgress) onProgress(15, 'загрузка FFmpeg для субцітраў...');
    ffmpeg = await getFFmpeg((pct, msg) => {
      if (onProgress) onProgress(Math.min(30, 15 + Math.round(pct * 0.15)), msg);
    });

    if (signal?.aborted) return null;

    if (onProgress) onProgress(35, 'чытанне файла субцітраў...');
    const subFileData = await readFileAsUint8Array(fileObj);
    if (!subFileData || subFileData.length === 0) {
      throw new Error('Не ўдалося прачытаць дадзеныя файла');
    }
    await ffmpeg.writeFile(inputName, subFileData);

    if (signal?.aborted) return null;

    if (onProgress) onProgress(50, 'апрацоўка субцітраў праз FFmpeg...');

    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg Subtitle Log]:', message);
    });

    const subStreamIndex = targetTrackIndex ?? 0;

    // Run FFmpeg to convert subtitle stream 0:s:X into SRT
    await ffmpeg.exec([
      '-y',
      '-i', inputName,
      '-map', `0:s:${subStreamIndex}?`,
      '-c:s', 'srt',
      outputName
    ]);

    if (signal?.aborted) return null;

    try {
      const data = await ffmpeg.readFile(outputName);
      let text = '';
      if (typeof data === 'string') {
        text = data;
      } else if (data instanceof Uint8Array) {
        text = new TextDecoder('utf-8').decode(data);
      }

      if (text && text.trim().length > 10) {
        // Strip <font ...> and </font> tags generated by FFmpeg MOV_TEXT (tx3g) extraction
        const cleanedText = text.replace(/<\/?font[^>]*>/gi, '').trim();
        if (onProgress) onProgress(100, 'субцітры паспяхова выцягнуты!');
        return cleanedText;
      }
    } catch (e) {
      console.warn('[FFmpeg Subtitle Extractor] Read file output.srt failed:', e);
    }
  } catch (err) {
    console.warn('[FFmpeg Subtitle Extractor] Failed:', err);
  } finally {
    if (ffmpeg) {
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }

  return null;
}

/**
 * Universal Subtitle Extractor entry point
 * Tries pure JS MKV demuxer first, then FFmpeg WASM
 */
export async function extractSrtSubtitles(
  fileObj: File,
  targetTrackNumber?: number,
  targetTrackIndex?: number,
  onProgress?: (pct: number, msg: string) => void,
  signal?: AbortSignal
): Promise<ExtractedSrtResult | null> {
  const baseName = fileObj.name.replace(/\.[^/.]+$/, '');
  const targetSrtFileName = `${baseName}.srt`;

  // Method 1: Pure JS fast Matroska demuxer for MKV/WebM
  const ext = fileObj.name.split('.').pop()?.toLowerCase() || '';
  if (['mkv', 'mka', 'webm'].includes(ext)) {
    if (onProgress) onProgress(10, 'аналіз субцітраў у MKV...');
    const jsResult = await extractMkvSrtPureJs(fileObj, targetTrackNumber, onProgress, signal);
    if (jsResult && jsResult.trim().length > 10) {
      const subtitleCount = (jsResult.match(/\d+\r?\n\d\d:\d\d:/g) || []).length;
      return {
        srtContent: jsResult,
        fileName: targetSrtFileName,
        subtitleCount: subtitleCount || 1,
        codecId: 'S_TEXT/SRT'
      };
    }
  }

  // Method 2: FFmpeg WASM for all video/audio formats
  if (onProgress) onProgress(20, 'запуск FFmpeg для выцягвання субцітраў...');
  const ffResult = await extractSrtWithFFmpegWasm(fileObj, targetTrackIndex, onProgress, signal);
  if (ffResult && ffResult.trim().length > 10) {
    const subtitleCount = (ffResult.match(/\d+\r?\n\d\d:\d\d:/g) || []).length;
    return {
      srtContent: ffResult,
      fileName: targetSrtFileName,
      subtitleCount: subtitleCount || 1,
      codecId: 'SRT'
    };
  }

  return null;
}

/**
 * Universal safe browser file download helper (delays URL revocation to ensure download begins)
 */
export function triggerBrowserDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
  }, 2000);
}

/**
 * Browser file download helper for .srt content
 */
export async function downloadSrtContent(srtContent: string, fileName: string): Promise<string | null> {
  const cleanName = fileName.endsWith('.srt') ? fileName : `${fileName}.srt`;
  return await saveFileUniversal(cleanName, srtContent, 'text/plain;charset=utf-8');
}

function formatAssTime(seconds: number): string {
  if (seconds < 0 || isNaN(seconds)) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centis = Math.floor((seconds % 1) * 100);
  return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

/**
 * Pure JavaScript Matroska (.mkv) Raw Subtitle Stream Extractor
 * Extracts raw subtitle packets directly using ChunkedFileReader without loading multi-GB files into memory.
 * Accurately constructs standard .sup files for PGS (HDMV), .sub/.idx for VobSub, .ass for SSA/ASS, etc.
 */
export async function extractMkvRawSubtitleTrackPureJs(
  fileObj: File,
  chosenTrackNumber: number,
  trackInfo?: SubtitleTrackInfo,
  onProgress?: (pct: number, msg: string) => void,
  signal?: AbortSignal
): Promise<{ blob: Blob; fileName: string } | null> {
  const baseName = fileObj.name.replace(/\.[^/.]+$/, '');
  const trackSuffix = trackInfo?.language ? `.${trackInfo.language}` : trackInfo?.trackNumber ? `.track_${trackInfo.trackNumber}` : '';

  let ext = 'sub';
  const c = (trackInfo?.codecId || '').toUpperCase();
  if (c.includes('HDMV') || c.includes('PGS')) ext = 'sup';
  else if (c.includes('VOBSUB') || c.includes('DVD')) ext = 'sub';
  else if (c.includes('ASS') || c.includes('SSA')) ext = 'ass';
  else if (c.includes('SRT') || c.includes('SUBRIP') || c.includes('UTF8') || c.includes('ASCII')) ext = 'srt';
  else if (c.includes('WEBVTT') || c.includes('VTT')) ext = 'vtt';

  const reader = new ChunkedFileReader(fileObj);
  let timecodeScale = 1000000; // default 1ms

  // Step 1: Read Segment Info for TimecodeScale
  try {
    const infoPos = await findByteSequence(reader, [0x15, 0x49, 0xA9, 0x66], 16 * 1024 * 1024, 0);
    if (infoPos !== -1) {
      const sz = readVint(await reader.getSlice(infoPos + 4, 8) || new Uint8Array(), 0);
      if (sz) {
        const infoBuf = await reader.getSlice(infoPos + 4 + sz.length, Math.min(64 * 1024, sz.value || 64 * 1024));
        if (infoBuf) {
          let p = 0;
          while (p < infoBuf.length) {
            const el = readElementId(infoBuf, p);
            if (!el) break;
            const elSz = readVint(infoBuf, p + el.length);
            if (!elSz) break;
            const vStart = p + el.length + elSz.length;
            if (el.id === 0x2ad7b1) { // TimecodeScale
              timecodeScale = readEbmlUint(infoBuf, vStart, elSz.value) || 1000000;
              break;
            }
            p = vStart + (elSz.isUnknown ? 1 : Math.max(1, elSz.value));
          }
        }
      }
    }
  } catch {}

  // Step 2: Scan Cluster blocks for subtitle track
  let currentClusterTimecode = 0;
  let pos = 0;
  const totalLen = fileObj.size;
  const rawPackets: { startTimeSec: number; durationSec: number; payload: Uint8Array }[] = [];

  while (pos < totalLen) {
    if (signal?.aborted) return null;

    const pct = Math.min(95, Math.round(10 + (pos / totalLen) * 85));
    if (onProgress) onProgress(pct, `чытанне патоку субцітраў ${pct}%...`);

    const clusterPos = await findByteSequence(reader, [0x1F, 0x43, 0xB6, 0x75], 32 * 1024 * 1024, pos);
    if (clusterPos === -1) break;

    const clusterSz = readVint(await reader.getSlice(clusterPos + 4, 8) || new Uint8Array(), 0);
    if (!clusterSz) {
      pos = clusterPos + 4;
      continue;
    }

    const clusterHeaderLen = 4 + clusterSz.length;
    const clusterDataStart = clusterPos + clusterHeaderLen;
    const clusterDataLen = (clusterSz.value > 0 && !clusterSz.isUnknown) ? clusterSz.value : 4 * 1024 * 1024;

    const clusterBuf = await reader.getSlice(clusterDataStart, Math.min(clusterDataLen, 8 * 1024 * 1024));
    if (!clusterBuf) {
      pos = clusterDataStart + clusterDataLen;
      continue;
    }

    let cOffset = 0;
    while (cOffset < clusterBuf.length) {
      const cEl = readElementId(clusterBuf, cOffset);
      if (!cEl) break;
      const cSz = readVint(clusterBuf, cOffset + cEl.length);
      if (!cSz) break;

      const valStart = cOffset + cEl.length + cSz.length;
      const valLen = (cSz.value >= 0 && !cSz.isUnknown) ? cSz.value : Math.min(64 * 1024, clusterBuf.length - valStart);

      if (cEl.id === 0xe7) { // Timecode
        currentClusterTimecode = readEbmlUint(clusterBuf, valStart, cSz.value);
      } else if (cEl.id === 0xa3 || cEl.id === 0xa1 || cEl.id === 0xa0) { // SimpleBlock, Block, or BlockGroup
        let blockValStart = valStart;
        let blockValLen = valLen;
        let blockDurationVal = 0;

        if (cEl.id === 0xa0) { // BlockGroup container
          let bgOffset = valStart;
          const bgEnd = Math.min(clusterBuf.length, valStart + valLen);
          while (bgOffset < bgEnd) {
            const bgEl = readElementId(clusterBuf, bgOffset);
            if (!bgEl) break;
            const bgSz = readVint(clusterBuf, bgOffset + bgEl.length);
            if (!bgSz) break;
            const bgValStart = bgOffset + bgEl.length + bgSz.length;
            if (bgEl.id === 0xa1) { // Block
              blockValStart = bgValStart;
              blockValLen = (bgSz.value >= 0 && !bgSz.isUnknown) ? bgSz.value : 64 * 1024;
            } else if (bgEl.id === 0x9b) { // BlockDuration
              blockDurationVal = readEbmlUint(clusterBuf, bgValStart, bgSz.value);
            }
            bgOffset = bgValStart + (bgSz.isUnknown ? 1 : Math.max(1, bgSz.value));
          }
        }

        const trkVint = readVint(clusterBuf, blockValStart);
        if (trkVint && trkVint.value === chosenTrackNumber) {
          const hdrLen = trkVint.length + 3; // trkVint + 2B relTimecode + 1B flags
          if (blockValLen > hdrLen) {
            const p = blockValStart + trkVint.length;
            const relTimecode = (clusterBuf[p] << 24 >> 16) | clusterBuf[p + 1];
            const startTimeSec = Math.max(0, ((currentClusterTimecode + relTimecode) * timecodeScale) / 1e9);
            const durationSec = blockDurationVal > 0 ? (blockDurationVal * timecodeScale) / 1e9 : 3.0;

            const payloadBytes = clusterBuf.subarray(blockValStart + hdrLen, Math.min(clusterBuf.length, blockValStart + blockValLen));
            if (payloadBytes.length > 0) {
              rawPackets.push({
                startTimeSec,
                durationSec,
                payload: new Uint8Array(payloadBytes)
              });
            }
          }
        }
      }

      cOffset = valStart + (cSz.isUnknown ? 1 : Math.max(1, cSz.value));
    }

    pos = clusterDataStart + Math.min(clusterDataLen, clusterBuf.length);
  }

  if (rawPackets.length === 0) return null;

  // Sort packets by presentation timestamp
  rawPackets.sort((a, b) => a.startTimeSec - b.startTimeSec);

  // Formatting output based on codec
  if (ext === 'sup') {
    // PGS / Blu-ray SUP format: prepend standard 10-byte Blu-ray SUP header to each segment
    const supChunks: Uint8Array[] = [];
    const createSupHeader = (ptsSec: number): Uint8Array => {
      const pts = Math.max(0, Math.round(ptsSec * 90000)) >>> 0;
      const dts = pts;
      return new Uint8Array([
        0x50, 0x47, // 'PG'
        (pts >>> 24) & 0xff,
        (pts >>> 16) & 0xff,
        (pts >>> 8) & 0xff,
        pts & 0xff,
        (dts >>> 24) & 0xff,
        (dts >>> 16) & 0xff,
        (dts >>> 8) & 0xff,
        dts & 0xff
      ]);
    };

    for (const pkt of rawPackets) {
      const pData = pkt.payload;
      // If packet already starts with 'PG' (0x50, 0x47), it already includes the header
      if (pData.length >= 2 && pData[0] === 0x50 && pData[1] === 0x47) {
        supChunks.push(pData);
        continue;
      }

      // In Matroska PGS, each block can contain one or more PGS segments:
      // [segType: 1B, segLen: 2B (big endian), data: segLen B]
      let sOff = 0;
      let parsedCount = 0;
      while (sOff + 3 <= pData.length) {
        const segType = pData[sOff];
        const isPgsType = segType === 0x14 || segType === 0x15 || segType === 0x16 || segType === 0x17 || segType === 0x80;
        const segLen = (pData[sOff + 1] << 8) | pData[sOff + 2];
        const totalSegLen = 3 + segLen;
        if (!isPgsType || sOff + totalSegLen > pData.length) {
          break;
        }
        const singleSeg = pData.subarray(sOff, sOff + totalSegLen);
        supChunks.push(createSupHeader(pkt.startTimeSec));
        supChunks.push(singleSeg);
        sOff += totalSegLen;
        parsedCount++;
      }

      if (parsedCount === 0) {
        supChunks.push(createSupHeader(pkt.startTimeSec));
        supChunks.push(pData);
      }
    }

    const blob = new Blob(supChunks, { type: 'application/octet-stream' });
    return { blob, fileName: `${baseName}${trackSuffix}.sup` };
  }

  if (ext === 'sub') {
    // VobSub or raw MPEG stream
    const subChunks: Uint8Array[] = rawPackets.map(p => p.payload);
    const blob = new Blob(subChunks, { type: 'application/octet-stream' });

    // If CodecPrivate contains VobSub index data (.idx), download .idx too
    if (trackInfo?.codecPrivate && trackInfo.codecPrivate.length > 0) {
      try {
        const idxText = new TextDecoder('utf-8').decode(trackInfo.codecPrivate);
        if (idxText.includes('# VobSub index file') || idxText.includes('size:')) {
          const idxBlob = new Blob([trackInfo.codecPrivate], { type: 'text/plain;charset=utf-8' });
          await saveFileUniversal(`${baseName}${trackSuffix}.idx`, idxBlob, 'text/plain;charset=utf-8');
        }
      } catch {}
    }

    return { blob, fileName: `${baseName}${trackSuffix}.sub` };
  }

  if (ext === 'ass') {
    // SSA/ASS subtitle reconstruction
    let header = trackInfo?.codecPrivate ? new TextDecoder('utf-8').decode(trackInfo.codecPrivate) : '';
    if (!header || !header.includes('[Events]')) {
      header = `[Script Info]\nTitle: Extracted Subtitles\nScriptType: v4.00+\nWrapStyle: 0\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
    }
    if (!header.endsWith('\n')) header += '\n';

    const decoder = new TextDecoder('utf-8');
    const eventLines: string[] = [];
    for (const pkt of rawPackets) {
      const lineText = decoder.decode(pkt.payload).trim();
      if (lineText) {
        if (lineText.startsWith('Dialogue:')) {
          eventLines.push(lineText);
        } else {
          const parts = lineText.split(',');
          const startTime = formatAssTime(pkt.startTimeSec);
          const endTime = formatAssTime(pkt.startTimeSec + pkt.durationSec);
          if (parts.length >= 8) {
            const layer = parts[0] || '0';
            const rest = parts.slice(1).join(',');
            eventLines.push(`Dialogue: ${layer},${startTime},${endTime},${rest}`);
          } else {
            eventLines.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${lineText}`);
          }
        }
      }
    }

    const fullAss = header + eventLines.join('\n') + '\n';
    const blob = new Blob([fullAss], { type: 'text/plain;charset=utf-8' });
    return { blob, fileName: `${baseName}${trackSuffix}.ass` };
  }

  if (ext === 'srt') {
    // SRT format reconstruction
    const decoder = new TextDecoder('utf-8');
    const srtBlocks: string[] = [];
    rawPackets.forEach((pkt, idx) => {
      const startStr = formatSecondsToSrtTime(pkt.startTimeSec);
      const endStr = formatSecondsToSrtTime(pkt.startTimeSec + pkt.durationSec);
      const text = cleanAssSubText(decoder.decode(pkt.payload));
      if (text) {
        srtBlocks.push(`${idx + 1}\n${startStr} --> ${endStr}\n${text}`);
      }
    });
    const blob = new Blob([srtBlocks.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    return { blob, fileName: `${baseName}${trackSuffix}.srt` };
  }

  // Any other format: package raw payloads
  const chunks = rawPackets.map(p => p.payload);
  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  return { blob, fileName: `${baseName}${trackSuffix}.${ext}` };
}

/**
 * Extracts and downloads raw subtitle stream (e.g. for SUP/PGS, VobSub, ASS, etc.)
 * Tries fast pure JS MKV streaming first (works on files of ANY size in seconds).
 * Falls back to FFmpeg WASM if needed.
 */
export async function downloadRawSubtitleTrack(
  fileObj: File,
  targetTrackIndex: number,
  trackInfo?: SubtitleTrackInfo,
  onProgress?: (pct: number, msg: string) => void
): Promise<boolean | 'cancelled'> {
  const chosenTrackNumber = trackInfo?.trackNumber ?? (targetTrackIndex + 1);
  const fileExt = fileObj.name.split('.').pop()?.toLowerCase() || '';

  // Step 1: If file is MKV/WebM, try ultra-fast pure JS demuxer first
  if (['mkv', 'mka', 'webm'].includes(fileExt) || fileObj.name.toLowerCase().endsWith('.mkv')) {
    try {
      if (onProgress) onProgress(10, 'выцягванне дарожкі субцітраў з MKV...');
      const pureJsResult = await extractMkvRawSubtitleTrackPureJs(
        fileObj,
        chosenTrackNumber,
        trackInfo,
        onProgress
      );

      if (pureJsResult && pureJsResult.blob.size > 0) {
        const saved = await saveFileUniversal(pureJsResult.fileName, pureJsResult.blob, 'application/octet-stream');
        if (saved === null) {
          if (onProgress) onProgress(0, 'Захаванне адменена');
          return 'cancelled';
        }
        if (onProgress) onProgress(100, 'спампавана!');
        return true;
      }
    } catch (pureJsErr) {
      console.warn('[downloadRawSubtitleTrack] Pure JS MKV extraction error, falling back to FFmpeg:', pureJsErr);
    }
  }

  // Step 2: Fallback to FFmpeg WASM (for MP4, TS, AVI, MOV, or complex MKVs)
  const baseName = fileObj.name.replace(/\.[^/.]+$/, '');
  const trackSuffix = trackInfo?.language ? `.${trackInfo.language}` : trackInfo?.trackNumber ? `.track_${trackInfo.trackNumber}` : '';

  let ext = 'sub';
  const c = (trackInfo?.codecId || '').toUpperCase();
  if (c.includes('HDMV') || c.includes('PGS')) ext = 'sup';
  else if (c.includes('VOBSUB') || c.includes('DVD')) ext = 'sub';
  else if (c.includes('DVB')) ext = 'sub';
  else if (c.includes('ASS') || c.includes('SSA')) ext = 'ass';
  else if (c.includes('SRT') || c.includes('SUBRIP')) ext = 'srt';

  const downloadFileName = `${baseName}${trackSuffix}.${ext}`;
  const inputExt = fileObj.name.split('.').pop()?.toLowerCase() || 'mkv';
  const inputName = `input_raw_sub.${inputExt}`;
  const outputName = `output_raw.${ext}`;

  let ffmpeg: FFmpeg | null = null;
  try {
    if (onProgress) onProgress(15, 'загрузка модуля FFmpeg...');
    ffmpeg = await getFFmpeg((pct, msg) => {
      if (onProgress) onProgress(Math.min(35, 15 + Math.round(pct * 0.2)), msg);
    });

    if (fileObj.size > 1.2 * 1024 * 1024 * 1024) {
      throw new Error('Памер файла занадта вялікі для FFmpeg у браўзеры (> 1.2GB).');
    }

    if (onProgress) onProgress(40, 'чытанне зыходнага файла...');
    const subFileData = await readFileAsUint8Array(fileObj);
    if (!subFileData || subFileData.length === 0) {
      throw new Error('Не ўдалося прачытаць дадзеныя файла');
    }
    await ffmpeg.writeFile(inputName, subFileData);

    if (onProgress) onProgress(65, 'капіяванне патоку субцітраў...');
    let execCode = -1;
    try {
      execCode = await ffmpeg.exec([
        '-y',
        '-i', inputName,
        '-map', `0:s:${targetTrackIndex}?`,
        '-c:s', 'copy',
        outputName
      ]);
    } catch {}

    let finalOutputName = outputName;
    if (execCode !== 0) {
      // If direct container copy failed, try copying to Matroska subtitle container (.mks)
      finalOutputName = 'output_raw.mks';
      await ffmpeg.exec([
        '-y',
        '-i', inputName,
        '-map', `0:s:${targetTrackIndex}?`,
        '-c:s', 'copy',
        finalOutputName
      ]);
    }

    const data = await ffmpeg.readFile(finalOutputName);
    let uint8: Uint8Array;
    if (typeof data === 'string') {
      uint8 = new TextEncoder().encode(data);
    } else if (data instanceof Uint8Array) {
      uint8 = data;
    } else {
      throw new Error('Нечаканы фармат дадзеных FFmpeg');
    }

    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(finalOutputName); } catch {}

    if (uint8.length > 0) {
      const finalExt = finalOutputName.endsWith('.mks') ? 'mks' : ext;
      const targetFileName = `${baseName}${trackSuffix}.${finalExt}`;
      const blob = new Blob([uint8], { type: 'application/octet-stream' });
      const saved = await saveFileUniversal(targetFileName, blob, 'application/octet-stream');
      if (saved === null) {
        if (onProgress) onProgress(0, 'Захаванне адменена');
        return 'cancelled';
      }
      if (onProgress) onProgress(100, 'спампавана!');
      return true;
    }
  } catch (err) {
    console.warn('[FFmpeg Raw Subtitle Download] Failed:', err);
  } finally {
    if (ffmpeg) {
      try { await ffmpeg.deleteFile(inputName); } catch {}
      try { await ffmpeg.deleteFile(outputName); } catch {}
    }
  }
  return false;
}
