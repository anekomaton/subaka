/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

export interface ProofreadIssue {
  word: string;
  suggestion?: string;
  explanation: string;
}

export interface SubtitleEntry {
  id: string; // Unique ID (usually sequential numerical string "1", "2")
  startTime: string; // e.g., "00:00:01,000" (SRT style) or "00:00:01.000"
  endTime: string;   // e.g., "00:00:04,500"
  originalStartTime?: string; // Original unshifted start time
  originalEndTime?: string;   // Original unshifted end time
  text: string;      // Original subtitle text
  translatedText?: string; // Belarusian translated text
  actor?: string;    // Character / actor name (e.g. from .ass or manual entry)
  originalActor?: string; // Character / actor name from original subtitles
  proofreadIssues?: ProofreadIssue[]; // AI proofread issues/suggestions
  audioUrl?: string; // URL of generated voiceover audio (Blob URL)
  audioSpeed?: number; // Custom playback speed for this specific voiceover (e.g. 1.0, 1.25)
  isGeneratingAudio?: boolean; // TTS in progress?
  audioError?: string; // Standard error message if TTS fails
}

export interface PlaybackState {
  currentTime: number; // in seconds
  isPlaying: boolean;
  playbackSpeed: number; // e.g. 1.0, 1.25, 1.5
  isSubtitlesOnlyPlay?: boolean; // whether to auto-play generated TTS as soon as subtitle line starts
}

export interface VoiceoverConfig {
  voiceName: 'Ales' | 'BelG2P' | 'Kore' | 'Charon' | 'Fenrir' | 'Zephyr' | 'Puck' | 'Alesya';
  speed: number; // speed multiplier
  pitch: string; // optional tone instruction
}
