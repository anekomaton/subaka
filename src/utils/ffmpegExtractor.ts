import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { extractAudioForSubtitleGen } from './mkvAudioExtractorForGen';

export async function readFileAsArrayBuffer(file: Blob | File | string): Promise<ArrayBuffer | null> {
  if (!file) return null;
  if (typeof file === 'string') {
    try {
      const res = await fetch(file);
      return await res.arrayBuffer();
    } catch (err) {
      console.warn('Fetching string URL to ArrayBuffer failed:', err);
      return null;
    }
  }
  try {
    return await file.arrayBuffer();
  } catch (err) {
    console.warn('file.arrayBuffer() failed, fallback to FileReader:', err);
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(file);
    });
  }
}

export async function readFileAsUint8Array(file: Blob | File | string | ArrayBuffer | ArrayBufferView): Promise<Uint8Array | null> {
  if (!file) return null;

  // 1. If it's already an ArrayBuffer or ArrayBufferView
  if (file instanceof ArrayBuffer) {
    return new Uint8Array(file);
  }
  if (ArrayBuffer.isView(file)) {
    return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  }

  // 2. If string URL (e.g. blob:http... or http...), fetch it
  if (typeof file === 'string') {
    try {
      const res = await fetch(file);
      const buf = await res.arrayBuffer();
      if (buf && buf.byteLength > 0) return new Uint8Array(buf);
    } catch (err) {
      console.warn('Fetching string URL in readFileAsUint8Array failed:', err);
    }
  }

  // 3. If Blob or File
  if (typeof file === 'object' && file !== null && 'size' in file && typeof (file as Blob).slice === 'function') {
    const blobObj = file as Blob;
    // 3a. Try blobObj.arrayBuffer() - standard modern browser API
    try {
      const buf = await blobObj.arrayBuffer();
      if (buf && buf.byteLength > 0) return new Uint8Array(buf);
    } catch (err) {
      console.warn('file.arrayBuffer() failed:', err);
    }

    // 3b. Try FileReader
    try {
      const buf = await new Promise<ArrayBuffer | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(blobObj);
      });
      if (buf && buf.byteLength > 0) return new Uint8Array(buf);
    } catch (err) {
      console.warn('FileReader failed:', err);
    }

    // 3c. Try fetchFile from @ffmpeg/util
    try {
      const data = await fetchFile(blobObj);
      if (data && data.length > 0) return data;
    } catch (err) {
      console.warn('fetchFile failed:', err);
    }

    // 3d. Chunked read fallback for large files
    try {
      const chunkSize = 16 * 1024 * 1024;
      if (blobObj.size > chunkSize && blobObj.size < 2 * 1024 * 1024 * 1024) {
        const out = new Uint8Array(blobObj.size);
        let offset = 0;
        while (offset < blobObj.size) {
          const slice = blobObj.slice(offset, Math.min(blobObj.size, offset + chunkSize));
          const buf = await slice.arrayBuffer();
          out.set(new Uint8Array(buf), offset);
          offset += chunkSize;
        }
        return out;
      }
    } catch (err) {
      console.warn('Chunked read failed:', err);
    }
  }

  return null;
}

let ffmpegInstance: FFmpeg | null = null;
let isLoading = false;
let isLoaded = false;

