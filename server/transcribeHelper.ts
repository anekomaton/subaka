import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

export const execFilePromise = promisify(execFile);

export interface AudioStreamInfo {
  index: number;
  audioIndex: number;
  codec: string;
  channels: number;
  sampleRate: number;
  language?: string;
  title?: string;
  isDefault?: boolean;
}

export async function getAudioStreamsInfo(filePath: string): Promise<AudioStreamInfo[]> {
  try {
    const { stdout } = await execFilePromise("ffprobe", [
      "-v", "error",
      "-analyzeduration", "100000000",
      "-probesize", "100000000",
      "-select_streams", "a",
      "-show_entries", "stream=index,codec_name,channels,sample_rate,disposition:stream_tags=language,title",
      "-of", "json",
      filePath
    ]);
    const parsed = JSON.parse(stdout);
    if (parsed && Array.isArray(parsed.streams)) {
      return parsed.streams.map((s: any, aIdx: number) => ({
        index: typeof s.index === 'number' ? s.index : parseInt(s.index, 10),
        audioIndex: aIdx,
        codec: s.codec_name || 'unknown',
        channels: s.channels || 2,
        sampleRate: s.sample_rate ? parseInt(s.sample_rate, 10) : 48000,
        language: s.tags?.language,
        title: s.tags?.title,
        isDefault: s.disposition?.default === 1
      }));
    }
  } catch (err) {
    console.warn(`[Transcribe Helper] ffprobe audio streams probe error:`, err);
  }
  return [];
}

export interface TrackExtractionOptions {
  language?: string;
  title?: string;
  mkvTrackNumber?: number;
}

