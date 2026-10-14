import { SubtitleEntry } from '../types';

const DB_NAME = 'SubakaWorkspaceDB';
const DB_VERSION = 1;
const STORE_NAME = 'workspace';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB not supported'));
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        } catch (e) {
          reject(e);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    } catch (e) {
      reject(e);
    }
  });
}

export interface SerializedSubtitleEntry {
  id: string;
  startTime: string;
  endTime: string;
  originalStartTime?: string;
  originalEndTime?: string;
  text: string;
  translatedText?: string;
  actor?: string;
  originalActor?: string;
  proofreadIssues?: any[];
  audioBlob?: Blob;
  audioSpeed?: number;
  audioError?: string;
}

export interface SavedWorkspace {
  subtitles: SubtitleEntry[];
  autoSubtitles: SubtitleEntry[] | null;
  mediaFileName: string;
  mediaFile: File | null;
  extAudioFile: File | null;
  selectedVoice?: string;
  originalAssHeader?: string;
  processedTracks?: Record<number, { blob: Blob; audioFile: File; label: string }>;
  activeTrackNumber?: number | null;
  activeExternalTrackId?: string | null;
  projectName?: string;
  splitRatio?: number;
}

// In-memory cache of audioBlobs per subtitle ID to prevent constant re-fetching of blob URLs
const audioBlobCache = new Map<string, Blob>();

export function cacheAudioBlob(id: string, blob: Blob) {
  audioBlobCache.set(id, blob);
}

export function getCachedAudioBlob(id: string): Blob | undefined {
  return audioBlobCache.get(id);
}