function formatFFmpegTime(seconds: number, forceHours = false): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0 || forceHours) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function createFFmpegProgressTracker(
  ffmpeg: FFmpeg,
  onProgress?: (progress: number, message: string) => void,
  startPercent = 25,
  endPercent = 95,
  knownDurationSec = 0
): () => void {
  let totalDurationSec = knownDurationSec > 0 ? knownDurationSec : 0;
  let lastPct = startPercent;
  let lastFormattedTime = '';

  const logHandler = ({ message }: { message: string }) => {
    if (!onProgress || !message) return;

    // Parse Duration: 00:05:12.34 from FFmpeg log whenever present
    const durMatch = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (durMatch) {
      const h = parseFloat(durMatch[1]);
      const m = parseFloat(durMatch[2]);
      const s = parseFloat(durMatch[3]);
      const dur = h * 3600 + m * 60 + s;
      if (dur > 0) {
        totalDurationSec = dur;
      }
    }

    // Parse current time: time=00:01:05.20 or time= 00:01:05
    const timeMatch = message.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (timeMatch) {
      const h = parseFloat(timeMatch[1]);
      const m = parseFloat(timeMatch[2]);
      const s = parseFloat(timeMatch[3]);
      const currentSec = h * 3600 + m * 60 + s;

      let pct = lastPct;
      if (totalDurationSec > 0) {
        const ratio = Math.min(1, Math.max(0, currentSec / totalDurationSec));
        pct = Math.min(endPercent, Math.round(startPercent + ratio * (endPercent - startPercent)));
      }

      const showHours = totalDurationSec >= 3600 || h > 0;
      const timeFormatted = formatFFmpegTime(currentSec, showHours);
      const durFormatted = totalDurationSec > 0 ? ` / ${formatFFmpegTime(totalDurationSec, showHours)}` : '';

      if (pct > lastPct || timeFormatted !== lastFormattedTime) {
        lastPct = Math.max(lastPct, pct);
        lastFormattedTime = timeFormatted;
        onProgress(lastPct, `локал FFmpeg ${lastPct}% (${timeFormatted}${durFormatted})`);
      }
    }
  };

  const progressHandler = ({ progress }: { progress: number }) => {
    if (!onProgress) return;
    if (typeof progress === 'number' && !isNaN(progress) && progress > 0 && progress <= 1) {
      const pct = Math.min(endPercent, Math.round(startPercent + progress * (endPercent - startPercent)));
      if (pct > lastPct) {
        lastPct = pct;
        const durFormatted = totalDurationSec > 0 ? ` / ${formatFFmpegTime(totalDurationSec, totalDurationSec >= 3600)}` : '';
        const msg = lastFormattedTime 
          ? `локал FFmpeg ${pct}% (${lastFormattedTime}${durFormatted})` 
          : `локал FFmpeg ${pct}%`;
        onProgress(pct, msg);
      }
    }
  };

  ffmpeg.on('log', logHandler);
  ffmpeg.on('progress', progressHandler);

  return () => {
    try {
      ffmpeg.off('log', logHandler);
      ffmpeg.off('progress', progressHandler);
    } catch {}
  };
}

/**
 * Initializes and loads FFmpeg WASM instance lazily in browser memory
 */
export async function getFFmpeg(onProgress?: (progress: number, message: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance && isLoaded) {
    return ffmpegInstance;
  }

  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();
    ffmpegInstance.on('log', ({ message }) => {
      if (message) console.log('[FFmpeg WASM Log]:', message);
    });
  }

  if (isLoading) {
    let waitCount = 0;
    while (isLoading && waitCount < 100) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      waitCount++;
    }
    if (isLoaded && ffmpegInstance) return ffmpegInstance;
  }

  try {
    isLoading = true;
    if (onProgress) onProgress(5, 'локал FFmpeg 5%');

    const localEsmJs = `${window.location.origin}/ffmpeg/esm/ffmpeg-core.js`;
    const localEsmWasm = `${window.location.origin}/ffmpeg/esm/ffmpeg-core.wasm`;

    if (onProgress) onProgress(15, 'локал FFmpeg: загрузка модуля 15%');

    try {
      const jsUrl = await toBlobURL(localEsmJs, 'text/javascript');
      const wasmUrl = await toBlobURL(localEsmWasm, 'application/wasm');
      if (onProgress) onProgress(20, 'локал FFmpeg 20%');
      await ffmpegInstance.load({
        coreURL: jsUrl,
        wasmURL: wasmUrl,
      });
    } catch (directErr) {
      console.warn('[FFmpeg WASM] Local load failed, trying CDN fallback:', directErr);
      if (onProgress) onProgress(15, 'локал FFmpeg: загрузка CDN 15%');
      const cdnBase = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';
      const jsUrl = await toBlobURL(`${cdnBase}/ffmpeg-core.js`, 'text/javascript');
      const wasmUrl = await toBlobURL(`${cdnBase}/ffmpeg-core.wasm`, 'application/wasm');
      if (onProgress) onProgress(20, 'локал FFmpeg: ініцыялізацыя CDN 20%');
      await ffmpegInstance.load({
        coreURL: jsUrl,
        wasmURL: wasmUrl,
      });
    }

    if (onProgress) onProgress(25, 'локал FFmpeg 25%');

    isLoaded = true;
    isLoading = false;
    return ffmpegInstance;
  } catch (err) {
    isLoading = false;
    isLoaded = false;
    ffmpegInstance = null;
    console.error('FFmpeg WASM load failed:', err);
    throw err;
  }
}

