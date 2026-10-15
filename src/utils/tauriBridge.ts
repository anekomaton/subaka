/**
 * Subaka Desktop (Tauri v2) Bridge
 * Provides transparent switching between Native Rust Desktop commands and Web fallback APIs.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';

export interface DesktopInfo {
  app_name: string;
  version: string;
  os: string;
  arch: string;
  grammar_driver: string;
  media_engine: string;
}

export interface DesktopGrammarStatus {
  ready: boolean;
  path?: string | null;
  size_mb?: number | null;
  total_forms?: number | null;
  driver: string;
  message: string;
}

export interface DesktopGrammarWordRecord {
  word: string;
  stressed: string;
  lemma?: string | null;
  lemma_stressed?: string | null;
  paradigm_id?: number | null;
}

export interface DesktopGrammarSearchResult {
  query: string;
  clean: string;
  found: boolean;
  stressed: string;
  lemma?: string | null;
  forms: DesktopGrammarWordRecord[];
  db_ready: boolean;
  phonetic?: string;
}

export interface AudioTrackInfo {
  index: number;
  stream_index: number;
  codec: string;
  channels: number;
  sample_rate: number;
  language?: string | null;
  title?: string | null;
}

export interface MediaProbeResult {
  file_path: string;
  duration_seconds?: number | null;
  format: string;
  audio_tracks: AudioTrackInfo[];
  video_streams_count: number;
}

export interface ExtractionProgressPayload {
  progress: number;
  message: string;
  finished: boolean;
  error?: string | null;
}

/**
 * Checks if running inside Tauri native desktop environment
 */
export const isTauriDesktop = (): boolean => {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
};

/**
 * Retrieves desktop platform information
 */
export async function getDesktopInfo(): Promise<DesktopInfo | null> {
  if (!isTauriDesktop()) return null;
  try {
    return await invoke<DesktopInfo>('get_desktop_info');
  } catch (err) {
    console.warn('[TauriBridge] Failed to get desktop info:', err);
    return null;
  }
}

/**
 * Checks GrammarDB status via native Rust SQLite manager or Web API
 */
export async function getGrammarDbStatus(): Promise<DesktopGrammarStatus> {
  if (isTauriDesktop()) {
    try {
      return await invoke<DesktopGrammarStatus>('get_grammar_status');
    } catch (err) {
      console.warn('[TauriBridge] Native get_grammar_status failed, falling back to web:', err);
    }
  }

  // Fallback to web endpoint
  try {
    const res = await fetch('/api/grammardb/status', { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      return {
        ready: Boolean(data.ready),
        path: data.path,
        size_mb: data.sizeMb,
        total_forms: data.totalForms || 2014526,
        driver: data.driver || 'Node.js SQLite',
        message: data.ready ? 'GrammarDB гатовая' : (data.lastLog || 'Ініцыялізацыя...'),
      };
    }
  } catch (_) {}

  return {
    ready: false,
    path: null,
    driver: 'none',
    message: 'База не падключана',
  };
}

/**
 * Performs instant lookup of a single word in GrammarDB
 */
export async function lookupGrammarWord(query: string): Promise<DesktopGrammarSearchResult> {
  if (isTauriDesktop()) {
    try {
      const res = await invoke<DesktopGrammarSearchResult>('lookup_grammar_word', { word: query });
      return res;
    } catch (err) {
      console.warn('[TauriBridge] Native lookup_grammar_word failed:', err);
    }
  }

  // Web endpoint fallback
  const res = await fetch('/api/grammardb/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    throw new Error(`Web GrammarDB search failed: HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * High-speed batch validation of multiple words
 */
export async function batchCheckWords(words: string[]): Promise<Record<string, boolean>> {
  if (isTauriDesktop()) {
    try {
      return await invoke<Record<string, boolean>>('batch_check_words', { words });
    } catch (err) {
      console.warn('[TauriBridge] Native batch_check_words failed:', err);
    }
  }

  // Web endpoint fallback
  try {
    const res = await fetch('/api/grammardb/spellcheck-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ words }),
    });
    if (res.ok) {
      const data = await res.json();
      const map: Record<string, boolean> = {};
      if (Array.isArray(data.results)) {
        words.forEach((w, i) => {
          map[w] = Boolean(data.results[i]?.found);
        });
        return map;
      }
    }
  } catch (_) {}

  return {};
}

/**
 * Opens native OS file picker
 */
export async function openMediaOrSubtitleDialog(
  type: 'media' | 'subtitles' | 'all'
): Promise<string | null> {
  if (isTauriDesktop()) {
    try {
      const extensions =
        type === 'media'
          ? ['mp4', 'mkv', 'webm', 'mov', 'avi', 'mp3', 'wav', 'aac', 'flac', 'm4a']
          : type === 'subtitles'
          ? ['srt', 'vtt', 'ass', 'ssa', 'sub', 'txt']
          : ['mp4', 'mkv', 'webm', 'srt', 'vtt', 'ass'];

      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{ name: type === 'media' ? 'Media Files' : 'Subtitles', extensions }],
      });

      if (typeof selected === 'string') {
        return selected;
      }
    } catch (err) {
      console.warn('[TauriBridge] Native open dialog failed:', err);
    }
  }

  return null;
}

/**
 * Opens native OS save dialog and saves file atomically (Text or Binary)
 */
