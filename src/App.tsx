/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Plus, 
  AlertCircle,
  Upload,
  Activity,
  ChevronDown,
  ChevronUp,
  Database,
  Save,
  Handshake,
  ExternalLink,
  BookOpen,
  Filter,
  Loader2
} from 'lucide-react';

import { SubtitleEntry, PlaybackState } from './types';
import { 
  srtTimeToSeconds, 
  secondsToSrtTime,
  stringifySrt,
  parseSrt,
  getOverlappingSubtitleIds,
  mergeSubtitlesByTime,
  stripSrtTags,
  sanitizeProjectName,
  getBelarusianSpellTokens,
  getStoredIgnoredWords,
  getStoredIgnoredCapitalization,
  stripAccents
} from './utils/subtitleUtils';
import { onHunspellReady } from './utils/hunspellChecker';
import { batchConvertPhonetics, convertPhoneticsLocal } from './utils/phoneticConverter';
import { mergeSubtitleAudio } from './utils/audioMerger';
import { prepareAudioForTranscriptionLocally, terminateFFmpegWorker } from './utils/ffmpegExtractor';
import {
  cacheAudioBlob,
  clearAudioBlobCache,
  saveWorkspaceToStorage,
  loadWorkspaceFromStorage,
  clearWorkspaceFromStorage,
  clearSubtitlesFromStorage,
  clearMediaFromStorage
} from './utils/persistence';
import { useSubtitleHistory } from './utils/useSubtitleHistory';
import { stringifyAss, parseSubtitleContent } from './utils/assParser';
import JSZip from 'jszip';

// Import components
import Header from './components/Header';
import TimelinePlayer from './components/TimelinePlayer';
import SubtitleItem from './components/SubtitleItem';
import ControlsPanel from './components/ControlsPanel';
import SubtitleTrackSelectModal from './components/SubtitleTrackSelectModal';
import HotkeysModal from './components/HotkeysModal';
import FormatHelpModal from './components/FormatHelpModal';
import { SearchModal } from './components/SearchModal';
import { GeminiApiKeyModal } from './components/GeminiApiKeyModal';
import { GlossaryModal } from './components/GlossaryModal';
import { useGrammarDbFullStatus } from './utils/useGrammarDbStatus';
import { useVerbumDbFullStatus } from './utils/useVerbumDbStatus';
import {
  saveFileUniversal,
  isTauriDesktop,
  getDesktopStorageInfo,
  clearDesktopTempCache,
  DesktopStorageInfo,
  openExternalUrl
} from './utils/tauriBridge';
import { synthesizeSubtitleAudioUniversal } from './utils/synthesisClient';
import { useSingleBrowserTab } from './utils/useSingleBrowserTab';
import { DuplicateTabModal } from './components/DuplicateTabModal';
import { extractUniversalAudioTrack } from './utils/mkvAudioExtractor';
import {
  desktopTranslateBatch,
  desktopProofreadBatch,
  desktopTranscribeAudio,
  getDesktopGeminiApiKey,
} from './utils/desktopAiClient';