export async function extractAudioWithFfmpeg(
  inputFilePath: string,
  outputAudioPath: string,
  trackNumber?: number,
  trackOptions?: TrackExtractionOptions
): Promise<boolean> {
  const isMultiTrackRequested = Boolean(trackNumber && trackNumber > 1);
  const trackMsg = isMultiTrackRequested 
    ? ` (дарожка #${trackNumber}${trackOptions?.language ? `, мова: ${trackOptions.language}` : ''})` 
    : "";
  console.log(`[Transcribe Helper] Extracting clean 16kHz WAV audio with ffmpeg from: ${inputFilePath}${trackMsg}`);

  const fileNameLower = path.basename(inputFilePath).toLowerCase();
  const isStandaloneAudio = ['.aac', '.m4a', '.wav', '.mp3', '.ogg', '.flac', '.opus', '.wma'].some(ext => fileNameLower.endsWith(ext)) || fileNameLower.includes('_subtitles_track');

  let audioStreams: AudioStreamInfo[] = [];
  if (!isStandaloneAudio) {
    audioStreams = await getAudioStreamsInfo(inputFilePath);
    console.log(`[Transcribe Helper] Probed ${audioStreams.length} audio stream(s) in: ${inputFilePath}`);
  }

  // Build list of map arguments to attempt in order
  const mapAttempts: string[][] = [];

  const targetTrackIdx = trackNumber && trackNumber >= 1 ? trackNumber - 1 : 0;
  
  // Try matching stream by language/title if provided, otherwise by audioIndex
  let targetStream: AudioStreamInfo | undefined = undefined;
  if (trackOptions?.language && audioStreams.length > 0) {
    targetStream = audioStreams.find(s => s.language?.toLowerCase() === trackOptions.language?.toLowerCase());
  }
  if (!targetStream && trackOptions?.title && audioStreams.length > 0) {
    targetStream = audioStreams.find(s => s.title?.toLowerCase().includes(trackOptions.title!.toLowerCase()));
  }
  if (!targetStream) {
    targetStream = audioStreams[targetTrackIdx];
  }

  if (isMultiTrackRequested) {
    // STRICT MULTI-TRACK SELECTION:
    // When the user explicitly requested track > 1, NEVER fall back to track 1 or omit -map!
    console.log(`[Transcribe Helper] Strict track extraction active for track #${trackNumber} (0-based audioIndex: ${targetTrackIdx})`);
    
    // 1. Audio-relative stream index (0:a:${targetTrackIdx})
    mapAttempts.push(["-map", `0:a:${targetTrackIdx}`]);

    // 2. Exact container stream index if known
    if (targetStream && typeof targetStream.index === 'number') {
      mapAttempts.push(["-map", `0:${targetStream.index}`]);
    }

    // 3. Language metadata match if known
    if (trackOptions?.language) {
      mapAttempts.push(["-map", `0:m:language:${trackOptions.language}`]);
    } else if (targetStream?.language) {
      mapAttempts.push(["-map", `0:m:language:${targetStream.language}`]);
    }

    // 4. MKV track number fallback
    if (trackOptions?.mkvTrackNumber && trackOptions.mkvTrackNumber !== targetTrackIdx) {
      mapAttempts.push(["-map", `0:a:${trackOptions.mkvTrackNumber - 1}`]);
      mapAttempts.push(["-map", `0:${trackOptions.mkvTrackNumber}`]);
    }
  } else {
    // Default track 1
    if (targetStream && typeof targetStream.index === 'number') {
      mapAttempts.push(["-map", `0:${targetStream.index}`]);
    }
    mapAttempts.push(["-map", "0:a:0"]);
    mapAttempts.push([]);
  }

  for (let i = 0; i < mapAttempts.length; i++) {
    const mapArgs = mapAttempts[i];
    try {
      const toleranceArgs = ["-analyzeduration", "100000000", "-probesize", "100000000", "-err_detect", "ignore_err", "-fflags", "+discardcorrupt"];
      const args = [
        ...toleranceArgs,
        "-i", inputFilePath,
        ...mapArgs,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        outputAudioPath,
        "-y"
      ];

      await execFilePromise("ffmpeg", args, {
        maxBuffer: 1024 * 1024 * 50
      });

      if (fs.existsSync(outputAudioPath) && fs.statSync(outputAudioPath).size > 100) {
        console.log(`[Transcribe Helper] Successfully extracted WAV audio (attempt ${i + 1}, map: ${mapArgs.join(' ')}): ${outputAudioPath} (${fs.statSync(outputAudioPath).size} bytes)`);
        return true;
      }
    } catch (err: any) {
      console.warn(`[Transcribe Helper] ffmpeg audio extraction attempt ${i + 1} (${mapArgs.join(' ')}) failed: ${err?.message || err}`);
    }
  }

  // Extra fallback attempt:
  // ONLY use fallback mapping matching the requested track. NEVER omit -map when track > 1!
  try {
    const fallbackMap = isMultiTrackRequested ? ["-map", `0:a:${targetTrackIdx}`] : [];
    const extraArgs = [
      "-analyzeduration", "100000000",
      "-probesize", "100000000",
      "-err_detect", "ignore_err",
      "-fflags", "+discardcorrupt",
      "-max_error_rate", "1.0",
      "-i", inputFilePath,
      ...fallbackMap,
      "-vn",
      "-ac", "1",
      "-ar", "16000",
      "-c:a", "pcm_s16le",
      outputAudioPath,
      "-y"
    ];
    await execFilePromise("ffmpeg", extraArgs, { maxBuffer: 1024 * 1024 * 50 });
    if (fs.existsSync(outputAudioPath) && fs.statSync(outputAudioPath).size > 100) {
      console.log(`[Transcribe Helper] Successfully extracted WAV audio with extra fallback: ${outputAudioPath} (${fs.statSync(outputAudioPath).size} bytes)`);
      return true;
    }
  } catch (err: any) {
    console.warn(`[Transcribe Helper] Extra fallback audio extraction failed: ${err?.message || err}`);
  }

  if (isMultiTrackRequested) {
    console.error(`[Transcribe Helper] Failed to extract requested audio track #${trackNumber}. Will NOT fallback to track 1.`);
    return false;
  }

  // AAC/subtitles rescue pass with max_error_rate 1.0
  if (inputFilePath.toLowerCase().endsWith(".aac") || inputFilePath.includes("_subtitles_track")) {
    try {
      console.log(`[Transcribe Helper] Attempting audio stream rescue pass...`);
      const rawArgs = [
        "-analyzeduration", "50000000",
        "-probesize", "50000000",
        "-err_detect", "ignore_err",
        "-fflags", "+discardcorrupt",
        "-max_error_rate", "1.0",
        "-i", inputFilePath,
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-c:a", "pcm_s16le",
        outputAudioPath,
        "-y"
      ];
      await execFilePromise("ffmpeg", rawArgs, { maxBuffer: 1024 * 1024 * 50 });
      if (fs.existsSync(outputAudioPath) && fs.statSync(outputAudioPath).size > 100) {
        console.log(`[Transcribe Helper] Successfully rescued raw AAC audio: ${outputAudioPath}`);
        return true;
      }
    } catch (rawErr: any) {
      console.warn(`[Transcribe Helper] Raw AAC stream rescue pass failed: ${rawErr?.message || rawErr}`);
    }
  }

  // Final fallback: If inputFilePath was a extracted track (e.g. .aac) and failed, check if original media file exists in the directory
  try {
    const dir = path.dirname(inputFilePath);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const originalMedia = files.find(f => {
        const p = path.join(dir, f);
        if (p === inputFilePath || p === outputAudioPath) return false;
        const ext = path.extname(f).toLowerCase();
        return ['.mkv', '.mp4', '.mov', '.avi', '.webm', '.mka', '.m4v'].includes(ext) && fs.statSync(p).size > 1000;
      });

      if (originalMedia) {
        const fullOriginalPath = path.join(dir, originalMedia);
        console.log(`[Transcribe Helper] Input file failed; falling back to original media file in directory: ${fullOriginalPath}`);
        const fbArgs = [
          "-analyzeduration", "20000000",
          "-probesize", "20000000",
          "-err_detect", "ignore_err",
          "-fflags", "+discardcorrupt",
          "-i", fullOriginalPath,
          "-vn",
          "-ac", "1",
          "-ar", "16000",
          "-c:a", "pcm_s16le",
          outputAudioPath,
          "-y"
        ];
        await execFilePromise("ffmpeg", fbArgs, { maxBuffer: 1024 * 1024 * 50 });
        if (fs.existsSync(outputAudioPath) && fs.statSync(outputAudioPath).size > 100) {
          console.log(`[Transcribe Helper] Successfully extracted WAV audio from original media file fallback: ${outputAudioPath}`);
          return true;
        }
      }
    }
  } catch (err: any) {
    console.warn(`[Transcribe Helper] Directory media fallback failed: ${err?.message || err}`);
  }

  return false;
}

