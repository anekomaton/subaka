/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SubtitleEntry } from '../types';
import { srtTimeToSeconds } from './subtitleUtils';
import { getCachedAudioBlob, getAudioBlobFromIndexedDB } from './persistence';

/**
 * Encodes an AudioBuffer into a standard 16-bit Mono WAV Blob.
 */
function bufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const length = numSamples * numOfChan * 2 + 44; // 16-bit is 2 bytes/sample
  const bufferArr = new ArrayBuffer(length);
  const view = new DataView(bufferArr);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }

  // write HEAD chunk
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"

  // write FMT chunk
  setUint32(0x20746d66);                         // "fmt "
  setUint32(16);                                 // chunk length
  setUint16(1);                                  // sample format (raw PCM)
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(sampleRate * 2 * numOfChan);         // byte rate
  setUint16(numOfChan * 2);                      // block align
  setUint16(16);                                 // bits per sample

  // write DATA chunk
  setUint32(0x61746164);                         // "data"
  setUint32(length - pos - 4);                   // chunk length

  for (i = 0; i < numOfChan; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (pos < length && offset < numSamples) {
    for (i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF); // scale to 16-bit signed int
      view.setInt16(pos, sample, true);          // write 16-bit sample
      pos += 2;
    }
    offset++;
  }

  return new Blob([bufferArr], { type: "audio/wav" });
}

/**
 * Time-stretching function using Synchronized Overlap-Add (SOLA) to adjust speed
 * without affecting the pitch of the audio. This prevents crackling and phase cancellation.
 */
function timeStretch(inputBuffer: Float32Array, speed: number): Float32Array {
  if (speed === 1.0 || inputBuffer.length === 0) return inputBuffer;

  const windowSize = 1024;
  const overlap = 512;
  const hopOut = 512;
  const hopIn = Math.round(hopOut * speed);
  const searchRange = 128; // ~5.3 ms search range for pitch alignment

  const inputLength = inputBuffer.length;

  // Fallback for extremely short inputs where OLA windowing is not possible
  if (inputLength <= windowSize + searchRange) {
    const targetLen = Math.floor(inputLength / speed);
    if (targetLen <= 0) return new Float32Array(0);
    const output = new Float32Array(targetLen);
    for (let i = 0; i < targetLen; i++) {
      const srcIdx = Math.min(inputLength - 1, Math.floor(i * speed));
      output[i] = inputBuffer[srcIdx];
    }
    return output;
  }

  // Estimate output length
  const estimatedOutputLength = Math.ceil(inputLength / speed) + windowSize + searchRange;
  const outputBuffer = new Float32Array(estimatedOutputLength);
  const accumWindow = new Float32Array(estimatedOutputLength);

  // Hann window for smooth crossfading
  const window = new Float32Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
  }

  // Copy the first window directly
  for (let i = 0; i < windowSize; i++) {
    outputBuffer[i] = inputBuffer[i] * window[i];
    accumWindow[i] = window[i];
  }

  let inPos = hopIn;
  let outPos = hopOut;

  while (inPos + windowSize + searchRange < inputLength) {
    // Find best shift in the search range
    let bestShift = 0;
    let maxCorrelation = -Infinity;

    // Search for alignment that maximizes cross-correlation in the overlap region
    for (let shift = -searchRange; shift <= searchRange; shift++) {
      let correlation = 0;
      let energy = 0;
      for (let i = 0; i < overlap; i++) {
        const outIdx = outPos + i;
        const inIdx = inPos + shift + i;
        if (outIdx < estimatedOutputLength && inIdx < inputLength) {
          const outVal = outputBuffer[outIdx];
          const inVal = inputBuffer[inIdx];
          correlation += outVal * inVal;
          energy += inVal * inVal;
        }
      }
      
      // Normalized cross-correlation
      const score = energy > 0.001 ? correlation / Math.sqrt(energy) : correlation;
      if (score > maxCorrelation) {
        maxCorrelation = score;
        bestShift = shift;
      }
    }

    // Overlap-add the aligned frame
    const alignedInPos = inPos + bestShift;
    for (let i = 0; i < windowSize; i++) {
      const outIdx = outPos + i;
      const inIdx = alignedInPos + i;
      if (outIdx < estimatedOutputLength && inIdx < inputLength) {
        outputBuffer[outIdx] += inputBuffer[inIdx] * window[i];
        accumWindow[outIdx] += window[i];
      }
    }

    inPos += hopIn;
    outPos += hopOut;
  }

  // Normalize by window to remove amplitude modulation
  for (let i = 0; i < estimatedOutputLength; i++) {
    if (accumWindow[i] > 0.01) {
      outputBuffer[i] /= accumWindow[i];
    }
  }

  // Trim to correct length
  const targetLen = Math.floor(inputLength / speed);
  return outputBuffer.slice(0, targetLen);
}