/**
 * Forcefully terminates the active FFmpeg Web Worker and resets the singleton instance.
 */
export function terminateFFmpegWorker() {
  if (ffmpegInstance) {
    try {
      console.log('[FFmpeg WASM] Force terminating active FFmpeg worker...');
      ffmpegInstance.terminate();
    } catch (e) {
      console.warn('[FFmpeg WASM] Error terminating FFmpeg worker:', e);
    } finally {
      ffmpegInstance = null;
      isLoaded = false;
      isLoading = false;
    }
  }
}

export interface FFmpegExtractionResult {
  blob: Blob;
  mimeType: string;
  fileName: string;
}

export async function getSafeFileBlob(file: Blob | File): Promise<Blob> {
  return file;
}

/**
 * Client-side WebAudio API + WASM Local Audio Decoder.
 */
export async function transcodeRawAudioLocallyWithWasm(
  rawAudioBlob: Blob,
  codecHint: string = '',
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
  knownDurationSec: number = 0
): Promise<Blob | null> {
  const onAbort = () => {
    console.log('[FFmpeg WASM] AbortSignal triggered! Terminating active worker...');
    terminateFFmpegWorker();
  };
  if (signal) {
    if (signal.aborted) {
      terminateFFmpegWorker();
      return null;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    if (signal?.aborted) return null;
    const arrayBuf = await rawAudioBlob.arrayBuffer();
    if (!arrayBuf || arrayBuf.byteLength === 0 || signal?.aborted) return null;

    // 1. Try native WebAudio API AudioContext decoding first (only for formats native to WebAudio like AAC/MP3/WAV)
    const upperCodec = codecHint.toUpperCase();
    const isNonNativeBitstream = upperCodec.includes('AC3') || upperCodec.includes('EAC3') || upperCodec.includes('AC-3') || upperCodec.includes('E-AC-3') || upperCodec.includes('DTS') || upperCodec.includes('TRUEHD') || upperCodec.includes('DOLBY');

    if (!isNonNativeBitstream) {
      try {
        if (onProgress) onProgress(20, 'дэкадаванне праз WebAudio API...');
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          const decodedBuffer = await audioCtx.decodeAudioData(arrayBuf.slice(0));
          if (decodedBuffer && decodedBuffer.duration > 0 && !signal?.aborted) {
            const wavBlob = audioBufferToWavBlob(decodedBuffer);
            audioCtx.close();
            if (wavBlob && wavBlob.size > 0) {
              if (onProgress) onProgress(100, 'апрацоўка аўдыя 100%');
              return wavBlob;
            }
          }
          audioCtx.close();
        }
      } catch (webAudioErr) {
        console.log('[WebAudio API] Native decodeAudioData skipped:', webAudioErr);
      }
    }

    if (signal?.aborted) return null;

    // 2. FFmpeg WASM locally in browser (100% Client-Side Transcode)
    if (onProgress) onProgress(22, 'локал FFmpeg 22%');
    const ffmpeg = await getFFmpeg((pct, msg) => {
      if (onProgress) onProgress(Math.min(36, Math.round(22 + pct * 0.7)), msg);
    });

    if (!ffmpeg || signal?.aborted) {
      return null;
    }

    let ext = 'eac3';
    if (upperCodec.includes('EAC3') || upperCodec.includes('E-AC-3') || upperCodec.includes('EAC-3')) {
      ext = 'eac3';
    } else if (upperCodec.includes('AC3') || upperCodec.includes('AC-3')) {
      ext = 'ac3';
    } else if (upperCodec.includes('DTS')) {
      ext = 'dts';
    } else if (upperCodec.includes('AAC')) {
      ext = 'aac';
    } else if (upperCodec.includes('MP3')) {
      ext = 'mp3';
    }

    const inputName = `raw_input_${Date.now()}.${ext}`;
    const outputNameM4a = `audio_output_${Date.now()}.m4a`;

    if (onProgress) onProgress(38, 'локал FFmpeg 38%');
    const fileData = new Uint8Array(arrayBuf);
    await ffmpeg.writeFile(inputName, fileData);

    if (signal?.aborted) return null;

    let resData: Uint8Array | null = null;
    let mimeType = 'audio/mp4';

    if (onProgress) onProgress(40, 'локал FFmpeg 40%');
    const estimatedDuration = knownDurationSec > 0 ? knownDurationSec : 0;
    const cleanupTracker = createFFmpegProgressTracker(ffmpeg, onProgress, 40, 95, estimatedDuration);
    const downmixFilter = 'aformat=channel_layouts=stereo';

    try {
      // Strategy 0: Fast stream copy into .m4a if input is already AAC (0.01s, zero re-encoding)
      if (ext === 'aac' || upperCodec.includes('AAC')) {
        try {
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-err_detect', 'ignore_err',
            '-i', inputName,
            '-c:a', 'copy',
            '-bsf:a', 'aac_adtstoasc',
            outputNameM4a
          ]);
          const res = await ffmpeg.readFile(outputNameM4a);
          if (res && (res as Uint8Array).length > 512) {
            resData = res as Uint8Array;
            mimeType = 'audio/mp4';
          }
          try { await ffmpeg.deleteFile(outputNameM4a); } catch {}
        } catch (copyErr) {
          console.warn('WASM stream copy for AAC failed, falling back to full transcode:', copyErr);
        }
      }

      // Strategy 1: AAC re-encode without filter (direct downmix via -ac 2)
      if (!resData) {
        try {
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-err_detect', 'ignore_err',
            '-i', inputName,
            '-vn',
            '-sn',
            '-dn',
            '-c:a', 'aac',
            '-b:a', '160k',
            '-ar', '44100',
            '-ac', '2',
            outputNameM4a
          ]);

          const res = await ffmpeg.readFile(outputNameM4a);
          if (res && (res as Uint8Array).length > 512) {
            resData = res as Uint8Array;
            mimeType = 'audio/mp4';
          }
          try { await ffmpeg.deleteFile(outputNameM4a); } catch {}
        } catch (err) {
          console.warn('WASM raw audio AAC transcode without filter failed, trying with filter:', err);
        }
      }

      // Strategy 2: AAC with safe downmix filter
      if (!resData) {
        try {
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-err_detect', 'ignore_err',
            '-i', inputName,
            '-vn',
            '-sn',
            '-dn',
            '-af', downmixFilter,
            '-c:a', 'aac',
            '-b:a', '160k',
            '-ar', '44100',
            '-ac', '2',
            outputNameM4a
          ]);

          const res = await ffmpeg.readFile(outputNameM4a);
          if (res && (res as Uint8Array).length > 512) {
            resData = res as Uint8Array;
            mimeType = 'audio/mp4';
          }
          try { await ffmpeg.deleteFile(outputNameM4a); } catch {}
        } catch (err) {
          console.warn('WASM raw audio AAC transcode with filter failed:', err);
        }
      }

      // Strategy 3: MP3 encoder fallback with '-y'
      if (!resData) {
        const outputNameMp3 = `audio_output_${Date.now()}.mp3`;
        try {
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-i', inputName,
            '-vn',
            '-sn',
            '-dn',
            '-c:a', 'libmp3lame',
            '-q:a', '2',
            '-ar', '44100',
            '-ac', '2',
            outputNameMp3
          ]);

          const res = await ffmpeg.readFile(outputNameMp3);
          if (res && (res as Uint8Array).length > 512) {
            resData = res as Uint8Array;
            mimeType = 'audio/mpeg';
          }
          try { await ffmpeg.deleteFile(outputNameMp3); } catch {}
        } catch (err) {
          console.warn('WASM raw audio MP3 transcode failed:', err);
        }
      }
    } finally {
      cleanupTracker();
    }

    try { await ffmpeg.deleteFile(inputName); } catch {}

    if (resData && resData.length > 512 && !signal?.aborted) {
      if (onProgress) onProgress(100, 'апрацоўка аўдыя 100%');
      return new Blob([resData.buffer], { type: mimeType });
    }
  } catch (err) {
    console.warn('[Method 3 WebAudio+WASM] Local raw audio transcode error:', err);
  }
  return null;
}