export async function getMediaDurationInSeconds(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFilePromise("ffprobe", [
      "-v", "error",
      "-analyzeduration", "10000000",
      "-probesize", "10000000",
      "-show_entries", "format=duration:stream=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath
    ], {
      maxBuffer: 1024 * 1024 * 10
    });
    const lines = stdout.trim().split(/\r?\n/);
    for (const line of lines) {
      const val = parseFloat(line.trim());
      if (!isNaN(val) && val > 0) {
        return val;
      }
    }
  } catch (err: any) {
    console.warn("[Transcribe Helper] ffprobe duration check failed:", err?.message || err);
  }

  // Fallback: Parse duration from ffmpeg stderr output if ffprobe format/stream duration failed
  try {
    const { stderr } = await execFilePromise("ffmpeg", [
      "-analyzeduration", "10000000",
      "-probesize", "10000000",
      "-i", filePath,
      "-f", "null", "-"
    ], {
      maxBuffer: 1024 * 1024 * 10
    });
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      const hours = parseFloat(match[1]);
      const minutes = parseFloat(match[2]);
      const seconds = parseFloat(match[3]);
      const totalSec = hours * 3600 + minutes * 60 + seconds;
      if (totalSec > 0) {
        return totalSec;
      }
    }
  } catch (err: any) {
    // FFmpeg exits non-zero on some null renders, but stderr may still contain Duration
    const stderrText = err?.stderr || '';
    const match = stderrText.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      const hours = parseFloat(match[1]);
      const minutes = parseFloat(match[2]);
      const seconds = parseFloat(match[3]);
      const totalSec = hours * 3600 + minutes * 60 + seconds;
      if (totalSec > 0) {
        return totalSec;
      }
    }
  }

  return 0;
}

export interface AudioSegment {
  filePath: string;
  startSec: number;
  endSec: number;
}

