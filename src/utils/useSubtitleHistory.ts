import { useState, useRef, useCallback } from 'react';
import { SubtitleEntry } from '../types';

interface HistoryState {
  past: SubtitleEntry[][];
  present: SubtitleEntry[];
  future: SubtitleEntry[][];
}

const MAX_HISTORY_LENGTH = 50;

/**
 * Deep clone of subtitles array to ensure immutable snapshot
 */
function cloneSubtitles(entries: SubtitleEntry[]): SubtitleEntry[] {
  return entries.map((entry) => ({
    ...entry,
    proofreadIssues: entry.proofreadIssues ? [...entry.proofreadIssues] : undefined,
  }));
}

export function useSubtitleHistory(initialSubtitles: SubtitleEntry[] = []) {
  const [history, setHistory] = useState<HistoryState>({
    past: [],
    present: initialSubtitles,
    future: [],
  });

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingPastSnapshotRef = useRef<SubtitleEntry[] | null>(null);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  /**
   * Set subtitles directly and push current present to past history immediately
   */
  const setSubtitlesWithHistory = useCallback((
    newSubtitlesOrFn: SubtitleEntry[] | ((prev: SubtitleEntry[]) => SubtitleEntry[]),
    saveImmediate: boolean = true
  ) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    setHistory((curr) => {
      const nextPresent = typeof newSubtitlesOrFn === 'function'
        ? newSubtitlesOrFn(curr.present)
        : newSubtitlesOrFn;

      if (saveImmediate) {
        pendingPastSnapshotRef.current = null;
        const newPast = [...curr.past, cloneSubtitles(curr.present)];
        if (newPast.length > MAX_HISTORY_LENGTH) {
          newPast.shift();
        }
        return {
          past: newPast,
          present: nextPresent,
          future: [], // Clear redo stack on new action
        };
      } else {
        // Debounced typing: save base snapshot before typing began
        if (!pendingPastSnapshotRef.current) {
          pendingPastSnapshotRef.current = cloneSubtitles(curr.present);
        }

        debounceTimerRef.current = setTimeout(() => {
          setHistory((latest) => {
            if (!pendingPastSnapshotRef.current) return latest;
            const newPast = [...latest.past, pendingPastSnapshotRef.current];
            if (newPast.length > MAX_HISTORY_LENGTH) {
              newPast.shift();
            }
            pendingPastSnapshotRef.current = null;
            return {
              ...latest,
              past: newPast,
              future: [],
            };
          });
        }, 1000);

        return {
          ...curr,
          present: nextPresent,
        };
      }
    });
  }, []);

  /**
   * Reset the whole history (e.g. on loading a new project or file)
   */
  const resetHistory = useCallback((newEntries: SubtitleEntry[]) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingPastSnapshotRef.current = null;
    setHistory({
      past: [],
      present: newEntries,
      future: [],
    });
  }, []);

  /**
   * Undo last operation (Ctrl + Z)
   */
  const undo = useCallback((): SubtitleEntry[] | null => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingPastSnapshotRef.current = null;

    let restored: SubtitleEntry[] | null = null;
    setHistory((curr) => {
      if (curr.past.length === 0) return curr;

      const previous = curr.past[curr.past.length - 1];
      const newPast = curr.past.slice(0, curr.past.length - 1);
      restored = previous;

      return {
        past: newPast,
        present: previous,
        future: [cloneSubtitles(curr.present), ...curr.future],
      };
    });

    return restored;
  }, []);

  /**
   * Redo last undone operation (Ctrl + Y / Ctrl + Shift + Z)
   */
  const redo = useCallback((): SubtitleEntry[] | null => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingPastSnapshotRef.current = null;

    let restored: SubtitleEntry[] | null = null;
    setHistory((curr) => {
      if (curr.future.length === 0) return curr;

      const next = curr.future[0];
      const newFuture = curr.future.slice(1);
      restored = next;

      return {
        past: [...curr.past, cloneSubtitles(curr.present)],
        present: next,
        future: newFuture,
      };
    });

    return restored;
  }, []);

  return {
    subtitles: history.present,
    setSubtitles: setSubtitlesWithHistory,
    resetHistory,
    undo,
    redo,
    canUndo,
    canRedo,
    historyCount: history.past.length,
  };
}