/**
 * Pure JS helper to turn AudioBuffer into a playable PCM WAV Blob
 */
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numOfChan = Math.min(buffer.numberOfChannels, 2);
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  const channels: Float32Array[] = [];
  let sample = 0;
  let offset = 0;
  let pos = 0;

  function writeString(str: string) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(pos++, str.charCodeAt(i));
    }
  }

  writeString('RIFF');
  view.setUint32(pos, length - 8, true); pos += 4;
  writeString('WAVE');
  writeString('fmt ');
  view.setUint32(pos, 16, true); pos += 4;
  view.setUint16(pos, 1, true); pos += 2;
  view.setUint16(pos, numOfChan, true); pos += 2;
  view.setUint32(pos, buffer.sampleRate, true); pos += 4;
  view.setUint32(pos, buffer.sampleRate * 2 * numOfChan, true); pos += 4;
  view.setUint16(pos, numOfChan * 2, true); pos += 2;
  view.setUint16(pos, 16, true); pos += 2;
  writeString('data');
  view.setUint32(pos, length - pos - 4, true); pos += 4;

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (offset < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([out], { type: 'audio/wav' });
}

/**
 * 100% Client-Side FFmpeg WASM Audio Extraction for any video/audio file (MKV, AC3, EAC3, M4A, DTS, etc.)
 */