export async function detectSilencePoints(audioFilePath: string): Promise<number[]> {
  try {
    const { stderr } = await execFilePromise(
      "ffmpeg",
      ["-i", audioFilePath, "-af", "silencedetect=noise=-30dB:d=0.4", "-f", "null", "-"],
      { maxBuffer: 1024 * 1024 * 20 }
    );
    
    const silenceMidpoints: number[] = [];
    const lines = stderr.split('\n');
    let currentStart: number | null = null;

    for (const line of lines) {
      if (line.includes("silence_start:")) {
        const match = line.match(/silence_start:\s*([\d.]+)/);
        if (match) currentStart = parseFloat(match[1]);
      } else if (line.includes("silence_end:")) {
        const match = line.match(/silence_end:\s*([\d.]+)/);
        if (match && currentStart !== null) {
          const end = parseFloat(match[1]);
          const mid = (currentStart + end) / 2;
          silenceMidpoints.push(mid);
          currentStart = null;
        }
      }
    }
    return silenceMidpoints;
  } catch (err: any) {
    console.warn("[Transcribe Helper] silencedetect execution warning:", err?.message || err);
    return [];
  }
}

export async function segmentAudioBySilence(
  audioFilePath: string,
  outputDir: string,
  totalDurationSec: number,
  targetChunkDurationSec: number = 60,
  trackNumber?: number
): Promise<AudioSegment[]> {
  fs.mkdirSync(outputDir, { recursive: true });

  let masterWavPath = audioFilePath;

  // Pre-convert to a single uncompressed 16kHz PCM WAV if input is not WAV
  // This ensures 100% reliable frame-accurate seeking without AAC frame header errors
  if (!audioFilePath.toLowerCase().endsWith('.wav')) {
    const masterWav = path.join(outputDir, "full_master_16k.wav");
    const mapArgs = trackNumber && trackNumber > 1 ? ["-map", `0:a:${trackNumber - 1}`] : [];
    try {
      console.log(`[Transcribe Helper] Pre-converting input audio (${path.basename(audioFilePath)}) to master 16kHz PCM WAV for robust chunking...`);
      await execFilePromise(
        "ffmpeg",
        [
          "-analyzeduration", "50000000",
          "-probesize", "50000000",
          "-err_detect", "ignore_err",
          "-i", audioFilePath,
          ...mapArgs,
          "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
          masterWav,
          "-y"
        ],
        { maxBuffer: 1024 * 1024 * 50 }
      );
      if (fs.existsSync(masterWav) && fs.statSync(masterWav).size > 1000) {
        masterWavPath = masterWav;
        console.log(`[Transcribe Helper] Master WAV created successfully (${Math.round(fs.statSync(masterWav).size / 1024 / 1024)}MB).`);
      }
    } catch (convErr) {
      console.warn("[Transcribe Helper] Pre-conversion to master WAV warning:", convErr);
      try {
        console.log(`[Transcribe Helper] Attempting secondary stream rescue pass for master WAV...`);
        await execFilePromise(
          "ffmpeg",
          [
            "-analyzeduration", "100000000",
            "-probesize", "100000000",
            "-err_detect", "ignore_err",
            "-fflags", "+discardcorrupt",
            "-max_error_rate", "1.0",
            "-i", audioFilePath,
            ...mapArgs,
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
            masterWav,
            "-y"
          ],
          { maxBuffer: 1024 * 1024 * 50 }
        );
        if (fs.existsSync(masterWav) && fs.statSync(masterWav).size > 1000) {
          masterWavPath = masterWav;
          console.log(`[Transcribe Helper] Master WAV created via AAC rescue pass (${Math.round(fs.statSync(masterWav).size / 1024 / 1024)}MB).`);
        }
      } catch (rescueErr) {
        console.warn("[Transcribe Helper] AAC rescue pass for master WAV warning:", rescueErr);
      }
    }
  }

  if (totalDurationSec <= 0 || masterWavPath !== audioFilePath || totalDurationSec > 86400) {
    const exactWavDur = await getMediaDurationInSeconds(masterWavPath);
    if (exactWavDur > 0) {
      totalDurationSec = exactWavDur;
    }
  }

  // Safety cap: If totalDurationSec is still unreasonably large (> 24 hours), treat as single segment
  if (totalDurationSec > 86400) {
    console.warn(`[Transcribe Helper] Calculated duration (${totalDurationSec}s) is implausible (>24h). Treating audio as single segment.`);
    return [{ filePath: masterWavPath, startSec: 0, endSec: Math.min(totalDurationSec, 7200) }];
  }

  // Any media longer than 45s is intelligently split into chunks to guarantee frame-accurate sync
  if (totalDurationSec <= Math.min(45, targetChunkDurationSec)) {
    return [{ filePath: masterWavPath, startSec: 0, endSec: totalDurationSec }];
  }

  console.log(`[Transcribe Helper] Detecting silence points for intelligent splitting (target ~${targetChunkDurationSec}s)...`);
  let silenceMidpoints: number[] = [];
  try {
    silenceMidpoints = await detectSilencePoints(masterWavPath);
  } catch (e) {
    console.warn("[Transcribe Helper] detectSilencePoints warning:", e);
  }
  console.log(`[Transcribe Helper] Found ${silenceMidpoints.length} silence points.`);

  let cutPoints: number[] = [0];
  let currentPos = 0;

  if (silenceMidpoints.length > 0) {
    while (currentPos + targetChunkDurationSec < totalDurationSec - 10) {
      const idealCut = currentPos + targetChunkDurationSec;
      const minCut = currentPos + Math.max(15, Math.floor(targetChunkDurationSec * 0.45));
      const maxCut = currentPos + Math.min(totalDurationSec - currentPos - 5, Math.ceil(targetChunkDurationSec * 1.3));

      const candidates = silenceMidpoints.filter((p) => p >= minCut && p <= maxCut);
      let chosenCut = idealCut;

      if (candidates.length > 0) {
        chosenCut = candidates.reduce((prev, curr) =>
          Math.abs(curr - idealCut) < Math.abs(prev - idealCut) ? curr : prev
        );
      }

      cutPoints.push(chosenCut);
      currentPos = chosenCut;
    }
  }

  // If silence midpoints produced no internal cuts, slice into fixed targetChunkDurationSec intervals
  if (cutPoints.length <= 1) {
    cutPoints = [0];
    for (let pos = targetChunkDurationSec; pos < totalDurationSec - 10; pos += targetChunkDurationSec) {
      cutPoints.push(pos);
    }
  }

  cutPoints.push(totalDurationSec);

  console.log(
    `[Transcribe Helper] Audio cut points (${cutPoints.length - 1} chunks):`,
    cutPoints.map((p) => p.toFixed(1) + "s")
  );

  const segments: AudioSegment[] = [];

  for (let i = 0; i < cutPoints.length - 1; i++) {
    const startSec = cutPoints[i];
    const endSec = cutPoints[i + 1];

    if (endSec - startSec < 3.0) {
      console.log(`[Transcribe Helper] Skipping tiny audio cut ${i + 1} (${(endSec - startSec).toFixed(1)}s)`);
      continue;
    }

    const segFileName = `seg_${String(i + 1).padStart(3, "0")}.wav`;
    const segFilePath = path.join(outputDir, segFileName);

    try {
      // Fast input seeking with -ss before -i and -t for duration
      await execFilePromise(
        "ffmpeg",
        [
          "-analyzeduration", "10000000",
          "-probesize", "10000000",
          "-err_detect", "ignore_err",
          "-ss", startSec.toFixed(3),
          "-i", masterWavPath,
          "-t", (endSec - startSec).toFixed(3),
          "-ac", "1",
          "-ar", "16000",
          "-c:a", "pcm_s16le",
          segFilePath,
          "-y"
        ],
        { maxBuffer: 1024 * 1024 * 20 }
      );
      if (fs.existsSync(segFilePath) && fs.statSync(segFilePath).size > 1000) {
        segments.push({
          filePath: segFilePath,
          startSec,
          endSec,
        });
      } else {
        console.warn(`[Transcribe Helper] Segment file ${segFileName} is empty or too small, skipping.`);
        try { if (fs.existsSync(segFilePath)) fs.unlinkSync(segFilePath); } catch (_) {}
      }
    } catch (err: any) {
      console.warn(`[Transcribe Helper] Fast seeking failed for segment ${i + 1}, retrying with output seeking...`, err?.message || err);
      try {
        await execFilePromise(
          "ffmpeg",
          [
            "-analyzeduration", "10000000",
            "-probesize", "10000000",
            "-err_detect", "ignore_err",
            "-i", masterWavPath,
            "-ss", startSec.toFixed(3),
            "-t", (endSec - startSec).toFixed(3),
            "-ac", "1",
            "-ar", "16000",
            "-c:a", "pcm_s16le",
            segFilePath,
            "-y"
          ],
          { maxBuffer: 1024 * 1024 * 20 }
        );
        if (fs.existsSync(segFilePath) && fs.statSync(segFilePath).size > 1000) {
          segments.push({
            filePath: segFilePath,
            startSec,
            endSec,
          });
        }
      } catch (retryErr: any) {
        console.error(`[Transcribe Helper] Failed to extract silence segment ${i + 1}:`, retryErr?.message || retryErr);
      }
    }
  }

  return segments;
}