/**
 * Stretches or compresses an AudioBuffer to change its playback speed while preserving its original pitch.
 */
function stretchAudioBuffer(ctx: AudioContext | OfflineAudioContext, buffer: AudioBuffer, speed: number): AudioBuffer {
  if (speed === 1.0) return buffer;
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const stretchedChannels: Float32Array[] = [];
  let maxLen = 0;

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    const stretched = timeStretch(channelData, speed);
    stretchedChannels.push(stretched);
    maxLen = Math.max(maxLen, stretched.length);
  }

  const newBuffer = ctx.createBuffer(numChannels, maxLen, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    newBuffer.getChannelData(channel).set(stretchedChannels[channel]);
  }
  return newBuffer;
}

/**
 * Stretches a single audio URL's audio with high quality, then returns a WAV Blob.
 */
export async function stretchSingleAudio(audioUrl: string, speed: number, subId?: string): Promise<Blob | null> {
  if (!audioUrl && !subId) return null;

  async function getSourceBlob(): Promise<Blob | null> {
    if (subId) {
      const cached = getCachedAudioBlob(subId);
      if (cached) return cached;
    }
    if (audioUrl) {
      try {
        const response = await fetch(audioUrl);
        if (response.ok) return await response.blob();
      } catch (_) {}
    }
    if (subId) {
      try {
        const dbBlob = await getAudioBlobFromIndexedDB(subId);
        if (dbBlob) return dbBlob;
      } catch (_) {}
    }
    return null;
  }

  if (speed === 1.0) {
    try {
      return await getSourceBlob();
    } catch (err) {
      console.warn("[Audio Merger] Error getting original single audio:", err);
      return null;
    }
  }

  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const blob = await getSourceBlob();
    if (!blob) {
      console.warn("[Audio Merger] Could not resolve audio source for single stretch");
      return null;
    }
    const arrayBuffer = await blob.arrayBuffer();
    const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
    
    // Stretch the buffer
    const stretchedBuffer = stretchAudioBuffer(audioCtx, decodedBuffer, speed);
    
    // Encode to WAV
    return bufferToWav(stretchedBuffer);
  } catch (err) {
    console.warn("[Audio Merger] Error stretching single audio:", err);
    return null;
  } finally {
    await audioCtx.close();
  }
}

/**
 * Combines all synthesized subtitle audios into a single continuous WAV blob,
 * perfectly synchronized according to each subtitle line's starting time.
 */