export async function extractAudioWithFFmpeg(
  file: File,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
  knownDurationSec: number = 0,
  audioTrackIndex?: number
): Promise<FFmpegExtractionResult | null> {
  const onAbort = () => {
    console.log('[FFmpeg WASM] AbortSignal triggered in extractAudioWithFFmpeg! Terminating active worker...');
    terminateFFmpegWorker();
  };
  if (signal) {
    if (signal.aborted) {
      terminateFFmpegWorker();
      return null;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    if (signal?.aborted) return null;

    if (file.size > 1024 * 1024 * 1024 && (file.type.startsWith('video/') || !file.type.startsWith('audio/'))) {
      console.warn('[FFmpeg WASM] Skipping direct video WASM allocation (>1GB) to protect browser memory.');
      return null;
    }

    const ffmpeg = await getFFmpeg(onProgress);

    const extMatch = file.name ? file.name.match(/\.([a-zA-Z0-9]+)$/) : null;
    const ext = extMatch ? extMatch[1].toLowerCase() : 'mkv';
    const inputName = `input_${Date.now()}.${ext}`;

    if (onProgress) onProgress(15, 'локал FFmpeg 15%');
    
    const fileData = await readFileAsUint8Array(file);

    if (!fileData || fileData.length === 0) {
      throw new Error('Не ўдалося прачытаць дадзеныя файла');
    }

    if (signal?.aborted) return null;

    if (onProgress) onProgress(22, 'локал FFmpeg 22%');
    await ffmpeg.writeFile(inputName, fileData);

    if (onProgress) onProgress(25, 'локал FFmpeg 25%');

    const outputNameM4a = `output_${Date.now()}.m4a`;
    let data: Uint8Array | null = null;
    let mimeType = 'audio/mp4';
    let outputExt = 'm4a';
    let success = false;

    const cleanupTracker = createFFmpegProgressTracker(ffmpeg, onProgress, 25, 95, knownDurationSec);
    const downmixFilter = 'aformat=channel_layouts=stereo';

    const mapSpec = audioTrackIndex !== undefined && audioTrackIndex >= 0 ? `0:a:${audioTrackIndex}` : '0:a?';

    try {
      // Strategy 0: Fast native stream copy (-c:a copy) ONLY if input is already AAC/M4A (0.01s)
      const isAlreadyAac = ext === 'aac' || ext === 'm4a';
      if (isAlreadyAac) {
        try {
          const copyOutputName = `output_copy_${Date.now()}.m4a`;
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-err_detect', 'ignore_err',
            '-i', inputName,
            '-vn',
            '-sn',
            '-dn',
            '-map', mapSpec,
            '-c:a', 'copy',
            copyOutputName
          ]);

          const res = await ffmpeg.readFile(copyOutputName);
          if (res && (res as Uint8Array).length > 512) {
            data = res as Uint8Array;
            mimeType = 'audio/mp4';
            outputExt = 'm4a';
            success = true;
            console.log('[FFmpeg WASM] Fast native stream copy succeeded (0% re-encoding)!');
          }
          try { await ffmpeg.deleteFile(copyOutputName); } catch {}
        } catch (err) {
          console.log('[FFmpeg WASM] Direct stream copy skipped, falling back to encoder:', err);
        }
      }

      // Strategy 1: AAC encoder without filter (direct downmix via -ac 2)
      if (!success) {
        try {
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
          '-avoid_negative_ts', 'make_zero',
          '-err_detect', 'ignore_err',
          '-i', inputName,
          '-vn',
          '-sn',
          '-dn',
          '-map', mapSpec,
          '-c:a', 'aac',
          '-b:a', '160k',
          '-ar', '44100',
          '-ac', '2',
          outputNameM4a
        ]);

        const res = await ffmpeg.readFile(outputNameM4a);
        if (res && (res as Uint8Array).length > 512) {
          data = res as Uint8Array;
          mimeType = 'audio/mp4';
          outputExt = 'm4a';
          success = true;
        }
        try { await ffmpeg.deleteFile(outputNameM4a); } catch {}
      } catch (err) {
        console.warn('FFmpeg WASM AAC transcode without filter failed, trying with filter:', err);
      }
    }

      // Strategy 2: AAC encoder with safe downmix filter
      if (!success) {
        try {
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-err_detect', 'ignore_err',
            '-i', inputName,
            '-vn',
            '-sn',
            '-dn',
            '-map', mapSpec,
            '-af', downmixFilter,
            '-c:a', 'aac',
            '-b:a', '160k',
            '-ar', '44100',
            '-ac', '2',
            outputNameM4a
          ]);

          const res = await ffmpeg.readFile(outputNameM4a);
          if (res && (res as Uint8Array).length > 512) {
            data = res as Uint8Array;
            mimeType = 'audio/mp4';
            outputExt = 'm4a';
            success = true;
          }
          try { await ffmpeg.deleteFile(outputNameM4a); } catch {}
        } catch (err) {
          console.warn('FFmpeg WASM AAC transcode with filter failed:', err);
        }
      }

      // Strategy 3: MP3 encoder fallback
      if (!success) {
        const outputNameMp3 = `output_${Date.now()}.mp3`;
        try {
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-i', inputName,
            '-vn',
            '-sn',
            '-dn',
            '-map', '0:a:0?',
            '-c:a', 'libmp3lame',
            '-q:a', '2',
            '-ar', '44100',
            '-ac', '2',
            outputNameMp3
          ]);

          const res = await ffmpeg.readFile(outputNameMp3);
          if (res && (res as Uint8Array).length > 512) {
            data = res as Uint8Array;
            mimeType = 'audio/mpeg';
            outputExt = 'mp3';
            success = true;
          }
          try { await ffmpeg.deleteFile(outputNameMp3); } catch {}
        } catch (err) {
          console.warn('FFmpeg WASM MP3 transcode failed:', err);
        }
      }

      // Strategy 4: PCM WAV fallback (100% universal compatibility)
      if (!success) {
        const outputNameWav = `output_${Date.now()}.wav`;
        try {
          await ffmpeg.exec([
            '-y',
            '-fflags', '+genpts+igndts+discardcorrupt',
            '-avoid_negative_ts', 'make_zero',
            '-i', inputName,
            '-vn',
            '-sn',
            '-dn',
            '-map', '0:a:0?',
            '-c:a', 'pcm_s16le',
            '-ar', '44100',
            '-ac', '2',
            outputNameWav
          ]);

          const res = await ffmpeg.readFile(outputNameWav);
          if (res && (res as Uint8Array).length > 512) {
            data = res as Uint8Array;
            mimeType = 'audio/wav';
            outputExt = 'wav';
            success = true;
          }
          try { await ffmpeg.deleteFile(outputNameWav); } catch {}
        } catch (err) {
          console.warn('FFmpeg WASM WAV transcode failed:', err);
        }
      }
    } finally {
      cleanupTracker();
      try { await ffmpeg.deleteFile(inputName); } catch {}
    }

    if (success && data && data.length > 0) {
      const blob = new Blob([data.buffer], { type: mimeType });
      if (onProgress) onProgress(100, 'апрацоўка аўдыя 100%');
      return {
        blob,
        mimeType,
        fileName: `${file.name.replace(/\.[^/.]+$/, '')}.${outputExt}`
      };
    } else {
      throw new Error('FFmpeg не змог транскадаваць аўдыядарожку');
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || signal?.aborted) return null;
    console.error('Client-side FFmpeg extraction failed:', err);
    throw err;
  }
}