export async function saveSubtitleFileNative(
  defaultName: string,
  content: string
): Promise<string | null> {
  return saveFileUniversal(defaultName, content, 'text/plain;charset=utf-8;');
}

/**
 * Universal file saver: handles Native OS Save Dialog in Desktop mode,
 * with standard browser blob download as fallback for web.
 */
export async function saveFileUniversal(
  defaultName: string,
  content: string | Blob,
  mimeType: string = 'text/plain;charset=utf-8;'
): Promise<string | null> {
  if (isTauriDesktop()) {
    try {
      const ext = defaultName.split('.').pop()?.toLowerCase() || '';
      const filters = [];
      if (ext === 'srt') filters.push({ name: 'SubRip Subtitles (*.srt)', extensions: ['srt'] });
      else if (ext === 'ass') filters.push({ name: 'Advanced SubStation Alpha (*.ass)', extensions: ['ass'] });
      else if (ext === 'vtt') filters.push({ name: 'WebVTT (*.vtt)', extensions: ['vtt'] });
      else if (ext === 'csv') filters.push({ name: 'CSV File (*.csv)', extensions: ['csv'] });
      else if (ext === 'txt') filters.push({ name: 'Text File (*.txt)', extensions: ['txt'] });
      else if (ext === 'zip') filters.push({ name: 'ZIP Archive (*.zip)', extensions: ['zip'] });
      else if (ext === 'wav') filters.push({ name: 'Waveform Audio (*.wav)', extensions: ['wav'] });
      else if (ext) filters.push({ name: `Files (*.${ext})`, extensions: [ext] });
      filters.push({ name: 'All Files (*.*)', extensions: ['*'] });

      const filePath = await save({
        defaultPath: defaultName,
        filters,
      });

      if (filePath) {
        if (typeof content === 'string') {
          await invoke('save_file_direct', { filePath, content });
        } else {
          // Convert Blob to Base64 for native write
          const buffer = await content.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          let binary = '';
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const dataBase64 = btoa(binary);
          await invoke('save_binary_file_direct', { filePath, dataBase64 });
        }
        return filePath;
      }
      return null;
    } catch (err) {
      console.warn('[TauriBridge] Native file save failed, using web download:', err);
    }
  }

  // Web fallback: download as blob
  const blob = typeof content === 'string' ? new Blob([content], { type: mimeType }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = defaultName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return defaultName;
}

export interface DesktopStorageInfo {
  app_data_dir: string;
  cache_dir: string;
  temp_dir: string;
  resources_dir: string;
  grammardb_path?: string | null;
  grammardb_size_mb?: number | null;
  verbum_path?: string | null;
  verbum_size_mb?: number | null;
}

export async function getDesktopStorageInfo(): Promise<DesktopStorageInfo | null> {
  if (isTauriDesktop()) {
    try {
      return await invoke<DesktopStorageInfo>('get_desktop_storage_info');
    } catch (e) {
      console.warn('Failed to get desktop storage info:', e);
    }
  }
  return null;
}

export async function clearDesktopTempCache(): Promise<boolean> {
  if (isTauriDesktop()) {
    try {
      return await invoke<boolean>('clear_desktop_temp_cache');
    } catch (e) {
      console.warn('Failed to clear desktop temp cache:', e);
    }
  }
  return false;
}

export async function getDesktopVerbumStatus(): Promise<{
  ready: boolean;
  path?: string | null;
  size_mb?: number | null;
  total_articles?: number | null;
  message: string;
} | null> {
  if (isTauriDesktop()) {
    try {
      return await invoke('get_verbum_status');
    } catch (e) {
      console.warn('Failed to get desktop verbum status:', e);
    }
  }
  return null;
}

export async function lookupDesktopVerbum(word: string): Promise<any[]> {
  if (isTauriDesktop()) {
    try {
      return await invoke<any[]>('lookup_verbum_word', { word });
    } catch (e) {
      console.warn('Failed to lookup desktop verbum word:', e);
    }
  }
  return [];
}

/**
 * Direct file read in desktop mode
 */
export async function readSubtitleDirect(filePath: string): Promise<string> {
  if (isTauriDesktop()) {
    return await invoke<string>('read_file_direct', { filePath });
  }
  throw new Error('Direct file read is only supported in desktop mode');
}

/**
 * Probes media file with native FFmpeg sidecar
 */
export async function probeMediaStreamsNative(filePath: string): Promise<MediaProbeResult> {
  if (isTauriDesktop()) {
    return await invoke<MediaProbeResult>('probe_media_streams', { filePath });
  }
  throw new Error('Native media probe is only supported in desktop mode');
}

/**
 * Extracts audio track using native FFmpeg sidecar with live progress
 */
export async function extractAudioTrackNative(
  inputPath: string,
  trackIndex: number,
  outputPath: string,
  onProgress?: (payload: ExtractionProgressPayload) => void
): Promise<string> {
  if (!isTauriDesktop()) {
    throw new Error('Native audio extraction is only supported in desktop mode');
  }

  let unlisten: UnlistenFn | null = null;
  if (onProgress) {
    unlisten = await listen<ExtractionProgressPayload>('media-extraction-progress', (event) => {
      onProgress(event.payload);
    });
  }

  try {
    const res = await invoke<string>('extract_audio_track', {
      inputPath,
      trackIndex,
      outputPath,
    });
    return res;
  } finally {
    if (unlisten) {
      unlisten();
    }
  }
}
