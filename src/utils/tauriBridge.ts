/**
 * Subaka Desktop (Tauri v2) Bridge
 * Provides transparent switching between Native Rust Desktop commands and Web fallback APIs.
 */

import { invoke, convertFileSrc } from '@tauri-apps/api/core';
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
  is_default?: boolean;
}

export interface SubtitleTrackInfo {
  index: number;
  stream_index: number;
  codec: string;
  language?: string | null;
  title?: string | null;
  is_default?: boolean;
}

export interface MediaProbeResult {
  file_path: string;
  duration_seconds?: number | null;
  format: string;
  audio_tracks: AudioTrackInfo[];
  subtitle_tracks: SubtitleTrackInfo[];
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
 * Extracts embedded text subtitle track (.srt, .ass, subrip) natively using FFmpeg sidecar
 */
export async function extractSubtitleTrackNative(
  inputPath: string,
  trackIndex: number
): Promise<string> {
  if (!isTauriDesktop()) {
    throw new Error('Native subtitle extraction is only supported in desktop mode');
  }
  return await invoke<string>('extract_subtitle_track', {
    inputPath,
    trackIndex,
  });
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

export async function postJsonNative(
  url: string,
  jsonBody: string,
  headers?: Record<string, string>
): Promise<string> {
  if (isTauriDesktop()) {
    return await invoke<string>('post_json_native', { url, jsonBody, headers: headers || null });
  }
  throw new Error('postJsonNative is only available on desktop');
}

/**
 * Native GET request for verbum.by or external APIs in Tauri (bypasses CORS in desktop WebView)
 */
export async function fetchVerbumOnlineNative(
  url: string,
  headers?: Record<string, string>
): Promise<any | null> {
  if (isTauriDesktop()) {
    try {
      const res = await invoke<string>('fetch_verbum_online_native', { url, headers: headers || null });
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

/**
 * Takes and clears launch file path passed via command-line / file association
 */
export async function takeLaunchFilePath(): Promise<string | null> {
  if (isTauriDesktop()) {
    try {
      return await invoke<string | null>('take_launch_file_path');
    } catch (err) {
      console.warn('[TauriBridge] take_launch_file_path failed:', err);
    }
  }
  return null;
}

/**
 * Loads a desktop file path into text content or File object
 */
export async function loadDesktopFileFromPath(filePath: string): Promise<{
  file?: File;
  textContent?: string;
  fileName: string;
  isSubtitle: boolean;
  isMedia: boolean;
}> {
  const cleanPath = filePath.trim().replace(/^["']|["']$/g, '');
  const fileName = cleanPath.split(/[/\\]/).pop() || 'file';
  const ext = fileName.split('.').pop()?.toLowerCase() || '';

  const subExts = ['srt', 'ass', 'vtt', 'sub', 'ssa', 'txt'];
  const mediaExts = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'mp3', 'wav', 'aac', 'flac', 'm4a', 'ogg', 'wma', 'mka', 'ts', 'm2ts', '3gp'];

  const isSubtitle = subExts.includes(ext);
  const isMedia = mediaExts.includes(ext);

  if (isSubtitle) {
    const textContent = await readSubtitleDirect(cleanPath);
    return { textContent, fileName, isSubtitle: true, isMedia: false };
  }

  if (isMedia) {
    const mimeMap: Record<string, string> = {
      'mp4': 'video/mp4',
      'mkv': 'video/x-matroska',
      'webm': 'video/webm',
      'avi': 'video/x-msvideo',
      'mov': 'video/quicktime',
      'mp3': 'audio/mp3',
      'wav': 'audio/wav',
      'aac': 'audio/aac',
      'flac': 'audio/flac',
      'm4a': 'audio/m4a',
      'ogg': 'audio/ogg',
      'wma': 'audio/x-ms-wma',
      'mka': 'audio/x-matroska',
      'ts': 'video/mp2t',
      'm2ts': 'video/mp2t',
      '3gp': 'video/3gpp',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    const assetUrl = getDesktopAssetUrl(cleanPath);

    const isVideo = ['mp4', 'mkv', 'webm', 'avi', 'mov', 'ts', 'm2ts', '3gp', 'm4v', 'flv', 'ogv'].includes(ext);

    // 1. Primary for videos: instantly return streaming File shell with desktopPath and streaming asset URL.
    // Avoids loading 2GB-10GB movies into JavaScript heap as Blobs, which caused startup OOM crashes.
    if (isVideo && assetUrl) {
      const emptyBlob = new Blob([], { type: mimeType });
      const file = new File([emptyBlob], fileName, { type: mimeType });
      (file as any).desktopPath = cleanPath;
      (file as any).path = cleanPath;
      (file as any).streamUrl = assetUrl;
      (file as any).assetUrl = assetUrl;
      return { file, fileName, isSubtitle: false, isMedia: true };
    }

    // 2. For audio files (<= 150MB): fetch asset protocol to create Blob
    try {
      if (assetUrl) {
        const res = await fetch(assetUrl);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], fileName, { type: mimeType });
          (file as any).desktopPath = cleanPath;
          (file as any).path = cleanPath;
          (file as any).streamUrl = assetUrl;
          (file as any).assetUrl = assetUrl;
          return { file, fileName, isSubtitle: false, isMedia: true };
        }
      }
    } catch (err) {
      console.warn('[TauriBridge] Failed to fetch media file via convertFileSrc:', err);
    }

    // 2. Secondary fallback: native read_binary_file_direct command
    try {
      const base64 = await invoke<string>('read_binary_file_direct', { filePath: cleanPath });
      if (base64) {
        const binStr = atob(base64);
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        const file = new File([blob], fileName, { type: mimeType });
        (file as any).desktopPath = cleanPath;
        (file as any).path = cleanPath;
        if (assetUrl) {
          (file as any).streamUrl = assetUrl;
          (file as any).assetUrl = assetUrl;
        }
        return { file, fileName, isSubtitle: false, isMedia: true };
      }
    } catch (err) {
      console.warn('[TauriBridge] read_binary_file_direct failed for media:', err);
    }

    // 3. Fallback for large files: construct File shell with desktopPath and streaming asset URL
    if (assetUrl) {
      const emptyBlob = new Blob([], { type: mimeType });
      const file = new File([emptyBlob], fileName, { type: mimeType });
      (file as any).desktopPath = cleanPath;
      (file as any).path = cleanPath;
      (file as any).streamUrl = assetUrl;
      (file as any).assetUrl = assetUrl;
      return { file, fileName, isSubtitle: false, isMedia: true };
    }

    throw new Error(`Не ўдалося загрузіць медыяфайл: ${fileName}`);
  }

  // Fallback for non-media files: read as text/subtitle
  const textContent = await readSubtitleDirect(cleanPath);
  return { textContent, fileName, isSubtitle: true, isMedia: false };
}

/**
 * Converts local desktop file path to streaming asset URL via Tauri asset protocol
 */
export function getDesktopAssetUrl(filePath: string): string {
  if (!filePath) return '';
  const cleanPath = filePath.trim().replace(/^["']|["']$/g, '');
  if (isTauriDesktop()) {
    try {
      const url = convertFileSrc(cleanPath);
      if (url) return url;
    } catch (err) {
      console.warn('[TauriBridge] convertFileSrc error:', err);
    }
  }
  return '';
}

/**
 * Creates a clean, 100% compatible video stream (video-only bitstream copy)
 * Eliminates AC3/DTS/multichannel audio codec initialization crashes in WebView2.
 */
export async function prepareCompatibleVideoDesktop(
  inputPath: string,
  outputPath?: string
): Promise<string | null> {
  if (!isTauriDesktop() || !inputPath) return null;
  const cleanIn = inputPath.trim().replace(/^["']|["']$/g, '');
  try {
    const result = await invoke<string>('prepare_compatible_video', {
      inputPath: cleanIn,
      outputPath: outputPath || null,
    });
    return result || null;
  } catch (err) {
    console.warn('[TauriBridge] prepare_compatible_video failed:', err);
    logDesktopError('VideoPipeline', 'Failed to prepare clean compatible video', { error: String(err) });
    return null;
  }
}

/**
 * Strips personal paths, usernames, tokens, and sensitive file names from log entries
 */
export function sanitizeLogText(text: string): string {
  if (!text) return '';
  return text
    // Replace Windows user profile paths: C:\Users\<Username>\... -> C:\Users\<user>\...
    .replace(/[A-Za-z]:\\(?:Users|Пользователи|home)\\[^\\]+/gi, '<user_dir>')
    // Replace full file paths with generic placeholders keeping only extension
    .replace(/[A-Za-z]:\\[^"'\n\r\t<>*|?]+\.([a-zA-Z0-9]{2,5})\b/gi, '<path>/<file>.$1')
    .replace(/\/(?:home|Users)\/[^"'\n\r\t<>*|?]+\.([a-zA-Z0-9]{2,5})\b/gi, '<path>/<file>.$1')
    // Remove query params or keys from URLs
    .replace(/([?&](?:key|token|auth|secret|api_key)=)[^&]+/gi, '$1<redacted>')
    // Remove IP addresses or emails
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '<email>');
}

/**
 * Logs sanitized error information directly into AppData\Local\com.subaka.desktop\logs\SUBaka.log
 */
export async function logDesktopError(
  category: string,
  message: string,
  details?: Record<string, any> | string
): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const cleanMsg = sanitizeLogText(message);
    const detailsStr = details
      ? (typeof details === 'string' ? sanitizeLogText(details) : sanitizeLogText(JSON.stringify(details)))
      : undefined;
    await invoke('log_desktop_event', {
      level: 'error',
      category: sanitizeLogText(category),
      message: cleanMsg,
      details: detailsStr,
    });
  } catch (_) {
    // Logging failure should never interrupt application flow
  }
}

/**
 * Logs sanitized warning information into SUBaka.log
 */
export async function logDesktopWarn(
  category: string,
  message: string,
  details?: Record<string, any> | string
): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const cleanMsg = sanitizeLogText(message);
    const detailsStr = details
      ? (typeof details === 'string' ? sanitizeLogText(details) : sanitizeLogText(JSON.stringify(details)))
      : undefined;
    await invoke('log_desktop_event', {
      level: 'warn',
      category: sanitizeLogText(category),
      message: cleanMsg,
      details: detailsStr,
    });
  } catch (_) {
    // Logging failure should never interrupt application flow
  }
}

/**
 * Logs sanitized info information directly into AppData\Local\com.subaka.desktop\logs\SUBaka.log
 */
export async function logDesktopInfo(
  category: string,
  message: string,
  details?: Record<string, any> | string
): Promise<void> {
  if (!isTauriDesktop()) return;
  try {
    const cleanMsg = sanitizeLogText(message);
    const detailsStr = details
      ? (typeof details === 'string' ? sanitizeLogText(details) : sanitizeLogText(JSON.stringify(details)))
      : undefined;
    await invoke('log_desktop_event', {
      level: 'info',
      category: sanitizeLogText(category),
      message: cleanMsg,
      details: detailsStr,
    });
  } catch (_) {
    // Logging failure should never interrupt application flow
  }
}

/**
 * Saves a Blob/File to a temporary file path on desktop disk
 */
export async function saveTempBinaryFileDesktop(content: Blob | File, filename: string): Promise<string> {
  const storageInfo = await getDesktopStorageInfo().catch(() => null);
  const tempDir = (storageInfo?.temp_dir || storageInfo?.cache_dir || '').replace(/[/\\]+$/, '');
  const cleanName = filename.replace(/[^\w.-]/g, '_');
  const targetPath = tempDir ? `${tempDir}/${cleanName}` : cleanName;

  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const base64 = res.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to encode audio for desktop temporary file'));
    reader.readAsDataURL(content);
  });

  await invoke('save_binary_file_direct', { filePath: targetPath, dataBase64 });
  return targetPath;
}

export interface WhisperEngineDetails {
  binaryPath: string;
  modelPath: string;
  isCuda: boolean;
  engineName: string;
}

/**
 * Retrieves full details about the local Whisper engine (CPU vs NVIDIA CUDA GPU)
 */
export async function getWhisperEngineDetails(): Promise<WhisperEngineDetails | null> {
  if (!isTauriDesktop()) return null;
  try {
    const res = await invoke<{ binary_path: string; model_path: string; is_cuda: boolean; engine_name: string }>(
      'get_whisper_engine_details'
    );
    return {
      binaryPath: res.binary_path,
      modelPath: res.model_path,
      isCuda: res.is_cuda,
      engineName: res.engine_name,
    };
  } catch (_) {
    return {
      binaryPath: 'resources/whisper.exe',
      modelPath: 'resources/ggml-small.bin',
      isCuda: false,
      engineName: 'CPU (Standard whisper.cpp)',
    };
  }
}

/**
 * Cancels any active local Whisper transcription process immediately
 */
export async function cancelWhisperTranscribeDesktop(): Promise<boolean> {
  if (!isTauriDesktop()) return false;
  try {
    logDesktopInfo('WhisperEngine', 'Cancelling active local whisper process');
    await invoke<boolean>('cancel_whisper_transcribe');
    return true;
  } catch (err) {
    console.warn('[TauriBridge] cancel_whisper_transcribe failed:', err);
    return false;
  }
}

/**
 * Invokes native local whisper.cpp sidecar engine for desktop transcription
 */
export async function runWhisperTranscribeDesktop(
  audioInput: string | Blob | File,
  modelName = 'ggml-small.bin',
  language = 'auto',
  signal?: AbortSignal
): Promise<string | null> {
  if (!isTauriDesktop()) return null;

  if (signal?.aborted) {
    await cancelWhisperTranscribeDesktop();
    throw new Error('Абпрацоўка адменена карыстальнікам');
  }

  const abortHandler = () => {
    cancelWhisperTranscribeDesktop().catch(() => {});
  };

  if (signal) {
    signal.addEventListener('abort', abortHandler);
  }

  try {
    let wavPath = '';
    if (typeof audioInput === 'string') {
      wavPath = audioInput;
    } else {
      const rawDesktopPath = (audioInput as any)?.desktopPath || (audioInput as any)?.path;
      if (rawDesktopPath && typeof rawDesktopPath === 'string') {
        wavPath = rawDesktopPath;
      } else {
        const tempName = `whisper_input_${Date.now()}.wav`;
        wavPath = await saveTempBinaryFileDesktop(audioInput, tempName);
      }
    }

    logDesktopInfo('WhisperEngine', 'Launching local whisper.cpp transcription', { wavPath, modelName, language });
    const srtOutput = await invoke<string>('run_whisper_transcribe', {
      audioPath: wavPath,
      modelName: modelName || 'ggml-small.bin',
      language: language || 'auto',
    });

    if (signal?.aborted) {
      throw new Error('Абпрацоўка адменена карыстальнікам');
    }

    logDesktopInfo('WhisperEngine', 'Local whisper.cpp transcription completed successfully');
    return srtOutput;
  } catch (err: any) {
    const errorMsg = typeof err === 'string' ? err : (err?.message || String(err));
    console.warn('[TauriBridge] run_whisper_transcribe failed:', errorMsg);
    logDesktopError('WhisperEngine', 'Local whisper.cpp execution failed', { error: errorMsg });
    throw new Error(errorMsg);
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}