export async function getAudioBlobFromIndexedDB(id: string): Promise<Blob | null> {
  const cached = audioBlobCache.get(id);
  if (cached) return cached;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const rawSubtitles = await new Promise<any[]>((resolve) => {
      const req = store.get('subtitles');
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
    const found = rawSubtitles.find((s) => s.id === id);
    if (found && found.audioBlob instanceof Blob) {
      audioBlobCache.set(id, found.audioBlob);
      return found.audioBlob;
    }
  } catch (e) {
    // Ignore IndexedDB error
  }
  return null;
}

export function clearAudioBlobCache() {
  audioBlobCache.clear();
}

/**
 * Save current workspace state to IndexedDB
 */
export async function saveWorkspaceToStorage(
  subtitles: SubtitleEntry[],
  autoSubtitles: SubtitleEntry[] | null,
  mediaFileName: string,
  mediaFile: File | null,
  extAudioFile: File | null,
  selectedVoice?: string,
  processedTracks?: Record<number, { blob: Blob; audioFile: File; label: string }>,
  activeTrackNumber?: number | null,
  activeExternalTrackId?: string | null,
  originalAssHeader?: string,
  projectName?: string,
  splitRatio?: number
): Promise<void> {
  try {
    const db = await openDB();

    // Prepare serialized subtitles
    const serializedSubtitles: SerializedSubtitleEntry[] = await Promise.all(
      subtitles.map(async (sub) => {
        let audioBlob = audioBlobCache.get(sub.id);
        if (!audioBlob && sub.audioUrl && sub.audioUrl.startsWith('blob:')) {
          try {
            const res = await fetch(sub.audioUrl);
            if (res.ok) {
              audioBlob = await res.blob();
              audioBlobCache.set(sub.id, audioBlob);
            }
          } catch (e) {
            console.warn(`[Persistence] Could not fetch audio blob for sub ${sub.id}:`, e);
          }
        }

        return {
          id: sub.id,
          startTime: sub.startTime,
          endTime: sub.endTime,
          originalStartTime: sub.originalStartTime,
          originalEndTime: sub.originalEndTime,
          text: sub.text,
          translatedText: sub.translatedText,
          actor: sub.actor,
          originalActor: sub.originalActor,
          proofreadIssues: sub.proofreadIssues,
          audioBlob,
          audioSpeed: sub.audioSpeed,
          audioError: sub.audioError,
        };
      })
    );

    // Prepare serialized autoSubtitles
    let serializedAutoSubtitles: SerializedSubtitleEntry[] | null = null;
    if (autoSubtitles && autoSubtitles.length > 0) {
      serializedAutoSubtitles = autoSubtitles.map((sub) => ({
        id: sub.id,
        startTime: sub.startTime,
        endTime: sub.endTime,
        text: sub.text,
        translatedText: sub.translatedText,
        actor: sub.actor,
        originalActor: sub.originalActor,
        proofreadIssues: sub.proofreadIssues,
        audioSpeed: sub.audioSpeed,
      }));
    }

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put(serializedSubtitles, 'subtitles');
    store.put(serializedAutoSubtitles, 'autoSubtitles');
    store.put(mediaFileName || '', 'mediaFileName');
    if (projectName) {
      store.put(projectName, 'projectName');
    } else {
      store.delete('projectName');
    }
    const VALID_VOICES = new Set(['Ales', 'BelG2P', 'Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir']);
    const safeVoiceToSave = selectedVoice && VALID_VOICES.has(selectedVoice) ? selectedVoice : 'Ales';
    store.put(safeVoiceToSave, 'selectedVoice');
    if (originalAssHeader) {
      store.put(originalAssHeader, 'originalAssHeader');
    } else {
      store.delete('originalAssHeader');
    }

    if (processedTracks && Object.keys(processedTracks).length > 0) {
      const tracksToSave = Object.entries(processedTracks).map(([numStr, item]) => ({
        trackNumber: Number(numStr),
        name: item.audioFile.name,
        type: item.audioFile.type,
        blob: item.blob || item.audioFile,
        label: item.label,
      }));
      store.put(tracksToSave, 'processedTracksData');
    } else {
      store.delete('processedTracksData');
    }

    if (activeTrackNumber !== undefined && activeTrackNumber !== null) {
      store.put(activeTrackNumber, 'activeTrackNumber');
    } else {
      store.delete('activeTrackNumber');
    }

    if (activeExternalTrackId) {
      store.put(activeExternalTrackId, 'activeExternalTrackId');
    } else {
      store.delete('activeExternalTrackId');
    }

    if (mediaFile) {
      try {
        store.put({ name: mediaFile.name, type: mediaFile.type, blob: mediaFile }, 'mediaFileData');
      } catch (err) {
        console.warn('[Persistence] Could not store mediaFile blob in IDB, saving name only:', err);
        store.put({ name: mediaFile.name, type: mediaFile.type }, 'mediaFileData');
      }
    } else {
      store.delete('mediaFileData');
    }

    if (extAudioFile) {
      try {
        store.put({ name: extAudioFile.name, type: extAudioFile.type, blob: extAudioFile }, 'extAudioFileData');
      } catch (err) {
        store.put({ name: extAudioFile.name, type: extAudioFile.type }, 'extAudioFileData');
      }
    } else {
      store.delete('extAudioFileData');
    }

    if (typeof splitRatio === 'number' && !isNaN(splitRatio) && splitRatio >= 25 && splitRatio <= 75) {
      store.put(splitRatio, 'splitRatio');
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[Persistence] Save workspace failed:', err);
  }
}

/**
 * Load saved workspace state from IndexedDB
 */
export async function loadWorkspaceFromStorage(): Promise<SavedWorkspace | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const getReq = (key: string) =>
      new Promise<any>((resolve) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });

    const [
      rawSubtitles,
      rawAutoSubtitles,
      savedMediaFileName,
      mediaFileData,
      extAudioFileData,
      savedVoice,
      rawProcessedTracks,
      savedActiveTrackNumber,
      savedActiveExternalTrackId,
      savedOriginalAssHeader,
      savedProjectName,
      savedSplitRatio,
    ] = await Promise.all([
      getReq('subtitles'),
      getReq('autoSubtitles'),
      getReq('mediaFileName'),
      getReq('mediaFileData'),
      getReq('extAudioFileData'),
      getReq('selectedVoice'),
      getReq('processedTracksData'),
      getReq('activeTrackNumber'),
      getReq('activeExternalTrackId'),
      getReq('originalAssHeader'),
      getReq('projectName'),
      getReq('splitRatio'),
    ]);

    if ((!rawSubtitles || !Array.isArray(rawSubtitles) || rawSubtitles.length === 0) && !savedMediaFileName && !mediaFileData && !savedProjectName) {
      return null;
    }

    // Reconstruct subtitles with live object URLs
    const subtitles: SubtitleEntry[] = (rawSubtitles && Array.isArray(rawSubtitles))
      ? rawSubtitles.map((item: SerializedSubtitleEntry) => {
          let audioUrl: string | undefined = undefined;
          if (item.audioBlob && item.audioBlob instanceof Blob && item.audioBlob.size > 0) {
            audioUrl = URL.createObjectURL(item.audioBlob);
            audioBlobCache.set(item.id, item.audioBlob);
          }

          return {
            id: item.id,
            startTime: item.startTime,
            endTime: item.endTime,
            originalStartTime: item.originalStartTime,
            originalEndTime: item.originalEndTime,
            text: item.text,
            translatedText: item.translatedText,
            actor: item.actor,
            originalActor: item.originalActor,
            proofreadIssues: item.proofreadIssues,
            audioUrl,
            audioSpeed: item.audioSpeed,
            audioError: item.audioError,
          };
        })
      : [];

    let autoSubtitles: SubtitleEntry[] | null = null;
    if (rawAutoSubtitles && Array.isArray(rawAutoSubtitles)) {
      autoSubtitles = rawAutoSubtitles.map((item: SerializedSubtitleEntry) => ({
        id: item.id,
        startTime: item.startTime,
        endTime: item.endTime,
        text: item.text,
        translatedText: item.translatedText,
        actor: item.actor,
        originalActor: item.originalActor,
        proofreadIssues: item.proofreadIssues,
        audioSpeed: item.audioSpeed,
      }));
    }

    let restoredMediaFile: File | null = null;
    if (mediaFileData && mediaFileData.blob instanceof Blob) {
      restoredMediaFile = new File([mediaFileData.blob], mediaFileData.name, {
        type: mediaFileData.type || '',
      });
    }

    let restoredExtAudioFile: File | null = null;
    if (extAudioFileData && extAudioFileData.blob instanceof Blob) {
      restoredExtAudioFile = new File([extAudioFileData.blob], extAudioFileData.name, {
        type: extAudioFileData.type || '',
      });
    }

    const restoredProcessedTracks: Record<number, { blob: Blob; audioFile: File; label: string }> = {};
    if (rawProcessedTracks && Array.isArray(rawProcessedTracks)) {
      for (const item of rawProcessedTracks) {
        if (item && item.trackNumber && item.blob instanceof Blob) {
          const audioFile = new File([item.blob], item.name || `track_${item.trackNumber}.m4a`, {
            type: item.type || '',
          });
          restoredProcessedTracks[item.trackNumber] = {
            blob: item.blob,
            audioFile,
            label: item.label || `Дарожка #${item.trackNumber}`,
          };
        }
      }
    }

    const VALID_VOICES = new Set(['Ales', 'BelG2P', 'Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir']);
    const safeRestoredVoice = savedVoice && VALID_VOICES.has(savedVoice) ? savedVoice : 'Ales';

    return {
      subtitles,
      autoSubtitles,
      mediaFileName: savedMediaFileName || (mediaFileData?.name ?? ''),
      mediaFile: restoredMediaFile,
      extAudioFile: restoredExtAudioFile,
      selectedVoice: safeRestoredVoice,
      originalAssHeader: savedOriginalAssHeader || undefined,
      processedTracks: restoredProcessedTracks,
      activeTrackNumber: typeof savedActiveTrackNumber === 'number' ? savedActiveTrackNumber : null,
      activeExternalTrackId: savedActiveExternalTrackId || null,
      projectName: savedProjectName || undefined,
      splitRatio: typeof savedSplitRatio === 'number' && !isNaN(savedSplitRatio) ? savedSplitRatio : undefined,
    };
  } catch (err) {
    console.warn('[Persistence] Load workspace failed:', err);
    return null;
  }
}

/**
 * Clear all saved workspace data from IndexedDB
 */
export async function clearWorkspaceFromStorage(): Promise<void> {
  clearAudioBlobCache();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.warn('[Persistence] Clear storage failed:', err);
  }
}

/**
 * Clear only subtitles data from IndexedDB
 */
export async function clearSubtitlesFromStorage(): Promise<void> {
  clearAudioBlobCache();
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete('subtitles');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.warn('[Persistence] Clear subtitles storage failed:', err);
  }
}

/**
 * Clear only media data from IndexedDB
 */
export async function clearMediaFromStorage(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete('mediaFile');
    store.delete('mediaFileName');
    store.delete('extAudioFile');
    store.delete('processedTracks');
    store.delete('activeTrackNumber');
    store.delete('activeExternalTrackId');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    console.warn('[Persistence] Clear media storage failed:', err);
  }
}