export const SUPPORTED_VOICES: readonly string[] = ['Ales', 'BelG2P', 'Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'];
export const isSupportedVoice = (v: any): boolean => typeof v === 'string' && SUPPORTED_VOICES.includes(v);

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const isManual = localStorage.getItem('subaka_theme_manual') === 'true';
      const saved = localStorage.getItem('subaka_theme');
      if (isManual && (saved === 'light' || saved === 'dark')) {
        return saved;
      }
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return (saved === 'light' || saved === 'dark') ? saved : 'light';
    } catch {
      return 'light';
    }
  });

  const { isDuplicate: isDuplicateTab, takeOver: handleTakeOverTab } = useSingleBrowserTab();

  const {
    subtitles,
    setSubtitles,
    resetHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useSubtitleHistory([]);

  const [activeSubtitleIndex, setActiveSubtitleIndex] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('subaka_active_subtitle_index');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0) return parsed;
      }
    } catch {
      // ignore
    }
    return -1;
  });
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('subaka_selected_voice');
      if (saved && isSupportedVoice(saved)) return saved;
    } catch {}
    return 'Ales';
  });

  const handleVoiceChange = useCallback((v: string) => {
    const safeVoice = isSupportedVoice(v) ? v : 'Ales';
    setSelectedVoice(safeVoice);
    try {
      localStorage.setItem('subaka_selected_voice', safeVoice);
    } catch {}
  }, []);
  const [autoSubtitles, setAutoSubtitles] = useState<SubtitleEntry[] | null>(null);
  const [autoTranslate, setAutoTranslate] = useState<boolean>(false);
  const [autoSpellCheck, setAutoSpellCheck] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('subaka_auto_spell_check');
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  });

  const handleToggleAutoSpellCheck = useCallback((val: boolean) => {
    setAutoSpellCheck(val);
    if (!val) {
      setQuickFilter((prev) => (prev === 'errors' ? null : prev));
    }
    try {
      localStorage.setItem('subaka_auto_spell_check', String(val));
    } catch {
      // ignore
    }
  }, []);
  const [originalAssHeader, setOriginalAssHeader] = useState<string | undefined>(undefined);
  const [isFormatHelpOpen, setIsFormatHelpOpen] = useState<boolean>(false);
  const [isHotkeysOpen, setIsHotkeysOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [hunspellRevision, setHunspellRevision] = useState<number>(0);

  useEffect(() => {
    return onHunspellReady(() => {
      setHunspellRevision((prev) => prev + 1);
    });
  }, []);

  const [quickFilter, setQuickFilter] = useState<'comments' | 'errors' | null>(null);

  useEffect(() => {
    if (!autoSpellCheck && quickFilter === 'errors') {
      setQuickFilter(null);
    }
  }, [autoSpellCheck, quickFilter]);
  const [ignoredWords, setIgnoredWords] = useState<Set<string>>(() => getStoredIgnoredWords());
  const [ignoredCapitalization, setIgnoredCapitalization] = useState<Set<string>>(() => getStoredIgnoredCapitalization());

  useEffect(() => {
    const handleCapChange = (e: StorageEvent | CustomEvent) => {
      if ('key' in e && e.key !== 'subaka_ignored_capitalization') return;
      setIgnoredCapitalization(new Set(getStoredIgnoredCapitalization()));
    };

    window.addEventListener('storage', handleCapChange as EventListener);
    window.addEventListener('subaka-ignored-capitalization-updated', handleCapChange as EventListener);
    return () => {
      window.removeEventListener('storage', handleCapChange as EventListener);
      window.removeEventListener('subaka-ignored-capitalization-updated', handleCapChange as EventListener);
    };
  }, []);

  useEffect(() => {
    const handleIgnoredWordsChange = (e: StorageEvent | CustomEvent) => {
      if ('key' in e && e.key !== 'subaka_ignored_words') return;
      setIgnoredWords(new Set(getStoredIgnoredWords()));
    };

    window.addEventListener('storage', handleIgnoredWordsChange as EventListener);
    window.addEventListener('subaka-ignored-words-updated', handleIgnoredWordsChange as EventListener);
    return () => {
      window.removeEventListener('storage', handleIgnoredWordsChange as EventListener);
      window.removeEventListener('subaka-ignored-words-updated', handleIgnoredWordsChange as EventListener);
    };
  }, []);

  const [projectName, setProjectName] = useState<string>(() => {
    try {
      return localStorage.getItem('subaka_project_name') || '';
    } catch {
      return '';
    }
  });

  const [desktopStorage, setDesktopStorage] = useState<DesktopStorageInfo | null>(null);

  useEffect(() => {
    if (isTauriDesktop()) {
      getDesktopStorageInfo().then((info) => {
        if (info) setDesktopStorage(info);
      });
      let unlisten: (() => void) | null = null;
      import('@tauri-apps/api/event').then(({ listen }) => {
        listen('subaka-pause-playback', () => {
          setPlaybackState((prev) => ({ ...prev, isPlaying: false }));
        }).then((un) => {
          unlisten = un;
        });
      }).catch(() => {});

      // Intercept any clicked external http/https link to open in the system default browser
      const handleGlobalClick = (e: MouseEvent) => {
        let target = e.target as HTMLElement | null;
        while (target && target !== document.body) {
          if (target.tagName === 'A' && target.getAttribute('href')) {
            const href = target.getAttribute('href');
            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
              e.preventDefault();
              e.stopPropagation();
              openExternalUrl(href);
              return;
            }
          }
          target = target.parentElement;
        }
      };
      document.addEventListener('click', handleGlobalClick, true);

      return () => {
        if (unlisten) unlisten();
        document.removeEventListener('click', handleGlobalClick, true);
      };
    }
  }, []);

  const handleProjectNameChange = useCallback((name: string) => {
    setProjectName(name);
    try {
      localStorage.setItem('subaka_project_name', name);
    } catch {
      // ignore
    }
  }, []);

  const parentRef = useRef<HTMLDivElement>(null);

  // Subtitle text font size state (default 12px)
  const [subtitleFontSize, setSubtitleFontSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('subaka_card_subtitle_font_size');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 10 && parsed <= 24) return parsed;
      }
    } catch {
      // ignore
    }
    return 12;
  });

  const handleSubtitleFontSizeChange = useCallback((newSize: number) => {
    const clamped = Math.max(10, Math.min(24, newSize));
    setSubtitleFontSize(clamped);
    try {
      localStorage.setItem('subaka_card_subtitle_font_size', clamped.toString());
    } catch {
      // ignore
    }
  }, []);

  const addExternalAudioRef = useRef<((file: File) => Promise<void>) | null>(null);
  const handleRegisterAddExternalAudio = useCallback((fn: (file: File) => Promise<void>) => {
    addExternalAudioRef.current = fn;
  }, []);

  // Resizable layout state between Subtitles Editor and Video Player (between 25% and 75%)
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('subaka_split_ratio');
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 25 && val <= 75) return val;
      }
      return 50;
    } catch {
      return 50;
    }
  });
  const currentSplitRatioRef = useRef<number>(splitRatio);
  currentSplitRatioRef.current = splitRatio;
  const splitTooltipRef = useRef<HTMLDivElement>(null);

  const [isRestored, setIsRestored] = useState<boolean>(false);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const mainWorkspaceRef = useRef<HTMLElement>(null);
  const editorSectionRef = useRef<HTMLElement>(null);
  const playerSectionRef = useRef<HTMLElement>(null);
  const lastSplitClickTimeRef = useRef<number>(0);
  const dragStartXRef = useRef<number>(0);
  const hasMovedRef = useRef<boolean>(false);

  // Synchronize CSS custom properties and store to localStorage immediately on mount and changes
  useEffect(() => {
    try {
      localStorage.setItem('subaka_split_ratio', String(splitRatio));
    } catch {}
    if (mainWorkspaceRef.current) {
      mainWorkspaceRef.current.style.setProperty('--editor-width', `${splitRatio}%`);
      mainWorkspaceRef.current.style.setProperty('--player-width', `${100 - splitRatio}%`);
    }
    if (editorSectionRef.current) {
      editorSectionRef.current.style.setProperty('--editor-width', `${splitRatio}%`);
    }
    if (playerSectionRef.current) {
      playerSectionRef.current.style.setProperty('--player-width', `${100 - splitRatio}%`);
    }
  }, [splitRatio]);

  const isDraggingSplitRef = useRef<boolean>(false);
  const subtitlesRef = useRef<SubtitleEntry[]>(subtitles);
  subtitlesRef.current = subtitles;
  const activeSubtitleIndexRef = useRef<number>(activeSubtitleIndex);
  activeSubtitleIndexRef.current = activeSubtitleIndex;

  // Natural CSS Windowing State for high performance with 0 layout overlap bugs on panel resize
  const [listScrollTop, setListScrollTop] = useState(0);
  const [listContainerHeight, setListContainerHeight] = useState(600);
  const [listContainerWidth, setListContainerWidth] = useState(500);
  const [virtualScrollTrigger, setVirtualScrollTrigger] = useState(0);
  const measuredHeightsRef = useRef<Map<number, number>>(new Map());
  const itemResizeObserverRef = useRef<ResizeObserver | null>(null);

  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setListScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Observe container dimensions for scroll calculations
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    setListContainerHeight(el.clientHeight || 600);
    setListContainerWidth(el.clientWidth || 500);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.round(entry.contentRect.width);
        const h = Math.round(entry.contentRect.height);
        setListContainerWidth((prevW) => (Math.abs(prevW - w) >= 2 ? w : prevW));
        setListContainerHeight((prevH) => (Math.abs(prevH - h) >= 2 ? h : prevH));
        setVirtualScrollTrigger((prev) => prev + 1);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ResizeObserver for measuring visible rendered cards
  useEffect(() => {
    itemResizeObserverRef.current = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const indexStr = target.getAttribute('data-index');
        if (indexStr !== null) {
          const index = parseInt(indexStr, 10);
          const h = target.offsetHeight;
          if (h && h > 50) {
            const prev = measuredHeightsRef.current.get(index);
            if (!prev || Math.abs(prev - h) > 2) {
              measuredHeightsRef.current.set(index, h);
              changed = true;
            }
          }
        }
      }
      if (changed) {
        setVirtualScrollTrigger((prev) => prev + 1);
      }
    });

    return () => {
      itemResizeObserverRef.current?.disconnect();
    };
  }, []);

  const measureElementNode = useCallback((index: number, node: HTMLDivElement | null) => {
    if (!node) return;
    if (itemResizeObserverRef.current) {
      itemResizeObserverRef.current.observe(node);
    }
    const h = node.offsetHeight;
    if (h && h > 50) {
      const prev = measuredHeightsRef.current.get(index);
      if (!prev || Math.abs(prev - h) > 2) {
        measuredHeightsRef.current.set(index, h);
      }
    }
  }, []);

  // Reset measured heights when font size or split ratio changes
  useEffect(() => {
    measuredHeightsRef.current.clear();
    setVirtualScrollTrigger((prev) => prev + 1);
  }, [subtitleFontSize, splitRatio]);

  const estimateItemHeight = useCallback((index: number, width: number, fontSize: number) => {
    const sub = subtitlesRef.current[index];
    if (!sub) return 220;
    const textWidth = Math.max(160, width - 56);
    const charWidth = Math.max(7, Math.round(fontSize * 0.52));
    const charsPerLine = Math.max(16, Math.floor(textWidth / charWidth));
    const origText = sub.text || '';
    const transText = sub.translatedText || '';
    const origLines = origText ? origText.split('\n').reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / charsPerLine)), 0) : 1;
    const transLines = transText ? transText.split('\n').reduce((acc, line) => acc + Math.max(1, Math.ceil(line.length / charsPerLine)), 0) : 1;
    const totalLines = origLines + transLines;
    const lineHeight = Math.round(fontSize * 1.5) + 8;
    const baseHeight = 175;
    return baseHeight + totalLines * lineHeight + (sub.actor || sub.originalActor ? 28 : 0);
  }, []);

  const getItemHeight = useCallback((index: number) => {
    const measured = measuredHeightsRef.current.get(index);
    if (measured && measured > 50) return measured;
    return estimateItemHeight(index, listContainerWidth, subtitleFontSize);
  }, [listContainerWidth, subtitleFontSize, estimateItemHeight]);

  // Quick Filter for Subtitles (заўвагі, CPS, памылкі)
  const displayedSubtitlesWithIndices = useMemo(() => {
    if (!quickFilter) {
      return subtitles.map((entry, index) => ({ entry, originalIndex: index }));
    }

    return subtitles
      .map((entry, index) => ({ entry, originalIndex: index }))
      .filter(({ entry, originalIndex }) => {
        if (quickFilter === 'comments') {
          return Boolean(entry.proofreadIssues && entry.proofreadIssues.length > 0);
        }

        if (quickFilter === 'errors') {
          if (!autoSpellCheck) return false;
          if (!entry.translatedText || !entry.translatedText.trim()) return false;
          const prevText = originalIndex > 0 ? subtitles[originalIndex - 1].translatedText : undefined;
          const tokens = getBelarusianSpellTokens(entry.translatedText, ignoredWords, {
            previousText: prevText,
            ignoredCapitalization,
          });
          return tokens.some((t) => t.isError && t.errorType !== 'yellow');
        }

        return true;
      });
  }, [subtitles, quickFilter, ignoredWords, ignoredCapitalization, hunspellRevision, autoSpellCheck]);

  const handleToggleQuickFilter = useCallback((filter: 'comments' | 'errors') => {
    if (filter === 'errors' && !autoSpellCheck) return;
    setQuickFilter((prev) => (prev === filter ? null : filter));
    if (parentRef.current) {
      parentRef.current.scrollTop = 0;
    }
  }, [autoSpellCheck]);

  // Compute visible item window & spacers
  const totalCount = displayedSubtitlesWithIndices.length;
  let topPadding = 0;
  let bottomPadding = 0;
  let startIndex = 0;
  let endIndex = Math.max(0, totalCount - 1);

  if (totalCount > 0) {
    const overscan = 8;
    const viewTop = listScrollTop;
    const viewBottom = listScrollTop + (listContainerHeight || 600);

    let currentTop = 0;
    let startFound = false;
    let computedStartIndex = 0;
    let computedEndIndex = totalCount - 1;

    for (let i = 0; i < totalCount; i++) {
      const origIdx = displayedSubtitlesWithIndices[i].originalIndex;
      const h = getItemHeight(origIdx) + 10; // 10px gap
      const itemBottom = currentTop + h;

      if (!startFound && itemBottom >= viewTop) {
        computedStartIndex = Math.max(0, i - overscan);
        startFound = true;
      }

      if (startFound && currentTop > viewBottom + 300) {
        computedEndIndex = Math.min(totalCount - 1, i + overscan);
        break;
      }

      currentTop = itemBottom;
    }

    startIndex = computedStartIndex;
    endIndex = Math.min(totalCount - 1, Math.max(startIndex, computedEndIndex));

    let sumTop = 0;
    for (let i = 0; i < startIndex; i++) {
      sumTop += getItemHeight(displayedSubtitlesWithIndices[i].originalIndex) + 10;
    }
    topPadding = sumTop;

    let sumBottom = 0;
    for (let i = endIndex + 1; i < totalCount; i++) {
      sumBottom += getItemHeight(displayedSubtitlesWithIndices[i].originalIndex) + 10;
    }
    bottomPadding = sumBottom;
  }

  const visibleSubtitles: { entry: SubtitleEntry; index: number }[] = [];
  for (let i = startIndex; i <= endIndex && i < totalCount; i++) {
    const item = displayedSubtitlesWithIndices[i];
    if (item) {
      visibleSubtitles.push({ entry: item.entry, index: item.originalIndex });
    }
  }

  const scrollToSubtitleIndex = useCallback((index: number, align: 'auto' | 'center' = 'auto') => {
    if (index < 0 || !parentRef.current) return;
    const el = document.getElementById(`subtitle-card-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: 'auto', block: align === 'center' ? 'center' : 'nearest' });
      return;
    }
    const displayPos = displayedSubtitlesWithIndices.findIndex((item) => item.originalIndex === index);
    if (displayPos === -1) return;
    let targetTop = 0;
    for (let i = 0; i < displayPos; i++) {
      targetTop += getItemHeight(displayedSubtitlesWithIndices[i].originalIndex) + 10;
    }
    if (align === 'center') {
      targetTop = Math.max(0, targetTop - (listContainerHeight || 600) / 2);
    }
    parentRef.current.scrollTop = targetTop;
  }, [listContainerHeight, getItemHeight, displayedSubtitlesWithIndices]);

  // Auto-scroll when activeSubtitleIndex changes
  useEffect(() => {
    if (activeSubtitleIndex >= 0 && activeSubtitleIndex < subtitles.length) {
      const rafId = requestAnimationFrame(() => {
        scrollToSubtitleIndex(activeSubtitleIndex, 'auto');
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [activeSubtitleIndex, subtitles.length, scrollToSubtitleIndex]);

  // Initial scroll to selected subtitle after workspace is restored
  useEffect(() => {
    if (isRestored && activeSubtitleIndex >= 0 && activeSubtitleIndex < subtitles.length) {
      const t = setTimeout(() => {
        scrollToSubtitleIndex(activeSubtitleIndex, 'center');
      }, 150);
      return () => clearTimeout(t);
    }
  }, [isRestored, activeSubtitleIndex, subtitles.length, scrollToSubtitleIndex]);

  // Persist active selected subtitle index and ID to localStorage (only after workspace restored)
  useEffect(() => {
    if (!isRestored) return;
    try {
      if (activeSubtitleIndex >= 0 && activeSubtitleIndex < subtitles.length) {
        localStorage.setItem('subaka_active_subtitle_index', String(activeSubtitleIndex));
        const sub = subtitles[activeSubtitleIndex];
        if (sub?.id) {
          localStorage.setItem('subaka_active_subtitle_id', sub.id);
        }
      } else if (subtitles.length === 0) {
        localStorage.removeItem('subaka_active_subtitle_index');
        localStorage.removeItem('subaka_active_subtitle_id');
      }
    } catch {
      // ignore
    }
  }, [activeSubtitleIndex, subtitles, isRestored]);

  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const now = Date.now();
    if (now - lastSplitClickTimeRef.current < 350) {
      // Double click detected -> reset to 50%
      lastSplitClickTimeRef.current = 0;
      currentSplitRatioRef.current = 50;
      setSplitRatio(50);
      if (mainWorkspaceRef.current) {
        mainWorkspaceRef.current.style.setProperty('--editor-width', '50%');
        mainWorkspaceRef.current.style.setProperty('--player-width', '50%');
      }
      if (editorSectionRef.current) {
        editorSectionRef.current.style.setProperty('--editor-width', '50%');
      }
      if (playerSectionRef.current) {
        playerSectionRef.current.style.setProperty('--player-width', '50%');
      }
      isDraggingSplitRef.current = false;
      setIsDraggingSplit(false);
      try {
        localStorage.setItem('subaka_split_ratio', '50');
      } catch {}
      return;
    }
    lastSplitClickTimeRef.current = now;
    dragStartXRef.current = e.clientX;
    hasMovedRef.current = false;
    isDraggingSplitRef.current = true;
    setIsDraggingSplit(true);
  };

  const handleSplitTouchStart = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastSplitClickTimeRef.current < 350) {
      lastSplitClickTimeRef.current = 0;
      currentSplitRatioRef.current = 50;
      setSplitRatio(50);
      if (mainWorkspaceRef.current) {
        mainWorkspaceRef.current.style.setProperty('--editor-width', '50%');
        mainWorkspaceRef.current.style.setProperty('--player-width', '50%');
      }
      if (editorSectionRef.current) {
        editorSectionRef.current.style.setProperty('--editor-width', '50%');
      }
      if (playerSectionRef.current) {
        playerSectionRef.current.style.setProperty('--player-width', '50%');
      }
      isDraggingSplitRef.current = false;
      setIsDraggingSplit(false);
      try {
        localStorage.setItem('subaka_split_ratio', '50');
      } catch {}
      return;
    }
    lastSplitClickTimeRef.current = now;
    if (e.touches.length > 0) {
      dragStartXRef.current = e.touches[0].clientX;
      hasMovedRef.current = false;
      isDraggingSplitRef.current = true;
      setIsDraggingSplit(true);
    }
  };

  useEffect(() => {
    if (!isDraggingSplit) return;

    let rafId: number | null = null;

    const handleMove = (clientX: number) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (!mainWorkspaceRef.current) return;
        if (Math.abs(clientX - dragStartXRef.current) > 2) {
          hasMovedRef.current = true;
        }
        const rect = mainWorkspaceRef.current.getBoundingClientRect();
        const totalWidth = rect.width;
        if (totalWidth <= 0) return;
        const offset = clientX - rect.left;
        const rawRatio = (offset / totalWidth) * 100;
        const clampedRatio = Math.min(75, Math.max(25, Math.round(rawRatio * 10) / 10));
        currentSplitRatioRef.current = clampedRatio;
        // Directly update CSS properties on the container and section elements for 60fps/120fps buttery smooth dragging
        mainWorkspaceRef.current.style.setProperty('--editor-width', `${clampedRatio}%`);
        mainWorkspaceRef.current.style.setProperty('--player-width', `${100 - clampedRatio}%`);
        if (editorSectionRef.current) {
          editorSectionRef.current.style.setProperty('--editor-width', `${clampedRatio}%`);
        }
        if (playerSectionRef.current) {
          playerSectionRef.current.style.setProperty('--player-width', `${100 - clampedRatio}%`);
        }
        if (splitTooltipRef.current) {
          splitTooltipRef.current.textContent = `Субцітры: ${Math.round(clampedRatio)}% | Відэа: ${Math.round(100 - clampedRatio)}%`;
        }
      });
    };

    const onMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX);
      }
    };

    const onEnd = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const finalRatio = currentSplitRatioRef.current;
      isDraggingSplitRef.current = false;
      setIsDraggingSplit(false);
      setSplitRatio(finalRatio);
      try {
        localStorage.setItem('subaka_split_ratio', String(finalRatio));
      } catch {}
      requestAnimationFrame(() => {
        setVirtualScrollTrigger((prev) => prev + 1);
      });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchend', onEnd);
    };
  }, [isDraggingSplit]);

  const [showActorsOnPlayer, setShowActorsOnPlayer] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('subaka_show_actors_on_player');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const handleToggleShowActorsOnPlayer = (enabled: boolean) => {
    setShowActorsOnPlayer(enabled);
    try {
      localStorage.setItem('subaka_show_actors_on_player', String(enabled));
    } catch {}
  };

  useEffect(() => {
    try {
      localStorage.setItem('subaka_theme', theme);
    } catch {}

    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
      root.style.colorScheme = 'light';
    }
  }, [theme]);

  // Sync automatically when the user toggles dark/light theme in their browser / OS
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      const systemTheme = e.matches ? 'dark' : 'light';
      setTheme(systemTheme);
      try {
        localStorage.setItem('subaka_theme', systemTheme);
        // Clear manual override when user changes browser preference so it tracks browser
        localStorage.removeItem('subaka_theme_manual');
      } catch {}
    };

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    } else if ((mediaQuery as any).addListener) {
      (mediaQuery as any).addListener(handleSystemThemeChange);
      return () => (mediaQuery as any).removeListener(handleSystemThemeChange);
    }
  }, []);

  const handleToggleTheme = () => {
    setTheme((prev) => {
      const nextTheme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('subaka_theme', nextTheme);
        localStorage.setItem('subaka_theme_manual', 'true');
      } catch {}
      return nextTheme;
    });
  };

  const [geminiApiKey, setGeminiApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem('subaka_gemini_api_key') || '';
    } catch {
      return '';
    }
  });
  const [isGeminiKeyModalOpen, setIsGeminiKeyModalOpen] = useState(false);

  // Global notification toast banner list
  const [, setToasts] = useState<{ id: string; message: string; type: any }[]>([]);
  const [latestMessage, setLatestMessage] = useState<{ message: string; type: 'success' | 'info' | 'error' | 'warning' } | null>(null);
  const [messagesHistory, setMessagesHistory] = useState<{ id: string; timestamp: string; message: string; type: 'success' | 'info' | 'error' | 'warning' }[]>([]);
  const lastToastRef = useRef<{ message: string; timestamp: number } | null>(null);

  const addToast = useCallback((message: string, type: 'success' | 'info' | 'error' | 'warning' = 'info') => {
    const now = Date.now();
    if (lastToastRef.current && lastToastRef.current.message === message && now - lastToastRef.current.timestamp < 2000) {
      return;
    }
    lastToastRef.current = { message, timestamp: now };

    const id = Math.random().toString(36).substring(4);
    setToasts((prev) => [...prev, { id, message, type }]);
    setLatestMessage({ message, type });
    
    const timestamp = new Date().toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setMessagesHistory((prev) => [{ id, timestamp, message, type }, ...prev]);

    // Toast messages recorded to history
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Standard API headers helper: sends personal geminiApiKey if provided by user, otherwise server uses default shared key
  const getApiHeaders = useCallback((additionalHeaders: Record<string, string> = {}) => {
    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(additionalHeaders)) {
      if (typeof val === 'string') {
        headers[key] = val.replace(/[^\x00-\x7F]/g, '');
      }
    }
    const effectiveKey = geminiApiKey || (isTauriDesktop() ? getDesktopGeminiApiKey() : '');
    if (effectiveKey && typeof effectiveKey === 'string') {
      const cleanKey = effectiveKey.replace(/[^\x00-\x7F]/g, '').trim().replace(/^["']|["']$/g, '');
      if (cleanKey) {
        headers['x-gemini-api-key'] = cleanKey;
      }
    }
    return headers;
  }, [geminiApiKey]);
  
  // App states
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const cancelTranslatingRef = React.useRef(false);
  const translateAbortControllerRef = React.useRef<AbortController | null>(null);
  const [isSynthesizingAll, setIsSynthesizingAll] = useState(false);
  const cancelSynthesizingRef = React.useRef(false);
  const transcribeAbortControllerRef = React.useRef<AbortController | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isProofreadingTranslation, setIsProofreadingTranslation] = useState(false);
  const cancelProofreadingRef = React.useRef(false);
  const proofreadAbortControllerRef = React.useRef<AbortController | null>(null);
  const [isConvertingPhoneticsAll, setIsConvertingPhoneticsAll] = useState(false);
  const isClearingWorkspaceRef = React.useRef(false);

  // GrammarDB Deployment & Ready Status tracking
  const grammarDbStatus = useGrammarDbFullStatus();
  const prevGrammarBuildingRef = useRef<boolean | undefined>(undefined);
  const prevGrammarReadyRef = useRef<boolean | undefined>(undefined);
  const lastLoggedGrammarMsgRef = useRef<string>('');

  // Verbum Offline Dictionaries Deployment & Ready Status tracking
  const verbumDbStatus = useVerbumDbFullStatus();
  const prevVerbumReadyRef = useRef<boolean | undefined>(undefined);
  const hasNotifiedVerbumDeployedRef = useRef<boolean>(false);

  useEffect(() => {
    if (prevVerbumReadyRef.current === undefined) {
      prevVerbumReadyRef.current = verbumDbStatus.ready;
      if (verbumDbStatus.ready) {
        const sizeStr = verbumDbStatus.sizeMb ? `${verbumDbStatus.sizeMb} МБ, ` : '';
        const countStr = verbumDbStatus.articleCount ? `${(verbumDbStatus.articleCount / 1000).toFixed(0)}K арт.` : '';
        const msg = `Аўтаномны рэзерв слоўнікаў Verbum гатовы (${sizeStr}${countStr}, падключаецца пры недасяжнасці verbum.by)`;
        const timestamp = new Date().toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setMessagesHistory((prev) => [{ id: Math.random().toString(36).substring(4), timestamp, message: msg, type: 'success' }, ...prev]);
      }
      return;
    }
    if (prevVerbumReadyRef.current === false && verbumDbStatus.ready && !hasNotifiedVerbumDeployedRef.current) {
      hasNotifiedVerbumDeployedRef.current = true;
      const sizeStr = verbumDbStatus.sizeMb ? `${verbumDbStatus.sizeMb} МБ, ` : '';
      const countStr = verbumDbStatus.articleCount ? `${(verbumDbStatus.articleCount / 1000).toFixed(0)}K арт.` : '';
      const msg = `Аўтаномны рэзерв слоўнікаў Verbum разгорнуты (${sizeStr}${countStr}, падключаецца пры недасяжнасці verbum.by)`;
      addToast(msg, "success");
    }
    prevVerbumReadyRef.current = verbumDbStatus.ready;
  }, [verbumDbStatus.ready, verbumDbStatus.articleCount, verbumDbStatus.sizeMb, addToast]);

  const [playbackState, setPlaybackState] = useState<PlaybackState>({
    currentTime: 0,
    isPlaying: false,
    playbackSpeed: 1.0,
    isSubtitlesOnlyPlay: true, // Default live-dubbing on
  });

  const [mediaLoadingProgress, setMediaLoadingProgress] = useState<number | null>(null);
  const [isAudioProcessing, setIsAudioProcessing] = useState<boolean>(false);
  const [mediaFileName, setMediaFileName] = useState<string>('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [extAudioFile, setExtAudioFile] = useState<File | null>(null);
  const [processedTracks, setProcessedTracks] = useState<Record<number, { blob: Blob; audioFile: File; label: string }>>({});
  const [processedForGenTracks, setProcessedForGenTracks] = useState<Record<number, { blob: Blob; audioFile: File; label: string }>>({});
  const [activeTrackNumber, setActiveTrackNumber] = useState<number | null>(null);
  const [activeExternalTrackId, setActiveExternalTrackId] = useState<string | null>(null);
  const [transcribeProgress, setTranscribeProgress] = useState<string | null>(null);
  const [isSubtitleTrackModalOpen, setIsSubtitleTrackModalOpen] = useState<boolean>(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState<boolean>(false);

  // Initialize workspace from storage
  useEffect(() => {
    async function initStorage() {
      try {
        const restored = await loadWorkspaceFromStorage();
        if (restored) {
          let targetIdx = 0;
          let hasTargetSubtitle = false;
          if (restored.subtitles && restored.subtitles.length > 0) {
            resetHistory(restored.subtitles);
            
            // Restore active selected subtitle card index and ID
            try {
              const savedId = localStorage.getItem('subaka_active_subtitle_id');
              const savedIdxStr = localStorage.getItem('subaka_active_subtitle_index');
              if (savedId) {
                const foundIdx = restored.subtitles.findIndex((s) => s.id === savedId);
                if (foundIdx !== -1) {
                  targetIdx = foundIdx;
                }
              } else if (savedIdxStr !== null) {
                const parsed = parseInt(savedIdxStr, 10);
                if (!isNaN(parsed) && parsed >= 0 && parsed < restored.subtitles.length) {
                  targetIdx = parsed;
                }
              }
            } catch {}

            setActiveSubtitleIndex(targetIdx);
            hasTargetSubtitle = Boolean(restored.subtitles[targetIdx]);
          }

          // Restore playback current time (prioritize saved playbackCurrentTime from DB or localStorage)
          let restoredTime = 0;
          const lsTimeStr = localStorage.getItem('subaka_playback_current_time');
          const lsTime = lsTimeStr ? parseFloat(lsTimeStr) : NaN;
          if (typeof restored.playbackCurrentTime === 'number' && Number.isFinite(restored.playbackCurrentTime) && restored.playbackCurrentTime >= 0) {
            restoredTime = restored.playbackCurrentTime;
          } else if (!isNaN(lsTime) && lsTime >= 0) {
            restoredTime = lsTime;
          } else if (hasTargetSubtitle && restored.subtitles?.[targetIdx]) {
            restoredTime = srtTimeToSeconds(restored.subtitles[targetIdx].startTime);
          }

          if (restoredTime >= 0) {
            handlePlaybackStateChange({ currentTime: restoredTime });
          }

          if (restored.autoSubtitles) setAutoSubtitles(restored.autoSubtitles);
          if (restored.mediaFileName) setMediaFileName(restored.mediaFileName);
          if (restored.mediaFile) setMediaFile(restored.mediaFile);
          if (restored.extAudioFile) setExtAudioFile(restored.extAudioFile);
          if (restored.selectedVoice) {
            const safeVoice = isSupportedVoice(restored.selectedVoice) ? restored.selectedVoice : 'Ales';
            setSelectedVoice(safeVoice);
            try {
              localStorage.setItem('subaka_selected_voice', safeVoice);
            } catch {}
          }
          if (restored.processedTracks) setProcessedTracks(restored.processedTracks);
          if (restored.activeTrackNumber !== undefined) setActiveTrackNumber(restored.activeTrackNumber);
          if (restored.activeExternalTrackId) setActiveExternalTrackId(restored.activeExternalTrackId);
          if (restored.originalAssHeader) setOriginalAssHeader(restored.originalAssHeader);
          if (restored.projectName) {
            setProjectName(restored.projectName);
            try {
              localStorage.setItem('subaka_project_name', restored.projectName);
            } catch {}
          }
          if (restored.splitRatio && typeof restored.splitRatio === 'number' && restored.splitRatio >= 25 && restored.splitRatio <= 75) {
            setSplitRatio(restored.splitRatio);
            try {
              localStorage.setItem('subaka_split_ratio', String(restored.splitRatio));
            } catch {}
          }
        }
      } catch (e) {
        console.warn('[Storage] Init error:', e);
      } finally {
        setIsRestored(true);
      }
      checkServiceHealth();
    }
    initStorage();
  }, [resetHistory]);

  // Robust Auto-Save function (saves to IndexedDB and records timestamp)
  const triggerAutosave = useCallback(async (isManual = false) => {
    if (!isRestored || isClearingWorkspaceRef.current) return;
    try {
      setIsSaving(true);
      await saveWorkspaceToStorage(
        subtitles,
        autoSubtitles,
        mediaFileName,
        mediaFile,
        extAudioFile,
        selectedVoice,
        processedTracks,
        activeTrackNumber,
        activeExternalTrackId,
        originalAssHeader,
        projectName,
        splitRatio,
        playbackState.currentTime
      );
      const nowStr = new Date().toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit' });
      setLastSavedTime(nowStr);
      try {
        localStorage.setItem('subaka_last_saved', new Date().toISOString());
      } catch {}
      if (isManual) {
        addToast("Праект захаваны ў лакальнае сховішча", "success");
      }
    } catch (err) {
      console.warn('[Storage] Autosave error:', err);
    } finally {
      setIsSaving(false);
    }
  }, [
    isRestored,
    subtitles,
    autoSubtitles,
    mediaFileName,
    mediaFile,
    extAudioFile,
    selectedVoice,
    processedTracks,
    activeTrackNumber,
    activeExternalTrackId,
    originalAssHeader,
    projectName,
    splitRatio,
    playbackState.currentTime,
  ]);

  // Periodic interval auto-save + trigger save on tab unload / refresh
  useEffect(() => {
    if (!isRestored) return;
    const interval = setInterval(() => {
      triggerAutosave(false);
    }, 10000);

    const handleBeforeUnload = () => {
      triggerAutosave(false);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isRestored, triggerAutosave]);

  // Debounced auto-save when subtitles or project metadata change (1.5s after last edit)
  useEffect(() => {
    if (!isRestored) return;
    const timer = setTimeout(() => {
      triggerAutosave(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [subtitles, projectName, selectedVoice, isRestored, triggerAutosave]);

  // Undo / Redo notification handlers
  const handleUndo = useCallback(() => {
    const restored = undo();
    if (restored) {
      addToast("Дзеянне адменена (Undo)", "info");
    }
  }, [undo]);

  const handleRedo = useCallback(() => {
    const restored = redo();
    if (restored) {
      addToast("Дзеянне вернута (Redo)", "info");
    }
  }, [redo]);

  // Ref to trigger handleAddSubtitle from hotkeys without dependency cycle
  const handleAddSubtitleRef = useRef<(customTime?: number) => void>(() => {});

  // Global Hotkeys Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const target = e.target as HTMLElement;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      // 1. Ctrl + Space: Play/Pause audio/video playback (works globally)
      if (cmdOrCtrl && e.code === 'Space') {
        e.preventDefault();
        setPlaybackState((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
        return;
      }

      // 2. Alt + Left / Up: Navigate to previous subtitle
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowUp')) {
        e.preventDefault();
        if (subtitles.length > 0) {
          setActiveSubtitleIndex((curr) => {
            const nextIdx = Math.max(0, curr > 0 ? curr - 1 : 0);
            const targetSub = subtitles[nextIdx];
            if (targetSub) {
              const startSec = srtTimeToSeconds(targetSub.startTime);
              handlePlaybackStateChange({ currentTime: startSec });
            }
            return nextIdx;
          });
        }
        return;
      }

      // 3. Alt + Right / Down: Navigate to next subtitle
      if (e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (subtitles.length > 0) {
          setActiveSubtitleIndex((curr) => {
            const nextIdx = Math.min(subtitles.length - 1, curr < subtitles.length - 1 ? curr + 1 : curr);
            const targetSub = subtitles[nextIdx];
            if (targetSub) {
              const startSec = srtTimeToSeconds(targetSub.startTime);
              handlePlaybackStateChange({ currentTime: startSec });
            }
            return nextIdx;
          });
        }
        return;
      }

      // 4. Ctrl + S / Cmd + S: Instant save (works globally across all keyboard layouts - English, Belarusian, Russian, etc.)
      if (cmdOrCtrl && (e.code === 'KeyS' || e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы') && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        triggerAutosave(true);
        return;
      }

      // 5. Ctrl + Z (Undo) - works across all keyboard layouts (English, Belarusian, Cyrillic, etc.)
      const isUndoKey =
        cmdOrCtrl && !e.altKey && !e.shiftKey && (
          e.code === 'KeyZ' ||
          e.keyCode === 90 ||
          (e as any).which === 90 ||
          e.key === 'z' ||
          e.key === 'Z' ||
          e.key === 'я' ||
          e.key === 'Я' ||
          e.key === '\u001a'
        );

      if (isUndoKey) {
        if (!isTyping) {
          e.preventDefault();
          e.stopPropagation();
          if (canUndo) {
            handleUndo();
          }
          return;
        } else {
          // Inside input or textarea: first attempt native field undo
          let nativeUndone = false;
          try {
            nativeUndone = document.execCommand('undo');
          } catch {}
          // If native field has no more undo states and workspace has undo history, fallback to workspace undo
          if (!nativeUndone && canUndo) {
            e.preventDefault();
            e.stopPropagation();
            handleUndo();
            return;
          }
        }
      }

      // 6. Ctrl + Y or Ctrl + Shift + Z (Redo) - works across all keyboard layouts (English, Belarusian, Cyrillic, etc.)
      const isRedoKey =
        (cmdOrCtrl && !e.altKey && !e.shiftKey && (
          e.code === 'KeyY' ||
          e.keyCode === 89 ||
          (e as any).which === 89 ||
          e.key === 'y' ||
          e.key === 'Y' ||
          e.key === 'н' ||
          e.key === 'Н' ||
          e.key === '\u0019'
        )) ||
        (cmdOrCtrl && !e.altKey && e.shiftKey && (
          e.code === 'KeyZ' ||
          e.keyCode === 90 ||
          (e as any).which === 90 ||
          e.key === 'z' ||
          e.key === 'Z' ||
          e.key === 'я' ||
          e.key === 'Я' ||
          e.key === '\u001a'
        ));

      if (isRedoKey) {
        e.preventDefault();
        e.stopPropagation();
        if (isTyping) {
          // Browsers (especially Chromium) fail to trigger native redo on Cyrillic Ctrl+Y (key 'н') in textareas/inputs.
          // Trigger native redo via execCommand first, then fallback to workspace redo
          let nativeRedone = false;
          try {
            nativeRedone = document.execCommand('redo');
          } catch {}
          if (!nativeRedone && canRedo) {
            handleRedo();
          }
        } else {
          if (canRedo) {
            handleRedo();
          }
        }
        return;
      }

      // 7. F1 or ? (outside typing): Open hotkeys modal
      if ((e.key === 'F1' || (e.key === '?' && !isTyping))) {
        e.preventDefault();
        setIsHotkeysOpen((prev) => !prev);
        return;
      }

      // 8. Ctrl + F: Open search modal across subtitles (works across all layouts via code === 'KeyF' and capture phase)
      if (cmdOrCtrl && (e.code === 'KeyF' || e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
        e.preventDefault();
        e.stopPropagation();
        setIsSearchOpen(true);
        return;
      }

      // 9. Alt + 1: Trigger Proofread "пр." (Праверка правапісу карткі) for active/selected subtitle card
      if (e.altKey && (e.key === '1' || e.code === 'Digit1' || e.code === 'Numpad1')) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('subaka-hotkey-proofread'));
        return;
      }

      // 10. Alt + 2: Trigger Grammar DB "гб." (Пошук у граматычнай базе выдзеленага слова) for active/selected subtitle card
      if (e.altKey && (e.key === '2' || e.code === 'Digit2' || e.code === 'Numpad2')) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('subaka-hotkey-grammardb'));
        return;
      }

      // 11. Alt + 3: Toggle automatic spell check (Уключыць/выключыць аўтаматычную праверку правапісу)
      if (e.altKey && (e.key === '3' || e.code === 'Digit3' || e.code === 'Numpad3')) {
        e.preventDefault();
        e.stopPropagation();
        setAutoSpellCheck((prev) => {
          const next = !prev;
          if (!next) {
            setQuickFilter((curr) => (curr === 'errors' ? null : curr));
          }
          try {
            localStorage.setItem('subaka_auto_spell_check', String(next));
          } catch {
            // ignore
          }
          addToast(
            next
              ? 'Аўтаматычная праверка правапісу ўключана (Alt+3)'
              : 'Аўтаматычная праверка правапісу выключана (Alt+3)',
            next ? 'success' : 'info'
          );
          return next;
        });
        return;
      }

      // 12. Alt + 4: Trigger Verbum Dictionary "сл." (Пошук у слоўніках verbum.by выдзеленага слова) for active/selected subtitle card
      if (e.altKey && (e.key === '4' || e.code === 'Digit4' || e.code === 'Numpad4')) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('subaka-hotkey-verbum'));
        return;
      }

      // 13. Alt + 5: Open/toggle Glossary modal (Гласарый)
      if (e.altKey && (e.key === '5' || e.code === 'Digit5' || e.code === 'Numpad5')) {
        e.preventDefault();
        e.stopPropagation();
        setIsGlossaryModalOpen((prev) => !prev);
        return;
      }

      // 14. Alt + N: Create new subtitle card at current player time
      if (e.altKey && (e.code === 'KeyN' || e.key === 'n' || e.key === 'N' || e.key === 'т' || e.key === 'Т')) {
        e.preventDefault();
        e.stopPropagation();
        if (handleAddSubtitleRef.current) {
          handleAddSubtitleRef.current();
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [subtitles, canUndo, canRedo, handleUndo, handleRedo, triggerAutosave]);

  const handleSaveGeminiKey = useCallback((newKey: string) => {
    const trimmed = newKey.trim();
    setGeminiApiKey(trimmed);
    try {
      if (trimmed) {
        localStorage.setItem('subaka_gemini_api_key', trimmed);
        localStorage.setItem('gemini_api_key', trimmed);
      } else {
        localStorage.removeItem('subaka_gemini_api_key');
        localStorage.removeItem('gemini_api_key');
      }
    } catch {}
    if (trimmed) {
      addToast("Асабісты Gemini API Key захаваны і актываваны!", "success");
    } else {
      addToast("Асабісты Gemini API Key выдалены. Выкарыстоўваецца агульны доступ.", "info");
    }
  }, []);

  // Glossary (Спіс ігнараваных слоў) state & handlers
  const [isGlossaryModalOpen, setIsGlossaryModalOpen] = useState(false);

  const handleExportGlossary = useCallback((format: 'csv' | 'txt' = 'csv') => {
    const wordsArr = (Array.from(ignoredWords) as string[]).sort((a, b) => a.localeCompare(b, 'be'));
    if (wordsArr.length === 0) {
      addToast('Гласарый пусты, няма слоў для захавання', 'info');
      return;
    }
    const namePart = sanitizeProjectName(projectName || 'subaka');

    if (format === 'csv') {
      // CSV with UTF-8 BOM so Excel/LibreOffice displays Belarusian Cyrillic correctly
      const csvContent = '\uFEFF' + 'Слова\r\n' + wordsArr.map((w) => `"${w.replace(/"/g, '""')}"`).join('\r\n');
      saveFileUniversal(`glasary_${namePart}.csv`, csvContent, 'text/csv;charset=utf-8;').then((res) => {
        if (res) addToast(`Гласарый захаваны ў .csv (${wordsArr.length} слоў)`, 'success');
      });
    } else {
      // TXT with UTF-8 BOM (plain list, 1 word per line)
      const txtContent = '\uFEFF' + wordsArr.join('\r\n');
      saveFileUniversal(`glasary_${namePart}.txt`, txtContent, 'text/plain;charset=utf-8;').then((res) => {
        if (res) addToast(`Гласарый захаваны ў .txt (${wordsArr.length} слоў)`, 'success');
      });
    }
  }, [ignoredWords, projectName]);

  const handleImportGlossary = useCallback(async (input: React.ChangeEvent<HTMLInputElement> | File | FileList | File[]) => {
    let files: File[] = [];
    if (input && typeof input === 'object' && 'target' in input && input.target && 'files' in input.target) {
      files = Array.from(input.target.files || []);
      try {
        input.target.value = '';
      } catch {
        // ignore
      }
    } else if (input instanceof File) {
      files = [input];
    } else if (input instanceof FileList) {
      files = Array.from(input);
    } else if (Array.isArray(input)) {
      files = input;
    }

    if (files.length === 0) return;

    let totalAdded = 0;
    const current = getStoredIgnoredWords();
    const updated = new Set(current);

    for (const file of files) {
      try {
        const buffer = await file.arrayBuffer();
        if (!buffer || buffer.byteLength === 0) {
          continue;
        }

        // Smart text decoding: UTF-8 with BOM check and Windows-1251 fallback
        let text = '';
        const uint8 = new Uint8Array(buffer);
        if (uint8.length >= 3 && uint8[0] === 0xef && uint8[1] === 0xbb && uint8[2] === 0xbf) {
          text = new TextDecoder('utf-8').decode(uint8.subarray(3));
        } else {
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(uint8);
          } catch {
            try {
              text = new TextDecoder('windows-1251').decode(uint8);
            } catch {
              text = new TextDecoder('utf-8').decode(uint8);
            }
          }
        }

        text = text.replace(/^\uFEFF/, '').replace(/\uFEFF/g, '').trim();
        if (!text) continue;

        const newWords: string[] = [];

        // 1. JSON format detection
        if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
          try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (typeof item === 'string') {
                  const clean = stripAccents(item).toLowerCase().trim();
                  if (clean) newWords.push(clean);
                }
              }
            } else if (parsed && typeof parsed === 'object') {
              const list = Array.isArray(parsed.words)
                ? parsed.words
                : Array.isArray(parsed.glossary)
                ? parsed.glossary
                : Array.isArray(parsed.terms)
                ? parsed.terms
                : Object.keys(parsed);
              for (const item of list) {
                if (typeof item === 'string') {
                  const clean = stripAccents(item).toLowerCase().trim();
                  if (clean) newWords.push(clean);
                }
              }
            }
          } catch {
            // Fall back to line parser
          }
        }

        // 2. Delimited, Hunspell DIC or plain text parser
        if (newWords.length === 0) {
          const lines = text.split(/[\r\n]+/);
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            // Hunspell .dic file line 1 is the word count (pure number)
            if (i === 0 && /^\d+$/.test(line) && lines.length > 1) {
              continue;
            }

            // Skip common column headers
            const cleanHeader = line.replace(/["';,]/g, '').trim().toLowerCase();
            if (['слова', 'словы', 'word', 'words', 'term', 'terms', 'glossary', 'гласарый', 'беларуская', 'пераклад'].includes(cleanHeader)) {
              continue;
            }

            // Split line by comma, semicolon, tab or pipe
            const tokens = line.split(/[,;\t|]/);
            for (const rawToken of tokens) {
              // Strip Hunspell flags like "слова/PO" -> "слова"
              const withoutFlags = rawToken.split('/')[0];
              // Strip list bullet numbers "1. ", "- ", "* "
              const withoutBullets = withoutFlags.replace(/^[\d\s.\-*•–—#>()\[\]]+/, '');
              // Clean token
              const cleanToken = stripAccents(withoutBullets.replace(/^["'\s«»“”(){}\[\]]+|["'\s«»“”(){}\[\]]+$/g, '')).toLowerCase().trim();
              
              if (cleanToken && cleanToken.length > 0 && !/^\d+$/.test(cleanToken)) {
                const subWords = cleanToken.split(/\s+/);
                for (const sw of subWords) {
                  const cleanSw = stripAccents(sw.replace(/^[^a-zа-яёіў0-9]+|[^a-zа-яёіў0-9]+$/gi, '')).toLowerCase().trim();
                  if (cleanSw && cleanSw.length > 0 && !/^\d+$/.test(cleanSw)) {
                    newWords.push(cleanSw);
                  }
                }
              }
            }
          }
        }

        for (const w of newWords) {
          if (!updated.has(w)) {
            updated.add(w);
            totalAdded++;
          }
        }
      } catch (err) {
        console.error('Error importing glossary file:', err);
      }
    }

    if (totalAdded > 0) {
      localStorage.setItem('subaka_ignored_words', JSON.stringify(Array.from(updated)));
      setIgnoredWords(updated);
      window.dispatchEvent(new CustomEvent('subaka-ignored-words-updated', { detail: {} }));
      addToast(`Загружана ${totalAdded} новых слоў (усяго ў гласарыі: ${updated.size})`, 'success');
    } else {
      if (updated.size > 0 && current.size === updated.size) {
        addToast(`Усе словы з файла ўжо ёсць у гласарыі (усяго: ${updated.size})`, 'info');
      } else {
        addToast('У файле не знойдзена прыдатных слоў для дадання', 'warning');
      }
    }
  }, [addToast]);

  const handleRemoveIgnoredWord = useCallback((wordToRemove: string) => {
    const lower = stripAccents(wordToRemove).toLowerCase().trim();
    if (!lower) return;
    const current = getStoredIgnoredWords();
    const updated = new Set(current);
    updated.delete(lower);
    localStorage.setItem('subaka_ignored_words', JSON.stringify(Array.from(updated)));
    setIgnoredWords(updated);
    window.dispatchEvent(new CustomEvent('subaka-ignored-words-updated', { detail: { word: lower } }));
    addToast(`Слова «${wordToRemove}» выдалена з гласарыя`, 'info');
  }, []);

  const handleClearGlossary = useCallback(() => {
    if (ignoredWords.size === 0) return;
    localStorage.setItem('subaka_ignored_words', JSON.stringify([]));
    setIgnoredWords(new Set());
    window.dispatchEvent(new CustomEvent('subaka-ignored-words-updated', { detail: {} }));
    addToast('Гласарый поўнасцю ачышчаны', 'info');
  }, [ignoredWords, addToast]);

  const handleAddGlossaryWord = useCallback((wordToAdd: string) => {
    const lower = stripAccents(wordToAdd).toLowerCase().trim();
    if (!lower) return;
    const current = getStoredIgnoredWords();
    const updated = new Set(current);
    if (updated.has(lower)) {
      addToast(`Слова «${lower}» ужо ёсць у гласарыі`, 'info');
      return;
    }
    updated.add(lower);
    localStorage.setItem('subaka_ignored_words', JSON.stringify(Array.from(updated)));
    setIgnoredWords(updated);
    window.dispatchEvent(new CustomEvent('subaka-ignored-words-updated', { detail: { word: lower } }));
    addToast(`Слова «${lower}» дададзена ў гласарый`, 'success');
  }, []);

  // Monitor and log GrammarDB deployment progress to "Статус і гісторыя"
  useEffect(() => {
    // 1. Initial status logging upon app load
    if (prevGrammarReadyRef.current === undefined) {
      prevGrammarReadyRef.current = grammarDbStatus.ready;
      prevGrammarBuildingRef.current = grammarDbStatus.building;
      if (grammarDbStatus.ready) {
        const sizeStr = grammarDbStatus.sizeMb ? `${grammarDbStatus.sizeMb} МБ, ` : '';
        const msg = `Граматычная база гатовая да працы (${sizeStr}3.98M словаформаў, SQLite)`;
        setLatestMessage({ message: msg, type: 'success' });
        const timestamp = new Date().toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setMessagesHistory((prev) => [{ id: Math.random().toString(36).substring(4), timestamp, message: msg, type: 'success' }, ...prev]);
      } else if (grammarDbStatus.building) {
        const msg = `Разгортванне Граматычнай базы: ${grammarDbStatus.lastLog || 'ініцыялізацыя...'}`;
        setLatestMessage({ message: msg, type: 'info' });
        const timestamp = new Date().toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setMessagesHistory((prev) => [{ id: Math.random().toString(36).substring(4), timestamp, message: msg, type: 'info' }, ...prev]);
        lastLoggedGrammarMsgRef.current = grammarDbStatus.lastLog || '';
      }
      return;
    }

    // 2. Deployment was initiated
    if (grammarDbStatus.building && !prevGrammarBuildingRef.current) {
      const msg = `Разгортванне Граматычнай базы...`;
      addToast(msg, 'info');
      lastLoggedGrammarMsgRef.current = grammarDbStatus.lastLog || '';
    }

    // 3. Deployment progress updates (new step or words processed)
    if (grammarDbStatus.building && grammarDbStatus.lastLog && grammarDbStatus.lastLog !== lastLoggedGrammarMsgRef.current) {
      lastLoggedGrammarMsgRef.current = grammarDbStatus.lastLog;
      const msg = `Граматычная база: ${grammarDbStatus.lastLog}`;
      setLatestMessage({ message: msg, type: 'info' });
      const timestamp = new Date().toLocaleTimeString('be-BY', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setMessagesHistory((prev) => [{ id: Math.random().toString(36).substring(4), timestamp, message: msg, type: 'info' }, ...prev]);
    }

    // 4. Deployment completed successfully
    if (grammarDbStatus.ready && !prevGrammarReadyRef.current) {
      const sizeStr = grammarDbStatus.sizeMb ? `${grammarDbStatus.sizeMb} МБ, ` : '';
      const msg = `Граматычная база паспяхова разгорнутая і падключаная (${sizeStr}3.98M словаформаў, SQLite)`;
      addToast(msg, 'success');
    }

    // 5. Deployment stopped or failed
    if (!grammarDbStatus.building && prevGrammarBuildingRef.current && !grammarDbStatus.ready) {
      addToast('Разгортванне Граматычнай базы спынена або адбылася памылка.', 'error');
    }

    prevGrammarBuildingRef.current = grammarDbStatus.building;
    prevGrammarReadyRef.current = grammarDbStatus.ready;
  }, [grammarDbStatus]);

  const [isMergingFull, setIsMergingFull] = useState(false);

  // Helper to obtain sanitized project name for file exports
  const getEffectiveProjectName = useCallback(() => {
    if (projectName && projectName.trim()) {
      return sanitizeProjectName(projectName);
    }
    if (mediaFileName && mediaFileName.trim()) {
      const baseName = mediaFileName.replace(/\.[^/.]+$/, '');
      return sanitizeProjectName(baseName);
    }
    return 'subaka';
  }, [projectName, mediaFileName]);

  const downloadFile = async (content: string | Blob, fileName: string, mimeType: string = 'text/plain;charset=utf-8;') => {
    return await saveFileUniversal(fileName, content, mimeType);
  };

  const handleDownloadOriginalSrt = async () => {
    if (subtitles.length === 0) return;
    const pName = getEffectiveProjectName();
    const fileName = `${pName}_orig.srt`;
    const srtContent = stringifySrt(subtitles, false);
    const res = await downloadFile(srtContent, fileName, "text/srt;charset=utf-8;");
    if (res) addToast("Зыходныя субцітры (.srt) захаваныя", "success");
  };

  const handleDownloadOriginalAss = async () => {
    if (subtitles.length === 0) return;
    const pName = getEffectiveProjectName();
    const fileName = `${pName}_orig.ass`;
    const assContent = stringifyAss(subtitles, false, originalAssHeader);
    const res = await downloadFile(assContent, fileName, "text/x-ssa;charset=utf-8;");
    if (res) addToast("Зыходныя субцітры (.ass) захаваныя", "success");
  };

  const handleDownloadTranslatedSrt = async () => {
    if (subtitles.length === 0) return;
    const pName = getEffectiveProjectName();
    const fileName = `${pName}_bel.srt`;
    const srtContent = stringifySrt(subtitles, true);
    const res = await downloadFile(srtContent, fileName, "text/srt;charset=utf-8;");
    if (res) addToast("Перакладзеныя субцітры (.srt) захаваныя", "success");
  };

  const handleDownloadTranslatedAss = async () => {
    if (subtitles.length === 0) return;
    const pName = getEffectiveProjectName();
    const fileName = `${pName}_bel.ass`;
    const assContent = stringifyAss(subtitles, true, originalAssHeader);
    const res = await downloadFile(assContent, fileName, "text/x-ssa;charset=utf-8;");
    if (res) addToast("Перакладзеныя субцітры (.ass) захаваныя", "success");
  };

  const handleDownloadTranslatedByActorSrt = async () => {
    if (subtitles.length === 0) return;
    const pName = getEffectiveProjectName();

    // Group subtitles by actor (splitting comma-separated actors so the line appears in each actor's file)
    const groups = new Map<string, SubtitleEntry[]>();
    subtitles.forEach((sub) => {
      const rawActor = (sub.actor || '').trim();
      if (!rawActor) {
        const actorKey = 'без_ролі';
        if (!groups.has(actorKey)) {
          groups.set(actorKey, []);
        }
        groups.get(actorKey)!.push(sub);
      } else {
        // Parse multiple actors separated by comma or semicolon
        const actorList = rawActor
          .split(/[,;]+/)
          .map((a) => a.trim())
          .filter(Boolean);

        if (actorList.length === 0) {
          const actorKey = 'без_ролі';
          if (!groups.has(actorKey)) {
            groups.set(actorKey, []);
          }
          groups.get(actorKey)!.push(sub);
        } else {
          actorList.forEach((actorName) => {
            if (!groups.has(actorName)) {
              groups.set(actorName, []);
            }
            groups.get(actorName)!.push(sub);
          });
        }
      }
    });

    const sanitizeActorFilename = (name: string) => {
      return sanitizeProjectName(name, 'роля');
    };

    const groupKeys = Array.from(groups.keys());
    if (groupKeys.length === 0) {
      addToast("Няма субцітраў для экспарту", "warning");
      return;
    }

    // Package into .zip archive: [назва_праекта]_bel_by_actor.zip
    try {
      addToast("Пакаванне субцітраў па ролях у ZIP-архіў...", "info");
      const zip = new JSZip();
      for (const [actor, items] of groups.entries()) {
        const content = stringifySrt(items, true);
        const safeName = sanitizeActorFilename(actor);
        zip.file(`${pName}_bel_${safeName}.srt`, content);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const fileName = `${pName}_bel_by_actor.zip`;

      const res = await downloadFile(zipBlob, fileName, "application/zip");
      if (res) addToast(`ZIP-архіў "${fileName}" паспяхова захаваны!`, "success");
    } catch (err: any) {
      console.error("ZIP creation error:", err);
      addToast("Памылка пры стварэнні ZIP-архіва", "error");
    }
  };

  const handleDownloadOriginal = handleDownloadOriginalSrt;
  const handleDownloadTranslated = handleDownloadTranslatedSrt;

  const handleDownloadFullVoiceover = async () => {
    const hasAudio = subtitles.some(sub => sub.audioUrl);
    if (!hasAudio) {
      addToast("Калі ласка, спачатку агучце хоць адзін радок субцітраў.", "warning");
      return;
    }
    const pName = getEffectiveProjectName();
    const fileName = `${pName}_bel_voiceover.wav`;
    setIsMergingFull(true);
    addToast("Падрыхтоўка і звядзенне агучкі...", "info");
    try {
      const mergedBlob = await mergeSubtitleAudio(subtitles);
      if (mergedBlob) {
        const res = await downloadFile(mergedBlob, fileName, "audio/wav");
        if (res) addToast("Поўная агучка паспяхова захаваная.", "success");
      } else {
        addToast("Не ўдалося аб'яднаць файлы агучкі.", "error");
      }
    } catch (err) {
      console.error(err);
      addToast("Адбылася памылка пры стварэнні агульнай агучкі.", "error");
    } finally {
      setIsMergingFull(false);
    }
  };

  const [, setServiceStatus] = useState<{ online: boolean; checked: boolean }>({
    online: false,
    checked: false,
  });

  const checkServiceHealth = async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      if (data.status === "ok") {
        setServiceStatus({ online: true, checked: true });
      }
    } catch {
      setServiceStatus({ online: false, checked: true });
    }
  };

  // State Updates from timeline player
  const lastSavedPlaybackTimeRef = useRef<number>(0);
  const handlePlaybackStateChange = (updated: Partial<PlaybackState>) => {
    setPlaybackState((prev) => ({ ...prev, ...updated }));
    if (updated.currentTime !== undefined && Number.isFinite(updated.currentTime) && updated.currentTime >= 0) {
      const now = Date.now();
      if (now - lastSavedPlaybackTimeRef.current > 1500 || updated.isPlaying === false) {
        lastSavedPlaybackTimeRef.current = now;
        try {
          localStorage.setItem('subaka_playback_current_time', String(updated.currentTime));
        } catch {}
      }
    }
  };

  // Helper to sort subtitles chronologically by startTime without shifting timestamps
  const sortSubtitlesByTime = (list: SubtitleEntry[]): SubtitleEntry[] => {
    return [...list].sort((a, b) => {
      const startA = srtTimeToSeconds(a.startTime);
      const startB = srtTimeToSeconds(b.startTime);
      return startA - startB;
    });
  };

  // Set of IDs of subtitles that overlap in time (memoized against subtitle list changes to avoid CPU load during playback)
  const overlappingSubtitleIds = React.useMemo(() => {
    return getOverlappingSubtitleIds(subtitles);
  }, [subtitles]);

  // Stable zero-cost accessor for actor names across subtitles (prevents re-rendering 1000s of cards)
  const getAllActors = React.useCallback((): string[] => {
    const set = new Set<string>();
    const currentSubs = subtitlesRef.current;
    for (let i = 0; i < currentSubs.length; i++) {
      const a = currentSubs[i].actor;
      if (a && a.trim()) {
        const parts = a.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
        parts.forEach((part) => set.add(part));
      }
      const oa = currentSubs[i].originalActor;
      if (oa && oa.trim()) {
        const parts = oa.split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
        parts.forEach((part) => set.add(part));
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'be'));
  }, []);

  // Subtitle card value updates without shifting other cards (memoized to keep references stable)
  const handleUpdateSubtitle = React.useCallback((id: string, updated: Partial<SubtitleEntry>) => {
    setSubtitles((prev) => {
      const subIndex = prev.findIndex((s) => s.id === id);
      if (subIndex === -1) return prev;

      const sub = prev[subIndex];
      
      const normalizeTimeStr = (str: string): string | null => {
        const flexRegex = /^\d{2}:\d{2}:\d{2}(?:[,.]\d+)?$/;
        if (!flexRegex.test(str)) return null;
        const secs = srtTimeToSeconds(str);
        if (isNaN(secs) || secs < 0) return null;
        return secondsToSrtTime(secs);
      };

      let updatedStartTime = sub.startTime;
      let updatedEndTime = sub.endTime;

      const normalizedStart = updated.startTime !== undefined ? normalizeTimeStr(updated.startTime) : null;
      const normalizedEnd = updated.endTime !== undefined ? normalizeTimeStr(updated.endTime) : null;

      if (updated.startTime !== undefined && updated.endTime !== undefined) {
        if (normalizedStart !== null && normalizedEnd !== null) {
          updatedStartTime = normalizedStart;
          updatedEndTime = normalizedEnd;
        }
      } else if (updated.startTime !== undefined && updated.startTime !== sub.startTime) {
        if (normalizedStart !== null) {
          const oldStartSec = srtTimeToSeconds(sub.startTime);
          const newStartSec = srtTimeToSeconds(normalizedStart);
          if (!isNaN(newStartSec) && newStartSec >= 0) {
            const delta = newStartSec - oldStartSec;
            updatedStartTime = normalizedStart;
            const oldEndSec = srtTimeToSeconds(sub.endTime);
            updatedEndTime = secondsToSrtTime(Math.max(newStartSec, oldEndSec + delta));
          }
        }
      } else if (updated.endTime !== undefined && updated.endTime !== sub.endTime) {
        if (normalizedEnd !== null) {
          const newEndSec = srtTimeToSeconds(normalizedEnd);
          const startSec = srtTimeToSeconds(sub.startTime);
          if (!isNaN(newEndSec) && newEndSec >= startSec) {
            updatedEndTime = normalizedEnd;
          }
        }
      }

      const updatedObj = { ...sub, ...updated };
      if (updated.startTime !== undefined) updatedObj.startTime = updatedStartTime;
      if (updated.endTime !== undefined) updatedObj.endTime = updatedEndTime;

      const textChanged = updated.text !== undefined && updated.text !== sub.text;
      const transChanged = updated.translatedText !== undefined && updated.translatedText !== sub.translatedText;
      if (textChanged || transChanged) {
        if (sub.audioUrl) {
          try {
            URL.revokeObjectURL(sub.audioUrl);
          } catch (_) {}
          updatedObj.audioUrl = undefined;
        }
      }

      if (updated.translatedText !== undefined && updated.translatedText !== sub.translatedText) {
        if (updated.proofreadIssues === undefined) {
          updatedObj.proofreadIssues = undefined;
        }
      }

      const copy = prev.map((item, idx) => (idx === subIndex ? updatedObj : item));
      // Only sort chronologically if startTime actually changed
      if (updated.startTime !== undefined && updatedStartTime !== sub.startTime) {
        return sortSubtitlesByTime(copy);
      }
      return copy;
    });
  }, []);

  // Subtitle insertion: start time = current video cursor position (playbackState.currentTime), duration = 2 seconds default.
  // Other cards' timings do NOT move!
  const handleAddSubtitle = useCallback((customTime?: number) => {
    const validCustomTime = typeof customTime === 'number' && Number.isFinite(customTime) ? customTime : undefined;
    const curTimeSec = Math.max(0, validCustomTime !== undefined ? validCustomTime : (Number(playbackState.currentTime) || 0));
    const startSec = Number.isFinite(curTimeSec) ? curTimeSec : 0;
    const endSec = startSec + 2.0;

    const newSub: SubtitleEntry = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      startTime: secondsToSrtTime(startSec),
      endTime: secondsToSrtTime(endSec),
      text: '',
      translatedText: '',
    };

    setSubtitles((prev) => {
      const updated = sortSubtitlesByTime([...prev, newSub]);
      const newIdx = updated.findIndex((s) => s.id === newSub.id);
      setActiveSubtitleIndex(newIdx !== -1 ? newIdx : updated.length - 1);
      return updated;
    });

    handlePlaybackStateChange({ currentTime: startSec });
    addToast(`Новая картка створана з часу плэера (${secondsToSrtTime(startSec).slice(3, 8)})`, "success");
  }, [playbackState.currentTime, addToast]);

  handleAddSubtitleRef.current = handleAddSubtitle;

  const handleAddSubtitleBefore = (index: number) => {
    if (index < 0 || index >= subtitles.length) {
      handleAddSubtitle();
      return;
    }

    const currentSub = subtitles[index];
    const curStart = srtTimeToSeconds(currentSub.startTime);
    const prevSub = index > 0 ? subtitles[index - 1] : null;
    const prevEnd = prevSub ? srtTimeToSeconds(prevSub.endTime) : null;
    const playerTime = Math.max(0, playbackState.currentTime || 0);

    let newStart: number;
    let newEnd: number;
    let usedPlayerTime = false;

    // Калі час плэера актыўны і знаходзіцца перад пачаткам бягучай карткі:
    if (playerTime > 0 && playerTime < curStart) {
      usedPlayerTime = true;
      newStart = playerTime;
      newEnd = Math.min(newStart + 2.0, curStart);
      if (newEnd - newStart < 0.5) {
        newEnd = curStart;
      }
      if (newEnd <= newStart) {
        newEnd = newStart + 1.0;
      }
    } else {
      // Аўтаматычная ўстаўка перад карткай
      newEnd = curStart;
      newStart = prevEnd !== null ? Math.max(prevEnd, curStart - 2.0) : Math.max(0, curStart - 2.0);
      if (newEnd - newStart < 0.5) {
        newStart = Math.max(0, curStart - 1.0);
      }
      if (newEnd <= newStart) {
        newEnd = newStart + 1.0;
      }
    }

    const newSub: SubtitleEntry = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      startTime: secondsToSrtTime(newStart),
      endTime: secondsToSrtTime(newEnd),
      text: '',
      translatedText: '',
    };

    setSubtitles((prev) => {
      const copy = [...prev];
      copy.splice(index, 0, newSub);
      const updated = sortSubtitlesByTime(copy);
      const newIdx = updated.findIndex((s) => s.id === newSub.id);
      setActiveSubtitleIndex(newIdx !== -1 ? newIdx : index);
      return updated;
    });

    handlePlaybackStateChange({ currentTime: newStart });
    addToast(
      usedPlayerTime
        ? `Картка дададзена з часу плэера (${secondsToSrtTime(newStart).slice(3, 8)})`
        : `Картка дададзена перад (${secondsToSrtTime(newStart).slice(3, 8)})`,
      "success"
    );
  };

  const handleAddSubtitleAfter = (index: number) => {
    if (index < 0 || index >= subtitles.length) {
      handleAddSubtitle();
      return;
    }

    const currentSub = subtitles[index];
    const curStart = srtTimeToSeconds(currentSub.startTime);
    const curEnd = srtTimeToSeconds(currentSub.endTime);
    const nextSub = index < subtitles.length - 1 ? subtitles[index + 1] : null;
    const nextStart = nextSub ? srtTimeToSeconds(nextSub.startTime) : null;
    const playerTime = Math.max(0, playbackState.currentTime || 0);

    let newStart: number;
    let newEnd: number;
    let usedPlayerTime = false;

    // Калі час плэера актыўны і знаходзіцца пасля пачатку/канца бягучай карткі:
    if (playerTime > 0 && (playerTime >= curEnd || playerTime > curStart + 0.1)) {
      usedPlayerTime = true;
      newStart = playerTime;
      if (nextStart !== null && nextStart > newStart) {
        newEnd = Math.min(newStart + 2.0, nextStart);
      } else {
        newEnd = newStart + 2.0;
      }
    } else {
      // Аўтаматычная ўстаўка пасля канца бягучай карткі
      newStart = curEnd;
      if (nextStart !== null && nextStart > newStart) {
        newEnd = Math.min(newStart + 2.0, nextStart);
      } else {
        newEnd = newStart + 2.0;
      }
    }

    // Забеспячэнне мінімальнай працягласці
    if (newEnd - newStart < 0.5) {
      newEnd = newStart + 1.0;
    }

    const newSub: SubtitleEntry = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      startTime: secondsToSrtTime(newStart),
      endTime: secondsToSrtTime(newEnd),
      text: '',
      translatedText: '',
    };

    setSubtitles((prev) => {
      const copy = [...prev];
      copy.splice(index + 1, 0, newSub);
      const updated = sortSubtitlesByTime(copy);
      const newIdx = updated.findIndex((s) => s.id === newSub.id);
      setActiveSubtitleIndex(newIdx !== -1 ? newIdx : index + 1);
      return updated;
    });

    handlePlaybackStateChange({ currentTime: newStart });
    addToast(
      usedPlayerTime
        ? `Картка дададзена з часу плэера (${secondsToSrtTime(newStart).slice(3, 8)})`
        : `Картка дададзена пасля (${secondsToSrtTime(newStart).slice(3, 8)})`,
      "success"
    );
  };

  // Deletion logic: remaining cards' timestamps do NOT change, renumbering is automatic
  const handleDeleteSubtitle = (id: string) => {
    const target = subtitles.find((sub) => sub.id === id);
    if (target?.audioUrl) {
      URL.revokeObjectURL(target.audioUrl);
    }

    setSubtitles((prev) => {
      const filtered = prev.filter((sub) => sub.id !== id);
      return sortSubtitlesByTime(filtered);
    });

    setActiveSubtitleIndex((prevIdx) => Math.max(-1, prevIdx - 1));
    addToast("Картка выдалена", "info");
  };

  // Shifting all timestamps synchronously
  const handleShiftAll = (seconds: number) => {
    if (seconds === 0) return;
    setSubtitles((prev) =>
      prev.map((sub) => {
        const origStart = sub.originalStartTime || sub.startTime;
        const origEnd = sub.originalEndTime || sub.endTime;
        const newStart = Math.max(0, srtTimeToSeconds(sub.startTime) + seconds);
        const newEnd = Math.max(0.1, srtTimeToSeconds(sub.endTime) + seconds);
        return {
          ...sub,
          originalStartTime: origStart,
          originalEndTime: origEnd,
          startTime: secondsToSrtTime(newStart),
          endTime: secondsToSrtTime(newEnd),
        };
      })
    );
    const ms = Math.round(seconds * 1000);
    const sign = ms > 0 ? '+' : '';
    addToast(`Зрух часу на [ ${sign}${ms} мс ] паспяховы`, "info");
  };

  // Revert all subtitles back to their original unshifted timestamps
  const handleResetOriginalTime = () => {
    setSubtitles((prev) => {
      let changed = false;
      const updated = prev.map((sub) => {
        if (sub.originalStartTime && sub.originalEndTime) {
          if (sub.startTime !== sub.originalStartTime || sub.endTime !== sub.originalEndTime) {
            changed = true;
          }
          return {
            ...sub,
            startTime: sub.originalStartTime,
            endTime: sub.originalEndTime,
          };
        }
        return sub;
      });

      if (changed) {
        addToast("Арыгінальны час субцітраў адноўлены", "info");
        return sortSubtitlesByTime(updated);
      } else {
        addToast("Субцітры ўжо маюць арыгінальны час", "info");
        return prev;
      }
    });
  };

  // INLINE TRADUCTION INDIVIDUAL
  const handleTranslateSingle = async (id: string) => {
    const target = subtitles.find((sub) => sub.id === id);
    if (!target || !target.text.trim()) return;

    if (isTauriDesktop()) {
      const apiKey = geminiApiKey || getDesktopGeminiApiKey();
      if (!apiKey) {
        setIsGeminiKeyModalOpen(true);
        addToast("Для працы перакладу праз AI ў дэсктопнай версіі неабходна ўвесці Gemini API ключ", "warning");
        return;
      }
      try {
        const translations = await desktopTranslateBatch([{ id: target.id, text: target.text }], 'Belarusian', apiKey);
        if (translations && translations.length > 0) {
          handleUpdateSubtitle(id, {
            translatedText: translations[0].translatedText,
          });
          addToast("Частковы пераклад паспяховы", "success");
        }
      } catch (err: any) {
        addToast(err.message || "Памылка перакладу", "error");
        throw err;
      }
      return;
    }

    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: getApiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          entries: [{ id: target.id, text: target.text }],
          autoSpellCheck,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Тэхнічная памылка сервера пры перакладзе");
      }
      const data = await response.json();

      if (data.translations && data.translations.length > 0) {
        handleUpdateSubtitle(id, {
          translatedText: data.translations[0].translatedText,
        });
        addToast("Частковы пераклад паспяховы", "success");
      }
    } catch (err: any) {
      addToast(err.message || "Памылка перакладу", "error");
      throw err;
    }
  };

  // INLINE TTS INDIVIDUAL
  const handleSynthesizeSingle = async (id: string, voiceName: string) => {
    const targetIndex = subtitles.findIndex((sub) => sub.id === id);
    if (targetIndex !== -1) {
      setActiveSubtitleIndex(targetIndex);
      try {
        localStorage.setItem('subaka_active_subtitle_index', targetIndex.toString());
        localStorage.setItem('subaka_active_subtitle_id', id);
      } catch {}
    }

    const target = subtitles.find((sub) => sub.id === id);
    if (!target) return;

    const synthText = (target.translatedText || "").trim();
    if (!synthText) {
      addToast("Для агучвання неабходны тэкст перакладу.", "warning");
      return;
    }

    const safeVoice = isSupportedVoice(voiceName) 
      ? voiceName 
      : (isSupportedVoice(selectedVoice) ? selectedVoice : 'Ales');

    try {
      const blob = await synthesizeSubtitleAudioUniversal(synthText, safeVoice, {
        headers: getApiHeaders({ "Content-Type": "application/json" }),
      });
      cacheAudioBlob(id, blob);
      
      const newUrl = URL.createObjectURL(blob);
      handleUpdateSubtitle(id, {
        audioUrl: newUrl,
        audioError: undefined,
      });
      const voiceLabel = safeVoice === 'Ales' ? 'TTS Алесь' : safeVoice === 'BelG2P' ? 'TTS Маруся' : `AI ${safeVoice}`;
      addToast(`Голас (${voiceLabel}) паспяхова згенераваны і падключаны`, "success");
    } catch (err: any) {
      const errMsg = err.message || "Не ўдалося сінтэзаваць голас";
      const isQuota = errMsg.includes("Quota") || errMsg.includes("ліміт") || errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED");
      
      handleUpdateSubtitle(id, { 
        audioError: isQuota ? "Ліміт API" : (err.message || "Памылка сінтэзу") 
      });

      if (isQuota) {
        addToast("Дасягнуты ліміт квоты Gemini. Пераключыцеся на 'TTS Алесь' або 'TTS Маруся' у хэдары для агучвання без абмежаванняў.", "warning");
      } else {
        addToast(err.message || "Не ўдалося сінтэзаваць голас для карткі", "error");
      }
      throw err;
    }
  };

  // BATCH TRANSLATE ALL
  const handleTranslateAll = async (targetSubtitles?: SubtitleEntry[]) => {
    const isArray = targetSubtitles && Array.isArray(targetSubtitles);
    const listToTranslate = isArray ? [...targetSubtitles] : [...subtitles];
    if (listToTranslate.length === 0) return;

    if (isTauriDesktop()) {
      const apiKey = geminiApiKey || getDesktopGeminiApiKey();
      if (!apiKey) {
        setIsGeminiKeyModalOpen(true);
        addToast("Для працы перакладу праз AI ў дэсктопнай версіі неабходна ўвесці Gemini API ключ", "warning");
        return;
      }

      const controller = new AbortController();
      translateAbortControllerRef.current = controller;

      setIsTranslatingAll(true);
      cancelTranslatingRef.current = false;
      addToast("Запуск пакетнага перакладу субцітраў праз Gemini AI...", "info");

      try {
        const chunkSize = 25;
        const chunks: SubtitleEntry[][] = [];
        for (let i = 0; i < listToTranslate.length; i += chunkSize) {
          chunks.push(listToTranslate.slice(i, i + chunkSize));
        }

        for (let c = 0; c < chunks.length; c++) {
          if (cancelTranslatingRef.current || controller.signal.aborted) break;
          const chunk = chunks[c];
          if (chunks.length > 1) {
            addToast(`Пераклад фрагмента ${c + 1} з ${chunks.length}...`, "info");
          }
          const packets = chunk.map((sub) => ({ id: sub.id, text: sub.text }));
          let translations: any = null;
          let chunkAttempts = 2;
          while (chunkAttempts > 0) {
            if (cancelTranslatingRef.current || controller.signal.aborted) break;
            try {
              translations = await desktopTranslateBatch(
                packets,
                'Belarusian',
                apiKey,
                undefined,
                { signal: controller.signal, cancelRef: cancelTranslatingRef }
              );
              break;
            } catch (chunkErr: any) {
              if (chunkErr?.name === 'AbortError' || cancelTranslatingRef.current || controller.signal.aborted) {
                break;
              }
              const errMsg = chunkErr?.message || '';
              if ((errMsg.includes('429') || errMsg.includes('квот') || errMsg.includes('503')) && chunkAttempts > 1) {
                addToast("Пераключэнне мадэлі Gemini... Чакаем 2 сек.", "info");
                await new Promise((r) => setTimeout(r, 2000));
                chunkAttempts--;
                continue;
              }
              throw chunkErr;
            }
          }

          if (cancelTranslatingRef.current || controller.signal.aborted) break;

          if (translations && translations.length > 0) {
            setSubtitles((prev) => {
              const baseList = isArray ? listToTranslate : prev;
              const updatedList = baseList.map((sub) => {
                const match = translations.find((t: any) => String(t.id) === String(sub.id));
                if (match) return { ...sub, translatedText: match.translatedText };
                return sub;
              });
              return updatedList;
            });
          }

          if (c < chunks.length - 1 && !cancelTranslatingRef.current && !controller.signal.aborted) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

        if (cancelTranslatingRef.current || controller.signal.aborted) {
          addToast("Пакетны пераклад быў прыпынены карыстальнікам.", "info");
        } else {
          addToast("Усе субцітры перакладзены на беларускую мову!", "success");
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || cancelTranslatingRef.current || controller.signal.aborted) {
          addToast("Пакетны пераклад быў прыпынены карыстальнікам.", "info");
        } else {
          addToast(err.message || "Пакетны пераклад не атрымаўся", "error");
        }
      } finally {
        setIsTranslatingAll(false);
        if (translateAbortControllerRef.current === controller) {
          translateAbortControllerRef.current = null;
        }
      }
      return;
    }

    setIsTranslatingAll(true);
    cancelTranslatingRef.current = false;

    const controller = new AbortController();
    translateAbortControllerRef.current = controller;

    addToast("Запуск пакетнага перакладу субцітраў...", "info");

    try {
      const chunkSize = 35;
      const chunks: SubtitleEntry[][] = [];
      for (let i = 0; i < listToTranslate.length; i += chunkSize) {
        chunks.push(listToTranslate.slice(i, i + chunkSize));
      }

      for (let c = 0; c < chunks.length; c++) {
        if (cancelTranslatingRef.current) {
          break;
        }

        const chunk = chunks[c];
        if (chunks.length > 1) {
          addToast(`Пераклад фрагмента ${c + 1} з ${chunks.length}...`, "info");
        }
        const packets = chunk.map((sub) => ({ id: sub.id, text: sub.text }));
        
        const response = await fetch("/api/translate", {
          method: "POST",
          headers: getApiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ entries: packets, autoSpellCheck }),
          signal: controller.signal
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Не ўдалося завяршыць пакетны пераклад");
        }
        const data = await response.json();

        if (data.translations) {
          setSubtitles((prev) => {
            const baseList = isArray ? listToTranslate : prev;
            const updatedList = baseList.map((sub) => {
              const match = data.translations.find((t: any) => t.id === sub.id);
              if (match) {
                return { ...sub, translatedText: match.translatedText };
              }
              const prevSub = prev.find(p => p.id === sub.id);
              if (prevSub && prevSub.translatedText !== sub.translatedText) {
                return { ...sub, translatedText: prevSub.translatedText };
              }
              return sub;
            });

            updatedList.forEach(item => {
              const idx = listToTranslate.findIndex(l => l.id === item.id);
              if (idx !== -1) {
                listToTranslate[idx] = item;
              }
            });

            return updatedList;
          });
        }
      }

      if (cancelTranslatingRef.current) {
        addToast("Пакетны пераклад быў прыпынены карыстальнікам.", "info");
      } else {
        addToast("Усе субцітры перакладзены на беларускую мову!", "success");
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        addToast("Пераклад субцітраў прыпынены карыстальнікам.", "info");
      } else {
        addToast(err.message || "Пакетны пераклад не атрымаўся", "error");
      }
    } finally {
      setIsTranslatingAll(false);
      if (translateAbortControllerRef.current === controller) {
        translateAbortControllerRef.current = null;
      }
    }
  };

  const handleCancelTranslate = () => {
    cancelTranslatingRef.current = true;
    if (translateAbortControllerRef.current) {
      translateAbortControllerRef.current.abort();
    }
  };

  // TRANSCRIBE MEDIA FILE
  const handleTranscribe = async (
    engineChoice: string = 'gemini',
    _modelChoice: string = 'gemini',
    targetTrackNum?: number,
    isExternalTrack?: boolean,
    customAudioFile?: File
  ) => {
    if (isTauriDesktop()) {
      const apiKey = geminiApiKey || getDesktopGeminiApiKey();
      if (!apiKey) {
        setIsGeminiKeyModalOpen(true);
        addToast("Для працы генерацыі субцітраў праз AI ў дэсктопнай версіі неабходна ўвесці Gemini API ключ", "warning");
        return;
      }
    }

    let targetFile: File | Blob | null = customAudioFile || null;
    const currentTrackNum = targetTrackNum || activeTrackNumber || 1;

    // Determine the source file to transcribe
    if (customAudioFile) {
      targetFile = customAudioFile;
      console.log(`[App handleTranscribe] Using custom uploaded audio file for transcription: ${(customAudioFile as File).name}`);
    } else if (isExternalTrack && extAudioFile) {
      targetFile = extAudioFile;
      console.log(`[App handleTranscribe] Using user-selected external audio track for transcription: ${extAudioFile.name}`);
    } else if (mediaFile) {
      // Native server FFmpeg extracts the exact requested audio track (track #${currentTrackNum}) directly from the container
      targetFile = mediaFile;
      console.log(`[App handleTranscribe] Using original mediaFile (${mediaFile.name}) for audio track #${currentTrackNum}.`);
    } else if (extAudioFile) {
      targetFile = extAudioFile;
      console.log(`[App handleTranscribe] Using active audio file for transcription.`);
    }

    if (!targetFile) {
      throw new Error("Медыяфайл не знойдзены.");
    }

    setIsTranscribing(true);
    setTranscribeProgress("Падрыхтоўка...");

    const controller = new AbortController();
    transcribeAbortControllerRef.current = controller;

    try {

      if (controller.signal.aborted) return;
      if (!targetFile) return;

      if (customAudioFile) {
        addToast(`Генерацыя субцітраў з загружанага аўдыяфайла (${customAudioFile.name})...`, "info");
      } else if (isExternalTrack && extAudioFile) {
        addToast(`Генерацыя субцітраў з аўдыядарожкі (${extAudioFile.name})...`, "info");
      } else if (currentTrackNum && currentTrackNum > 1) {
        addToast(`Генерацыя субцітраў з дарожкі #${currentTrackNum}...`, "info");
      } else {
        addToast(`Генерацыя субцітраў з дапамогай Gemini...`, "info");
      }

      if (targetFile.size > 28 * 1024 * 1024 * 1024) {
        throw new Error("Файл занадта вялікі. Максімальны памер файла для апрацоўкі — 28 ГБ.");
      }

      const rawTargetName = (targetFile as File).name || 'audio.mp3';
      const targetFileName = rawTargetName.replace(/[^\x20-\x7E]/g, '_').replace(/_+/g, '_') || 'audio.mp3';

      let detectedMimeType = targetFile.type;
      if (!detectedMimeType || detectedMimeType === 'application/octet-stream') {
        const ext = targetFileName.split('.').pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
          'mp3': 'audio/mp3',
          'wav': 'audio/wav',
          'ogg': 'audio/ogg',
          'm4a': 'audio/m4a',
          'mp4': 'video/mp4',
          'webm': 'video/webm',
          'avi': 'video/x-msvideo',
          'mov': 'video/quicktime',
          'mkv': 'video/x-matroska',
          'aac': 'audio/aac',
          'flac': 'audio/flac',
          'wma': 'audio/x-ms-wma'
        };
        detectedMimeType = mimeMap[ext || ''] || 'audio/mp3';
      }

      // Detect exact media duration in browser to bound generated subtitles
      let mediaDurationSec: number | undefined = undefined;
      if (targetFile instanceof File || targetFile instanceof Blob) {
        try {
          const isAudio = (detectedMimeType || '').startsWith('audio');
          const tempMedia = document.createElement(isAudio ? 'audio' : 'video');
          tempMedia.preload = 'metadata';
          const url = URL.createObjectURL(targetFile);
          await new Promise<void>((resolve) => {
            tempMedia.onloadedmetadata = () => {
              if (tempMedia.duration && !isNaN(tempMedia.duration) && tempMedia.duration > 0) {
                mediaDurationSec = tempMedia.duration;
              }
              resolve();
            };
            tempMedia.onerror = () => resolve();
            setTimeout(resolve, 1200);
            tempMedia.src = url;
          });
          URL.revokeObjectURL(url);
        } catch (_) {}
      }

      // In Desktop standalone mode (Tauri): execute direct transcription via desktopTranscribeAudio.
      // This bypasses non-existent Express server endpoints and routes all requests through subaka.exe
      // using postJsonNative to ensure 100% compliance with Windows Split Tunneling VPN.
      if (isTauriDesktop()) {
        const apiKey = geminiApiKey || getDesktopGeminiApiKey();
        if (!apiKey) {
          setIsGeminiKeyModalOpen(true);
          addToast("Для працы генерацыі субцітраў праз AI ў дэсктопнай версіі неабходна ўвесці Gemini API ключ", "warning");
          return;
        }

        let audioInputForDesktop: Blob | File = targetFile;
        const isVideo = !detectedMimeType.startsWith('audio') && (
          detectedMimeType.startsWith('video') ||
          /\.(mp4|mkv|webm|avi|mov|m4v|3gp|flv)$/i.test(targetFileName)
        );

        if (processedTracks[currentTrackNum]?.audioFile) {
          audioInputForDesktop = processedTracks[currentTrackNum].audioFile;
        } else if (isVideo) {
          setTranscribeProgress("Выцягванне аўдыядарожкі з відэафайла...");
          try {
            const extracted = await extractUniversalAudioTrack(
              targetFile,
              currentTrackNum,
              (pct, msg) => setTranscribeProgress(msg || `выцягванне аўдыя ${pct}%`),
              controller.signal
            );
            if (extracted && extracted.blob) {
              audioInputForDesktop = extracted.blob;
            }
          } catch (extErr: any) {
            if (extErr.name === 'AbortError' || controller.signal.aborted) {
              throw new DOMException("Aborted", "AbortError");
            }
            console.warn('[Desktop Transcribe] extractUniversalAudioTrack fallback:', extErr);
          }
        }

        const rawSrtResult = await desktopTranscribeAudio(audioInputForDesktop, {
          apiKey,
          onProgress: (msg) => setTranscribeProgress(msg),
          signal: controller.signal,
          mediaDurationSec,
        });

        if (!rawSrtResult) {
          throw new Error("Мадэль Gemini не вярнула субцітры");
        }

        const parsed = parseSrt(rawSrtResult, mediaDurationSec);
        if (parsed.length === 0) {
          throw new Error("Не ўдалося распазнаць фармат SRT у адказе мадэлі");
        }

        setAutoSubtitles(parsed);
        addToast(`Аўтасубцітры паспяхова сфарміраваны (картак: ${parsed.length})! Націсніце «ужыць», каб уставіць іх у працоўную вобласць.`, "success");
        return;
      }

      // 1. Chunked Upload Configuration (Browser / Web Server mode)
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks for better stability and fast uploads
      const totalChunks = Math.ceil(targetFile.size / CHUNK_SIZE);
      const uploadId = crypto.randomUUID();

      // Sequential Chunk Upload Loop with Automatic Retries
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, targetFile.size);
        const chunkBlob = targetFile.slice(start, end);

        // Update progress in percentage of uploading
        const uploadPercent = Math.round((i / totalChunks) * 100);
        setTranscribeProgress(`Загрузка ${uploadPercent}%`);

        // Send chunk to backend with retry on network drops
        let response: Response | null = null;
        let lastChunkErr: any = null;

        for (let attempt = 1; attempt <= 5; attempt++) {
          if (controller.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }
          try {
            response = await fetch("/api/transcribe/chunk", {
              method: "POST",
              headers: getApiHeaders({
                "x-upload-id": uploadId,
                "x-chunk-index": String(i),
                "x-total-chunks": String(totalChunks),
                "x-chunk-offset": String(start),
                "x-file-name": encodeURIComponent(targetFileName),
                "x-mime-type": encodeURIComponent(detectedMimeType || ''),
                "Content-Type": "application/octet-stream"
              }),
              body: chunkBlob,
              signal: controller.signal
            });
            if (response && (response.ok || (response.status >= 400 && response.status < 500))) {
              break;
            }
          } catch (cErr: any) {
            if (cErr.name === 'AbortError' || (cErr instanceof DOMException && cErr.name === 'AbortError')) {
              throw cErr;
            }
            lastChunkErr = cErr;
            console.warn(`[Transcribe Chunk Upload] Attempt ${attempt}/5 failed for chunk ${i + 1}: ${cErr.message || cErr}`);
          }
          if (attempt < 5) {
            await new Promise((res) => setTimeout(res, 1000 * attempt));
          }
        }

        if (!response || !response.ok) {
          const errText = response ? await response.text().catch(() => "") : "";
          let errMsg = `Памылка пры загрузцы часткі ${i + 1} з ${totalChunks}`;
          try {
            const errData = JSON.parse(errText);
            if (errData && errData.error) errMsg = errData.error;
          } catch {
            if (errText) errMsg = errText.slice(0, 150);
            else if (lastChunkErr?.message) errMsg = lastChunkErr.message;
          }
          throw new Error(errMsg);
        }
      }

      // Once all chunks are uploaded, update UI progress state
      setTranscribeProgress("Падрыхтоўка генерацыі...");

      // Final request to initiate async transcription job with retry
      let finalResponse: Response | null = null;
      let lastFinishErr: any = null;

      for (let attempt = 1; attempt <= 5; attempt++) {
        if (controller.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        try {
          finalResponse = await fetch("/api/transcribe/finish", {
            method: "POST",
            headers: getApiHeaders({
              "Content-Type": "application/json"
            }),
            body: JSON.stringify({
              uploadId,
              fileName: targetFileName,
              mimeType: detectedMimeType,
              engine: engineChoice,
              trackNumber: currentTrackNum
            }),
            signal: controller.signal
          });
          if (finalResponse && (finalResponse.ok || (finalResponse.status >= 400 && finalResponse.status < 500))) {
            break;
          }
        } catch (fErr: any) {
          if (fErr.name === 'AbortError' || (fErr instanceof DOMException && fErr.name === 'AbortError')) {
            throw fErr;
          }
          lastFinishErr = fErr;
          console.warn(`[Transcribe Finish] Attempt ${attempt}/5 failed: ${fErr.message || fErr}`);
        }
        if (attempt < 5) {
          await new Promise((res) => setTimeout(res, 1000 * attempt));
        }
      }

      if (!finalResponse || !finalResponse.ok) {
        const errText = finalResponse ? await finalResponse.text().catch(() => "") : "";
        let errMsg = "Памылка сервера пры запуску генерацыі";
        try {
          const errData = JSON.parse(errText);
          if (errData && errData.error) {
            errMsg = errData.error;
          }
        } catch {
          if (errText) {
            errMsg = errText.slice(0, 150);
          } else if (lastFinishErr?.message) {
            errMsg = lastFinishErr.message;
          }
        }
        throw new Error(errMsg);
      }

      const finalResText = await finalResponse.text().catch(() => "");
      let startData: any = {};
      try {
        startData = JSON.parse(finalResText);
      } catch {
        // Fallback to uploadId if JSON parsing fails
      }
      const jobId = startData?.jobId || uploadId;

      // Poll server for transcription progress and completion with retry tolerance
      let jobCompleted = false;
      let rawSrtResult = "";
      let consecutiveErrors = 0;
      let consecutive404 = 0;
      const MAX_CONSECUTIVE_ERRORS = 120; // ~5 minutes of network/proxy reconnection tolerance (120 * 2.5s = 300s)
      const MAX_CONSECUTIVE_404 = 30; // ~75 seconds of 404 tolerance in case of server restart/recovery

      while (!jobCompleted) {
        if (controller.signal.aborted) {
          fetch(`/api/transcribe/cancel/${encodeURIComponent(jobId)}`, { method: "POST" }).catch(() => {});
          throw new DOMException("Aborted", "AbortError");
        }

        await new Promise((res) => setTimeout(res, 2500));

        if (controller.signal.aborted) {
          fetch(`/api/transcribe/cancel/${encodeURIComponent(jobId)}`, { method: "POST" }).catch(() => {});
          throw new DOMException("Aborted", "AbortError");
        }

        try {
          const statusResponse = await fetch(`/api/transcribe/status/${encodeURIComponent(jobId)}`, {
            signal: controller.signal,
            headers: getApiHeaders({})
          });

          const statusText = await statusResponse.text().catch(() => "");
          let statusData: any = null;
          try {
            statusData = JSON.parse(statusText);
          } catch {
            statusData = null;
          }

          if (!statusResponse.ok) {
            if (statusResponse.status === 404) {
              consecutive404++;
              console.warn(`[Transcribe Poll] Status 404 attempt ${consecutive404}/${MAX_CONSECUTIVE_404}`);
              if (consecutive404 >= MAX_CONSECUTIVE_404) {
                throw new Error("Задача распазнавання страчана. Калі ласка, пачніце генерацыю субцітраў зноў.");
              }
              continue;
            }

            consecutiveErrors++;
            console.warn(`[Transcribe Poll] Status check HTTP ${statusResponse.status} (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              throw new Error(`Сервер часова недаступны (${statusResponse.status}). Паўтарыце спробу.`);
            }
            continue;
          }

          if (!statusData) {
            consecutiveErrors++;
            console.warn(`[Transcribe Poll] Transient non-JSON / gateway response received (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}). Retrying in 2.5s...`);
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
              throw new Error("Не ўдалося атрымаць статус ад сервера пасля некалькіх спроб.");
            }
            continue;
          }

          // Reset counters on valid status response
          consecutiveErrors = 0;
          consecutive404 = 0;

          if (statusData.status === "completed") {
            rawSrtResult = statusData.srt || "";
            jobCompleted = true;
            break;
          } else if (statusData.status === "error") {
            throw new Error(statusData.error || "Памылка на баку сервера пры апрацоўцы");
          } else {
            // Status: processing
            if (statusData.progressMessage) {
              const hasPercent = statusData.progressMessage.includes("%");
              const pctMsg = (!hasPercent && statusData.percent != null) ? ` (${statusData.percent}%)` : "";
              setTranscribeProgress(`${statusData.progressMessage}${pctMsg}`);
            }

            // Store partial SRT in autoSubtitles buffer without auto-inserting into workspace
            if (statusData.srt && typeof statusData.srt === "string" && statusData.srt.trim().length > 10) {
              try {
                const partialParsed = parseSrt(statusData.srt, mediaDurationSec);
                if (partialParsed.length > 0) {
                  setAutoSubtitles(partialParsed);
                }
              } catch (_) {
                // Ignore partial parse errors while chunks are streaming
              }
            }
          }
        } catch (err: any) {
          if (err.name === 'AbortError' || err instanceof DOMException) {
            throw err;
          }
          if (err.message && (
            err.message.includes("Памылка на баку сервера") || 
            err.message.includes("страчана")
          )) {
            throw err;
          }
          consecutiveErrors++;
          console.warn(`[Transcribe Poll] Poll error: ${err.message} (attempt ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            throw err;
          }
        }
      }

      if (!rawSrtResult) {
        throw new Error("Мадэль не вярнула субцітры");
      }

      const parsed = parseSrt(rawSrtResult, mediaDurationSec);
      if (parsed.length === 0) {
        throw new Error("Не ўдалося распазнаць фармат SRT у адказе мадэлі");
      }

      // Store auto-generated subtitles in buffer only - inserted strictly via the "ужыць" button
      setAutoSubtitles(parsed);
      addToast(`Аўтасубцітры згенераваны (картак: ${parsed.length})! Націсніце «ужыць», каб уставіць іх у працоўную вобласць.`, "success");
    } catch (err: any) {
      if (err.name === 'AbortError') {
        addToast("Генерацыя субцітраў прыпынена карыстальнікам.", "info");
      } else {
        console.error("Transcribe error:", err);
        let userMsg = err.message || "Памылка пры генерацыі субцітраў";
        if (userMsg.includes("Failed to fetch") || userMsg.includes("fetch")) {
          userMsg = "Страчана сувязь з серверам (Failed to fetch). Паўтарыце спробу.";
        }
        addToast(userMsg, "error");
      }
    } finally {
      setIsTranscribing(false);
      setTranscribeProgress(null);
      if (transcribeAbortControllerRef.current === controller) {
        transcribeAbortControllerRef.current = null;
      }
    }
  };

  const handleCancelTranscribe = () => {
    if (transcribeAbortControllerRef.current) {
      transcribeAbortControllerRef.current.abort();
    }
  };

  const handleCancelSynthesizeAll = () => {
    cancelSynthesizingRef.current = true;
    addToast("Калі ідзе працэс агучвання, ён будзе прыпынены пасля завяршэння бягучага радка...", "info");
  };

  // BATCH SYNTHESIZE ALL SEQUENTIALLY
  const handleSynthesizeAll = async () => {
    const pending = subtitles.filter((sub) => (sub.translatedText || "").trim() && !sub.audioUrl);
    if (pending.length === 0) {
      addToast("Няма радкоў з перакладам без агучкі для апрацоўкі", "info");
      return;
    }

    // Inform user of rate limiting safety for large batches
    if (pending.length > 15) {
      addToast(`Вялікі пакет (${pending.length} субцітраў). Сінтэз пачнецца аўтаматычна.`, "info");
    }

    setIsSynthesizingAll(true);
    cancelSynthesizingRef.current = false;
    const voiceToUse = isSupportedVoice(selectedVoice) ? selectedVoice : 'Ales';
    if (selectedVoice !== voiceToUse) {
      handleVoiceChange(voiceToUse);
    }
    const isQuotaFreeVoice = voiceToUse === 'Ales' || voiceToUse === 'BelG2P';
    addToast(`Пачаўся сінтэз для ${pending.length} субцітраў...`, "info");

    for (let i = 0; i < pending.length; i++) {
      if (cancelSynthesizingRef.current) {
        break;
      }

      const sub = pending[i];
      const textToUse = (sub.translatedText || "").trim();
      if (!textToUse) {
        continue;
      }

      // Find the index of this subtitle in the main subtitles array and select it to highlight/scroll to it in order!
      const mainIndex = subtitles.findIndex((s) => s.id === sub.id);
      if (mainIndex !== -1) {
        setActiveSubtitleIndex(mainIndex);
      }

      // Update loader state in UI
      setSubtitles((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, isGeneratingAudio: true } : s))
      );

      let success = false;
      let attempts = 3;
      let attempt = 0;
      let lastErrMsg = "";

      while (attempt < attempts && !success) {
        if (cancelSynthesizingRef.current) {
          break;
        }

        try {
          const blob = await synthesizeSubtitleAudioUniversal(textToUse, voiceToUse, {
            headers: getApiHeaders({ "Content-Type": "application/json" }),
          });
          cacheAudioBlob(sub.id, blob);
          const url = URL.createObjectURL(blob);

          setSubtitles((prev) =>
            prev.map((s) =>
              s.id === sub.id
                ? { ...s, audioUrl: url, isGeneratingAudio: false, audioError: undefined }
                : s
            )
          );
          success = true;
        } catch (err: any) {
          const errMsg = err.message || "TTS error status context";
          lastErrMsg = errMsg;

          const isRateLimit = 
            errMsg.includes("Quota Exceeded") || 
            errMsg.includes("Quota exceeded") || 
            errMsg.includes("limit") || 
            errMsg.includes("429") || 
            errMsg.includes("RESOURCE_EXHAUSTED");

          if (isRateLimit && !isQuotaFreeVoice && attempt < attempts - 1 && !cancelSynthesizingRef.current) {
            attempt++;
            const backoffDelay = attempt * 8000; // 8s, 16s
            addToast(`Ліміт API Gemini. Чакаем ${backoffDelay / 1000} сек. перад паўторам... Або пераключыцеся на TTS Алесь ці TTS Маруся.`, "info");
            await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          } else {
            break;
          }
        }
      }

      if (!success && !cancelSynthesizingRef.current) {
        const isRateLimit = 
          lastErrMsg.includes("Quota Exceeded") || 
          lastErrMsg.includes("Quota exceeded") || 
          lastErrMsg.includes("limit") || 
          lastErrMsg.includes("429") || 
          lastErrMsg.includes("RESOURCE_EXHAUSTED");

        setSubtitles((prev) =>
          prev.map((s) =>
            s.id === sub.id
              ? { ...s, isGeneratingAudio: false, audioError: isRateLimit ? "Ліміт API" : lastErrMsg }
              : s
          )
        );

        if (isRateLimit && !isQuotaFreeVoice) {
          addToast("Ліміт квоты Gemini перавышаны. Пераключыцеся на 'TTS Алесь' або 'TTS Маруся' у хэдары для агучвання без абмежаванняў.", "warning");
          // Stop batch or allow user to switch voice
          break;
        } else {
          addToast(`Памылка пры агучванні радка: ${lastErrMsg}`, "error");
        }
      }

      // Delay between cards: fast 80ms for Ales / BelG2P phonetic TTS, 2500ms for Gemini AI
      if (i < pending.length - 1 && !cancelSynthesizingRef.current) {
        const delayMs = isQuotaFreeVoice ? 80 : 2500;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    setIsSynthesizingAll(false);
    if (cancelSynthesizingRef.current) {
      addToast("Пакетны сінтэз агучкі прыпынены карыстальнікам.", "info");
    } else {
      addToast("Пакетны сінтэз агучкі паспяхова завершаны!", "success");
    }
  };

  // PROOFREAD SINGLE SUBTITLE CARD (called from SubtitleItem)
  const handleProofreadSingleCard = async (id: string) => {
    const target = subtitles.find((sub) => sub.id === id);
    if (!target || !(target.translatedText || "").trim()) {
      addToast("Няма тэксту перакладу для праверкі", "info");
      return;
    }

    if (isTauriDesktop()) {
      const apiKey = geminiApiKey || getDesktopGeminiApiKey();
      if (!apiKey) {
        setIsGeminiKeyModalOpen(true);
        addToast("Для працы праверкі правапісу праз AI ў дэсктопнай версіі неабходна ўвесці Gemini API ключ", "warning");
        return;
      }
      addToast("Праверка карткі ШІ...", "info");
      try {
        const results = await desktopProofreadBatch([{ id: target.id, text: target.translatedText }], apiKey);
        const match = results.find((r) => String(r.id) === String(id));
        const issues = match?.issues || [];
        setSubtitles((prev) =>
          prev.map((sub) => (String(sub.id) === String(id) ? { ...sub, proofreadIssues: issues } : sub))
        );

        if (issues.length > 0) {
          addToast(`Праверка завершана. Знойдзена заўваг/памылак: ${issues.length}. Яны падкрэслены фіялетавым.`, "info");
        } else {
          addToast("Памылак не знойдзена.", "success");
        }
      } catch (err: any) {
        addToast(err.message || "Памылка праверкі карткі", "error");
      }
      return;
    }

    addToast("Праверка карткі ШІ...", "info");
    try {
      const response = await fetch("/api/proofread", {
        method: "POST",
        headers: getApiHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ entries: [{ id: target.id, text: target.translatedText }] }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Не ўдалося праверыць картку");
      }

      const data = await response.json();
      if (data.results && Array.isArray(data.results)) {
        const match = data.results.find((r: any) => String(r.id) === String(id));
        const issues = match?.issues || [];
        setSubtitles((prev) =>
          prev.map((sub) => (String(sub.id) === String(id) ? { ...sub, proofreadIssues: issues } : sub))
        );

        if (issues.length > 0) {
          addToast(`Праверка завершана. Знойдзена заўваг/памылак: ${issues.length}. Яны падкрэслены фіялетавым.`, "info");
        } else {
          addToast("Памылак не знойдзена.", "success");
        }
      }
    } catch (err: any) {
      addToast(err.message || "Памылка праверкі карткі", "error");
    }
  };

  // PROOFREAD ALL TRANSLATIONS (batch from ControlsPanel)
  const handleProofreadTranslation = async () => {
    const listToProofread = subtitles.filter((sub) => (sub.translatedText || "").trim());
    if (listToProofread.length === 0) {
      addToast("Няма тэксту перакладу для праверкі", "info");
      return;
    }

    if (isTauriDesktop()) {
      const apiKey = geminiApiKey || getDesktopGeminiApiKey();
      if (!apiKey) {
        setIsGeminiKeyModalOpen(true);
        addToast("Для працы праверкі правапісу праз AI ў дэсктопнай версіі неабходна ўвесці Gemini API ключ", "warning");
        return;
      }

      const controller = new AbortController();
      proofreadAbortControllerRef.current = controller;

      setIsProofreadingTranslation(true);
      cancelProofreadingRef.current = false;
      addToast("Пачалася праверка беларускага перакладу ШІ...", "info");

      try {
        const chunkSize = 25;
        const chunks: SubtitleEntry[][] = [];
        for (let i = 0; i < listToProofread.length; i += chunkSize) {
          chunks.push(listToProofread.slice(i, i + chunkSize));
        }

        for (let c = 0; c < chunks.length; c++) {
          if (cancelProofreadingRef.current || controller.signal.aborted) break;

          const chunk = chunks[c];
          if (chunks.length > 1) {
            addToast(`Праверка фрагмента ${c + 1} з ${chunks.length}...`, "info");
          }

          const packets = chunk.map((sub) => ({ id: sub.id, text: sub.translatedText }));
          let results: any = null;
          let chunkAttempts = 2;
          while (chunkAttempts > 0) {
            if (cancelProofreadingRef.current || controller.signal.aborted) break;
            try {
              results = await desktopProofreadBatch(packets, apiKey, undefined, {
                signal: controller.signal,
                cancelRef: cancelProofreadingRef,
              });
              break;
            } catch (chunkErr: any) {
              if (chunkErr?.name === 'AbortError' || cancelProofreadingRef.current || controller.signal.aborted) {
                break;
              }
              const errMsg = chunkErr?.message || '';
              if ((errMsg.includes('429') || errMsg.includes('квот') || errMsg.includes('503')) && chunkAttempts > 1) {
                addToast("Пераключэнне мадэлі Gemini для праверкі... Чакаем 2 сек.", "info");
                await new Promise((r) => setTimeout(r, 2000));
                chunkAttempts--;
                continue;
              }
              throw chunkErr;
            }
          }
          if (cancelProofreadingRef.current || controller.signal.aborted) break;

          if (results && Array.isArray(results)) {
            setSubtitles((prev) =>
              prev.map((sub) => {
                const match = results.find((r: any) => String(r.id) === String(sub.id));
                if (match) {
                  return { ...sub, proofreadIssues: match.issues };
                }
                return sub;
              })
            );
          }

          if (c < chunks.length - 1 && !cancelProofreadingRef.current && !controller.signal.aborted) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }

        if (cancelProofreadingRef.current || controller.signal.aborted) {
          addToast("Праверка перакладу спынена", "info");
        } else {
          addToast("Праверка ўсяго перакладу паспяхова завершана!", "success");
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || cancelProofreadingRef.current || controller.signal.aborted) {
          addToast("Праверка перакладу спынена", "info");
        } else {
          addToast(err.message || "Памылка праверкі перакладу", "error");
        }
      } finally {
        setIsProofreadingTranslation(false);
        if (proofreadAbortControllerRef.current === controller) {
          proofreadAbortControllerRef.current = null;
        }
      }
      return;
    }

    setIsProofreadingTranslation(true);
    cancelProofreadingRef.current = false;
    addToast("Пачалася праверка беларускага перакладу ШІ...", "info");

    try {
      const chunkSize = 30;
      const chunks: SubtitleEntry[][] = [];
      for (let i = 0; i < listToProofread.length; i += chunkSize) {
        chunks.push(listToProofread.slice(i, i + chunkSize));
      }

      let totalIssuesFound = 0;

      for (let c = 0; c < chunks.length; c++) {
        if (cancelProofreadingRef.current) break;

        const chunk = chunks[c];
        if (chunks.length > 1) {
          addToast(`Праверка фрагмента ${c + 1} з ${chunks.length}...`, "info");
        }

        const packets = chunk.map((sub) => ({ id: sub.id, text: sub.translatedText }));
        const controller = new AbortController();
        proofreadAbortControllerRef.current = controller;

        const response = await fetch("/api/proofread", {
          method: "POST",
          headers: getApiHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ entries: packets }),
          signal: controller.signal,
        });

        if (!response.ok) {
          if (cancelProofreadingRef.current) break;
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || "Не ўдалося праверыць пераклад");
        }

        const data = await response.json();
        if (cancelProofreadingRef.current) break;

        if (data.results && Array.isArray(data.results)) {
          setSubtitles((prev) =>
            prev.map((sub) => {
              const match = data.results.find((r: any) => String(r.id) === String(sub.id));
              if (match) {
                const issues = match.issues || [];
                totalIssuesFound += issues.length;
                return { ...sub, proofreadIssues: issues };
              }
              return sub;
            })
          );
        }
      }

      if (cancelProofreadingRef.current) {
        addToast("Праверка перакладу спынена", "info");
      } else if (totalIssuesFound > 0) {
        addToast(`Праверка завершана! Знойдзена заўваг/памылак: ${totalIssuesFound}.`, "info");
      } else {
        addToast("Праверка завершана! Усе карткі без памылак.", "success");
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || cancelProofreadingRef.current) {
        addToast("Праверка перакладу спынена", "info");
      } else {
        addToast(err.message || "Памылка праверкі перакладу", "error");
      }
    } finally {
      setIsProofreadingTranslation(false);
      proofreadAbortControllerRef.current = null;
    }
  };

  const handleCancelProofread = () => {
    cancelProofreadingRef.current = true;
    if (proofreadAbortControllerRef.current) {
      proofreadAbortControllerRef.current.abort();
    }
    setIsProofreadingTranslation(false);
  };

  // BATCH CONVERT ORIGINAL TO PHONETICS (BelG2P School transcription for Belarusian / Google Translate style IPA for English)
  const handleBatchConvertPhonetics = async () => {
    if (subtitles.length === 0) {
      addToast("Няма картак для фанетычнай канвертацыі", "info");
      return;
    }

    const itemsToConvert = subtitles.filter((sub) => (sub.text || "").trim().length > 0);
    if (itemsToConvert.length === 0) {
      addToast("Поле арыгіналу пустое ва ўсіх картках", "info");
      return;
    }

    setIsConvertingPhoneticsAll(true);
    addToast("Канвертацыя картак арыгіналу ў школьную транскрыпцыю...", "info");

    try {
      const results = await batchConvertPhonetics(
        itemsToConvert.map((sub) => ({ id: sub.id, text: stripSrtTags(sub.text || "").trim() }))
      );

      const phoneticMap = new Map<string | number, string>();
      for (const res of results) {
        if (res && res.id !== undefined && res.phonetic) {
          phoneticMap.set(res.id, res.phonetic);
        }
      }

      setSubtitles((prev) =>
        prev.map((sub) => {
          const converted = phoneticMap.get(sub.id);
          if (converted) {
            return { ...sub, translatedText: converted };
          }
          return sub;
        })
      );

      addToast(`Паспяхова канвертавана ${phoneticMap.size} картак у школьную транскрыпцыю!`, "success");
    } catch (err: any) {
      console.error("Batch phonetics conversion failed:", err);
      // Fallback: канвертуем лакальна з дапамогай BelG2P / enG2P
      setSubtitles((prev) =>
        prev.map((sub) => {
          const raw = stripSrtTags(sub.text || "").trim();
          if (raw) {
            return { ...sub, translatedText: convertPhoneticsLocal(raw) };
          }
          return sub;
        })
      );
      addToast("Карткі канвертаваны ў школьную транскрыпцыю", "success");
    } finally {
      setIsConvertingPhoneticsAll(false);
    }
  };

  // Clear workspace
  const handleClearAll = async () => {
    isClearingWorkspaceRef.current = true;

    // Interrupted active tasks
    handleCancelTranslate();
    handleCancelTranscribe();
    handleCancelSynthesizeAll();
    handleCancelProofread();
    terminateFFmpegWorker();

    setIsConvertingPhoneticsAll(false);
    setIsAudioProcessing(false);
    setIsMergingFull(false);

    subtitles.forEach((sub) => {
      if (sub.audioUrl) URL.revokeObjectURL(sub.audioUrl);
    });

    setSubtitles([]);
    setAutoSubtitles(null);
    setOriginalAssHeader(undefined);
    setActiveSubtitleIndex(-1);
    try {
      localStorage.removeItem('subaka_active_subtitle_index');
      localStorage.removeItem('subaka_active_subtitle_id');
    } catch {}
    setMediaFileName('');
    setMediaFile(null);
    setExtAudioFile(null);
    setProcessedTracks({});
    setProcessedForGenTracks({});
    setActiveTrackNumber(null);
    setActiveExternalTrackId(null);
    setMediaLoadingProgress(null);
    setTranscribeProgress(null);
    setIsTranscribing(false);
    setIsTranslatingAll(false);
    setIsSynthesizingAll(false);
    setIsProofreadingTranslation(false);

    setPlaybackState((prev) => ({
      ...prev,
      currentTime: 0,
      isPlaying: false,
    }));
    try {
      localStorage.removeItem('subaka_playback_current_time');
    } catch {}

    await clearWorkspaceFromStorage();
    if (isTauriDesktop()) {
      await clearDesktopTempCache();
    }
    setTimeout(() => {
      isClearingWorkspaceRef.current = false;
    }, 1500);
    addToast("Працоўная вобласць, часовыя файлы і кэш ачышчаны (граматыка, слоўнікі, гласарый і настройкі захаваны)", "info");
  };

  const handleClearMedia = async () => {
    // Interrupted active tasks related to media
    handleCancelTranscribe();
    terminateFFmpegWorker();

    setIsAudioProcessing(false);
    setIsMergingFull(false);

    setMediaFileName('');
    setMediaFile(null);
    setExtAudioFile(null);
    setProcessedTracks({});
    setProcessedForGenTracks({});
    setActiveTrackNumber(null);
    setActiveExternalTrackId(null);
    setMediaLoadingProgress(null);
    setTranscribeProgress(null);
    setIsTranscribing(false);

    setPlaybackState((prev) => ({
      ...prev,
      currentTime: 0,
      isPlaying: false,
    }));
    try {
      localStorage.removeItem('subaka_playback_current_time');
    } catch {}

    await clearMediaFromStorage();
    addToast("Медыяфайл ачышчаны", "info");
  };

  const handleMediaFileLoaded = (file: File) => {
    // If loading a new media file, reset processed tracks, external audio, and active tracks from any previous media file
    setExtAudioFile(null);
    setProcessedTracks({});
    setProcessedForGenTracks({});
    setActiveTrackNumber(1);
    setActiveExternalTrackId(null);
    setPlaybackState((prev) => ({
      ...prev,
      currentTime: 0,
      isPlaying: false,
    }));
    try {
      localStorage.removeItem('subaka_playback_current_time');
    } catch {}

    setMediaFile(file);
    setMediaFileName(file.name);
    addToast(`Медыяфайл "${file.name}" загружаны`, "success");
  };

  const handleClearSubtitles = async () => {
    subtitles.forEach((sub) => {
      if (sub.audioUrl) URL.revokeObjectURL(sub.audioUrl);
    });
    setSubtitles([]);
    // Не ачышчаем autoSubtitles — аўтазгенераваныя субцітры застаюцца даступнымі для кнопкі «ужыць»
    setOriginalAssHeader(undefined);
    setActiveSubtitleIndex(-1);
    try {
      localStorage.removeItem('subaka_active_subtitle_index');
      localStorage.removeItem('subaka_active_subtitle_id');
    } catch {}
    await clearSubtitlesFromStorage();
    addToast("Працоўная вобласць субцітраў ачышчана", "info");
  };

  const handleClearVoiceover = async () => {
    if (isSynthesizingAll) {
      handleCancelSynthesizeAll();
    }
    setIsSynthesizingAll(false);

    let clearedCount = 0;
    subtitles.forEach((sub) => {
      if (sub.audioUrl) {
        clearedCount++;
        if (sub.audioUrl.startsWith('blob:')) {
          try {
            URL.revokeObjectURL(sub.audioUrl);
          } catch {}
        }
      }
    });

    if (clearedCount === 0) {
      addToast("Няма згенераванай агучкі для ачысткі", "info");
      return;
    }

    clearAudioBlobCache();

    const updatedSubtitles = subtitles.map((sub) => {
      if (!sub.audioUrl && !sub.audioError && !sub.isGeneratingAudio) return sub;
      return {
        ...sub,
        audioUrl: undefined,
        audioError: undefined,
        isGeneratingAudio: false,
      };
    });

    setSubtitles(updatedSubtitles);

    try {
      await saveWorkspaceToStorage(
        updatedSubtitles,
        autoSubtitles,
        mediaFileName,
        mediaFile,
        extAudioFile,
        selectedVoice,
        processedTracks,
        activeTrackNumber,
        activeExternalTrackId,
        originalAssHeader,
        projectName,
        splitRatio,
        playbackState.currentTime
      );
    } catch (e) {
      console.warn("[Storage] Error saving workspace after clearing voiceover:", e);
    }

    addToast(`Агучка ачышчана (знята з ${clearedCount} ${clearedCount === 1 ? 'карткі' : 'картак'})`, "info");
  };

  const handleApplyAutoSubtitles = async () => {
    if (!autoSubtitles || autoSubtitles.length === 0) {
      addToast("Няма згенераваных аўтасубцітраў для прымянення", "warning");
      return;
    }

    const targetAutoSubs = autoSubtitles;

    subtitles.forEach((sub) => {
      if (sub.audioUrl) URL.revokeObjectURL(sub.audioUrl);
    });

    const existingTranslations = subtitles.filter((s) => s.translatedText && s.translatedText.trim());
    let finalSubtitles = targetAutoSubs;
    if (existingTranslations.length > 0) {
      finalSubtitles = mergeSubtitlesByTime(targetAutoSubs, existingTranslations);
    }

    setSubtitles(finalSubtitles);
    // Захоўваем autoSubtitles у памяці для магчымасці паўторнага ўжывання
    let initialIdx = finalSubtitles.length > 0 ? 0 : -1;
    const curPlaybackTime = playbackState.currentTime || 0;
    if (finalSubtitles.length > 0 && curPlaybackTime > 0) {
      const match = finalSubtitles.findIndex((sub) => {
        const s = srtTimeToSeconds(sub.startTime);
        const e = srtTimeToSeconds(sub.endTime);
        return curPlaybackTime >= s && curPlaybackTime <= e;
      });
      if (match !== -1) {
        initialIdx = match;
      } else {
        for (let i = finalSubtitles.length - 1; i >= 0; i--) {
          if (curPlaybackTime >= srtTimeToSeconds(finalSubtitles[i].startTime)) {
            initialIdx = i;
            break;
          }
        }
      }
    }
    setActiveSubtitleIndex(initialIdx);
    if (!playbackState.isPlaying && curPlaybackTime === 0 && finalSubtitles.length > 0) {
      const firstStartSec = srtTimeToSeconds(finalSubtitles[0].startTime);
      setPlaybackState((prev) => ({ ...prev, currentTime: firstStartSec }));
    }
    addToast(`Аўтасубцітры паспяхова ўстаўлены ў працоўную вобласць (картак: ${targetAutoSubs.length})!`, "success");

    if (autoTranslate && finalSubtitles.length > 0) {
      await handleTranslateAll(finalSubtitles);
    }
  };

  const handleTranslationSubtitlesLoaded = (entries: SubtitleEntry[]) => {
    if (entries.length === 0) return;

    setSubtitles((prev) => {
      return mergeSubtitlesByTime(prev, entries);
    });

    if (activeSubtitleIndex === -1 && entries.length > 0) {
      setActiveSubtitleIndex(0);
    }

    addToast(`Паспяхова загружаны пераклад (${entries.length} радкоў)`, "success");
  };

  // Derived counts for batch actions panel and status bar
  const totalSubtitlesCount = subtitles.length;
  const translatedCount = subtitles.filter((s) => s.translatedText && s.translatedText.trim()).length;
  const synthesizedCount = subtitles.filter((s) => s.audioUrl).length;
  const isTranslatedPercent = totalSubtitlesCount > 0 ? Math.round((translatedCount / totalSubtitlesCount) * 100) : 0;
  const isSynthesizedPercent = totalSubtitlesCount > 0 ? Math.round((synthesizedCount / totalSubtitlesCount) * 100) : 0;

  // New statistics: AI remarks count, CPS excess count, and spell errors count (yellow warnings and red errors, excluding ignored words)
  const { totalAiRemarksCount, cpsExcessCount, redErrorsCount, yellowErrorsCount } = useMemo(() => {
    let aiRemarks = 0;
    let cpsExcess = 0;
    let redErrors = 0;
    let yellowErrors = 0;

    for (let i = 0; i < subtitles.length; i++) {
      const sub = subtitles[i];

      // 1. "заўвагі:" колькасць заўваг ШІ
      if (sub.proofreadIssues && sub.proofreadIssues.length > 0) {
        aiRemarks += sub.proofreadIssues.length;
      }

      if (sub.translatedText && sub.translatedText.trim()) {
        // 2. "CPS:" колькасць перавышэнняў CPS (> 20 сімв/сек)
        const startSec = srtTimeToSeconds(sub.startTime);
        const endSec = srtTimeToSeconds(sub.endTime);
        const durSec = Math.max(0.1, endSec - startSec);
        const cleanText = stripSrtTags(sub.translatedText).replace(/\u0301/g, '').trim();
        if (cleanText.length > 0) {
          const cps = cleanText.length / durSec;
          if (cps > 20) {
            cpsExcess++;
          }
        }

        // 3. "памылкі:" колькасць памылак (жоўтыя і чырвоныя, акрамя тых, што ігнаруюцца)
        if (autoSpellCheck) {
          const prevText = i > 0 ? subtitles[i - 1].translatedText : undefined;
          const tokens = getBelarusianSpellTokens(sub.translatedText, ignoredWords, {
            previousText: prevText,
            ignoredCapitalization,
          });
          for (let j = 0; j < tokens.length; j++) {
            const t = tokens[j];
            if (t.isError) {
              if (t.errorType === 'yellow') {
                yellowErrors++;
              } else {
                redErrors++;
              }
            }
          }
        }
      }
    }

    return {
      totalAiRemarksCount: aiRemarks,
      cpsExcessCount: cpsExcess,
      redErrorsCount: redErrors,
      yellowErrorsCount: yellowErrors,
    };
  }, [subtitles, ignoredWords, ignoredCapitalization, hunspellRevision, autoSpellCheck]);

  const hasAutoSubtitles = Boolean(autoSubtitles && autoSubtitles.length > 0);
  const autoSubtitlesCount = autoSubtitles ? autoSubtitles.length : 0;

  return (
    <div className={`h-screen h-[100dvh] max-h-[100dvh] flex flex-col font-sans selection:bg-indigo-500 selection:text-white overflow-hidden transition-colors duration-200 ${
      theme === 'dark' ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900'
    }`}>
      
      <Header
        geminiApiKey={geminiApiKey}
        onOpenGeminiKeyModal={() => setIsGeminiKeyModalOpen(true)}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onSubtitlesLoaded={async (entries, autoTranslateSelected, format, rawHeader) => {
          if (rawHeader) {
            setOriginalAssHeader(rawHeader);
          }
          // Revoke old object URLs
          subtitles.forEach((sub) => {
            if (sub.audioUrl) URL.revokeObjectURL(sub.audioUrl);
          });

          const existingTranslations = subtitles.filter((s) => s.translatedText && s.translatedText.trim());
          let finalSubtitles = entries;
          if (existingTranslations.length > 0) {
            finalSubtitles = mergeSubtitlesByTime(entries, existingTranslations);
          }

          setSubtitles(finalSubtitles);
          setAutoSubtitles(null);
          let initialIdx = finalSubtitles.length > 0 ? 0 : -1;
          const curPlaybackTime = playbackState.currentTime || 0;
          if (finalSubtitles.length > 0 && curPlaybackTime > 0) {
            const match = finalSubtitles.findIndex((sub) => {
              const s = srtTimeToSeconds(sub.startTime);
              const e = srtTimeToSeconds(sub.endTime);
              return curPlaybackTime >= s && curPlaybackTime <= e;
            });
            if (match !== -1) {
              initialIdx = match;
            } else {
              for (let i = finalSubtitles.length - 1; i >= 0; i--) {
                if (curPlaybackTime >= srtTimeToSeconds(finalSubtitles[i].startTime)) {
                  initialIdx = i;
                  break;
                }
              }
            }
          }
          setActiveSubtitleIndex(initialIdx);
          addToast("Загружана субцітраў: " + entries.length + (format === 'ass' ? ' (.ass з ролямі)' : ''), "success");
          
          if (autoTranslateSelected && finalSubtitles.length > 0) {
            await handleTranslateAll(finalSubtitles);
          }
        }}
        onTranslationSubtitlesLoaded={handleTranslationSubtitlesLoaded}
        onMediaFileLoaded={handleMediaFileLoaded}
        subtitles={subtitles}
        mediaFile={mediaFile}
        mediaFileName={mediaFileName}
        onDownloadOriginalSrt={handleDownloadOriginalSrt}
        onDownloadOriginalAss={handleDownloadOriginalAss}
        onDownloadTranslatedSrt={handleDownloadTranslatedSrt}
        onDownloadTranslatedAss={handleDownloadTranslatedAss}
        onDownloadTranslatedByActorSrt={handleDownloadTranslatedByActorSrt}
        onDownloadTranslated={handleDownloadTranslated}
        onDownloadOriginal={handleDownloadOriginal}
        onDownloadFullVoiceover={handleDownloadFullVoiceover}
        isMergingFull={isMergingFull}
        isTranslatingAll={isTranslatingAll}
        onTranslateAll={() => handleTranslateAll()}
        onCancelTranslate={handleCancelTranslate}
        isSynthesizingAll={isSynthesizingAll}
        onSynthesizeAll={handleSynthesizeAll}
        onCancelSynthesizeAll={handleCancelSynthesizeAll}
        isTranscribing={isTranscribing}
        transcribeProgress={transcribeProgress}
        hasAutoSubtitles={hasAutoSubtitles}
        autoSubtitlesCount={autoSubtitlesCount}
        isSubtitlesOnlyPlay={playbackState.isSubtitlesOnlyPlay}
        onToggleIsSubtitlesOnlyPlay={(enabled) => handlePlaybackStateChange({ isSubtitlesOnlyPlay: enabled })}
        showActorsOnPlayer={showActorsOnPlayer}
        onToggleShowActorsOnPlayer={handleToggleShowActorsOnPlayer}
        selectedVoice={selectedVoice}
        onVoiceChange={handleVoiceChange}
        autoTranslate={autoTranslate}
        onToggleAutoTranslate={setAutoTranslate}
        autoSpellCheck={autoSpellCheck}
        onToggleAutoSpellCheck={handleToggleAutoSpellCheck}
        addToast={addToast}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenFormatHelp={() => setIsFormatHelpOpen(true)}
        onOpenHotkeys={() => setIsHotkeysOpen(true)}
        onOpenSearch={() => setIsSearchOpen(true)}
        lastSavedTime={lastSavedTime}
        isSaving={isSaving}
        subtitleFontSize={subtitleFontSize}
        onSubtitleFontSizeChange={handleSubtitleFontSizeChange}
        projectName={projectName}
        onProjectNameChange={handleProjectNameChange}
        ignoredWordsCount={ignoredWords.size}
        onOpenGlossaryModal={() => setIsGlossaryModalOpen(true)}
        totalAiRemarksCount={totalAiRemarksCount}
        cpsExcessCount={cpsExcessCount}
        yellowErrorsCount={yellowErrorsCount}
        redErrorsCount={redErrorsCount}
        activeQuickFilter={quickFilter}
        onToggleQuickFilter={handleToggleQuickFilter}
      />

      {/* Main Workspace Frame with resizable split pane */}
      <main
        ref={mainWorkspaceRef}
        style={{
          '--editor-width': `${splitRatio}%`,
          '--player-width': `${100 - splitRatio}%`,
        } as React.CSSProperties}
        className="flex-1 lg:overflow-hidden overflow-y-auto min-h-0 w-full max-w-full px-2 sm:px-3 md:px-4 lg:px-6 py-1 md:py-2 flex flex-col lg:flex-row gap-3 lg:gap-0 items-stretch relative"
      >
        
        {/* Editor on the left (resizable width between 25% and 75%) */}
        <section
          ref={editorSectionRef}
          className="workspace-editor-column flex flex-col gap-2 lg:h-full lg:overflow-hidden min-h-0 min-w-0 w-full shrink-0 lg:pr-1.5 order-1 lg:order-1"
        >
          {/* Subtitles cards list in their own dedicated scrollable section */}
          <div
            ref={parentRef}
            id="subtitles-list-scroll-section"
            onScroll={handleListScroll}
            className="overflow-y-auto flex-1 pr-1.5 scrollbar-thin scrollbar-thumb-slate-800 scrollbar-track-transparent min-h-0 relative max-h-[305px] sm:max-h-[315px] lg:max-h-none"
          >
            {/* Quick Filter Active Banner */}
            {quickFilter && subtitles.length > 0 && (
              <div
                id="active-quick-filter-banner"
                className={`sticky top-0 z-20 flex items-center justify-between px-2.5 py-1 mb-2 rounded-md text-[10px] border shadow-xs transition-all ${
                  theme === 'dark'
                    ? 'bg-purple-950/90 border-purple-800/80 text-purple-200 backdrop-blur-xs'
                    : 'bg-purple-50/95 border-purple-200 text-purple-950 backdrop-blur-xs'
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <Filter className="w-3 h-3 text-purple-500 dark:text-purple-400 shrink-0" />
                  <span>
                    Фільтр:{' '}
                    <strong className="font-bold text-purple-600 dark:text-purple-300">
                      {quickFilter === 'comments' && 'Заўвагі ШІ'}
                      {quickFilter === 'errors' && 'Чырвоныя памылкі правапісу'}
                    </strong>
                    {' — '}
                    паказана {displayedSubtitlesWithIndices.length} з {subtitles.length}
                  </span>
                </div>
                <button
                  type="button"
                  id="reset-quick-filter-button"
                  onClick={() => handleToggleQuickFilter(quickFilter)}
                  className={`text-[9.5px] px-2 py-0.5 rounded transition-colors cursor-pointer font-medium ${
                    theme === 'dark'
                      ? 'hover:bg-purple-900/50 text-purple-300 hover:text-white'
                      : 'hover:bg-purple-200 text-purple-800 hover:text-purple-950'
                  }`}
                  title="Скінуць фільтр (паказаць усе субцітры)"
                >
                  Скінуць фільтр ✕
                </button>
              </div>
            )}

            {subtitles.length > 0 ? (
              displayedSubtitlesWithIndices.length > 0 ? (
                <div
                  style={{
                    paddingTop: `${topPadding}px`,
                    paddingBottom: `${bottomPadding}px`,
                    boxSizing: 'border-box',
                  }}
                >
                  <div className="flex flex-col gap-2.5">
                    {visibleSubtitles.map(({ entry, index }) => (
                      <div
                        key={entry.id}
                        id={`subtitle-card-${index}`}
                        data-index={index}
                        ref={(node) => measureElementNode(index, node)}
                      >
                        <SubtitleItem
                          entry={entry}
                          index={index}
                          fontSize={subtitleFontSize}
                          isSelected={index === activeSubtitleIndex}
                          isOverlapping={overlappingSubtitleIds.has(entry.id)}
                          onSelect={() => {
                            setActiveSubtitleIndex(index);
                            const startSec = srtTimeToSeconds(entry.startTime);
                            handlePlaybackStateChange({ currentTime: startSec });
                          }}
                          onUpdate={(updated) => handleUpdateSubtitle(entry.id, updated)}
                          onDelete={() => handleDeleteSubtitle(entry.id)}
                          onAddAfter={() => handleAddSubtitleAfter(index)}
                          onAddBefore={() => handleAddSubtitleBefore(index)}
                          onTranslateSingle={handleTranslateSingle}
                          onProofreadSingle={handleProofreadSingleCard}
                          onSynthesizeSingle={handleSynthesizeSingle}
                          selectedVoice={selectedVoice}
                          theme={theme}
                          autoSpellCheck={autoSpellCheck}
                          previousText={index > 0 ? subtitles[index - 1].translatedText : undefined}
                          hunspellRevision={hunspellRevision}
                          onGetActors={getAllActors}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className={`flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-xl gap-3 flex-1 my-4 ${
                  theme === 'dark' ? 'bg-purple-950/10 border-purple-900/40' : 'bg-purple-50/40 border-purple-200'
                }`}>
                  <Filter className={`h-8 w-8 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} />
                  <div>
                    <h3 className={`text-sm font-bold ${theme === 'dark' ? 'text-slate-200' : 'text-slate-800'}`}>
                      {quickFilter === 'comments' && 'Няма картак з заўвагамі ШІ'}
                      {quickFilter === 'errors' && 'Няма картак з чырвонымі памылкамі правапісу'}
                    </h3>
                    <p className={`text-xs mt-1 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      Усе субцітры ў праекце адпавядаюць патрабаванням альбо не ўтрымліваюць адпаведных заўваг.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleQuickFilter(quickFilter!)}
                    className="px-3 py-1.5 text-xs rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors cursor-pointer shadow-xs"
                  >
                    Паказаць усе субцітры
                  </button>
                </div>
              )
            ) : (
              <div className={`flex flex-col items-center justify-center text-center p-12 border-2 border-dashed rounded-xl gap-4 flex-1 ${
                theme === 'dark' ? 'bg-slate-900/20 border-slate-800' : 'bg-white/60 border-slate-300'
              }`}>
                <AlertCircle className={`h-10 w-10 animate-pulse ${theme === 'dark' ? 'text-slate-600' : 'text-slate-400'}`} />
                <div>
                  <h3 className={`text-sm font-bold ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>Працоўная вобласць пустая</h3>
                  <p className={`text-xs mt-1 max-w-sm ${theme === 'dark' ? 'text-slate-500' : 'text-slate-600'}`}>
                    Няма загружаных субцітраў. Загрузіце ўласны файл .srt ці .ass або стварыце субцітры.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAddSubtitle()}
                    className={`px-3 py-1.5 font-medium text-xs rounded-lg transition-colors border shadow-xs cursor-pointer flex items-center gap-1.5 ${
                      theme === 'dark'
                        ? 'bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 border-slate-700 hover:border-slate-600'
                        : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300 hover:border-slate-400'
                    }`}
                  >
                    <Plus className="w-3.5 h-3.5 opacity-70" />
                    стварыць першую картку
                  </button>
                </div>
              </div>
            )}
          </div>

        </section>

        {/* Drag Handle Divider for lg screens */}
        <div
          onMouseDown={handleSplitMouseDown}
          onTouchStart={handleSplitTouchStart}
          onDoubleClick={(e) => {
            e.preventDefault();
            setSplitRatio(50);
            setIsDraggingSplit(false);
            if (mainWorkspaceRef.current) {
              mainWorkspaceRef.current.style.setProperty('--editor-width', '50%');
              mainWorkspaceRef.current.style.setProperty('--player-width', '50%');
            }
            if (editorSectionRef.current) {
              editorSectionRef.current.style.setProperty('--editor-width', '50%');
            }
            if (playerSectionRef.current) {
              playerSectionRef.current.style.setProperty('--player-width', '50%');
            }
            try {
              localStorage.setItem('subaka_split_ratio', '50');
            } catch {}
          }}
          title="Перацягніце для змены прапорцый экрана (падвойны клік — 50/50)"
          className={`hidden lg:flex flex-col items-center justify-center w-4 -mx-1.5 relative cursor-col-resize select-none shrink-0 z-30 touch-none group order-2 lg:order-2 ${
            isDraggingSplit ? 'cursor-col-resize' : ''
          }`}
        >
          {/* Minimalist vertical divider line */}
          <div
            className={`w-0.5 h-full rounded-full transition-colors duration-150 pointer-events-none ${
              isDraggingSplit
                ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)]'
                : theme === 'dark'
                  ? 'bg-slate-800 group-hover:bg-indigo-500/70'
                  : 'bg-slate-200 group-hover:bg-indigo-400'
            }`}
          />

          {/* Floating ratio tooltip during active drag */}
          {isDraggingSplit && (
            <div
              ref={splitTooltipRef}
              className={`absolute top-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded-md text-[10px] font-mono font-bold shadow-lg border pointer-events-none whitespace-nowrap z-50 ${
                theme === 'dark'
                  ? 'bg-slate-900/95 border-indigo-500/50 text-indigo-300 shadow-black/80'
                  : 'bg-white/95 border-indigo-400 text-indigo-700 shadow-slate-300'
              }`}
            >
              Субцітры: {Math.round(splitRatio)}% | Відэа: {Math.round(100 - splitRatio)}%
            </div>
          )}
        </div>

        {/* Player on the right (or below on mobile) */}
        <section
          ref={playerSectionRef}
          className="workspace-player-column flex flex-col gap-4 lg:h-full lg:overflow-hidden w-full shrink-0 lg:shrink lg:flex-1 lg:pl-1.5 order-3 lg:order-3 min-h-fit lg:min-h-0"
        >
          
          <TimelinePlayer
            subtitles={subtitles}
            playbackState={playbackState}
            onPlaybackStateChange={handlePlaybackStateChange}
            onAddSubtitle={handleAddSubtitle}
            activeSubtitleIndex={activeSubtitleIndex}
            onSelectSubtitle={(index) => setActiveSubtitleIndex(index)}
            showActorsOnPlayer={showActorsOnPlayer}
            onToggleShowActorsOnPlayer={handleToggleShowActorsOnPlayer}
            mediaLoadingProgress={mediaLoadingProgress}
            setMediaLoadingProgress={setMediaLoadingProgress}
            mediaFileName={mediaFileName}
            setMediaFileName={setMediaFileName}
            mediaFile={mediaFile}
            setMediaFile={setMediaFile}
            addToast={addToast}
            latestMessage={latestMessage}
            messagesHistory={messagesHistory}
            onClearHistory={() => setMessagesHistory([])}
            isTranscribing={isTranscribing}
            onTranscribe={handleTranscribe}
            onCancelTranscribe={handleCancelTranscribe}
            hasAutoSubtitles={hasAutoSubtitles}
            onApplyAutoSubtitles={handleApplyAutoSubtitles}
            extAudioFile={extAudioFile}
            onExtAudioFileChange={setExtAudioFile}
            processedTracks={processedTracks}
            onProcessedTracksChange={setProcessedTracks}
            activeTrackNumber={activeTrackNumber}
            onActiveTrackNumberChange={setActiveTrackNumber}
            activeExternalTrackId={activeExternalTrackId}
            onActiveExternalTrackIdChange={setActiveExternalTrackId}
            onAudioProcessingChange={setIsAudioProcessing}
            theme={theme}
            autoTranslate={autoTranslate}
            onSubtitlesLoaded={async (entries, autoTranslateSelected) => {
              subtitles.forEach((sub) => {
                if (sub.audioUrl) URL.revokeObjectURL(sub.audioUrl);
              });

              const existingTranslations = subtitles.filter((s) => s.translatedText && s.translatedText.trim());
              let finalSubtitles = entries;
              if (existingTranslations.length > 0) {
                finalSubtitles = mergeSubtitlesByTime(entries, existingTranslations);
              }

              setSubtitles(finalSubtitles);
              setAutoSubtitles(null);

              // Match current playback position so the active card stays in sync without rewinding
              let initialIdx = finalSubtitles.length > 0 ? 0 : -1;
              const curPlaybackTime = playbackState.currentTime || 0;
              if (finalSubtitles.length > 0 && curPlaybackTime > 0) {
                const match = finalSubtitles.findIndex((sub) => {
                  const s = srtTimeToSeconds(sub.startTime);
                  const e = srtTimeToSeconds(sub.endTime);
                  return curPlaybackTime >= s && curPlaybackTime <= e;
                });
                if (match !== -1) {
                  initialIdx = match;
                } else {
                  for (let i = finalSubtitles.length - 1; i >= 0; i--) {
                    if (curPlaybackTime >= srtTimeToSeconds(finalSubtitles[i].startTime)) {
                      initialIdx = i;
                      break;
                    }
                  }
                }
              }
              setActiveSubtitleIndex(initialIdx);
              addToast("Субцітры з файла дададзены ў працоўную вобласць: " + entries.length + " карт.", "success");

              if (autoTranslateSelected && finalSubtitles.length > 0) {
                await handleTranslateAll(finalSubtitles);
              }
            }}
            onTranslationSubtitlesLoaded={handleTranslationSubtitlesLoaded}
            onRegisterAddExternalAudio={handleRegisterAddExternalAudio}
          />
        </section>

        {/* Global drag transparent overlay to avoid iframe/video capturing mouse events */}
        {isDraggingSplit && (
          <div className="fixed inset-0 z-50 cursor-col-resize select-none pointer-events-auto" />
        )}

      </main>

      <ControlsPanel
        subtitles={subtitles}
        onShiftAll={handleShiftAll}
        onResetOriginalTime={handleResetOriginalTime}
        isTranscribing={isTranscribing}
        isAudioProcessing={isAudioProcessing}
        selectedVoice={selectedVoice}
        onVoiceChange={handleVoiceChange}
        translatedCount={translatedCount}
        synthesizedCount={synthesizedCount}
        mediaLoadingProgress={mediaLoadingProgress}
        mediaFileName={mediaFileName}
        transcribeProgress={transcribeProgress}
        hasAutoSubtitles={hasAutoSubtitles}
        autoSubtitlesCount={autoSubtitlesCount}
        onClearSubtitles={handleClearSubtitles}
        onClearMedia={handleClearMedia}
        onClearVoiceover={handleClearVoiceover}
        onClearAll={handleClearAll}
        isTranslatingAll={isTranslatingAll}
        onTranslateAll={() => handleTranslateAll()}
        onCancelTranslate={handleCancelTranslate}
        onProofreadTranslation={handleProofreadTranslation}
        onCancelProofread={handleCancelProofread}
        isProofreadingTranslation={isProofreadingTranslation}
        onBatchConvertPhonetics={handleBatchConvertPhonetics}
        isConvertingPhoneticsAll={isConvertingPhoneticsAll}
        onOpenTranscribeModal={() => {
          if (isTauriDesktop()) {
            const apiKey = geminiApiKey || getDesktopGeminiApiKey();
            if (!apiKey) {
              setIsGeminiKeyModalOpen(true);
              addToast("Для працы генерацыі субцітраў праз AI ў дэсктопнай версіі неабходна ўвесці Gemini API ключ", "warning");
              return;
            }
          }
          setIsSubtitleTrackModalOpen(true);
        }}
        onTranscribe={handleTranscribe}
        onCancelTranscribe={handleCancelTranscribe}
        onApplyAutoSubtitles={handleApplyAutoSubtitles}
        isSynthesizingAll={isSynthesizingAll}
        onSynthesizeAll={handleSynthesizeAll}
        onCancelSynthesizeAll={handleCancelSynthesizeAll}
        isMergingFull={isMergingFull}
        onDownloadFullVoiceover={handleDownloadFullVoiceover}
        theme={theme}
      />

      <SubtitleTrackSelectModal
        isOpen={isSubtitleTrackModalOpen}
        onClose={() => setIsSubtitleTrackModalOpen(false)}
        mediaFile={mediaFile}
        mediaFileName={mediaFileName}
        extAudioFile={extAudioFile}
        activeTrackNumber={activeTrackNumber}
        activeExternalTrackId={activeExternalTrackId}
        processedForGenTracks={processedForGenTracks}
        processedTracks={processedTracks}
        onStartTranscribe={(engine, model, trackNum, isExternal, customAudioFile) => {
          if (isTauriDesktop()) {
            const apiKey = geminiApiKey || getDesktopGeminiApiKey();
            if (!apiKey) {
              setIsSubtitleTrackModalOpen(false);
              setIsGeminiKeyModalOpen(true);
              addToast("Для працы генерацыі субцітраў праз AI ў дэсктопнай версіі неабходна ўвесці Gemini API ключ", "warning");
              return;
            }
          }
          if (customAudioFile) {
            setExtAudioFile(customAudioFile);
          }
          if (!isExternal && trackNum) {
            setActiveTrackNumber(trackNum);
          }
          handleTranscribe(engine, model, trackNum, isExternal, customAudioFile);
        }}
        theme={theme}
      />

      <FormatHelpModal
        isOpen={isFormatHelpOpen}
        onClose={() => setIsFormatHelpOpen(false)}
        theme={theme}
        desktopStorage={desktopStorage}
      />

      <HotkeysModal
        isOpen={isHotkeysOpen}
        onClose={() => setIsHotkeysOpen(false)}
        theme={theme}
      />

      <GeminiApiKeyModal
        isOpen={isGeminiKeyModalOpen}
        onClose={() => setIsGeminiKeyModalOpen(false)}
        apiKey={geminiApiKey}
        onSaveKey={handleSaveGeminiKey}
        theme={theme}
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        subtitles={subtitles}
        activeSubtitleIndex={activeSubtitleIndex}
        onSelectSubtitle={(index) => {
          setActiveSubtitleIndex(index);
          if (subtitles[index]) {
            const startSec = srtTimeToSeconds(subtitles[index].startTime);
            handlePlaybackStateChange({ currentTime: startSec });
          }
        }}
        onUpdateSubtitles={(newSubtitles, msg) => {
          setSubtitles(newSubtitles);
          if (msg) {
            addToast(msg, 'success');
          }
        }}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        theme={theme}
      />

      <GlossaryModal
        isOpen={isGlossaryModalOpen}
        onClose={() => setIsGlossaryModalOpen(false)}
        ignoredWords={ignoredWords}
        onAddWord={handleAddGlossaryWord}
        onRemoveWord={handleRemoveIgnoredWord}
        onClearAll={handleClearGlossary}
        onExport={handleExportGlossary}
        onImport={handleImportGlossary}
        theme={theme}
      />



      <footer className={`${
        theme === 'dark' ? 'bg-slate-950/95 border-slate-900' : 'bg-white border-slate-200'
      } border-t shrink-0 select-none flex flex-col transition-colors duration-200 pb-[env(safe-area-inset-bottom,0px)]`}>
        {/* Collapsible Status/History Panel */}
        <div className={`border-b transition-colors ${
          theme === 'dark' ? 'border-slate-900/60 bg-slate-950/40 text-slate-300' : 'border-slate-200 bg-slate-50 text-slate-700'
        }`}>
          {/* Header of Panel: always visible, micro-slim, clickable */}
          <div 
            onClick={() => setIsHistoryExpanded(!isHistoryExpanded)}
            className={`flex flex-col sm:flex-row sm:items-center justify-between py-1 px-2 md:px-3 cursor-pointer transition-colors select-none gap-1 sm:gap-2 ${
              theme === 'dark' ? 'hover:bg-slate-900/40' : 'hover:bg-slate-200/60'
            }`}
          >
            {/* Top row on mobile / Left section on desktop */}
            <div className="flex items-center justify-between sm:justify-start gap-1.5 min-w-0 w-full sm:w-auto shrink-0">
              <div className="flex items-center gap-1 shrink-0">
                <Activity className={`h-2.5 w-2.5 ${latestMessage ? 'animate-pulse' : ''} ${
                  theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'
                }`} />
                <span className={`font-semibold text-[7px] uppercase tracking-wider whitespace-nowrap ${
                  theme === 'dark' ? 'text-slate-400' : 'text-slate-600'
                }`}>
                  Статус і гісторыя
                </span>
                {messagesHistory.length > 0 && (
                  <span className={`text-[6.5px] font-extrabold px-1 py-0 rounded-full border leading-none ${
                    theme === 'dark'
                      ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                      : 'bg-indigo-100 text-indigo-800 border-indigo-300 font-mono'
                  }`}>
                    {messagesHistory.length}
                  </span>
                )}
              </div>

              {/* Latest message */}
              {!isHistoryExpanded && (
                latestMessage ? (
                  <div className={`hidden md:inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[7.5px] border leading-none shrink-0 ${
                    theme === 'dark'
                      ? 'bg-slate-900/60 border-slate-800/80 text-slate-200'
                      : 'bg-white border-slate-300 text-slate-800 shadow-2xs'
                  }`}>
                    <span className={`inline-block w-1 h-1 rounded-full shrink-0 ${
                      latestMessage.type === 'success' ? 'bg-emerald-400' :
                      latestMessage.type === 'error' ? 'bg-red-400' : 'bg-indigo-400'
                    }`}></span>
                    <span className="font-medium leading-none whitespace-nowrap">{latestMessage.message}</span>
                  </div>
                ) : (
                  <span className={`hidden md:inline-block text-[7.5px] italic leading-none shrink-0 whitespace-nowrap ${theme === 'dark' ? 'text-slate-500' : 'text-slate-500'}`}>
                    Чаканне дзеянняў...
                  </span>
                )
              )}

              {/* Mobile chevron toggle button */}
              <div className="sm:hidden flex items-center shrink-0">
                {isHistoryExpanded ? (
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                ) : (
                  <ChevronUp className="h-3 w-3 text-slate-400" />
                )}
              </div>
            </div>

            {/* Center section: Stats badges (wraps into 2 rows on mobile) */}
            {!isHistoryExpanded && (
              <div className="flex-1 flex items-center justify-start sm:justify-center min-w-0">
                <div className="flex flex-wrap items-center gap-1 font-mono">
                  <span
                    className={`px-1 py-0.5 rounded border text-[7.5px] flex items-baseline gap-0.5 whitespace-nowrap leading-none ${
                      theme === 'dark' ? 'bg-slate-900/60 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-700'
                    }`}
                    title="Усяго картак субцітраў"
                  >
                    <span className="text-slate-400 font-sans text-[7px] leading-none">карткі:</span>
                    <strong className="text-emerald-500 font-bold leading-none text-[8.5px]">{totalSubtitlesCount}</strong>
                  </span>
                  <span
                    className={`px-1 py-0.5 rounded border text-[7.5px] flex items-baseline gap-0.5 whitespace-nowrap leading-none ${
                      theme === 'dark' ? 'bg-slate-900/60 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-700'
                    }`}
                    title="Перакладзеныя карткі"
                  >
                    <span className="text-slate-400 font-sans text-[7px] leading-none">пер:</span>
                    <strong className="text-emerald-500 font-bold leading-none text-[8.5px]">{translatedCount}</strong>
                    <span className="text-[7px] text-slate-400 leading-none">({isTranslatedPercent}%)</span>
                  </span>
                  <span
                    className={`px-1 py-0.5 rounded border text-[7.5px] flex items-baseline gap-0.5 whitespace-nowrap leading-none ${
                      theme === 'dark' ? 'bg-slate-900/60 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-700'
                    }`}
                    title="Агучаныя карткі"
                  >
                    <span className="text-slate-400 font-sans text-[7px] leading-none">аг:</span>
                    <strong className="text-emerald-500 font-bold leading-none text-[8.5px]">{synthesizedCount}</strong>
                    <span className="text-[7px] text-slate-400 leading-none">({isSynthesizedPercent}%)</span>
                  </span>
                  <span
                    className={`px-1 py-0.5 rounded border text-[7.5px] flex items-baseline gap-0.5 whitespace-nowrap leading-none ${
                      theme === 'dark' ? 'bg-slate-900/60 border-slate-800 text-slate-300' : 'bg-white border-slate-200 text-slate-700'
                    }`}
                    title="Колькасць перавышэнняў CPS (> 20 сімв/сек)"
                  >
                    <span className="text-slate-400 font-sans text-[7px] leading-none">CPS:</span>
                    <strong className="text-amber-500 dark:text-amber-400 font-bold leading-none text-[8.5px]">{cpsExcessCount}</strong>
                  </span>
                </div>
              </div>
            )}

            {/* Desktop right side expand toggle button */}
            <button className={`hidden sm:flex transition-colors p-0 items-center shrink-0 ml-1.5 ${
              theme === 'dark' ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'
            }`}>
              {isHistoryExpanded ? (
                <ChevronDown className="h-2.5 w-2.5" />
              ) : (
                <ChevronUp className="h-2.5 w-2.5" />
              )}
            </button>
          </div>

          {/* Expanded portion */}
          {isHistoryExpanded && (
            <div className={`border-t p-1.5 sm:p-2 flex flex-col gap-2 animate-fade-in max-h-[45vh] sm:max-h-[50vh] overflow-y-auto scrollbar-thin ${
              theme === 'dark'
                ? 'border-slate-900/60 bg-slate-950/80 scrollbar-thumb-slate-800'
                : 'border-slate-200 bg-slate-100/90 scrollbar-thumb-slate-300'
            }`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-stretch">
                
                {/* Left Column: Project Statistics & GrammarDB */}
                <div className={`flex flex-col justify-start gap-1.5 border rounded-lg p-2 min-h-[65px] ${
                  theme === 'dark'
                    ? 'bg-slate-900/40 border-slate-900/60'
                    : 'bg-white border-slate-200 shadow-2xs'
                }`}>
                  {/* Project Statistics Badges in Status Panel */}
                  <div className={`flex items-center justify-between gap-1 text-[7.5px] flex-wrap ${
                    theme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                  }`}>
                    <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                      <span className="font-bold text-[7px] uppercase tracking-wider text-slate-500 dark:text-slate-400 shrink-0">
                        Карткі субцітраў:
                      </span>
                      <div className="flex items-center gap-1 flex-wrap">
                        {/* Total */}
                        <div
                          className={`py-0.5 px-1.5 rounded-md flex items-baseline gap-1 border leading-none ${
                            theme === 'dark' ? 'bg-slate-950/50 border-slate-800/70' : 'bg-slate-50 border-slate-200'
                          }`}
                          title="Усяго картак субцітраў"
                        >
                          <span className={`text-[7.5px] font-bold tracking-wider leading-none ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                            усяго:
                          </span>
                          <span className="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 font-mono leading-none">
                            {totalSubtitlesCount}
                          </span>
                        </div>

                        {/* Translate */}
                        <div
                          className={`py-0.5 px-1.5 rounded-md flex items-baseline gap-1 border leading-none ${
                            theme === 'dark' ? 'bg-slate-950/50 border-slate-800/70' : 'bg-slate-50 border-slate-200'
                          }`}
                          title="Перакладзеныя карткі"
                        >
                          <span className={`text-[7.5px] font-bold tracking-wider leading-none ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                            пераклад:
                          </span>
                          <span className="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 font-mono leading-none">
                            {translatedCount}{' '}
                            <span className={`text-[8px] font-normal leading-none ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                              ({isTranslatedPercent}%)
                            </span>
                          </span>
                        </div>

                        {/* Synthesize */}
                        <div
                          className={`py-0.5 px-1.5 rounded-md flex items-baseline gap-1 border leading-none ${
                            theme === 'dark' ? 'bg-slate-950/50 border-slate-800/70' : 'bg-slate-50 border-slate-200'
                          }`}
                          title="Агучаныя карткі"
                        >
                          <span className={`text-[7.5px] font-bold tracking-wider leading-none ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                            агучка:
                          </span>
                          <span className="text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 font-mono leading-none">
                            {synthesizedCount}{' '}
                            <span className={`text-[8px] font-normal leading-none ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>
                              ({isSynthesizedPercent}%)
                            </span>
                          </span>
                        </div>

                        {/* AI Remarks ("заўвагі:") */}
                        <button
                          type="button"
                          onClick={() => handleToggleQuickFilter('comments')}
                          className={`py-0.5 px-1.5 rounded-md flex items-baseline gap-1 border leading-none cursor-pointer transition-all active:scale-95 select-none ${
                            quickFilter === 'comments'
                              ? theme === 'dark'
                                ? 'bg-purple-950/90 border-purple-500 text-purple-200 ring-1 ring-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                                : 'bg-purple-100 border-purple-500 text-purple-900 ring-1 ring-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.25)]'
                              : theme === 'dark'
                              ? 'bg-slate-950/50 hover:bg-slate-900 border-slate-800/70 hover:border-purple-500/50'
                              : 'bg-slate-50 hover:bg-purple-50/50 border-slate-200 hover:border-purple-300'
                          }`}
                          title={
                            quickFilter === 'comments'
                              ? 'Зняць фільтр (паказаны толькі карткі з заўвагамі ШІ)'
                              : 'Фільтраваць па заўвагах (паказаць толькі карткі з заўвагамі ШІ)'
                          }
                        >
                          <span className={`text-[7.5px] font-bold tracking-wider leading-none ${
                            quickFilter === 'comments' ? 'text-purple-300 dark:text-purple-200' : theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
                          }`}>
                            заўвагі:
                          </span>
                          <span className={`text-[10.5px] font-bold font-mono leading-none ${
                            quickFilter === 'comments' ? 'text-purple-200 dark:text-purple-100' : 'text-purple-600 dark:text-purple-400'
                          }`}>
                            {totalAiRemarksCount}
                          </span>
                        </button>

                        {/* CPS Excess ("CPS:") - простая картка статыстыкі */}
                        <div
                          className={`py-0.5 px-1.5 rounded-md flex items-baseline gap-1 border leading-none select-none ${
                            theme === 'dark'
                              ? 'bg-slate-950/50 border-slate-800/70'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                          title="Колькасць перавышэнняў CPS (> 20 сімв/сек)"
                        >
                          <span className={`text-[7.5px] font-bold tracking-wider leading-none ${
                            theme === 'dark' ? 'text-slate-400' : 'text-slate-500'
                          }`}>
                            CPS:
                          </span>
                          <span className="text-[10.5px] font-bold font-mono leading-none text-amber-600 dark:text-amber-400">
                            {cpsExcessCount}
                          </span>
                        </div>

                        {/* Errors ("памылкі:") */}
                        <button
                          type="button"
                          disabled={!autoSpellCheck}
                          onClick={() => {
                            if (!autoSpellCheck) return;
                            handleToggleQuickFilter('errors');
                          }}
                          className={`py-0.5 px-1.5 rounded-md flex items-baseline gap-1 border leading-none transition-all select-none ${
                            !autoSpellCheck
                              ? theme === 'dark'
                                ? 'bg-slate-950/40 border-slate-800/50 opacity-40 cursor-not-allowed text-slate-500'
                                : 'bg-slate-100/70 border-slate-300/60 opacity-50 cursor-not-allowed text-slate-400'
                              : quickFilter === 'errors'
                              ? theme === 'dark'
                                ? 'bg-purple-950/90 border-purple-500 text-purple-200 ring-1 ring-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)] cursor-pointer active:scale-95'
                                : 'bg-purple-100 border-purple-500 text-purple-900 ring-1 ring-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.25)] cursor-pointer active:scale-95'
                              : theme === 'dark'
                              ? 'bg-slate-950/50 hover:bg-slate-900 border-slate-800/70 hover:border-red-500/50 cursor-pointer active:scale-95'
                              : 'bg-slate-50 hover:bg-red-50/50 border-slate-200 hover:border-red-300 cursor-pointer active:scale-95'
                          }`}
                          title={
                            !autoSpellCheck
                              ? 'Праверка правапісу выключана'
                              : quickFilter === 'errors'
                              ? 'Зняць фільтр (паказаны толькі карткі з чырвонымі памылкамі правапісу)'
                              : 'Фільтраваць па памылках (паказаць толькі карткі з чырвонымі арфаграфічнымі памылкамі)'
                          }
                        >
                          <span className={`text-[7.5px] font-bold tracking-wider leading-none ${
                            !autoSpellCheck
                              ? 'text-slate-500'
                              : quickFilter === 'errors'
                              ? 'text-purple-300 dark:text-purple-200'
                              : theme === 'dark'
                              ? 'text-slate-400'
                              : 'text-slate-500'
                          }`}>
                            памылкі:
                          </span>
                          {autoSpellCheck ? (
                            <div className="inline-flex items-baseline gap-0.5 font-mono text-[10.5px] font-bold leading-none">
                              <span className="text-amber-500 dark:text-amber-400 leading-none">
                                {yellowErrorsCount}
                              </span>
                              <span className="text-slate-400 font-normal leading-none text-[8.5px]">
                                -
                              </span>
                              <span className="text-red-600 dark:text-red-400 leading-none">
                                {redErrorsCount}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-500 font-mono text-[9px] leading-none">
                              —
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Autosave Status in Status Panel */}
                  <div className={`mt-1.5 pt-1.5 border-t flex items-center justify-between gap-1 text-[7.5px] ${
                    theme === 'dark' ? 'border-slate-800/80 text-slate-300' : 'border-slate-200 text-slate-700'
                  }`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Save
                        className={`h-2.5 w-2.5 shrink-0 transition-colors duration-200 ${
                          isSaving ? 'text-amber-400 animate-pulse' : 'text-emerald-500 stroke-[2.2]'
                        }`}
                      />
                      <div className="flex flex-col min-w-0 leading-tight">
                        <span className="font-bold text-[7px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Аўтазахаванне праекта:
                        </span>
                        <span className="truncate font-medium">
                          {isSaving ? (
                            <span className="text-amber-500 font-semibold">Захаванне змяненняў...</span>
                          ) : lastSavedTime ? (
                            <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                              Захавана ў {lastSavedTime}
                            </span>
                          ) : (
                            <span className="text-slate-500">Праект сінхранізаваны</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* GrammarDB Status & Trigger in Status Panel */}
                  <div className={`mt-1.5 pt-1.5 border-t flex items-center justify-between gap-1 text-[7.5px] ${
                    theme === 'dark' ? 'border-slate-800/80 text-slate-300' : 'border-slate-200 text-slate-700'
                  }`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Database className={`h-2.5 w-2.5 shrink-0 ${
                        grammarDbStatus.ready
                          ? 'text-emerald-400'
                          : grammarDbStatus.building
                            ? 'text-amber-400 animate-spin'
                            : 'text-slate-400'
                      }`} />
                      <div className="flex flex-col min-w-0 leading-tight">
                        <span className="font-bold text-[7px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Граматычная база (GrammarDB):
                        </span>
                        <span className="truncate font-medium">
                          {grammarDbStatus.ready ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              Гатовая ({grammarDbStatus.sizeMb ? grammarDbStatus.sizeMb + ' МБ, ' : ''}3.98M словаформаў, SQLite)
                            </span>
                          ) : grammarDbStatus.building ? (
                            <span className="text-amber-600 dark:text-amber-300 font-semibold">
                              Разгортванне: {grammarDbStatus.lastLog || 'спампоўка і індэксацыя...'}
                            </span>
                          ) : (
                            <span className="text-slate-500">Не разгорнутая (выкарыстоўваецца лакальны слоўнік)</span>
                          )}
                        </span>
                      </div>
                    </div>

                  </div>

                  {/* Verbum Offline Dictionaries Deployment Status */}
                  <div className={`mt-1 pt-1 border-t flex items-center justify-between gap-1 text-[7.5px] ${
                    theme === 'dark' ? 'border-slate-800/80 text-slate-300' : 'border-slate-200 text-slate-700'
                  }`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <BookOpen className={`h-3 w-3 shrink-0 ${
                        verbumDbStatus.ready
                          ? 'text-emerald-500 dark:text-emerald-400'
                          : verbumDbStatus.building
                            ? 'text-amber-400 animate-spin'
                            : 'text-slate-400'
                      }`} />
                      <div className="flex flex-col min-w-0 leading-tight">
                        <span className="font-bold text-[7px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Слоўнікі Verbum (аўтаномны рэзерв):
                        </span>
                        <span className="truncate font-medium">
                          {verbumDbStatus.ready ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                              Гатовы ({verbumDbStatus.sizeMb ? verbumDbStatus.sizeMb + ' МБ, ' : ''}{verbumDbStatus.articleCount ? (verbumDbStatus.articleCount / 1000).toFixed(0) + 'K арт.' : ''}) • рэзерв на выпадак збою verbum.by
                            </span>
                          ) : verbumDbStatus.building ? (
                            <span className="text-amber-600 dark:text-amber-300 font-semibold">
                              Разгортванне рэзерву: {verbumDbStatus.lastLog || 'спампоўка і індэксацыя...'}
                            </span>
                          ) : (
                            <span className="text-slate-500">Ініцыялізуецца пры запуску сервера...</span>
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Шчыры дзякуй: Выкарыстаныя крыніцы, версіі і спасылкі */}
                  <div className={`mt-1.5 pt-1.5 border-t flex flex-col gap-1 text-[7.5px] ${
                    theme === 'dark' ? 'border-slate-800/80 text-slate-300' : 'border-slate-200 text-slate-700'
                  }`}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Handshake className="h-3 w-3 shrink-0 text-amber-500 dark:text-amber-400" />
                      <span className="font-bold text-[7px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Шчыры дзякуй:
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 mt-0.5 max-h-48 overflow-y-auto pr-0.5 scrollbar-thin">
                      {/* 1. GrammarDB */}
                      <div className={`py-1 px-1.5 rounded-md border flex items-center justify-between gap-1.5 transition-colors ${
                        theme === 'dark' ? 'bg-slate-950/70 border-slate-800/90 hover:bg-slate-900/60' : 'bg-slate-50/90 border-slate-200 hover:bg-slate-100/90'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          <span className="font-bold text-[8px] text-indigo-600 dark:text-indigo-400 shrink-0">GrammarDB</span>
                          <span className={`px-1 py-0.2 rounded text-[6.5px] font-mono font-bold shrink-0 ${
                            theme === 'dark' ? 'bg-slate-800 text-slate-200 border border-slate-700' : 'bg-slate-200 text-slate-700'
                          }`}>v0.4.3</span>
                          <span className="text-slate-400 shrink-0 text-[7px]">–</span>
                          <span className="text-[7.5px] text-slate-600 dark:text-slate-200 font-medium truncate">
                            Граматычная база (3.98M словаформаў, SQLite)
                          </span>
                        </div>
                        <a
                          href="https://github.com/Belarus/GrammarDB"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[7.5px] font-semibold text-indigo-500 dark:text-indigo-400 hover:underline shrink-0"
                          title="Адкрыць рэпазіторый GrammarDB на GitHub"
                        >
                          <span>github</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>

                      {/* 2. BelG2P */}
                      <div className={`py-1 px-1.5 rounded-md border flex items-center justify-between gap-1.5 transition-colors ${
                        theme === 'dark' ? 'bg-slate-950/70 border-slate-800/90 hover:bg-slate-900/60' : 'bg-slate-50/90 border-slate-200 hover:bg-slate-100/90'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          <span className="font-bold text-[8px] text-emerald-600 dark:text-emerald-400 shrink-0">BelG2P</span>
                          <span className={`px-1 py-0.2 rounded text-[6.5px] font-mono font-bold shrink-0 ${
                            theme === 'dark' ? 'bg-slate-800 text-slate-200 border border-slate-700' : 'bg-slate-200 text-slate-700'
                          }`}>рухавік націскаў</span>
                          <span className="text-slate-400 shrink-0 text-[7px]">–</span>
                          <span className="text-[7.5px] text-slate-600 dark:text-slate-200 font-medium truncate">
                            Фанетычны канвертар і правілы націску
                          </span>
                        </div>
                        <a
                          href="https://github.com/Belarus/BelG2P"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[7.5px] font-semibold text-emerald-500 dark:text-emerald-400 hover:underline shrink-0"
                          title="Адкрыць рэпазіторый BelG2P на GitHub"
                        >
                          <span>github</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>

                      {/* 3. PravilnaBy */}
                      <div className={`py-1 px-1.5 rounded-md border flex items-center justify-between gap-1.5 transition-colors ${
                        theme === 'dark' ? 'bg-slate-950/70 border-slate-800/90 hover:bg-slate-900/60' : 'bg-slate-50/90 border-slate-200 hover:bg-slate-100/90'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          <span className="font-bold text-[8px] text-amber-600 dark:text-amber-400 shrink-0">PravilnaBy</span>
                          <span className={`px-1 py-0.2 rounded text-[6.5px] font-mono font-bold shrink-0 ${
                            theme === 'dark' ? 'bg-slate-800 text-slate-200 border border-slate-700' : 'bg-slate-200 text-slate-700'
                          }`}>v0.1.0</span>
                          <span className="text-slate-400 shrink-0 text-[7px]">–</span>
                          <span className="text-[7.5px] text-slate-600 dark:text-slate-200 font-medium truncate">
                            Правілы і алгарытмы беларускага правапісу
                          </span>
                        </div>
                        <a
                          href="https://github.com/alroniks/pravilnaby"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[7.5px] font-semibold text-amber-500 dark:text-amber-400 hover:underline shrink-0"
                          title="Адкрыць рэпазіторый PravilnaBy на GitHub"
                        >
                          <span>github</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>

                      {/* 4. Hunspell-BE */}
                      <div className={`py-1 px-1.5 rounded-md border flex items-center justify-between gap-1.5 transition-colors ${
                        theme === 'dark' ? 'bg-slate-950/70 border-slate-800/90 hover:bg-slate-900/60' : 'bg-slate-50/90 border-slate-200 hover:bg-slate-100/90'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          <span className="font-bold text-[8px] text-sky-600 dark:text-sky-400 shrink-0">Hunspell-BE</span>
                          <span className={`px-1 py-0.2 rounded text-[6.5px] font-mono font-bold shrink-0 ${
                            theme === 'dark' ? 'bg-slate-800 text-slate-200 border border-slate-700' : 'bg-slate-200 text-slate-700'
                          }`}>v0.5.2</span>
                          <span className="text-slate-400 shrink-0 text-[7px]">–</span>
                          <span className="text-[7.5px] text-slate-600 dark:text-slate-200 font-medium truncate">
                            Пакет праверкі арфаграфіі (RZR team / BNKorpus.info)
                          </span>
                        </div>
                        <a
                          href="https://spell.by-reservation.com/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[7.5px] font-semibold text-sky-500 dark:text-sky-400 hover:underline shrink-0"
                          title="Адкрыць сайт spell.by-reservation.com"
                        >
                          <span>сайт</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>

                      {/* 5. BNKorpus */}
                      <div className={`py-1 px-1.5 rounded-md border flex items-center justify-between gap-1.5 transition-colors ${
                        theme === 'dark' ? 'bg-slate-950/70 border-slate-800/90 hover:bg-slate-900/60' : 'bg-slate-50/90 border-slate-200 hover:bg-slate-100/90'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          <span className="font-bold text-[8px] text-purple-600 dark:text-purple-400 shrink-0">БНКорпус</span>
                          <span className={`px-1 py-0.2 rounded text-[6.5px] font-mono font-bold shrink-0 ${
                            theme === 'dark' ? 'bg-slate-800 text-slate-200 border border-slate-700' : 'bg-slate-200 text-slate-700'
                          }`}>bnkorpus.info</span>
                          <span className="text-slate-400 shrink-0 text-[7px]">–</span>
                          <span className="text-[7.5px] text-slate-600 dark:text-slate-200 font-medium truncate">
                            Беларускі N-корпус (націскі і частата)
                          </span>
                        </div>
                        <a
                          href="https://bnkorpus.info"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[7.5px] font-semibold text-purple-500 dark:text-purple-400 hover:underline shrink-0"
                          title="Адкрыць сайт Беларускага N-корпуса"
                        >
                          <span>сайт</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>

                      {/* 6. Verbum.by */}
                      <div className={`py-1 px-1.5 rounded-md border flex items-center justify-between gap-1.5 transition-colors ${
                        theme === 'dark' ? 'bg-slate-950/70 border-slate-800/90 hover:bg-slate-900/60' : 'bg-slate-50/90 border-slate-200 hover:bg-slate-100/90'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          <span className="font-bold text-[8px] text-rose-600 dark:text-rose-400 shrink-0">Verbum.by</span>
                          <span className={`px-1 py-0.2 rounded text-[6.5px] font-mono font-bold shrink-0 ${
                            theme === 'dark' ? 'bg-slate-800 text-slate-200 border border-slate-700' : 'bg-slate-200 text-slate-700'
                          }`}>verbum.by</span>
                          <span className="text-slate-400 shrink-0 text-[7px]">–</span>
                          <span className="text-[7.5px] text-slate-600 dark:text-slate-200 font-medium truncate">
                            Адкрытыя слоўнікі беларускай мовы (ТСБЛМ, ТСБМ, ЭСБМ, БРС і інш.)
                          </span>
                        </div>
                        <a
                          href="https://verbum.by"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[7.5px] font-semibold text-rose-500 dark:text-rose-400 hover:underline shrink-0"
                          title="Адкрыць сайт verbum.by"
                        >
                          <span>сайт</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>

                      {/* 7. Corpus.by */}
                      <div className={`py-1 px-1.5 rounded-md border flex items-center justify-between gap-1.5 transition-colors ${
                        theme === 'dark' ? 'bg-slate-950/70 border-slate-800/90 hover:bg-slate-900/60' : 'bg-slate-50/90 border-slate-200 hover:bg-slate-100/90'
                      }`}>
                        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                          <span className="font-bold text-[8px] text-teal-600 dark:text-teal-400 shrink-0">Corpus.by</span>
                          <span className={`px-1 py-0.2 rounded text-[6.5px] font-mono font-bold shrink-0 ${
                            theme === 'dark' ? 'bg-slate-800 text-slate-200 border border-slate-700' : 'bg-slate-200 text-slate-700'
                          }`}>голас «Алесь»</span>
                          <span className="text-slate-400 shrink-0 text-[7px]">–</span>
                          <span className="text-[7.5px] text-slate-600 dark:text-slate-200 font-medium truncate">
                            API Corpus.by (голас «Алесь»)
                          </span>
                        </div>
                        <a
                          href="https://corpus.by/TextToSpeechBelarusianPy/?lang=be"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-0.5 text-[7.5px] font-semibold text-teal-500 dark:text-teal-400 hover:underline shrink-0"
                          title="Адкрыць сайт corpus.by (сінтэзатар маўлення Py)"
                        >
                          <span>сайт</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: History of events (Exactly 50% width on md) */}
                <div className={`border rounded-lg p-2 flex flex-col gap-1.5 min-h-[65px] ${
                  theme === 'dark'
                    ? 'bg-slate-900/40 border-slate-900/60'
                    : 'bg-white border-slate-200 shadow-2xs'
                }`}>
                  <div className={`flex items-center justify-between border-b pb-0.5 ${
                    theme === 'dark' ? 'border-slate-900/40' : 'border-slate-200'
                  }`}>
                    <span className={`font-bold uppercase tracking-wider text-[7px] ${
                      theme === 'dark' ? 'text-slate-500' : 'text-slate-600'
                    }`}>Папярэднія дзеянні ({messagesHistory.length}):</span>
                    {messagesHistory.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMessagesHistory([]);
                        }}
                        className={`text-[7px] transition-colors font-bold px-1 py-0.2 rounded border cursor-pointer ${
                          theme === 'dark'
                            ? 'text-red-400 hover:text-red-300 bg-red-950/20 hover:bg-red-950/40 border-red-500/10'
                            : 'text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border-red-200'
                        }`}
                      >
                        ачысціць гісторыю
                      </button>
                    )}
                  </div>
                  
                  <div className={`flex-1 min-h-0 max-h-[312px] sm:max-h-[312px] md:max-h-[312px] overflow-y-auto pr-1 flex flex-col gap-1 scrollbar-thin ${
                    theme === 'dark' ? 'scrollbar-thumb-slate-850' : 'scrollbar-thumb-slate-300'
                  } scrollbar-track-transparent`}>
                    {messagesHistory.length > 0 ? (
                      messagesHistory.map((item) => (
                        <div key={item.id} className={`p-0.5 px-1 rounded border flex items-center justify-between gap-2 text-[8px] shrink-0 ${
                          theme === 'dark'
                            ? 'bg-slate-950/30 border-slate-850/45'
                            : 'bg-slate-50 border-slate-200'
                        }`}>
                          <div className="flex items-center gap-1.5 overflow-hidden">
                            <span className={`font-mono text-[7.5px] shrink-0 ${
                              theme === 'dark' ? 'text-slate-550' : 'text-slate-500'
                            }`}>{item.timestamp}</span>
                            <p className={`truncate font-medium ${
                              theme === 'dark' ? 'text-slate-300' : 'text-slate-800'
                            }`}>{item.message}</p>
                          </div>
                          <span className={`px-1 rounded font-bold text-[6.5px] uppercase tracking-wide shrink-0 ${
                            item.type === 'success'
                              ? theme === 'dark' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-100 text-emerald-800'
                              : item.type === 'error'
                                ? theme === 'dark' ? 'bg-red-500/10 text-red-400' : 'bg-red-100 text-red-800'
                                : theme === 'dark' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-100 text-indigo-800'
                          }`}>
                            {item.type}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className={`text-center py-1 text-[9px] italic flex items-center justify-center h-full ${
                        theme === 'dark' ? 'text-slate-650' : 'text-slate-500'
                      }`}>
                        Гісторыя пустая.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>
          )}
        </div>
      </footer>
      <DuplicateTabModal
        isOpen={isDuplicateTab}
        onTakeOver={handleTakeOverTab}
        theme={theme}
      />

      {/* Workspace Restoration Screen / Overlay */}
      {!isRestored && (
        <div className="fixed inset-0 z-[999999] flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-md text-white select-none pointer-events-auto">
          <div className="flex flex-col items-center max-w-sm text-center px-6 py-8 rounded-2xl bg-slate-900/90 border border-slate-800 shadow-2xl">
            <div className="w-16 h-16 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shadow-inner">
              <Activity className="w-8 h-8 text-amber-400 animate-pulse" />
            </div>
            <div className="flex items-center gap-2.5 text-amber-400 font-bold text-base mb-2">
              <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
              <span>Аднаўленне працоўнай вобласці...</span>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Загрузка субцітраў, медыяфайлаў і налад праекта з лакальнага сховішча
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