/**
 * High-performance Server-Side Native FFmpeg Audio Transcoding.
 * Uses native system `ffmpeg` on backend for instant processing of raw audio streams.
 */
export async function transcodeRawAudioOnServer(
  rawAudioBlob: Blob | File,
  codecHint: string = '',
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal,
  trackNumber?: number
): Promise<Blob | null> {
  try {
    if (signal?.aborted) return null;

    if (rawAudioBlob.size > 150 * 1024 * 1024 && (rawAudioBlob.type.startsWith('video/') || (rawAudioBlob as File).name?.match(/\.(mp4|mov|mkv|avi|webm|ts|m4v)$/i))) {
      console.warn('[Server FFmpeg] Prevented uploading large video container (>150MB) to backend. Local demuxing required.');
      return null;
    }

    const totalSize = rawAudioBlob.size;
    const originalName = (rawAudioBlob as File).name || 'audio.bin';
    console.log(`[Server FFmpeg] Sending media file "${originalName}" (${Math.round(totalSize / 1024 / 1024)}MB, codec: "${codecHint}", track: ${trackNumber || 1}) to backend native FFmpeg...`);
    if (onProgress) onProgress(30, 'сервер FFmpeg 30%');

    // Small files <= 15MB: fast single POST
    if (totalSize <= 15 * 1024 * 1024) {
      if (onProgress) onProgress(40, 'сервер FFmpeg 40%');
      const res = await fetch(`/api/transcode-audio?codec=${encodeURIComponent(codecHint)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-audio-codec': encodeURIComponent(codecHint || ''),
          'x-file-name': encodeURIComponent(originalName || 'audio.bin')
        },
        body: rawAudioBlob,
        signal
      });
      if (res.ok) {
        const resultBlob = await res.blob();
        if (resultBlob && resultBlob.size > 512) {
          if (onProgress) onProgress(100, 'сервер FFmpeg 100%');
          return resultBlob;
        }
      }
      return null;
    }

    // Large files (>15MB): Chunked streaming upload to native server FFmpeg
    if (onProgress) onProgress(30, 'сервер FFmpeg: перадача 30%');
    const startRes = await fetch('/api/transcode-audio/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: originalName, totalSize, codec: codecHint, trackNumber }),
      signal
    });

    if (!startRes.ok) throw new Error('Server transcode session start failed');
    const { uploadId } = await startRes.json();
    if (!uploadId || signal?.aborted) return null;

    const chunkSize = 5 * 1024 * 1024; // 5MB chunk
    let offset = 0;
    while (offset < totalSize) {
      if (signal?.aborted) return null;
      const chunk = rawAudioBlob.slice(offset, offset + chunkSize);
      const chunkRes = await fetch(`/api/transcode-audio/chunk?uploadId=${encodeURIComponent(uploadId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk,
        signal
      });
      if (!chunkRes.ok) throw new Error('Server transcode chunk upload failed');
      offset += chunk.size;
      const pct = Math.min(75, Math.round(30 + (offset / totalSize) * 45));
      if (onProgress) onProgress(pct, `сервер FFmpeg: перадача ${pct}%`);
    }

    if (onProgress) onProgress(80, 'сервер FFmpeg 80%');
    const finishRes = await fetch('/api/transcode-audio/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId, codec: codecHint, trackNumber }),
      signal
    });

    if (finishRes.ok) {
      const resultBlob = await finishRes.blob();
      if (resultBlob && resultBlob.size > 512) {
        if (onProgress) onProgress(100, 'сервер FFmpeg 100%');
        return resultBlob;
      }
    }
  } catch (err) {
    console.warn('[Server Native FFmpeg] Audio transcode error:', err);
  }
  return null;
}

