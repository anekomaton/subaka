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
    return {
      query,
      clean: query.trim().toLowerCase(),
      found: false,
      stressed: query,
      forms: [],
      db_ready: false,
    };
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
    return {};
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
 * Batch lookup stressed words from GrammarDB SQLite in desktop mode
 */
export async function batchLookupStressedDesktop(words: string[]): Promise<Record<string, string>> {
  if (isTauriDesktop() && words.length > 0) {
    try {
      return await invoke<Record<string, string>>('batch_lookup_stressed', { words });
    } catch (err) {
      console.warn('[TauriBridge] Native batch_lookup_stressed failed:', err);
    }
  }
  return {};
}

/**
 * Stress Belarusian text using native GrammarDB SQLite and identical orthoepic rules in desktop mode
 */
export async function stressTextDesktop(text: string): Promise<string> {
  if (!text || !text.trim()) return text;
  if (isTauriDesktop()) {
    const { stressTextWithOrthoepy } = await import('./stressHelper');
    return await stressTextWithOrthoepy(text, batchLookupStressedDesktop);
  }
  return text;
}

/**
 * Reliably opens an external URL in the default system web browser
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  if (isTauriDesktop()) {
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
      return;
    } catch (_) {
      try {
        await invoke('open_external_url', { url });
        return;
      } catch (err) {
        console.warn('[TauriBridge] open_external_url failed:', err);
      }
    }
  }
  if (typeof window !== 'undefined') {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/**
 * Restores desktop window position and size after exiting fullscreen
 */
export async function restorePostFullscreenBoundsDesktop(): Promise<void> {
  if (isTauriDesktop()) {
    try {
      await invoke('restore_post_fullscreen_bounds');
    } catch (err) {
      console.warn('[TauriBridge] restore_post_fullscreen_bounds failed:', err);
    }
  }
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
      else if (ext === 'sup') filters.push({ name: 'PGS Subtitles (*.sup)', extensions: ['sup'] });
      else if (ext === 'sub') filters.push({ name: 'VobSub / Subtitles (*.sub)', extensions: ['sub'] });
      else if (ext === 'idx') filters.push({ name: 'VobSub Index (*.idx)', extensions: ['idx'] });
      else if (ext === 'mks') filters.push({ name: 'Matroska Subtitles (*.mks)', extensions: ['mks'] });
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
          // Asynchronously convert Blob to Base64 using native FileReader (non-blocking for large WAV files)
          const dataBase64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const res = reader.result as string;
              const base64 = res.split(',')[1] || '';
              resolve(base64);
            };
            reader.onerror = () => reject(new Error('Failed to encode audio file'));
            reader.readAsDataURL(content);
          });
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

/**
 * Native audio fetch via curl in Tauri
 */
export async function fetchAudioBufferNative(url: string): Promise<string> {
  if (isTauriDesktop()) {
    return await invoke<string>('fetch_audio_buffer_native', { url });
  }
  throw new Error('fetchAudioBufferNative is only available on desktop');
}

/**
 * Native POST JSON request via curl in Tauri
 */
export async function postJsonNative(url: string, jsonBody: string): Promise<string> {
  if (isTauriDesktop()) {
    return await invoke<string>('post_json_native', { url, jsonBody });
  }
  throw new Error('postJsonNative is only available on desktop');
}

/**
 * Native GET request for verbum.by in Tauri (bypasses CORS in desktop WebView)
 */
export async function fetchVerbumOnlineNative(url: string): Promise<any | null> {
  if (isTauriDesktop()) {
    try {
      const res = await invoke<string>('fetch_verbum_online_native', { url });
      if (res) {
        return JSON.parse(res);
      }
    } catch (err) {
      console.warn('[TauriBridge] Native verbum online fetch failed:', err);
    }
    return null;
  }

  // In web browser, use proxy or direct fetch
  try {
    const res = await fetch(url);
    if (res.ok) {
      return await res.json();
    }
  } catch (_) {}
  return null;
}

/**
 * Desktop Window Controls for Tauri
 */
export async function minimizeDesktopWindow(): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().minimize();
  } catch (e) {
    console.warn('[TauriBridge] Could not minimize window:', e);
  }
}

export async function toggleMaximizeDesktopWindow(): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().toggleMaximize();
  } catch (e) {
    console.warn('[TauriBridge] Could not toggle maximize window:', e);
  }
}

export async function hideDesktopWindow(): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    // Save window state and hide to system tray
    await getCurrentWindow().hide();
  } catch (e) {
    console.warn('[TauriBridge] Could not hide window:', e);
  }
}