export async function segmentAudioFile(audioFilePath: string, outputDir: string, segmentDurationSec: number = 480): Promise<string[]> {
  const pattern = path.join(outputDir, "seg_%03d.mp3");
  console.log(`[Transcribe Helper] Segmenting audio file into ${segmentDurationSec}s chunks...`);
  try {
    await execFilePromise("ffmpeg", ["-i", audioFilePath, "-f", "segment", "-segment_time", String(segmentDurationSec), "-c:a", "mp3", "-ar", "16000", "-ac", "1", pattern, "-y"], {
      maxBuffer: 1024 * 1024 * 50
    });
    const files = fs.readdirSync(outputDir);
    const segFiles = files
      .filter((f) => f.startsWith("seg_") && f.endsWith(".mp3"))
      .sort((a, b) => a.localeCompare(b))
      .map((f) => path.join(outputDir, f));

    console.log(`[Transcribe Helper] Created ${segFiles.length} segment files.`);
    return segFiles;
  } catch (err: any) {
    console.warn("[Transcribe Helper] ffmpeg audio segmenting failed with re-encode, trying fallback:", err?.message || err);
    try {
      await execFilePromise("ffmpeg", ["-i", audioFilePath, "-f", "segment", "-segment_time", String(segmentDurationSec), "-c", "copy", pattern, "-y"], {
        maxBuffer: 1024 * 1024 * 50
      });
      const files = fs.readdirSync(outputDir);
      return files
        .filter((f) => f.startsWith("seg_") && f.endsWith(".mp3"))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => path.join(outputDir, f));
    } catch (fallbackErr: any) {
      console.warn("[Transcribe Helper] Fallback segmenting failed:", fallbackErr?.message || fallbackErr);
      return [];
    }
  }
}