/**
 * Fast Stream-Copy helper: Packages raw ADTS AAC frames into an M4A (.mp4) container
 * with ZERO audio re-encoding or transcoding (takes ~0.02 seconds).
 */
export async function convertAacAdtsToM4aStreamCopy(
  aacBlob: Blob,
  signal?: AbortSignal
): Promise<Blob | null> {
  try {
    const ffmpeg = await getFFmpeg();
    if (!ffmpeg || signal?.aborted) return null;

    const inputName = `stream_input_${Date.now()}.aac`;
    const outputName = `stream_output_${Date.now()}.m4a`;

    const arrayBuf = await aacBlob.arrayBuffer();
    await ffmpeg.writeFile(inputName, new Uint8Array(arrayBuf));

    if (signal?.aborted) return null;

    await ffmpeg.exec([
      '-y',
      '-f', 'aac',
      '-i', inputName,
      '-c:a', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      outputName
    ]);

    const res = await ffmpeg.readFile(outputName);
    try { await ffmpeg.deleteFile(inputName); } catch {}
    try { await ffmpeg.deleteFile(outputName); } catch {}

    if (res && (res as Uint8Array).length > 512) {
      return new Blob([res as Uint8Array], { type: 'audio/mp4' });
    }
  } catch (err) {
    console.warn('[AAC Stream Copy] Fast M4A packaging failed:', err);
  }
  return null;
}