export async function mergeSubtitleAudio(subtitles: SubtitleEntry[]): Promise<Blob | null> {
  const activeSubs = subtitles.filter(sub => sub.audioUrl || getCachedAudioBlob(sub.id));
  if (activeSubs.length === 0) return null;

  // We need an AudioContext to decode the inline blob URLs
  const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

  try {
    // 1. Calculate subtitlesEndTime from all subtitles (whether active or not)
    let subtitlesEndTime = 0;
    for (const sub of subtitles) {
      const endSec = srtTimeToSeconds(sub.endTime);
      if (endSec > subtitlesEndTime) {
        subtitlesEndTime = endSec;
      }
    }

    // 2. Load and decode all the subtitle audio buffers
    const decodePromises = activeSubs.map(async (sub) => {
      try {
        let arrayBuffer: ArrayBuffer | null = null;

        // A. Check in-memory cache first
        const cached = getCachedAudioBlob(sub.id);
        if (cached) {
          try {
            arrayBuffer = await cached.arrayBuffer();
          } catch (_) {}
        }

        // B. Fetch audioUrl if available and not yet loaded
        if (!arrayBuffer && sub.audioUrl) {
          try {
            const response = await fetch(sub.audioUrl);
            if (response.ok) {
              arrayBuffer = await response.arrayBuffer();
            }
          } catch (_) {}
        }

        // C. Fallback to IndexedDB
        if (!arrayBuffer) {
          try {
            const dbBlob = await getAudioBlobFromIndexedDB(sub.id);
            if (dbBlob) {
              arrayBuffer = await dbBlob.arrayBuffer();
            }
          } catch (_) {}
        }

        if (!arrayBuffer || arrayBuffer.byteLength === 0) {
          console.warn(`[Audio Merger] No audio buffer found for subtitle ${sub.id}, skipping.`);
          return null;
        }

        const decodedBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        return {
          sub,
          buffer: decodedBuffer,
        };
      } catch (err) {
        console.warn(`[Audio Merger] Could not decode audio for subtitle ${sub.id}:`, err);
        return null;
      }
    });

    const decodedResults = await Promise.all(decodePromises);
    const validResults = decodedResults.filter(
      (r): r is { sub: SubtitleEntry; buffer: AudioBuffer } => r !== null
    );

    if (validResults.length === 0) {
      return null;
    }

    // 3. Pre-stretch the buffers to preserve pitch (avoiding the chipmunk effect)
    const stretchedResults = validResults.map(item => {
      const speed = item.sub.audioSpeed || 1.0;
      if (speed === 1.0) {
        return item;
      }
      const stretchedBuffer = stretchAudioBuffer(audioCtx, item.buffer, speed);
      return {
        sub: item.sub,
        buffer: stretchedBuffer
      };
    });

    // 4. Calculate maxVoiceoverEnd based on startTime + pre-stretched actual audio duration
    let maxVoiceoverEnd = 0;
    for (const item of stretchedResults) {
      const startSec = srtTimeToSeconds(item.sub.startTime);
      const endSec = startSec + item.buffer.duration;
      if (endSec > maxVoiceoverEnd) {
        maxVoiceoverEnd = endSec;
      }
    }

    // 5. Final duration is the maximum of subtitlesEndTime and maxVoiceoverEnd
    const finalDuration = Math.max(subtitlesEndTime, maxVoiceoverEnd);
    const sampleRate = 24000; // Gemini TTS 3.1 sample rate
    const totalSamples = Math.ceil((finalDuration > 0 ? finalDuration : 5) * sampleRate);

    // 6. Create OfflineAudioContext with the exact calculated samples
    const offlineCtx = new OfflineAudioContext(1, totalSamples, sampleRate);

    // 7. Schedule each pre-stretched audio buffer to play at its correct start timestamp (normal playbackRate of 1.0)
    for (const item of stretchedResults) {
      const startSec = srtTimeToSeconds(item.sub.startTime);
      const source = offlineCtx.createBufferSource();
      source.buffer = item.buffer;
      source.connect(offlineCtx.destination);
      source.start(startSec);
    }

    // 8. Render the final combined buffer
    const renderedBuffer = await offlineCtx.startRendering();
    
    // 9. Encode to a downloadable 16-bit mono WAV Blob
    return bufferToWav(renderedBuffer);
  } catch (error) {
    console.error("[Audio Merger] Fatal error merging subtitle voiceovers:", error);
    return null;
  } finally {
    await audioCtx.close();
  }
}