export function srtTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const clean = timeStr.trim().replace(/^\[|\]$/g, '');
  const normalized = clean.replace(',', '.');
  const parts = normalized.split(':');

  if (parts.length === 1) {
    const parsed = parseFloat(parts[0]);
    return isNaN(parsed) ? 0 : Math.max(0, parsed);
  }
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return Math.max(0, mins * 60 + secs);
  }

  const hours = parseFloat(parts[0]) || 0;
  const minutes = parseFloat(parts[1]) || 0;
  const seconds = parseFloat(parts[2]) || 0;

  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

export function secondsToSrtTime(totalSec: number): string {
  if (isNaN(totalSec) || totalSec < 0) totalSec = 0;
  const totalMs = Math.round(totalSec * 1000);
  const millis = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const seconds = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const minutes = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

export interface ParsedSrtItem {
  startTimeSec: number;
  endTimeSec: number;
  text: string;
}

export function parseSrtString(srtText: string): ParsedSrtItem[] {
  const result: ParsedSrtItem[] = [];
  if (!srtText) return result;

  const rawLines = srtText.replace(/\r\n/g, '\n').split('\n');
  const timestampRegex = /(?:^|\s)[\[\(]?\s*((?:\d{1,2}:){1,2}\d{1,2}(?:[,.]\d{1,3})?)\s*[\]\)]?\s*(?:-->|->|~|-)\s*[\[\(]?\s*((?:\d{1,2}:){1,2}\d{1,2}(?:[,.]\d{1,3})?)\s*[\]\)]?(?:$|\s)/;

  interface FoundTimestamp {
    lineIdx: number;
    startStr: string;
    endStr: string;
  }

  const foundTimestamps: FoundTimestamp[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    const match = line.match(timestampRegex);
    if (match) {
      foundTimestamps.push({
        lineIdx: i,
        startStr: match[1].trim(),
        endStr: match[2].trim(),
      });
    }
  }

  if (foundTimestamps.length === 0) {
    // Check for single-timestamp lines (e.g. "[00:12.50] Тэкст" or "00:12 - Тэкст" or "(00:01:23) Тэкст")
    const singleTsRegex = /^[\[\(]?\s*((?:\d{1,2}:){1,2}\d{1,2}(?:[,.]\d{1,3})?)\s*[\]\)]?[\s:-]*(.*)$/;
    const singleMatches: { timeSec: number; text: string }[] = [];

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line || /^\d+$/.test(line) || /^(WEBVTT|NOTE|Kind:|Language:|```)/i.test(line)) continue;
      const m = line.match(singleTsRegex);
      if (m && m[1]) {
        const tSec = srtTimeToSeconds(m[1]);
        const cleanTxt = (m[2] || '').replace(/<\/?font[^>]*>/gi, '').trim();
        if (cleanTxt) {
          singleMatches.push({ timeSec: tSec, text: cleanTxt });
        }
      }
    }

    if (singleMatches.length > 0) {
      for (let i = 0; i < singleMatches.length; i++) {
        const cur = singleMatches[i];
        const nextTime = i + 1 < singleMatches.length ? singleMatches[i + 1].timeSec : cur.timeSec + 3.0;
        const endSec = nextTime > cur.timeSec ? nextTime : cur.timeSec + 2.5;
        result.push({
          startTimeSec: cur.timeSec,
          endTimeSec: endSec,
          text: cur.text,
        });
      }
      return sanitizeAndFixSrtTimings(result);
    }

    // Fallback: If no timestamps found at all, split non-empty lines into progressive timed cards
    const cleanLines = rawLines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^\d+$/.test(l) && !/^(WEBVTT|NOTE|Kind:|Language:|```|here|this|transcription|subrip|subtitle|sure|okay)/i.test(l));

    if (cleanLines.length > 0) {
      let currentClock = 0;
      for (const cl of cleanLines) {
        const text = cl.replace(/<\/?font[^>]*>/gi, '').trim();
        if (text) {
          const dur = Math.min(6.0, Math.max(2.0, text.split(/\s+/).length * 0.4));
          result.push({
            startTimeSec: currentClock,
            endTimeSec: currentClock + dur,
            text,
          });
          currentClock += dur + 0.1;
        }
      }
      return sanitizeAndFixSrtTimings(result);
    }

    return result;
  }

  // Handle orphan lead text that appeared BEFORE the very first timestamp line
  const firstTsIdx = foundTimestamps[0].lineIdx;
  if (firstTsIdx > 0) {
    const leadTextLines: string[] = [];
    for (let k = 0; k < firstTsIdx; k++) {
      const line = rawLines[k].trim();
      if (!line) continue;
      if (/^\d+$/.test(line)) continue;
      if (/^(WEBVTT|NOTE|Kind:|Language:|```|here|this|transcription|subrip|subtitle|sure|okay)/i.test(line)) continue;
      leadTextLines.push(line);
    }
    const leadText = leadTextLines.join('\n').replace(/<\/?font[^>]*>/gi, '').trim();
    if (leadText) {
      const firstTsStartSec = srtTimeToSeconds(foundTimestamps[0].startStr);
      const endSec = firstTsStartSec > 0 ? firstTsStartSec : 2.5;
      result.push({
        startTimeSec: 0,
        endTimeSec: endSec,
        text: leadText,
      });
    }
  }

  // Process each timestamp line and its corresponding text lines
  for (let j = 0; j < foundTimestamps.length; j++) {
    const currentTs = foundTimestamps[j];
    const nextTsLineIdx = (j + 1 < foundTimestamps.length) ? foundTimestamps[j + 1].lineIdx : rawLines.length;

    const textLines: string[] = [];
    for (let k = currentTs.lineIdx + 1; k < nextTsLineIdx; k++) {
      const line = rawLines[k].trim();
      if (!line) continue;
      if (/^\d+$/.test(line)) continue;
      if (/^(WEBVTT|NOTE|Kind:|Language:)/i.test(line)) continue;
      textLines.push(line);
    }

    const rawText = textLines.join('\n').trim();
    const text = rawText.replace(/<\/?font[^>]*>/gi, '').trim();

    const startSec = srtTimeToSeconds(currentTs.startStr);
    const endSec = srtTimeToSeconds(currentTs.endStr);

    if (text) {
      result.push({
        startTimeSec: startSec,
        endTimeSec: endSec > startSec ? endSec : startSec + 1.5,
        text,
      });
    }
  }

  return sanitizeAndFixSrtTimings(result);
}

export function sanitizeAndFixSrtTimings(items: ParsedSrtItem[]): ParsedSrtItem[] {
  if (items.length === 0) return items;

  // 1. Sort chronologically by start time
  const sorted = [...items].sort((a, b) => a.startTimeSec - b.startTimeSec);
  const deduplicated: ParsedSrtItem[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (deduplicated.length > 0) {
      const prev = deduplicated[deduplicated.length - 1];
      const timeDiff = Math.abs(cur.startTimeSec - prev.startTimeSec);
      const textCur = cur.text.trim().toLowerCase();
      const textPrev = prev.text.trim().toLowerCase();

      // Skip boundary duplicates (identical or subset text within 4s)
      if (timeDiff < 4.0 && (textCur === textPrev || (textCur.length > 5 && textPrev.length > 5 && (textCur.includes(textPrev) || textPrev.includes(textCur))))) {
        if (cur.endTimeSec > prev.endTimeSec) {
          prev.endTimeSec = cur.endTimeSec;
        }
        continue;
      }
    }
    deduplicated.push({ ...cur });
  }

  const result: ParsedSrtItem[] = [];

  for (let i = 0; i < deduplicated.length; i++) {
    const item = deduplicated[i];
    let start = Math.max(0, item.startTimeSec);
    let end = item.endTimeSec;

    // Ensure end is after start
    if (end <= start) {
      end = start + 1.5;
    }

    // Anti-stretch heuristic: If a card is unrealistically stretched across long silence/music gaps
    // (e.g. 40 words taking 64 seconds). Normal speech rate is ~2.5-3.5 words/sec (0.3-0.45s per word).
    const cardDur = end - start;
    if (cardDur > 10.0) {
      const words = item.text.trim().split(/\s+/).filter(Boolean).length;
      const plausibleDur = Math.max(2.0, words * 0.40 + 0.8);
      if (cardDur > plausibleDur * 1.5) {
        end = start + plausibleDur;
      }
    }

    // Adjust overlap with next item
    if (i < deduplicated.length - 1) {
      const nextStart = deduplicated[i + 1].startTimeSec;
      if (end > nextStart && nextStart > start) {
        end = Math.max(start + 0.3, Math.min(end, nextStart - 0.05));
      }
    }

    result.push({
      startTimeSec: start,
      endTimeSec: end,
      text: item.text,
    });
  }

  return result;
}

export function mergeAndShiftSrtSegments(
  segmentSrts: { srt: string; offsetSec: number; durationSec?: number }[],
  totalAudioDurationSec?: number
): string {
  const allItems: ParsedSrtItem[] = [];

  for (const seg of segmentSrts) {
    const items = parseSrtString(seg.srt);
    for (const item of items) {
      let start = item.startTimeSec;
      let end = item.endTimeSec;

      // Bound within segment duration if provided
      if (seg.durationSec && seg.durationSec > 0) {
        if (start >= seg.durationSec - 0.1) continue;
        end = Math.min(end, seg.durationSec);
      }

      allItems.push({
        startTimeSec: start + seg.offsetSec,
        endTimeSec: end + seg.offsetSec,
        text: item.text,
      });
    }
  }

  let sanitized = sanitizeAndFixSrtTimings(allItems);

  // If total media duration is provided, strictly enforce as hard ceiling
  if (totalAudioDurationSec && totalAudioDurationSec > 0) {
    sanitized = sanitized
      .filter((item) => item.startTimeSec < totalAudioDurationSec - 0.2)
      .map((item) => ({
        ...item,
        endTimeSec: Math.min(item.endTimeSec, totalAudioDurationSec),
      }));
  }

  const formattedBlocks: string[] = [];
  sanitized.forEach((item, index) => {
    const startStr = secondsToSrtTime(item.startTimeSec);
    const endStr = secondsToSrtTime(item.endTimeSec);
    formattedBlocks.push(`${index + 1}\n${startStr} --> ${endStr}\n${item.text}`);
  });

  return formattedBlocks.join('\n\n');
}