/**
 * Dedicated local FFmpeg preparation for Subtitle Generation.
 * Extracts the active audio track from video/media containers in browser WASM
 * into a clean 16kHz mono AAC or WAV file optimized for Gemini speech-to-text.
 * Operates SEPARATELY from the player playback engine to avoid interrupting playback.
 */
export async function prepareAudioForTranscriptionLocally(
  mediaFile: File,
  trackNumber: number = 1,
  onProgress?: (progress: number, message: string) => void,
  signal?: AbortSignal
): Promise<File | null> {
  if (signal?.aborted) return null;

  // 1. If mediaFile is already a standalone audio file (<= 80MB, audio/*), return as-is
  const fileExt = mediaFile.name ? mediaFile.name.toLowerCase().split('.').pop() || '' : '';
  const isAudioType = mediaFile.type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'].includes(fileExt);
  
  if (isAudioType && mediaFile.size <= 80 * 1024 * 1024) {
    console.log('[Transcribe Local Prep] Input is already a small audio file.');
    return mediaFile;
  }

  // 2. Video container check: MP4, MOV, WebM, M4V, AVI, etc. MUST be processed by native server FFmpeg.
  // Demuxing MP4/MOV in pure JS into synthetic ADTS headers causes severe sample rate mismatches
  // (e.g. 32kHz/48kHz treated as 44.1kHz, stretching audio and desyncing timestamps).
  // Native Linux FFmpeg on server extracts pristine frame-accurate 16kHz WAV in <1s.
  const isVideoContainer = ['mp4', 'mov', 'm4v', 'webm', 'avi', '3gp', 'qt', 'ts', 'flv'].includes(fileExt) ||
                           mediaFile.type.startsWith('video/') || mediaFile.type.includes('mp4') || mediaFile.type.includes('quicktime');
  
  if (isVideoContainer) {
    console.log(`[Transcribe Local Prep] Video container (${mediaFile.name}) delegated directly to native server FFmpeg for 100% frame accuracy.`);
    return null;
  }

  // 3. For MKV files under 250MB, native server FFmpeg is faster and 100% accurate
  if (mediaFile.size <= 250 * 1024 * 1024) {
    console.log(`[Transcribe Local Prep] Media file <= 250MB (${mediaFile.name}) delegated to native server FFmpeg.`);
    return null;
  }

  // 4. For very large MKV files (> 250MB), use streaming JS demuxing
  try {
    const extractedFile = await extractAudioForSubtitleGen(mediaFile, trackNumber, onProgress, signal);
    if (extractedFile && extractedFile.size > 512) {
      console.log(`[Transcribe Local Prep] mkvAudioExtractorForGen successfully extracted complete audio track: ${extractedFile.name} (${Math.round(extractedFile.size / 1024 / 1024)}MB)`);
      return extractedFile;
    }
  } catch (genErr) {
    console.warn('[Transcribe Local Prep] mkvAudioExtractorForGen error:', genErr);
  }

  // Fallback: Native server FFmpeg
  console.log('[Transcribe Local Prep] Streaming JS demuxing returned null; delegating to native server FFmpeg.');
  return null;
}

