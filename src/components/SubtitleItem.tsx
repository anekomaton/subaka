/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { 
  Volume2, 
  Play, 
  Trash2, 
  Clock, 
  Timer, 
  ArrowRight,
  ChevronUp, 
  ChevronDown, 
  ChevronLeft,
  ChevronRight,
  Sparkles, 
  RefreshCw, 
  AlertCircle, 
  ArrowUp, 
  ArrowDown, 
  Download, 
  AudioLines, 
  Database,
  Eye,
  EyeOff,
  Check,
  BookOpen
} from 'lucide-react';
import { SubtitleEntry, ProofreadIssue } from '../types';
import { VerbumDictionaryModal } from './VerbumDictionaryModal';
import { srtTimeToSeconds, secondsToSrtTime, stripSrtTags, getBelarusianSpellTokens, getStoredIgnoredWords, getStoredIgnoredCapitalization, stripAccents } from '../utils/subtitleUtils';
import { stretchSingleAudio } from '../utils/audioMerger';
import { getPhoneticTranscription } from '../utils/phoneticConverter';
import { useGrammarDbStatus } from '../utils/useGrammarDbStatus';

interface SubtitleItemProps {
  entry: SubtitleEntry;
  index: number;
  isSelected: boolean;
  isOverlapping?: boolean;
  fontSize?: number;
  onSelect: () => void;
  onUpdate: (updated: Partial<SubtitleEntry>) => void;
  onDelete: () => void;
  onAddAfter: () => void;
  onAddBefore: () => void;
  onTranslateSingle: (id: string) => Promise<void>;
  onProofreadSingle?: (id: string) => Promise<void>;
  onSynthesizeSingle: (id: string, voiceName: string) => Promise<void>;
  selectedVoice: string;
  theme?: 'dark' | 'light';
  allActors?: string[];
  onGetActors?: () => string[];
  autoSpellCheck?: boolean;
  previousText?: string;
  hunspellRevision?: number;
}


export const SubtitleItem: React.FC<SubtitleItemProps> = ({
  entry,
  index,
  isSelected,
  isOverlapping = false,
  fontSize = 12,
  onSelect,
  onUpdate,
  onDelete,
  onAddAfter,
  onAddBefore,
  onTranslateSingle,
  onProofreadSingle,
  onSynthesizeSingle,
  selectedVoice,
  theme = 'dark',
  allActors = [],
  onGetActors,
  autoSpellCheck = true,
  previousText,
  hunspellRevision = 0,
}) => {
  const [isTranslating, setIsTranslating] = useState(false);
  const [isProofreadingCard, setIsProofreadingCard] = useState(false);
  const [activeIssue, setActiveIssue] = useState<ProofreadIssue | null>(null);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const isGenerating = isSynthesizing || !!entry.isGeneratingAudio;
  const audioInstanceRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const origTextareaRef = useRef<HTMLTextAreaElement>(null);
  const transTextareaRef = useRef<HTMLTextAreaElement>(null);
  const origBackdropRef = useRef<HTMLDivElement>(null);
  const transBackdropRef = useRef<HTMLDivElement>(null);
  const [isConvertingPhonetic, setIsConvertingPhonetic] = useState(false);
  const isGrammarDbReady = useGrammarDbStatus();

  // Verbum Dictionary modal state
  const [isVerbumModalOpen, setIsVerbumModalOpen] = useState(false);
  const [verbumSearchQuery, setVerbumSearchQuery] = useState('');
  const [verbumTargetField, setVerbumTargetField] = useState<'trans' | 'orig'>('trans');
  const [verbumSelectionRange, setVerbumSelectionRange] = useState<{ start: number; end: number } | undefined>(undefined);

  // Local state for text & translatedText to guarantee 0ms latency typing without re-rendering the whole app tree
  const [localText, setLocalText] = useState<string>(entry.text || '');
  const [localTransText, setLocalTransText] = useState<string>(entry.translatedText || '');
  const textDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const transDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastCommittedTextRef = useRef<string>(entry.text || '');
  const lastCommittedTransRef = useRef<string>(entry.translatedText || '');

  const [grammarDbResult, setGrammarDbResult] = useState<{
    query: string;
    stressed: string;
    phonetic?: string;
    found: boolean;
    forms: Array<{ word: string; stressed: string }>;
    dbReady?: boolean;
    errorMessage?: string;
    sourceField?: 'trans' | 'orig';
    selectionRange?: { start: number; end: number };
  } | null>(null);

  const [ignoredWords, setIgnoredWords] = useState<Set<string>>(() => getStoredIgnoredWords());
  const [ignoredCapitalization, setIgnoredCapitalization] = useState<Set<string>>(() => getStoredIgnoredCapitalization());

  // Listen for storage changes across tabs or other components
  React.useEffect(() => {
    const handleStorageChange = (e: StorageEvent | CustomEvent) => {
      if ('key' in e && e.key !== 'subaka_ignored_words' && e.key !== 'subaka_ignored_capitalization') return;
      const detailWord = (e as CustomEvent<{ word?: string }>)?.detail?.word;
      if (detailWord) {
        const cleanTrans = stripAccents(localTransText || '').toLowerCase();
        const cleanDetail = stripAccents(detailWord).toLowerCase().trim();
        const transHasWord = cleanTrans.includes(cleanDetail);
        const hasOpenPopup = Boolean(grammarDbResult);
        if (!transHasWord && !hasOpenPopup) {
          // Optimization: skip re-rendering if this card doesn't contain the modified ignored word
          return;
        }
      }
      setIgnoredWords(getStoredIgnoredWords());
      setIgnoredCapitalization(getStoredIgnoredCapitalization());
    };

    window.addEventListener('storage', handleStorageChange as EventListener);
    window.addEventListener('subaka-ignored-words-updated', handleStorageChange as EventListener);
    window.addEventListener('subaka-ignored-capitalization-updated', handleStorageChange as EventListener);
    return () => {
      window.removeEventListener('storage', handleStorageChange as EventListener);
      window.removeEventListener('subaka-ignored-words-updated', handleStorageChange as EventListener);
      window.removeEventListener('subaka-ignored-capitalization-updated', handleStorageChange as EventListener);
    };
  }, [localTransText, grammarDbResult]);

  const handleIgnoreWord = useCallback((wordToIgnore: string) => {
    const lower = stripAccents(wordToIgnore).toLowerCase().trim();
    if (!lower) return;
    const current = getStoredIgnoredWords();
    const updated = new Set(current);
    updated.add(lower);
    try {
      localStorage.setItem('subaka_ignored_words', JSON.stringify(Array.from(updated)));
    } catch {
      // ignore
    }
    setIgnoredWords(updated);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('subaka-ignored-words-updated', { detail: { word: lower, action: 'ignore' } }));
    }, 0);
  }, []);

  const handleUnignoreWord = useCallback((wordToUnignore: string) => {
    const lower = stripAccents(wordToUnignore).toLowerCase().trim();
    if (!lower) return;
    const current = getStoredIgnoredWords();
    const updated = new Set(current);
    updated.delete(lower);
    try {
      localStorage.setItem('subaka_ignored_words', JSON.stringify(Array.from(updated)));
    } catch {
      // ignore
    }
    setIgnoredWords(updated);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('subaka-ignored-words-updated', { detail: { word: lower, action: 'unignore' } }));
    }, 0);
  }, []);

  const handleIgnoreCapitalization = useCallback((wordToIgnore: string) => {
    const lower = stripAccents(wordToIgnore).toLowerCase().trim();
    if (!lower) return;
    const current = getStoredIgnoredCapitalization();
    const updated = new Set(current);
    updated.add(lower);
    try {
      localStorage.setItem('subaka_ignored_capitalization', JSON.stringify(Array.from(updated)));
    } catch {
      // ignore
    }
    setIgnoredCapitalization(updated);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('subaka-ignored-capitalization-updated', { detail: { word: lower, action: 'ignore' } }));
    }, 0);
  }, []);

  const handleUnignoreCapitalization = useCallback((wordToUnignore: string) => {
    const lower = stripAccents(wordToUnignore).toLowerCase().trim();
    if (!lower) return;
    const current = getStoredIgnoredCapitalization();
    const updated = new Set(current);
    updated.delete(lower);
    try {
      localStorage.setItem('subaka_ignored_capitalization', JSON.stringify(Array.from(updated)));
    } catch {
      // ignore
    }
    setIgnoredCapitalization(updated);
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('subaka-ignored-capitalization-updated', { detail: { word: lower, action: 'unignore' } }));
    }, 0);
  }, []);

  const [localHunspellRev, setLocalHunspellRev] = useState(0);
  React.useEffect(() => {
    const handleReady = () => {
      setLocalHunspellRev((v) => v + 1);
    };
    window.addEventListener('hunspell-ready', handleReady);
    return () => window.removeEventListener('hunspell-ready', handleReady);
  }, []);

  const effectiveHunspellRev = (hunspellRevision || 0) + localHunspellRev;

  // Calculate live Belarusian spell check tokens and error count (only when autoSpellCheck is enabled)
  // Evaluated synchronously with 0ms latency to keep highlights perfectly aligned with textarea during editing
  const spellCheckTokens = React.useMemo(() => {
    if (!autoSpellCheck || !localTransText) return [];
    return getBelarusianSpellTokens(localTransText, ignoredWords, { previousText, ignoredCapitalization });
  }, [autoSpellCheck, localTransText, ignoredWords, ignoredCapitalization, previousText, effectiveHunspellRev]);

  // Keep localText in sync if entry.text changes externally
  React.useEffect(() => {
    if (entry.text !== lastCommittedTextRef.current) {
      lastCommittedTextRef.current = entry.text || '';
      setLocalText(entry.text || '');
    }
  }, [entry.text]);

  // Keep localTransText in sync if entry.translatedText changes externally
  React.useEffect(() => {
    if (entry.translatedText !== lastCommittedTransRef.current) {
      lastCommittedTransRef.current = entry.translatedText || '';
      setLocalTransText(entry.translatedText || '');
    }
  }, [entry.translatedText]);

  // Clean up debounce timers on unmount & flush changes
  React.useEffect(() => {
    return () => {
      if (textDebounceRef.current) {
        clearTimeout(textDebounceRef.current);
      }
      if (transDebounceRef.current) {
        clearTimeout(transDebounceRef.current);
      }
    };
  }, []);

  const handleFixWord = useCallback((originalWord: string, replacement: string, field?: 'trans' | 'orig') => {
    const targetField = field || (localTransText.includes(originalWord) ? 'trans' : (localText.includes(originalWord) ? 'orig' : 'trans'));
    if (targetField === 'orig') {
      if (!localText) return;
      const regex = new RegExp(originalWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const updated = localText.replace(regex, replacement);
      setLocalText(updated);
      if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
      textDebounceRef.current = setTimeout(() => {
        lastCommittedTextRef.current = updated;
        onUpdate({ text: updated });
      }, 800);
    } else {
      if (!localTransText) return;
      const regex = new RegExp(originalWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      const updated = localTransText.replace(regex, replacement);
      setLocalTransText(updated);
      if (transDebounceRef.current) clearTimeout(transDebounceRef.current);
      transDebounceRef.current = setTimeout(() => {
        lastCommittedTransRef.current = updated;
        const remainingIssues = (entry.proofreadIssues || []).filter((i) => i.word !== originalWord);
        onUpdate({ translatedText: updated, proofreadIssues: remainingIssues.length > 0 ? remainingIssues : undefined });
      }, 800);
    }
  }, [localText, localTransText, onUpdate, entry.proofreadIssues]);

  const handleOrigTextChange = (newVal: string) => {
    setLocalText(newVal);
    if (textDebounceRef.current) clearTimeout(textDebounceRef.current);
    textDebounceRef.current = setTimeout(() => {
      lastCommittedTextRef.current = newVal;
      onUpdate({ text: newVal });
    }, 800);
  };

  const handleOrigTextBlur = () => {
    if (textDebounceRef.current) {
      clearTimeout(textDebounceRef.current);
      textDebounceRef.current = null;
    }
    if (localText !== (entry.text || '')) {
      lastCommittedTextRef.current = localText;
      onUpdate({ text: localText });
    }
  };

  const handleTransTextChange = (newVal: string) => {
    setLocalTransText(newVal);
    if (transDebounceRef.current) clearTimeout(transDebounceRef.current);
    transDebounceRef.current = setTimeout(() => {
      lastCommittedTransRef.current = newVal;
      onUpdate({ translatedText: newVal, proofreadIssues: undefined });
    }, 800);
  };

  const handleTransTextBlur = () => {
    if (transDebounceRef.current) {
      clearTimeout(transDebounceRef.current);
      transDebounceRef.current = null;
    }
    if (localTransText !== (entry.translatedText || '')) {
      lastCommittedTransRef.current = localTransText;
      onUpdate({ translatedText: localTransText, proofreadIssues: undefined });
    }
  };

  // Local state for actor input to guarantee 0ms latency typing without focus drops or CPU lag
  const [actorInput, setActorInput] = useState<string>(entry.actor || '');
  const [isActorDropdownOpen, setIsActorDropdownOpen] = useState(false);
  const [cachedActorsList, setCachedActorsList] = useState<string[]>([]);
  const [actorHighlightedIndex, setActorHighlightedIndex] = useState<number>(-1);
  const actorContainerRef = useRef<HTMLDivElement>(null);

  // Local state for original actor input
  const [origActorInput, setOrigActorInput] = useState<string>(entry.originalActor || '');
  const [isOrigActorDropdownOpen, setIsOrigActorDropdownOpen] = useState(false);
  const [cachedOrigActorsList, setCachedOrigActorsList] = useState<string[]>([]);
  const [origActorHighlightedIndex, setOrigActorHighlightedIndex] = useState<number>(-1);
  const origActorContainerRef = useRef<HTMLDivElement>(null);

  // Keep in sync when entry.actor changes externally
  React.useEffect(() => {
    setActorInput(entry.actor || '');
  }, [entry.actor]);

  // Keep in sync when entry.originalActor changes externally
  React.useEffect(() => {
    setOrigActorInput(entry.originalActor || '');
  }, [entry.originalActor]);

  const getActorQuery = (input: string) => {
    const parts = input.split(/[,;]+/);
    return (parts[parts.length - 1] || '').trim();
  };

  const isActorSelected = (actName: string, input: string) => {
    const trimmed = actName.trim().toLowerCase();
    const segments = input.split(/[,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
    return segments.includes(trimmed);
  };

  const renderHighlightedActorName = (name: string, query: string, highlightClass: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return name;
    const lowerName = name.toLowerCase();
    const lowerQuery = trimmedQuery.toLowerCase();
    const idx = lowerName.indexOf(lowerQuery);
    if (idx === -1) return name;

    const parts: React.ReactNode[] = [];
    let currentIdx = 0;
    let key = 0;

    while (currentIdx < name.length) {
      const matchIdx = lowerName.indexOf(lowerQuery, currentIdx);
      if (matchIdx === -1) {
        parts.push(<span key={key++}>{name.substring(currentIdx)}</span>);
        break;
      }
      if (matchIdx > currentIdx) {
        parts.push(<span key={key++}>{name.substring(currentIdx, matchIdx)}</span>);
      }
      parts.push(
        <span key={key++} className={highlightClass}>
          {name.substring(matchIdx, matchIdx + trimmedQuery.length)}
        </span>
      );
      currentIdx = matchIdx + trimmedQuery.length;
    }

    return parts;
  };

  // Load actors only when opening the dropdown (zero idle CPU cost)
  const openActorDropdown = () => {
    onSelect();
    const list = onGetActors ? onGetActors() : (allActors || []);
    setCachedActorsList(list);
    setIsActorDropdownOpen(true);
    setActorHighlightedIndex(-1);
  };

  const openOrigActorDropdown = () => {
    onSelect();
    const list = onGetActors ? onGetActors() : (allActors || []);
    setCachedOrigActorsList(list);
    setIsOrigActorDropdownOpen(true);
    setOrigActorHighlightedIndex(-1);
  };

  // Close actor dropdowns on outside click
  React.useEffect(() => {
    if (!isActorDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (actorContainerRef.current && !actorContainerRef.current.contains(e.target as Node)) {
        setIsActorDropdownOpen(false);
        setActorHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
    };
  }, [isActorDropdownOpen]);

  React.useEffect(() => {
    if (!isOrigActorDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (origActorContainerRef.current && !origActorContainerRef.current.contains(e.target as Node)) {
        setIsOrigActorDropdownOpen(false);
        setOrigActorHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
    };
  }, [isOrigActorDropdownOpen]);

  // Compute actors list: full list of roles, with matching roles prioritized on search
  const filteredActors = React.useMemo(() => {
    if (!isActorDropdownOpen || cachedActorsList.length === 0) return [];
    const query = getActorQuery(actorInput).toLowerCase();
    if (!query) return cachedActorsList;
    const matching = cachedActorsList.filter(a => a.toLowerCase().includes(query));
    const nonMatching = cachedActorsList.filter(a => !a.toLowerCase().includes(query));
    return [...matching, ...nonMatching];
  }, [isActorDropdownOpen, cachedActorsList, actorInput]);

  const filteredOrigActors = React.useMemo(() => {
    if (!isOrigActorDropdownOpen || cachedOrigActorsList.length === 0) return [];
    const query = getActorQuery(origActorInput).toLowerCase();
    if (!query) return cachedOrigActorsList;
    const matching = cachedOrigActorsList.filter(a => a.toLowerCase().includes(query));
    const nonMatching = cachedOrigActorsList.filter(a => !a.toLowerCase().includes(query));
    return [...matching, ...nonMatching];
  }, [isOrigActorDropdownOpen, cachedOrigActorsList, origActorInput]);

  const handleSelectActor = (selected: string) => {
    const trimmed = selected.trim();
    // If the input already had previous actors before the last comma/semicolon, append to them
    const lastDelimiterMatch = actorInput.match(/[,;]\s*[^,;]*$/);
    let finalActor = trimmed;
    if (lastDelimiterMatch && lastDelimiterMatch.index !== undefined) {
      const prefix = actorInput.substring(0, lastDelimiterMatch.index + 1).trim();
      finalActor = `${prefix} ${trimmed}`;
    }
    setActorInput(finalActor);
    onUpdate({ actor: finalActor });
    setIsActorDropdownOpen(false);
    setActorHighlightedIndex(-1);
  };

  const handleSelectOrigActor = (selected: string) => {
    const trimmed = selected.trim();
    const lastDelimiterMatch = origActorInput.match(/[,;]\s*[^,;]*$/);
    let finalActor = trimmed;
    if (lastDelimiterMatch && lastDelimiterMatch.index !== undefined) {
      const prefix = origActorInput.substring(0, lastDelimiterMatch.index + 1).trim();
      finalActor = `${prefix} ${trimmed}`;
    }
    setOrigActorInput(finalActor);
    onUpdate({ originalActor: finalActor });
    setIsOrigActorDropdownOpen(false);
    setOrigActorHighlightedIndex(-1);
  };

  const handleActorBlur = () => {
    const trimmed = actorInput.trim();
    if (trimmed !== (entry.actor || '')) {
      onUpdate({ actor: trimmed });
    }
  };

  const handleOrigActorBlur = () => {
    const trimmed = origActorInput.trim();
    if (trimmed !== (entry.originalActor || '')) {
      onUpdate({ originalActor: trimmed });
    }
  };

  const handleActorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isActorDropdownOpen) {
        setIsActorDropdownOpen(true);
        setActorHighlightedIndex(0);
      } else if (filteredActors.length > 0) {
        setActorHighlightedIndex(prev => (prev < filteredActors.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isActorDropdownOpen && filteredActors.length > 0) {
        setActorHighlightedIndex(prev => (prev > 0 ? prev - 1 : filteredActors.length - 1));
      }
    } else if (e.key === 'Enter') {
      if (isActorDropdownOpen && actorHighlightedIndex >= 0 && actorHighlightedIndex < filteredActors.length) {
        e.preventDefault();
        handleSelectActor(filteredActors[actorHighlightedIndex]);
      } else {
        setIsActorDropdownOpen(false);
        handleActorBlur();
        e.currentTarget.blur();
      }
    } else if (e.key === 'Escape') {
      if (isActorDropdownOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsActorDropdownOpen(false);
        setActorHighlightedIndex(-1);
      }
    }
  };

  const handleOrigActorKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOrigActorDropdownOpen) {
        setIsOrigActorDropdownOpen(true);
        setOrigActorHighlightedIndex(0);
      } else if (filteredOrigActors.length > 0) {
        setOrigActorHighlightedIndex(prev => (prev < filteredOrigActors.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOrigActorDropdownOpen && filteredOrigActors.length > 0) {
        setOrigActorHighlightedIndex(prev => (prev > 0 ? prev - 1 : filteredOrigActors.length - 1));
      }
    } else if (e.key === 'Enter') {
      if (isOrigActorDropdownOpen && origActorHighlightedIndex >= 0 && origActorHighlightedIndex < filteredOrigActors.length) {
        e.preventDefault();
        handleSelectOrigActor(filteredOrigActors[origActorHighlightedIndex]);
      } else {
        setIsOrigActorDropdownOpen(false);
        handleOrigActorBlur();
        e.currentTarget.blur();
      }
    } else if (e.key === 'Escape') {
      if (isOrigActorDropdownOpen) {
        e.preventDefault();
        e.stopPropagation();
        setIsOrigActorDropdownOpen(false);
        setOrigActorHighlightedIndex(-1);
      }
    }
  };
  const [isGrammarDbLoading, setIsGrammarDbLoading] = useState(false);

  // Close GrammarDB popup or AI Proofread popup when Escape key is pressed
  React.useEffect(() => {
    if (!grammarDbResult && !activeIssue) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (grammarDbResult) setGrammarDbResult(null);
        if (activeIssue) setActiveIssue(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [grammarDbResult, activeIssue]);

  const applyGrammarDbReplacement = (replacementWord: string) => {
    if (!replacementWord) return;

    if (grammarDbResult?.sourceField === 'orig') {
      const fullText = localText;
      let newText = fullText;
      if (grammarDbResult?.selectionRange && grammarDbResult.selectionRange.start >= 0 && grammarDbResult.selectionRange.end >= grammarDbResult.selectionRange.start) {
        const { start, end } = grammarDbResult.selectionRange;
        newText = fullText.substring(0, start) + replacementWord + fullText.substring(end);
      } else if (grammarDbResult?.query && fullText.includes(grammarDbResult.query)) {
        const idx = fullText.indexOf(grammarDbResult.query);
        newText = fullText.substring(0, idx) + replacementWord + fullText.substring(idx + grammarDbResult.query.length);
      } else {
        newText = fullText ? (fullText + ' ' + replacementWord) : replacementWord;
      }
      setLocalText(newText);
      lastCommittedTextRef.current = newText;
      onUpdate({ text: newText });
      setGrammarDbResult(null);
      setTimeout(() => {
        origTextareaRef.current?.focus();
      }, 50);
      return;
    }

    const fullText = localTransText;
    let newText = fullText;

    if (grammarDbResult?.selectionRange && grammarDbResult.selectionRange.start >= 0 && grammarDbResult.selectionRange.end >= grammarDbResult.selectionRange.start) {
      const { start, end } = grammarDbResult.selectionRange;
      newText = fullText.substring(0, start) + replacementWord + fullText.substring(end);
    } else if (grammarDbResult?.query && fullText.includes(grammarDbResult.query)) {
      const idx = fullText.indexOf(grammarDbResult.query);
      newText = fullText.substring(0, idx) + replacementWord + fullText.substring(idx + grammarDbResult.query.length);
    } else {
      newText = fullText ? (fullText + ' ' + replacementWord) : replacementWord;
    }

    setLocalTransText(newText);
    lastCommittedTransRef.current = newText;
    onUpdate({ translatedText: newText });
    setGrammarDbResult(null);

    setTimeout(() => {
      transTextareaRef.current?.focus();
    }, 50);
  };

  const handleGrammarDbSearch = async () => {
    const transTextarea = transTextareaRef.current;
    const origTextarea = origTextareaRef.current;
    const transText = localTransText;
    const origText = localText;

    let targetField: 'trans' | 'orig' = 'trans';
    let queryText = '';
    let selStart = -1;
    let selEnd = -1;

    // Helper to extract selected word from a textarea
    const extractSelectedFromTextarea = (textarea: HTMLTextAreaElement | null, fullText: string) => {
      if (!textarea) return null;
      const sStart = textarea.selectionStart;
      const sEnd = textarea.selectionEnd;
      if (sStart !== sEnd && sStart >= 0 && sEnd <= fullText.length) {
        const rawSelected = fullText.substring(sStart, sEnd);
        const match = rawSelected.match(/[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+/);
        if (match && match.index !== undefined) {
          return {
            query: match[0],
            start: sStart + match.index,
            end: sStart + match.index + match[0].length,
          };
        }
      }
      return null;
    };

    // Helper to extract word under cursor
    const extractCursorFromTextarea = (textarea: HTMLTextAreaElement | null, fullText: string) => {
      if (!textarea) return null;
      const cursor = textarea.selectionStart || 0;
      const before = fullText.slice(0, cursor);
      const after = fullText.slice(cursor);
      const matchBefore = before.match(/[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+$/);
      const matchAfter = after.match(/^[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+/);
      const wordBefore = matchBefore?.[0] || '';
      const wordAfter = matchAfter?.[0] || '';
      const start = cursor - wordBefore.length;
      const end = cursor + wordAfter.length;
      if (start < end) {
        const word = fullText.substring(start, end).trim();
        if (word && /[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]/.test(word)) {
          return {
            query: word,
            start,
            end,
          };
        }
      }
      return null;
    };

    // 1. Check if user explicitly selected a word range in translation or original
    const transSelection = extractSelectedFromTextarea(transTextarea, transText);
    const origSelection = extractSelectedFromTextarea(origTextarea, origText);

    if (transSelection && origSelection) {
      // Determine which textarea was focused/active
      if (document.activeElement === origTextarea) {
        targetField = 'orig';
        queryText = origSelection.query;
        selStart = origSelection.start;
        selEnd = origSelection.end;
      } else {
        targetField = 'trans';
        queryText = transSelection.query;
        selStart = transSelection.start;
        selEnd = transSelection.end;
      }
    } else if (transSelection) {
      targetField = 'trans';
      queryText = transSelection.query;
      selStart = transSelection.start;
      selEnd = transSelection.end;
    } else if (origSelection) {
      targetField = 'orig';
      queryText = origSelection.query;
      selStart = origSelection.start;
      selEnd = origSelection.end;
    }

    // 2. If no range selection, check cursor position in the active textarea
    if (!queryText) {
      if (document.activeElement === origTextarea) {
        const origCursor = extractCursorFromTextarea(origTextarea, origText);
        if (origCursor) {
          targetField = 'orig';
          queryText = origCursor.query;
          selStart = origCursor.start;
          selEnd = origCursor.end;
        }
      } else if (document.activeElement === transTextarea) {
        const transCursor = extractCursorFromTextarea(transTextarea, transText);
        if (transCursor) {
          targetField = 'trans';
          queryText = transCursor.query;
          selStart = transCursor.start;
          selEnd = transCursor.end;
        }
      }
    }

    // 3. Fallback: if nothing is selected/focused, search in translation (first word) or original (first word)
    if (!queryText) {
      const matchTransWord = transText.match(/[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+/);
      if (matchTransWord && matchTransWord.index !== undefined) {
        targetField = 'trans';
        selStart = matchTransWord.index;
        selEnd = matchTransWord.index + matchTransWord[0].length;
        queryText = matchTransWord[0];
      } else {
        const matchOrigWord = origText.match(/[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+/);
        if (matchOrigWord && matchOrigWord.index !== undefined) {
          targetField = 'orig';
          selStart = matchOrigWord.index;
          selEnd = matchOrigWord.index + matchOrigWord[0].length;
          queryText = matchOrigWord[0];
        }
      }
    }

    if (!queryText) {
      setGrammarDbResult({
        query: '',
        clean: '',
        stressed: '',
        found: false,
        forms: [],
        errorMessage: 'Вылучыце слова ў полі арыгінала ці перакладу альбо пастаўце курсор на слова для пошуку ў Граматычнай базе.'
      } as any);
      return;
    }

    const savedRange = (selStart >= 0 && selEnd >= selStart) ? { start: selStart, end: selEnd } : undefined;

    setIsGrammarDbLoading(true);
    try {
      const res = await fetch('/api/grammardb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryText }),
      });
      if (res.ok) {
        const data = await res.json();
        setGrammarDbResult({
          ...data,
          sourceField: targetField,
          selectionRange: savedRange,
        });
      } else {
        setGrammarDbResult({
          query: queryText,
          stressed: '',
          found: false,
          forms: [],
          errorMessage: 'Граматычная база яшчэ рыхтуецца або недаступная на серверы. Паспрабуйце яшчэ раз праз момант.',
          sourceField: targetField,
          selectionRange: savedRange
        });
      }
    } catch (e) {
      console.error('GrammarDB search error:', e);
      setGrammarDbResult({
        query: queryText,
        stressed: '',
        found: false,
        forms: [],
        errorMessage: 'Памылка злучэння з серверам. Паспрабуйце яшчэ раз.',
        sourceField: targetField,
        selectionRange: savedRange
      });
    } finally {
      setIsGrammarDbLoading(false);
    }
  };

  const handleVerbumSearch = () => {
    const transTextarea = transTextareaRef.current;
    const origTextarea = origTextareaRef.current;
    const transText = localTransText;
    const origText = localText;

    let targetField: 'trans' | 'orig' = 'trans';
    let queryText = '';
    let selStart = -1;
    let selEnd = -1;

    // Helper to extract selected word from a textarea
    const extractSelectedFromTextarea = (textarea: HTMLTextAreaElement | null, fullText: string) => {
      if (!textarea) return null;
      const sStart = textarea.selectionStart;
      const sEnd = textarea.selectionEnd;
      if (sStart !== sEnd && sStart >= 0 && sEnd <= fullText.length) {
        const rawSelected = fullText.substring(sStart, sEnd);
        const match = rawSelected.match(/[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+/);
        if (match && match.index !== undefined) {
          return {
            query: match[0],
            start: sStart + match.index,
            end: sStart + match.index + match[0].length,
          };
        }
      }
      return null;
    };

    // Helper to extract word under cursor
    const extractCursorFromTextarea = (textarea: HTMLTextAreaElement | null, fullText: string) => {
      if (!textarea) return null;
      const cursor = textarea.selectionStart || 0;
      const before = fullText.slice(0, cursor);
      const after = fullText.slice(cursor);
      const matchBefore = before.match(/[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+$/);
      const matchAfter = after.match(/^[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+/);
      const wordBefore = matchBefore?.[0] || '';
      const wordAfter = matchAfter?.[0] || '';
      const start = cursor - wordBefore.length;
      const end = cursor + wordAfter.length;
      if (start < end) {
        const word = fullText.substring(start, end).trim();
        if (word && /[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]/.test(word)) {
          return {
            query: word,
            start,
            end,
          };
        }
      }
      return null;
    };

    // 1. Check selected range
    const transSelection = extractSelectedFromTextarea(transTextarea, transText);
    const origSelection = extractSelectedFromTextarea(origTextarea, origText);

    if (transSelection && origSelection) {
      if (document.activeElement === origTextarea) {
        targetField = 'orig';
        queryText = origSelection.query;
        selStart = origSelection.start;
        selEnd = origSelection.end;
      } else {
        targetField = 'trans';
        queryText = transSelection.query;
        selStart = transSelection.start;
        selEnd = transSelection.end;
      }
    } else if (transSelection) {
      targetField = 'trans';
      queryText = transSelection.query;
      selStart = transSelection.start;
      selEnd = transSelection.end;
    } else if (origSelection) {
      targetField = 'orig';
      queryText = origSelection.query;
      selStart = origSelection.start;
      selEnd = origSelection.end;
    }

    // 2. Cursor in active textarea
    if (!queryText) {
      if (document.activeElement === origTextarea) {
        const origCursor = extractCursorFromTextarea(origTextarea, origText);
        if (origCursor) {
          targetField = 'orig';
          queryText = origCursor.query;
          selStart = origCursor.start;
          selEnd = origCursor.end;
        }
      } else if (document.activeElement === transTextarea) {
        const transCursor = extractCursorFromTextarea(transTextarea, transText);
        if (transCursor) {
          targetField = 'trans';
          queryText = transCursor.query;
          selStart = transCursor.start;
          selEnd = transCursor.end;
        }
      }
    }

    // 3. Fallback: first word in translation or original
    if (!queryText) {
      const matchTransWord = transText.match(/[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+/);
      if (matchTransWord && matchTransWord.index !== undefined) {
        targetField = 'trans';
        selStart = matchTransWord.index;
        selEnd = matchTransWord.index + matchTransWord[0].length;
        queryText = matchTransWord[0];
      } else {
        const matchOrigWord = origText.match(/[а-яёіўґА-ЯЁІЎҐa-zA-Z'’\u0301\+]+/);
        if (matchOrigWord && matchOrigWord.index !== undefined) {
          targetField = 'orig';
          selStart = matchOrigWord.index;
          selEnd = matchOrigWord.index + matchOrigWord[0].length;
          queryText = matchOrigWord[0];
        }
      }
    }

    // Clean accents if any for initial query
    const cleanWord = stripAccents(queryText).trim();
    setVerbumSearchQuery(cleanWord);
    setVerbumTargetField(targetField);
    setVerbumSelectionRange(selStart >= 0 && selEnd >= selStart ? { start: selStart, end: selEnd } : undefined);
    setIsVerbumModalOpen(true);
  };

  const handleApplyVerbumWord = (wordToApply: string) => {
    if (!wordToApply) return;
    if (verbumTargetField === 'orig') {
      const fullText = localText;
      let newText = fullText;
      if (verbumSelectionRange && verbumSelectionRange.start >= 0 && verbumSelectionRange.end >= verbumSelectionRange.start) {
        const { start, end } = verbumSelectionRange;
        newText = fullText.substring(0, start) + wordToApply + fullText.substring(end);
      } else if (verbumSearchQuery && fullText.includes(verbumSearchQuery)) {
        const idx = fullText.indexOf(verbumSearchQuery);
        newText = fullText.substring(0, idx) + wordToApply + fullText.substring(idx + verbumSearchQuery.length);
      } else {
        newText = fullText ? (fullText + ' ' + wordToApply) : wordToApply;
      }
      setLocalText(newText);
      lastCommittedTextRef.current = newText;
      onUpdate({ text: newText });
      setTimeout(() => {
        origTextareaRef.current?.focus();
      }, 50);
      return;
    }

    const fullText = localTransText;
    let newText = fullText;
    if (verbumSelectionRange && verbumSelectionRange.start >= 0 && verbumSelectionRange.end >= verbumSelectionRange.start) {
      const { start, end } = verbumSelectionRange;
      newText = fullText.substring(0, start) + wordToApply + fullText.substring(end);
    } else if (verbumSearchQuery && fullText.includes(verbumSearchQuery)) {
      const idx = fullText.indexOf(verbumSearchQuery);
      newText = fullText.substring(0, idx) + wordToApply + fullText.substring(idx + verbumSearchQuery.length);
    } else {
      newText = fullText ? (fullText + ' ' + wordToApply) : wordToApply;
    }
    setLocalTransText(newText);
    lastCommittedTransRef.current = newText;
    onUpdate({ translatedText: newText });
    setTimeout(() => {
      transTextareaRef.current?.focus();
    }, 50);
  };

  const handleConvertPhonetic = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const orig = stripSrtTags(localText).trim();
    if (!orig) return;
    setIsConvertingPhonetic(true);
    try {
      const phonetic = await getPhoneticTranscription(orig);
      if (phonetic) {
        setLocalTransText(phonetic);
        lastCommittedTransRef.current = phonetic;
        onUpdate({ translatedText: phonetic });
      }
    } catch (err) {
      console.error("Failed to convert phonetics:", err);
    } finally {
      setIsConvertingPhonetic(false);
    }
  };

  // Only sync activeIssue if the user has ALREADY opened the modal (do NOT auto-open on mount or seek)
  React.useEffect(() => {
    if (activeIssue) {
      if (!entry.proofreadIssues || entry.proofreadIssues.length === 0) {
        setActiveIssue(null);
      } else if (!entry.proofreadIssues.some((i) => i.word === activeIssue.word)) {
        setActiveIssue(entry.proofreadIssues[0] || null);
      }
    }
  }, [entry.proofreadIssues, activeIssue]);

  const [activeIssuePos, setActiveIssuePos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateActiveIssuePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const isLg = window.innerWidth >= 1024;
    const maxTop = Math.max(70, window.innerHeight - 360);
    if (isLg) {
      // Position to the right, on the player side with wider width for buttons
      const targetLeft = rect.right + 14;
      const desiredWidth = 440;
      const availableWidth = Math.max(320, window.innerWidth - targetLeft - 20);
      const finalWidth = Math.min(desiredWidth, availableWidth);
      const finalLeft = Math.min(window.innerWidth - finalWidth - 16, Math.max(16, targetLeft));
      const finalTop = Math.max(70, Math.min(maxTop, rect.top));
      setActiveIssuePos({ top: finalTop, left: finalLeft, width: finalWidth });
    } else {
      // Small screens: float safely in visible area below or over the card
      const finalWidth = Math.min(Math.max(340, rect.width), window.innerWidth - 24);
      const finalLeft = Math.max(12, Math.min(window.innerWidth - finalWidth - 12, rect.left));
      const finalTop = Math.max(70, Math.min(maxTop, rect.bottom + 8));
      setActiveIssuePos({ top: finalTop, left: finalLeft, width: finalWidth });
    }
  }, []);

  useEffect(() => {
    if (!activeIssue) {
      setActiveIssuePos(null);
      return;
    }
    updateActiveIssuePosition();
    const handleScrollOrResize = () => {
      updateActiveIssuePosition();
    };
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [activeIssue, updateActiveIssuePosition]);

  const [grammarDbPos, setGrammarDbPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const updateGrammarDbPosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const isLg = window.innerWidth >= 1024;
    const maxTop = Math.max(70, window.innerHeight - 520);
    if (isLg) {
      // Position to the right, on the player side
      const targetLeft = rect.right + 14;
      const desiredWidth = 420;
      const availableWidth = Math.max(280, window.innerWidth - targetLeft - 20);
      const finalWidth = Math.min(desiredWidth, availableWidth);
      const finalLeft = Math.min(window.innerWidth - finalWidth - 16, Math.max(16, targetLeft));
      const finalTop = Math.max(70, Math.min(maxTop, rect.top));
      setGrammarDbPos({ top: finalTop, left: finalLeft, width: finalWidth });
    } else {
      // Small screens: float safely in visible area
      const finalWidth = Math.min(Math.max(300, rect.width), window.innerWidth - 32);
      const finalLeft = Math.max(16, Math.min(window.innerWidth - finalWidth - 16, rect.left));
      const finalTop = Math.max(70, Math.min(maxTop, rect.bottom + 8));
      setGrammarDbPos({ top: finalTop, left: finalLeft, width: finalWidth });
    }
  }, []);

  useEffect(() => {
    if (!grammarDbResult) {
      setGrammarDbPos(null);
      return;
    }
    updateGrammarDbPosition();
    const handleScrollOrResize = () => {
      updateGrammarDbPosition();
    };
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [grammarDbResult, updateGrammarDbPosition]);

  const applyFormatTag = (
    field: 'text' | 'translatedText',
    tag: 'b' | 'i' | 'u',
    ref: React.RefObject<HTMLTextAreaElement>
  ) => {
    const textarea = ref.current;
    const currentVal = field === 'text' ? localText : localTransText;
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;

    if (!textarea) {
      const newVal = currentVal + `${openTag}${closeTag}`;
      if (field === 'text') {
        setLocalText(newVal);
        lastCommittedTextRef.current = newVal;
      } else {
        setLocalTransText(newVal);
        lastCommittedTransRef.current = newVal;
      }
      onUpdate({ [field]: newVal });
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = currentVal.substring(start, end);

    let newVal = '';
    let newStart = start;
    let newEnd = end;

    if (selectedText) {
      const wrapped = `${openTag}${selectedText}${closeTag}`;
      newVal = currentVal.substring(0, start) + wrapped + currentVal.substring(end);
      newStart = start;
      newEnd = start + wrapped.length;
    } else {
      const inserted = `${openTag}${closeTag}`;
      newVal = currentVal.substring(0, start) + inserted + currentVal.substring(end);
      newStart = start + openTag.length;
      newEnd = start + openTag.length;
    }

    if (field === 'text') {
      setLocalText(newVal);
      lastCommittedTextRef.current = newVal;
    } else {
      setLocalTransText(newVal);
      lastCommittedTransRef.current = newVal;
    }
    onUpdate({ [field]: newVal });

    setTimeout(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(newStart, newEnd);
      }
    }, 10);
  };

  const applyAccentMark = (
    field: 'text' | 'translatedText',
    ref: React.RefObject<HTMLTextAreaElement>
  ) => {
    const textarea = ref.current;
    const currentVal = field === 'text' ? localText : localTransText;
    const accentChar = '\u0301';

    if (!textarea) {
      const newVal = currentVal + accentChar;
      if (field === 'text') {
        setLocalText(newVal);
        lastCommittedTextRef.current = newVal;
      } else {
        setLocalTransText(newVal);
        lastCommittedTransRef.current = newVal;
      }
      onUpdate({ [field]: newVal });
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    let insertPos = end;

    if (start < end) {
      // Text or character is highlighted
      insertPos = end;
    } else {
      // Cursor is at a single point (start === end)
      if (start === 0 && currentVal.length > 0) {
        // If cursor is at the very beginning (before 1st char),
        // place accent mark AFTER the first character so it combines properly (e.g. 'а' + '\u0301' = 'а́')
        let charIndex = 0;
        if (currentVal.startsWith('<')) {
          const closingTagEnd = currentVal.indexOf('>') + 1;
          if (closingTagEnd > 0 && closingTagEnd < currentVal.length) {
            charIndex = closingTagEnd;
          }
        }
        insertPos = Math.min(currentVal.length, charIndex + 1);
      } else {
        insertPos = start;
      }
    }

    // Prevent duplicate accent mark right at insertPos
    if (insertPos > 0 && currentVal[insertPos - 1] === accentChar) {
      return;
    }

    const newVal = currentVal.substring(0, insertPos) + accentChar + currentVal.substring(insertPos);
    const newCursorPos = insertPos + accentChar.length;

    if (field === 'text') {
      setLocalText(newVal);
      lastCommittedTextRef.current = newVal;
    } else {
      setLocalTransText(newVal);
      lastCommittedTransRef.current = newVal;
    }
    onUpdate({ [field]: newVal });

    setTimeout(() => {
      if (ref.current) {
        ref.current.focus();
        ref.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 10);
  };

  // Helper to compute duration string (HH:MM:SS,MS) from startTime & endTime
  const calcDurationStr = (startStr: string, endStr: string) => {
    const startSec = srtTimeToSeconds(startStr);
    const endSec = srtTimeToSeconds(endStr);
    const durSec = Math.max(0, endSec - startSec);
    return secondsToSrtTime(durSec);
  };

  const [durationInput, setDurationInput] = useState<string>(() =>
    calcDurationStr(entry.startTime, entry.endTime)
  );
  const [isEditingDuration, setIsEditingDuration] = useState<boolean>(false);

  // Sync duration string when entry timestamps change
  React.useEffect(() => {
    if (!isEditingDuration) {
      setDurationInput(calcDurationStr(entry.startTime, entry.endTime));
    }
  }, [entry.startTime, entry.endTime, isEditingDuration]);

  const handleDurationInputChange = (val: string) => {
    setDurationInput(val);
    const durSec = srtTimeToSeconds(val);
    if (durSec >= 0) {
      const startSec = srtTimeToSeconds(entry.startTime);
      const newEndSec = startSec + durSec;
      const newEndTime = secondsToSrtTime(newEndSec);
      onUpdate({ endTime: newEndTime });
    }
  };

  const handleDurationBlur = () => {
    setIsEditingDuration(false);
    setDurationInput(calcDurationStr(entry.startTime, entry.endTime));
  };

  const adjustDuration = (msDelta: number) => {
    const startSec = srtTimeToSeconds(entry.startTime);
    const currentEndSec = srtTimeToSeconds(entry.endTime);
    const currentDurSec = Math.max(0, currentEndSec - startSec);
    const newDurSec = Math.max(0, currentDurSec + msDelta / 1000);
    const newEndSec = startSec + newDurSec;
    onUpdate({ endTime: secondsToSrtTime(newEndSec) });
  };

  // CPS (Characters Per Second) calculation strictly for translated text
  const cpsInfo = React.useMemo(() => {
    const startSec = srtTimeToSeconds(entry.startTime);
    const endSec = srtTimeToSeconds(entry.endTime);
    const durSec = Math.max(0.1, endSec - startSec);
    const rawText = localTransText !== undefined && localTransText !== '' ? localTransText : (entry.translatedText || '');
    const cleanText = stripSrtTags(rawText).replace(/\u0301/g, '').trim();
    const charCount = cleanText.length;
    if (charCount === 0) return { cps: 0, isTooFast: false };
    const cps = Number((charCount / durSec).toFixed(1));
    return {
      cps,
      isTooFast: cps > 20,
    };
  }, [entry.startTime, entry.endTime, localTransText, entry.translatedText]);

  // Auto-scroll is handled safely via virtualizer in App.tsx

  // Playback of generated line TTS
  const handlePlayAudio = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    
    if (audioInstanceRef.current) {
      audioInstanceRef.current.pause();
      audioInstanceRef.current = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    if (entry.audioUrl) {
      const audio = new Audio(entry.audioUrl);
      audioInstanceRef.current = audio;
      audio.playbackRate = entry.audioSpeed || 1.0;
      audio.play().catch((err) => {
        if (err.name === 'AbortError' || err.message?.includes('interrupted') || err.message?.includes('pause')) {
          console.log("Synthetic line audio playback interrupted as expected.");
        } else {
          console.error("Error playing synthetic line:", err);
        }
      });
    } else {
      // Browser speech synthesis fallback (natural human speech)
      const synthText = stripSrtTags(entry.translatedText || '');
      if (synthText && 'speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(synthText);
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.lang.startsWith('be')) 
          || voices.find(v => v.lang.startsWith('ru'))
          || voices.find(v => v.lang.startsWith('uk'))
          || voices.find(v => v.lang.startsWith('pl'))
          || voices.find(v => v.lang.startsWith('en'));
        if (preferredVoice) {
          utterance.voice = preferredVoice;
          utterance.lang = preferredVoice.lang;
        } else {
          utterance.lang = 'be-BY';
        }
        utterance.rate = entry.audioSpeed || 1.0;
        window.speechSynthesis.speak(utterance);
      }
    }
  };

  // Adjust timing helper: increments or decrements standard timestamp string
  const adjustTime = (field: 'startTime' | 'endTime' | 'both', msDelta: number) => {
    if (field === 'both') {
      const startSec = srtTimeToSeconds(entry.startTime);
      const endSec = srtTimeToSeconds(entry.endTime);
      const newStart = Math.max(0, startSec + msDelta / 1000);
      const newEnd = Math.max(0, endSec + msDelta / 1000);
      onUpdate({
        startTime: secondsToSrtTime(newStart),
        endTime: secondsToSrtTime(newEnd)
      });
    } else {
      const rawVal = entry[field];
      const seconds = srtTimeToSeconds(rawVal);
      const newSeconds = Math.max(0, seconds + msDelta / 1000);
      onUpdate({ [field]: secondsToSrtTime(newSeconds) });
    }
  };

  const handleTranslateClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    if (!entry.text.trim()) return;
    setIsTranslating(true);
    try {
      await onTranslateSingle(entry.id);
    } catch (err) {
      console.error(err);
    } finally {
      setIsTranslating(false);
    }
  };

  const handleSynthesizeClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    const textToSynth = (entry.translatedText || '').trim();
    if (!textToSynth) return;

    setIsSynthesizing(true);
    try {
      await onSynthesizeSingle(entry.id, selectedVoice);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSynthesizing(false);
    }
  };

  const isAnyPopupOpen = Boolean(activeIssue || grammarDbResult || isVerbumModalOpen || isActorDropdownOpen || isOrigActorDropdownOpen);

  const hasTransText = Boolean((localTransText || entry.translatedText || '').trim());

  const handleProofreadCard = async () => {
    if (!hasTransText) return;
    if (entry.proofreadIssues && entry.proofreadIssues.length > 0) {
      if (activeIssue) {
        setActiveIssue(null);
      } else {
        setActiveIssue(entry.proofreadIssues[0]);
      }
      return;
    }
    if (!onProofreadSingle || isProofreadingCard) return;
    setIsProofreadingCard(true);
    try {
      await onProofreadSingle(entry.id);
    } finally {
      setIsProofreadingCard(false);
    }
  };

  // Listen for global hotkey triggers (Alt+1: Proofread "пр", Alt+2: Grammar DB "гб", Alt+4: Verbum "сл")
  React.useEffect(() => {
    if (!isSelected) return;

    const onHotkeyProofread = () => {
      handleProofreadCard();
    };

    const onHotkeyGrammarDb = () => {
      if (!isGrammarDbReady || isGrammarDbLoading) return;
      handleGrammarDbSearch();
    };

    const onHotkeyVerbum = () => {
      handleVerbumSearch();
    };

    window.addEventListener('subaka-hotkey-proofread', onHotkeyProofread);
    window.addEventListener('subaka-hotkey-grammardb', onHotkeyGrammarDb);
    window.addEventListener('subaka-hotkey-verbum', onHotkeyVerbum);
    return () => {
      window.removeEventListener('subaka-hotkey-proofread', onHotkeyProofread);
      window.removeEventListener('subaka-hotkey-grammardb', onHotkeyGrammarDb);
      window.removeEventListener('subaka-hotkey-verbum', onHotkeyVerbum);
    };
  }, [
    isSelected,
    entry.id,
    entry.translatedText,
    entry.text,
    entry.proofreadIssues,
    activeIssue,
    onProofreadSingle,
    isProofreadingCard,
    isGrammarDbReady,
    isGrammarDbLoading,
    localText,
    localTransText,
  ]);

  // Close active modal popups (GrammarDB, AI Proofread) on outside click
  React.useEffect(() => {
    if (!grammarDbResult && !activeIssue) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        (containerRef.current && containerRef.current.contains(target)) ||
        target.closest?.('#proofread-portal-modal') ||
        target.closest?.('#grammardb-portal-modal')
      ) {
        return;
      }
      setGrammarDbResult(null);
      setActiveIssue(null);
    };
    document.addEventListener('mousedown', handleOutsideClick, true);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick, true);
    };
  }, [grammarDbResult, activeIssue]);

  return (
    <div
      ref={containerRef}
      data-subtitle-card="true"
      onClick={onSelect}
      className={`group border rounded-xl transition-colors px-2.5 py-2 sm:px-3 sm:py-2.5 flex flex-col gap-1.5 relative cursor-pointer @container ${
        isAnyPopupOpen
          ? 'z-[100]'
          : isSelected
            ? 'z-10'
            : 'z-0'
      } ${
        isOverlapping
          ? theme === 'dark'
            ? 'border-red-500/80 bg-red-950/30 shadow-md ring-1 ring-red-500/30'
            : 'border-red-500 bg-red-50/90 shadow-md ring-2 ring-red-500/20'
          : isSelected 
            ? theme === 'dark'
              ? 'bg-purple-950/30 border-purple-500 ring-2 ring-purple-500/30 shadow-xl shadow-purple-950/20' 
              : 'bg-purple-50/80 border-purple-400 ring-2 ring-purple-400/30 shadow-xs'
            : theme === 'dark'
              ? 'bg-slate-900 border-slate-800 hover:border-slate-700 hover:bg-slate-900/80'
              : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs hover:bg-slate-50/80'
      }`}
    >
      {/* Top Header Row of Info */}
      <div className={`relative flex flex-wrap items-center justify-between gap-1.5 border-b pb-1.5 ${theme === 'dark' ? 'border-slate-800' : 'border-slate-200'}`}>
        {/* Left: Duration Box */}
        <div className="flex items-center gap-1 flex-wrap">
          <div 
            className={`flex items-center gap-0.5 px-1 py-0.5 rounded-lg border transition-colors shrink-0 ${
              isOverlapping
                ? theme === 'dark'
                  ? 'bg-red-500/15 border-red-500/80 text-red-300'
                  : 'bg-red-100 border-red-400 text-red-800 font-bold'
                : theme === 'dark' ? 'bg-slate-950/80 border-slate-800' : 'bg-slate-100 border-slate-300'
            }`}
            title="Працягласць паказа субцітра (пры змене абнаўляецца час заканчэння)"
          >
            <Timer className={`h-2.5 w-2.5 shrink-0 ${isOverlapping ? (theme === 'dark' ? 'text-red-400 animate-pulse' : 'text-red-700 animate-pulse') : theme === 'dark' ? 'text-amber-400' : 'text-amber-600'}`} />
            <input
              type="text"
              value={durationInput}
              onFocus={() => setIsEditingDuration(true)}
              onChange={(e) => handleDurationInputChange(e.target.value)}
              onBlur={handleDurationBlur}
              onClick={(e) => e.stopPropagation()}
              placeholder="00:00:00,000"
              className={`text-[9px] font-mono border text-center py-0 px-0.5 w-[72px] sm:w-[76px] rounded focus:outline-none transition-colors ${
                isOverlapping
                  ? theme === 'dark'
                    ? 'bg-red-500/20 border-red-500 text-red-300 font-bold'
                    : 'bg-white border-red-500 text-red-800 font-extrabold shadow-2xs'
                  : theme === 'dark'
                    ? 'bg-slate-950 border-slate-700/60 text-amber-300 hover:border-slate-600 focus:border-amber-400'
                    : 'bg-white border-slate-300 text-amber-700 font-bold hover:border-slate-400 focus:border-amber-500'
              }`}
            />
            {/* Duration Adjustments */}
            <div className="flex flex-col ml-0.5">
              <button 
                onClick={(e) => { e.stopPropagation(); adjustDuration(10); }}
                className={`p-0 rounded transition-colors ${
                  isOverlapping
                    ? theme === 'dark' ? 'text-red-400 hover:text-red-200' : 'text-red-700 hover:text-red-950 font-bold'
                    : theme === 'dark' ? 'text-slate-500 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-600 hover:text-amber-600 hover:bg-slate-200'
                }`}
                title="+10мс да працягласці"
              >
                <ChevronUp className="h-2 w-2" />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); adjustDuration(-10); }}
                className={`p-0 rounded transition-colors ${
                  isOverlapping
                    ? theme === 'dark' ? 'text-red-400 hover:text-red-200' : 'text-red-700 hover:text-red-950 font-bold'
                    : theme === 'dark' ? 'text-slate-500 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-600 hover:text-amber-600 hover:bg-slate-200'
                }`}
                title="-10мс ад працягласці"
              >
                <ChevronDown className="h-2 w-2" />
              </button>
            </div>
          </div>

          {/* CPS (Characters Per Second) Badge */}
          {cpsInfo.cps > 0 && (
            <div
              className={`inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded border leading-none transition-colors shrink-0 ${
                cpsInfo.isTooFast
                  ? theme === 'dark'
                    ? 'bg-amber-500/15 border-amber-500/60 text-amber-300 font-semibold shadow-xs'
                    : 'bg-amber-50 border-amber-400 text-amber-800 font-bold shadow-2xs'
                  : theme === 'dark'
                    ? 'bg-slate-950/60 border-slate-800 text-slate-400'
                    : 'bg-slate-100 border-slate-300 text-slate-600'
              }`}
              title={
                cpsInfo.isTooFast
                  ? `Увага: хуткасць чытання ${cpsInfo.cps} сімв/сек (перавышае рэкамендаваныя 20 CPS)`
                  : `Хуткасць чытання: ${cpsInfo.cps} сімв/сек (CPS)`
              }
            >
              <span className="text-[7.5px] uppercase tracking-wider opacity-75 leading-none">CPS</span>
              <span className="text-[9px] font-mono font-semibold leading-none">{cpsInfo.cps}</span>
            </div>
          )}
        </div>

        {/* Center/Inline: Subtitle Index Number */}
        <div className="flex items-center justify-center px-1">
          <span className={`font-mono font-bold text-[11px] select-none transition-colors ${
            isSelected
              ? 'text-purple-600 dark:text-purple-400'
              : theme === 'dark'
                ? 'text-slate-500'
                : 'text-slate-400'
          }`}>
            #{index + 1}
          </span>
        </div>

        {/* Timings control widgets */}
        <div className={`flex flex-wrap items-center gap-1 p-0.5 px-1 rounded-lg border transition-colors shrink-0 ${
          isOverlapping
            ? theme === 'dark'
              ? 'bg-red-500/10 border-red-500/90 ring-1 ring-red-500/40 text-red-400'
              : 'bg-red-100/90 border-red-400 ring-1 ring-red-400/50 text-red-800'
            : theme === 'dark' ? 'bg-slate-950/60 border-slate-800/80' : 'bg-slate-100/90 border-slate-200'
        }`}>
          <Clock className={`h-2.5 w-2.5 mx-0.5 shrink-0 ${isOverlapping ? (theme === 'dark' ? 'text-red-400 animate-pulse' : 'text-red-700 animate-pulse') : theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`} />
          
          {/* Start Time Box */}
          <div className="flex items-center text-[9px] shrink-0">
            <input
              type="text"
              value={entry.startTime}
              onChange={(e) => onUpdate({ startTime: e.target.value })}
              className={`text-[9px] font-mono border text-center py-0 px-0.5 w-[72px] sm:w-[76px] rounded focus:outline-none transition-colors ${
                isOverlapping
                  ? theme === 'dark'
                    ? 'bg-red-500/20 border-red-500 text-red-300 font-bold'
                    : 'bg-white border-red-500 text-red-800 font-extrabold shadow-2xs'
                  : theme === 'dark'
                    ? 'bg-slate-950 border-slate-700/10 text-slate-200 hover:border-slate-600 focus:border-slate-700'
                    : 'bg-white border-slate-300 text-slate-900 font-semibold hover:border-slate-400 focus:border-slate-500'
              }`}
              title="Час пачатку"
            />
            {/* Start Adjustments */}
            <div className="flex flex-col ml-0.5">
              <button 
                onClick={(e) => { e.stopPropagation(); adjustTime('startTime', 10); }}
                className={`p-0 rounded transition-colors ${
                  isOverlapping
                    ? theme === 'dark' ? 'text-red-400 hover:text-red-200' : 'text-red-700 hover:text-red-950 font-bold'
                    : theme === 'dark' ? 'text-slate-500 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-600 hover:text-amber-600 hover:bg-slate-200'
                }`}
                title="+10мс"
              >
                <ChevronUp className="h-2 w-2" />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); adjustTime('startTime', -10); }}
                className={`p-0 rounded transition-colors ${
                  isOverlapping
                    ? theme === 'dark' ? 'text-red-400 hover:text-red-200' : 'text-red-700 hover:text-red-950 font-bold'
                    : theme === 'dark' ? 'text-slate-500 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-600 hover:text-amber-600 hover:bg-slate-200'
                }`}
                title="-10мс"
              >
                <ChevronDown className="h-2 w-2" />
              </button>
            </div>
          </div>

          <ArrowRight className={`h-2.5 w-2.5 mx-0.5 shrink-0 ${isOverlapping ? (theme === 'dark' ? 'text-red-400' : 'text-red-700') : theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`} />

          {/* End Time Box */}
          <div className="flex items-center text-[9px] shrink-0">
            <input
              type="text"
              value={entry.endTime}
              onChange={(e) => onUpdate({ endTime: e.target.value })}
              className={`text-[9px] font-mono border text-center py-0 px-0.5 w-[72px] sm:w-[76px] rounded focus:outline-none transition-colors ${
                isOverlapping
                  ? theme === 'dark'
                    ? 'bg-red-500/20 border-red-500 text-red-300 font-bold'
                    : 'bg-white border-red-500 text-red-800 font-extrabold shadow-2xs'
                  : theme === 'dark'
                    ? 'bg-slate-950 border-slate-700/10 text-slate-200 hover:border-slate-600 focus:border-slate-700'
                    : 'bg-white border-slate-300 text-slate-900 font-semibold hover:border-slate-400 focus:border-slate-500'
              }`}
              title="Час заканчэння"
            />
            {/* End Adjustments */}
            <div className="flex flex-col ml-0.5">
              <button 
                onClick={(e) => { e.stopPropagation(); adjustTime('endTime', 10); }}
                className={`p-0 rounded transition-colors ${
                  isOverlapping
                    ? theme === 'dark' ? 'text-red-400 hover:text-red-200' : 'text-red-700 hover:text-red-950 font-bold'
                    : theme === 'dark' ? 'text-slate-500 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-600 hover:text-amber-600 hover:bg-slate-200'
                }`}
                title="+10мс"
              >
                <ChevronUp className="h-2 w-2" />
              </button>
              <button 
                onClick={(e) => { e.stopPropagation(); adjustTime('endTime', -10); }}
                className={`p-0 rounded transition-colors ${
                  isOverlapping
                    ? theme === 'dark' ? 'text-red-400 hover:text-red-200' : 'text-red-700 hover:text-red-950 font-bold'
                    : theme === 'dark' ? 'text-slate-500 hover:text-amber-400 hover:bg-slate-700' : 'text-slate-600 hover:text-amber-600 hover:bg-slate-200'
                }`}
                title="-10мс"
              >
                <ChevronDown className="h-2 w-2" />
              </button>
            </div>
          </div>

          <div className={`flex gap-0.5 ml-0.5 border-l pl-0.5 shrink-0 ${isOverlapping ? (theme === 'dark' ? 'border-red-500/40' : 'border-red-300') : theme === 'dark' ? 'border-slate-800' : 'border-slate-300'}`}>
            <button
              onClick={(e) => { e.stopPropagation(); adjustTime('both', -1000); }}
              className={`p-0.5 rounded border transition-colors flex items-center justify-center ${
                isOverlapping
                  ? theme === 'dark'
                    ? 'text-red-400 bg-red-950/60 hover:bg-red-900 border-red-500/50'
                    : 'text-red-800 bg-red-100 hover:bg-red-200 border-red-400 font-extrabold shadow-2xs'
                  : theme === 'dark' ? 'text-slate-400 bg-slate-950 hover:bg-slate-800 border-slate-800/60' : 'text-slate-700 bg-slate-100 hover:bg-slate-200 border-slate-300'
              }`}
              title="Зрушыць назад на 1 сек (-1с)"
            >
              <ChevronLeft className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); adjustTime('both', 1000); }}
              className={`p-0.5 rounded border transition-colors flex items-center justify-center ${
                isOverlapping
                  ? theme === 'dark'
                    ? 'text-red-400 bg-red-950/60 hover:bg-red-900 border-red-500/50'
                    : 'text-red-800 bg-red-100 hover:bg-red-200 border-red-400 font-extrabold shadow-2xs'
                  : theme === 'dark' ? 'text-slate-400 bg-slate-950 hover:bg-slate-800 border-slate-800/60' : 'text-slate-700 bg-slate-100 hover:bg-slate-200 border-slate-300'
              }`}
              title="Зрушыць наперад на 1 сек (+1с)"
            >
              <ChevronRight className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Translation Texts */}
      <div className="grid grid-cols-1 @[620px]:grid-cols-2 gap-3 items-stretch">
        {/* Original Text Input */}
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap min-w-0">
              {/* Original Actor input with high-performance custom dropdown */}
              <div 
                ref={origActorContainerRef}
                className="relative flex items-center gap-1 shrink-0" 
                onClick={(e) => e.stopPropagation()}
              >
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={origActorInput}
                    onChange={(e) => {
                      setOrigActorInput(e.target.value);
                      if (!isOrigActorDropdownOpen) {
                        openOrigActorDropdown();
                      }
                      setOrigActorHighlightedIndex(-1);
                    }}
                    onFocus={() => {
                      openOrigActorDropdown();
                    }}
                    onBlur={handleOrigActorBlur}
                    onKeyDown={handleOrigActorKeyDown}
                    placeholder="роля..."
                    title="Імя ролі/персанажа са спісу або новае (некалькі праз ',' ці ';')"
                    style={{ width: '140px' }}
                    className={`h-[19px] text-[9.5px] pl-1.5 pr-4 py-0 rounded border font-medium outline-none transition-all w-[140px] ${
                      theme === 'dark'
                        ? 'bg-slate-900 border-slate-700/80 text-slate-200 placeholder:text-slate-600 focus:border-indigo-400 focus:bg-slate-950'
                        : 'bg-white border-slate-300 text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 shadow-2xs'
                    }`}
                  />
                  {/* Dropdown toggle button */}
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      if (isOrigActorDropdownOpen) {
                        setIsOrigActorDropdownOpen(false);
                      } else {
                        openOrigActorDropdown();
                      }
                    }}
                    className={`absolute right-0 top-0 bottom-0 px-1 flex items-center justify-center transition-colors cursor-pointer ${
                      theme === 'dark'
                        ? 'text-slate-500 hover:text-indigo-300'
                        : 'text-slate-400 hover:text-indigo-800'
                    }`}
                    title="Выбраць ролю арыгінала са спісу"
                  >
                    <ChevronDown className={`w-3 h-3 transition-transform ${isOrigActorDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Fast, lightweight floating dropdown popup */}
                  {isOrigActorDropdownOpen && (
                    <div
                      className={`absolute left-0 top-full mt-1 z-[100] min-w-[150px] max-w-[240px] max-h-56 overflow-y-auto rounded-lg shadow-2xl border p-1 text-[10px] animate-in fade-in duration-100 ${
                        theme === 'dark'
                          ? 'bg-slate-900/98 backdrop-blur border-slate-700 text-slate-200 shadow-black/90'
                          : 'bg-white border-slate-300 text-slate-800 shadow-slate-500/40 ring-1 ring-black/10'
                      }`}
                    >
                      {filteredOrigActors.length > 0 ? (
                        filteredOrigActors.map((act, aIdx) => {
                          const isHighlighted = origActorHighlightedIndex >= 0 && aIdx === origActorHighlightedIndex;
                          const isSelected = isActorSelected(act, origActorInput);
                          const activeQuery = getActorQuery(origActorInput);
                          return (
                            <button
                              key={act}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectOrigActor(act);
                              }}
                              onMouseEnter={() => setOrigActorHighlightedIndex(aIdx)}
                              className={`w-full text-left px-2 py-1 rounded transition-colors flex items-center justify-between gap-1 cursor-pointer truncate ${
                                isSelected
                                  ? theme === 'dark'
                                    ? 'bg-indigo-500/25 text-indigo-300 font-semibold'
                                    : 'bg-indigo-100 text-indigo-950 font-semibold'
                                  : isHighlighted
                                  ? theme === 'dark'
                                    ? 'bg-slate-800 text-slate-200'
                                    : 'bg-slate-100 text-slate-800'
                                  : theme === 'dark'
                                  ? 'hover:bg-slate-800/70 text-slate-300'
                                  : 'hover:bg-slate-100 text-slate-700'
                              }`}
                            >
                              <span className="truncate">
                                {renderHighlightedActorName(
                                  act,
                                  activeQuery,
                                  theme === 'dark' ? 'bg-indigo-500/40 text-white font-bold rounded-xs px-0.5' : 'bg-indigo-200 text-indigo-900 font-bold rounded-xs px-0.5'
                                )}
                              </span>
                              {isSelected && (
                                <span className="text-[9px] font-bold text-indigo-400 shrink-0">✓</span>
                              )}
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-2 py-1 text-slate-500 italic text-[9.5px]">
                          Няма захаваных роляў
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={handleTranslateClick}
                disabled={isTranslating || !entry.text?.trim()}
                className={`px-1.5 py-0.5 text-[8px] font-semibold rounded border transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 ${
                  entry.translatedText 
                    ? theme === 'dark' ? 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                    : theme === 'dark' ? 'bg-indigo-600/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                } ${isTranslating ? 'opacity-60 cursor-wait' : ''} ${!entry.text?.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Перакласці гэтую картку праз Gemini"
              >
                {isTranslating ? (
                  <RefreshCw className="h-2 w-2 animate-spin text-indigo-500 shrink-0" />
                ) : (
                  <Sparkles className="h-2 w-2 shrink-0" />
                )}
                пераклад
              </button>
              <button
                type="button"
                onClick={handleConvertPhonetic}
                disabled={isConvertingPhonetic || !entry.text?.trim()}
                className={`px-1.5 py-0.5 text-[8px] font-semibold rounded border transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0 ${
                  entry.translatedText 
                    ? theme === 'dark' ? 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                    : theme === 'dark' ? 'bg-indigo-600/15 border-indigo-500/30 text-indigo-300 hover:bg-indigo-600/30' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
                } ${isConvertingPhonetic ? 'opacity-60 cursor-wait' : ''} ${!entry.text?.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
                title="Арфаэпічны канвертар поля &quot;Арыгінал&quot;"
              >
                {isConvertingPhonetic ? (
                  <RefreshCw className="h-2 w-2 animate-spin text-indigo-500 shrink-0" />
                ) : (
                  <AudioLines className="h-2 w-2 shrink-0" />
                )}
                арфаэпія
              </button>
            </div>
            {/* Tag Formatting Toolbar */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); applyAccentMark('text', origTextareaRef); }}
                className={`px-1.5 py-0.5 text-[8px] font-bold rounded border transition-colors ${
                  theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-slate-800'
                }`}
                title="Паставіць націск на літару (а́)"
              >
                а́
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); applyFormatTag('text', 'b', origTextareaRef); }}
                className={`px-1.5 py-0.5 text-[8px] font-bold rounded border transition-colors ${
                  theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-slate-800'
                }`}
                title="Дадаць <b>тоўсты</b>"
              >
                <b>B</b>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); applyFormatTag('text', 'i', origTextareaRef); }}
                className={`px-1.5 py-0.5 text-[8px] italic rounded border transition-colors ${
                  theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-slate-800'
                }`}
                title="Дадаць <i>курсіў</i>"
              >
                <i>I</i>
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); applyFormatTag('text', 'u', origTextareaRef); }}
                className={`px-1.5 py-0.5 text-[8px] underline rounded border transition-colors ${
                  theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300' : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-slate-800'
                }`}
                title="Дадаць <u>падкрэслены</u>"
              >
                <u>U</u>
              </button>
            </div>
          </div>
          {/* Auto-growing Textarea with pure CSS grid */}
          <div className="relative grid grid-cols-1 items-stretch w-full flex-1">
            <div
              aria-hidden="true"
              className="invisible col-start-1 row-start-1 select-none pointer-events-none w-full"
              style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: `${fontSize}px`,
                lineHeight: '1.45',
                padding: '6px 10px',
                minHeight: `${Math.ceil(fontSize * 1.45) + 14}px`,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                border: '1px solid transparent',
                boxSizing: 'border-box',
              }}
            >
              {localText ? `${localText}\n` : '\u00A0'}
            </div>
            <textarea
              ref={origTextareaRef}
              value={localText}
              onChange={(e) => handleOrigTextChange(e.target.value)}
              onBlur={handleOrigTextBlur}
              onScroll={(e) => {
                if (origBackdropRef.current) {
                  origBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
                  origBackdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
              placeholder="Арыгінал..."
              spellCheck={false}
              style={{
                fontFamily: 'Arial, Helvetica, sans-serif',
                fontSize: `${fontSize}px`,
                lineHeight: '1.45',
                padding: '6px 10px',
                margin: 0,
                boxSizing: 'border-box',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
              className={`col-start-1 row-start-1 w-full h-full rounded-xl outline-none transition-colors resize-none border leading-normal overflow-hidden ${
                theme === 'dark'
                  ? 'bg-slate-950 border-slate-900 focus:border-white text-slate-200 focus:ring-1 focus:ring-white/20'
                  : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-indigo-500 focus:bg-white focus:ring-1 focus:ring-indigo-500/20'
              }`}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>

        {/* Belarusian Translated Text Input */}
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-1 min-w-0">
            <div className="flex items-center gap-1 flex-wrap min-w-0">
              {/* Actor input with high-performance custom dropdown */}
              <div 
                ref={actorContainerRef}
                className="relative flex items-center gap-1 shrink-0" 
                onClick={(e) => e.stopPropagation()}
              >
                <div className="relative flex items-center">
                  <input
                    type="text"
                    value={actorInput}
                    onChange={(e) => {
                      setActorInput(e.target.value);
                      if (!isActorDropdownOpen) {
                        openActorDropdown();
                      }
                      setActorHighlightedIndex(-1);
                    }}
                    onFocus={() => {
                      openActorDropdown();
                    }}
                    onBlur={handleActorBlur}
                    onKeyDown={handleActorKeyDown}
                    placeholder="роля..."
                    title="Імя ролі/персанажа са спісу або новае (некалькі праз ',' ці ';')"
                    style={{ width: '140px' }}
                    className={`h-[19px] text-[9.5px] pl-1.5 pr-4 py-0 rounded border font-medium outline-none transition-all w-[140px] ${
                      theme === 'dark'
                        ? 'bg-slate-900 border-slate-700/80 text-amber-300 placeholder:text-slate-600 focus:border-amber-400 focus:bg-slate-950'
                        : 'bg-white border-slate-300 text-amber-900 placeholder:text-slate-400 focus:border-indigo-500 shadow-2xs'
                    }`}
                  />
                  {/* Dropdown toggle button */}
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      if (isActorDropdownOpen) {
                        setIsActorDropdownOpen(false);
                      } else {
                        openActorDropdown();
                      }
                    }}
                    className={`absolute right-0 top-0 bottom-0 px-1 flex items-center justify-center transition-colors cursor-pointer ${
                      theme === 'dark'
                        ? 'text-slate-500 hover:text-amber-300'
                        : 'text-slate-400 hover:text-amber-800'
                    }`}
                    title="Выбраць ролю са спісу"
                  >
                    <ChevronDown className={`w-3 h-3 transition-transform ${isActorDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Fast, lightweight floating dropdown popup */}
                  {isActorDropdownOpen && (
                    <div
                      className={`absolute left-0 top-full mt-1 z-[100] min-w-[150px] max-w-[240px] max-h-56 overflow-y-auto rounded-lg shadow-2xl border p-1 text-[10px] animate-in fade-in duration-100 ${
                        theme === 'dark'
                          ? 'bg-slate-900/98 backdrop-blur border-slate-700 text-slate-200 shadow-black/90'
                          : 'bg-white border-slate-300 text-slate-800 shadow-slate-500/40 ring-1 ring-black/10'
                      }`}
                    >
                      {filteredActors.length > 0 ? (
                        filteredActors.map((act, aIdx) => {
                          const isHighlighted = actorHighlightedIndex >= 0 && aIdx === actorHighlightedIndex;
                          const isSelected = isActorSelected(act, actorInput);
                          const activeQuery = getActorQuery(actorInput);
                          return (
                            <button
                              key={act}
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleSelectActor(act);
                              }}
                              onMouseEnter={() => setActorHighlightedIndex(aIdx)}
                              className={`w-full text-left px-2 py-1 rounded transition-colors flex items-center justify-between gap-1 cursor-pointer truncate ${
                                isSelected
                                  ? theme === 'dark'
                                    ? 'bg-amber-500/25 text-amber-300 font-semibold'
                                    : 'bg-amber-100 text-amber-950 font-semibold'
                                  : isHighlighted
                                  ? theme === 'dark'
                                    ? 'bg-slate-800 text-slate-200'
                                    : 'bg-slate-100 text-slate-800'
                                  : theme === 'dark'
                                  ? 'hover:bg-slate-800/70 text-slate-300'
                                  : 'hover:bg-slate-100 text-slate-700'
                              }`}
                            >
                              <span className="truncate">
                                {renderHighlightedActorName(
                                  act,
                                  activeQuery,
                                  theme === 'dark' ? 'bg-amber-500/40 text-amber-200 font-bold rounded-xs px-0.5' : 'bg-amber-200 text-amber-950 font-bold rounded-xs px-0.5'
                                )}
                              </span>
                              {isSelected && (
                                <span className="text-[9px] font-bold text-amber-500 shrink-0">✓</span>
                              )}
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-2 py-1 text-slate-500 italic text-[9.5px]">
                          Няма захаваных роляў
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1 shrink-0">
              {/* Tag Formatting Toolbar */}
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); applyAccentMark('translatedText', transTextareaRef); }}
                  className={`px-1.5 py-0.5 text-[8px] font-bold rounded border transition-colors ${
                    theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-amber-400' : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-amber-700'
                  }`}
                  title="Паставіць націск на літару (а́)"
                >
                  а́
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); applyFormatTag('translatedText', 'b', transTextareaRef); }}
                  className={`px-1.5 py-0.5 text-[8px] font-bold rounded border transition-colors ${
                    theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-amber-400' : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-amber-700'
                  }`}
                  title="Дадаць <b>тоўсты</b>"
                >
                  <b>B</b>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); applyFormatTag('translatedText', 'i', transTextareaRef); }}
                  className={`px-1.5 py-0.5 text-[8px] italic rounded border transition-colors ${
                    theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-amber-400' : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-amber-700'
                  }`}
                  title="Дадаць <i>курсіў</i>"
                >
                  <i>I</i>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); applyFormatTag('translatedText', 'u', transTextareaRef); }}
                  className={`px-1.5 py-0.5 text-[8px] underline rounded border transition-colors ${
                    theme === 'dark' ? 'bg-slate-900 border-slate-800 hover:bg-slate-800 text-amber-400' : 'bg-slate-100 border-slate-300 hover:bg-slate-200 text-amber-700'
                  }`}
                  title="Дадаць <u>падкрэслены</u>"
                >
                  <u>U</u>
                </button>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleProofreadCard();
                  }}
                  disabled={!hasTransText || isProofreadingCard}
                  className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border transition-all flex items-center gap-0.5 whitespace-nowrap shrink-0 shadow-xs ${
                    !hasTransText
                      ? theme === 'dark'
                        ? 'bg-slate-800/40 text-slate-500 border-slate-700/50 opacity-40 cursor-not-allowed'
                        : 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 cursor-not-allowed'
                      : entry.proofreadIssues !== undefined
                        ? theme === 'dark'
                          ? 'bg-slate-800/80 text-slate-400 border-slate-700/80 hover:bg-slate-700/80 hover:text-slate-300 cursor-pointer'
                          : 'bg-slate-200/90 text-slate-500 border-slate-300 hover:bg-slate-300 hover:text-slate-700 cursor-pointer'
                        : theme === 'dark'
                          ? 'bg-purple-500/20 text-purple-200 border-purple-500/40 hover:bg-purple-500/35 hover:text-white cursor-pointer'
                          : 'bg-purple-100 text-purple-900 border-purple-300 hover:bg-purple-200 font-bold cursor-pointer'
                  }`}
                  title={
                    !hasTransText
                      ? 'Пераклад пусты: няма тэксту для праверкі правапісу'
                      : entry.proofreadIssues && entry.proofreadIssues.length > 0
                        ? `Заўвагі ШІ (${entry.proofreadIssues.length}): націсніце, каб паказаць (Alt+1)`
                        : entry.proofreadIssues !== undefined
                          ? 'Праверана ШІ: памылак не знойдзена (Alt+1)'
                          : 'Праверыць гэтую картку ШІ (Alt+1)'
                  }
                >
                  {isProofreadingCard ? (
                    <RefreshCw className="w-2.5 h-2.5 animate-spin text-purple-400 shrink-0" />
                  ) : (
                    <Sparkles className={`w-2.5 h-2.5 shrink-0 ${
                      !hasTransText
                        ? theme === 'dark' ? 'text-slate-500' : 'text-slate-400'
                        : entry.proofreadIssues !== undefined
                          ? 'text-slate-400'
                          : 'text-purple-400'
                    }`} />
                  )}
                   пр
                </button>

                {/* Dictionary search button ("сл" - verbum.by) */}
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleVerbumSearch();
                  }}
                  className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border transition-all flex items-center gap-0.5 whitespace-nowrap shrink-0 shadow-xs cursor-pointer ${
                    theme === 'dark'
                      ? 'bg-indigo-500/20 text-indigo-200 border-indigo-500/40 hover:bg-indigo-500/35 hover:text-white'
                      : 'bg-indigo-100 text-indigo-900 border-indigo-300 hover:bg-indigo-200 font-bold'
                  }`}
                  title="Пошук у слоўніках verbum.by выдзеленага слова ў арыгінале ці перакладзе (Alt+4)"
                >
                  <BookOpen className="w-2.5 h-2.5 shrink-0 text-indigo-400" />
                  сл
                </button>

                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!isGrammarDbReady) return;
                    handleGrammarDbSearch();
                  }}
                  disabled={!isGrammarDbReady || isGrammarDbLoading}
                  className={`text-[8.5px] font-bold px-1.5 py-0.5 rounded border transition-all flex items-center gap-0.5 whitespace-nowrap shrink-0 shadow-xs ${
                    !isGrammarDbReady
                      ? theme === 'dark'
                        ? 'bg-slate-800/40 text-slate-500 border-slate-700/50 opacity-40 cursor-not-allowed'
                        : 'bg-slate-100 text-slate-400 border-slate-200 opacity-40 cursor-not-allowed'
                      : theme === 'dark'
                        ? 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40 hover:bg-emerald-500/35 hover:text-white cursor-pointer'
                        : 'bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-200 cursor-pointer font-bold'
                  }`}
                  title={
                    isGrammarDbReady
                      ? 'Памылкі ў перакладзе і пошук у граматычнай базе выдзеленага слова ў арыгінале ці перакладзе (Alt+2)'
                      : 'Граматычная база недаступная альбо ініцыялізуецца...'
                  }
                >
                  {isGrammarDbLoading ? (
                    <RefreshCw className="w-2.5 h-2.5 animate-spin text-emerald-400 shrink-0" />
                  ) : (
                    <Database className={`w-2.5 h-2.5 shrink-0 ${isGrammarDbReady ? 'text-emerald-400' : 'text-slate-400 dark:text-slate-500'}`} />
                  )}
                  гб
                </button>
              </div>
            </div>
          </div>

            <div className="relative grid grid-cols-1 items-stretch w-full flex-1">
              {/* Invisible CSS sizer to drive the natural height of the grid cell */}
              <div
                aria-hidden="true"
                className="invisible col-start-1 row-start-1 select-none pointer-events-none w-full"
                style={{
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: `${fontSize}px`,
                  lineHeight: '1.45',
                  padding: '6px 10px',
                  minHeight: `${Math.ceil(fontSize * 1.45) + 14}px`,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  border: '1px solid transparent',
                  boxSizing: 'border-box',
                }}
              >
                {localTransText ? `${localTransText}\n` : '\u00A0'}
              </div>

              {/* SpellCheck & AI Proofread Backdrop Overlay with Red/Purple Wavy Underlines sitting ON TOP of textarea at z-20 with pointer-events-none */}
              {((autoSpellCheck && Boolean(localTransText)) || (entry.proofreadIssues && entry.proofreadIssues.length > 0)) && (
                <div
                  ref={transBackdropRef}
                  aria-hidden="true"
                  style={{
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontSize: `${fontSize}px`,
                    lineHeight: '1.45',
                    padding: '6px 10px',
                    margin: 0,
                    boxSizing: 'border-box',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    border: '1px solid transparent',
                  }}
                  className="col-start-1 row-start-1 w-full h-full rounded-xl pointer-events-none overflow-hidden select-none z-20"
                >
                  {(() => {
                    const text = localTransText;
                    if (!text) return null;

                    const proofreadIssues: ProofreadIssue[] = entry.proofreadIssues || [];
                    const proofreadMap = new Map<string, ProofreadIssue>();
                    proofreadIssues.forEach(i => {
                      if (i.word && i.word.trim()) {
                        const cleanW = i.word.toLowerCase().replace(/[\u0301\u00B4]/g, '').trim();
                        proofreadMap.set(cleanW, i);
                      }
                    });

                    if (autoSpellCheck) {
                      return spellCheckTokens.map((token, idx) => {
                        const tokenLower = token.text.toLowerCase().replace(/[\u0301\u00B4]/g, '');
                        const matchingProofread = proofreadMap.get(tokenLower);

                        if (token.isError) {
                          const isYellow = token.errorType === 'yellow';
                          const hasProofread = Boolean(matchingProofread);
                          return (
                            <span
                              key={idx}
                              className={`text-transparent rounded-xs font-medium ${
                                isYellow
                                  ? 'bg-amber-300/65 dark:bg-yellow-400/50'
                                  : 'bg-red-500/40 dark:bg-red-500/45'
                              } ${
                                hasProofread
                                  ? 'underline decoration-wavy decoration-purple-500 decoration-1 underline-offset-2'
                                  : ''
                              }`}
                              title={
                                hasProofread
                                  ? `${token.tooltip || 'Памылка правапісу'} | Заўвага ШІ: "${matchingProofread?.word}"`
                                  : (token.tooltip || 'Памылка правапісу')
                              }
                            >
                              {token.text}
                            </span>
                          );
                        } else if (matchingProofread) {
                          return (
                            <span
                              key={idx}
                              className="text-transparent underline decoration-wavy decoration-purple-500 decoration-1 underline-offset-2"
                              title={`Заўвага ШІ: "${matchingProofread.word}"`}
                            >
                              {token.text}
                            </span>
                          );
                        }

                        return (
                          <span key={idx} className="text-transparent">
                            {token.text}
                          </span>
                        );
                      });
                    }

                    // Fallback for AI proofread if autoSpellCheck is disabled
                    const validWords: string[] = Array.from(proofreadMap.keys()).sort((a, b) => b.length - a.length);
                    if (validWords.length === 0) return null;

                    const escaped = validWords.map((w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
                    const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');
                    const parts = text.split(pattern);

                    return parts.map((part: string, idx: number) => {
                      const matchingIssue = proofreadMap.get(part.toLowerCase());
                      if (matchingIssue) {
                        return (
                          <span
                            key={idx}
                            className="text-transparent underline decoration-wavy decoration-purple-500 decoration-1 underline-offset-2"
                            title={`Заўвага ШІ для "${matchingIssue.word}"`}
                          >
                            {part}
                          </span>
                        );
                      }
                      return (
                        <span key={idx} className="text-transparent">
                          {part}
                        </span>
                      );
                    });
                  })()}
                </div>
              )}

              {/* AI Proofread Floating Modal Popup (Appears on the right towards the player side) */}
              {activeIssue && activeIssuePos && typeof document !== 'undefined' && createPortal(
                <div
                  id="proofread-portal-modal"
                  style={{
                    position: 'fixed',
                    top: `${activeIssuePos.top}px`,
                    left: `${activeIssuePos.left}px`,
                    width: `${activeIssuePos.width}px`,
                    maxHeight: `calc(100vh - ${activeIssuePos.top + 16}px)`,
                    zIndex: 9999,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={`p-3.5 rounded-xl shadow-2xl border flex flex-col justify-between gap-2.5 transition-all pointer-events-auto overflow-y-auto animate-in fade-in duration-150 ${
                    theme === 'dark'
                      ? 'bg-slate-900/98 backdrop-blur border-purple-500/60 text-slate-100 shadow-purple-950/90 ring-1 ring-purple-500/40'
                      : 'bg-white border-purple-400 text-slate-900 shadow-2xl shadow-slate-400/80 ring-1 ring-purple-400/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 border-b border-purple-500/20 pb-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-purple-400 truncate">
                      <Sparkles className="w-4 h-4 shrink-0 text-purple-400" />
                      <span className="truncate">Заўвага ШІ: "<span className="underline decoration-wavy decoration-purple-500 underline-offset-2">{activeIssue.word}</span>"</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {entry.proofreadIssues && entry.proofreadIssues.length > 1 && (() => {
                        const curIdx = entry.proofreadIssues.findIndex((i) => i.word === activeIssue.word);
                        return (
                          <div className="flex items-center gap-0.5 mr-1">
                            <span className="text-[10px] text-purple-400 font-mono font-bold mr-1">
                              {curIdx >= 0 ? curIdx + 1 : 1}/{entry.proofreadIssues.length}
                            </span>
                            <button
                              type="button"
                              disabled={curIdx <= 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (entry.proofreadIssues && curIdx > 0) {
                                  setActiveIssue(entry.proofreadIssues[curIdx - 1]);
                                }
                              }}
                              className="p-0.5 rounded hover:bg-purple-500/10 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                              title="Папярэдняя заўвага"
                            >
                              <ChevronUp className="w-3.5 h-3.5 -rotate-90 text-purple-400" />
                            </button>
                            <button
                              type="button"
                              disabled={curIdx >= entry.proofreadIssues.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (entry.proofreadIssues && curIdx < entry.proofreadIssues.length - 1) {
                                  setActiveIssue(entry.proofreadIssues[curIdx + 1]);
                                }
                              }}
                              className="p-0.5 rounded hover:bg-purple-500/10 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                              title="Наступная заўвага"
                            >
                              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-purple-400" />
                            </button>
                          </div>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveIssue(null); }}
                        className="text-slate-400 hover:text-purple-400 font-bold px-2 py-0.5 text-xs cursor-pointer rounded hover:bg-purple-500/10"
                        title="Закрыць"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <p className={`text-xs leading-relaxed ${theme === 'dark' ? 'text-slate-200' : 'text-slate-700'}`}>
                    {activeIssue.explanation}
                  </p>

                  {activeIssue.suggestion && (
                    <div className="flex flex-wrap items-center justify-between gap-2.5 pt-2 border-t border-purple-500/20">
                      <div className="text-xs text-purple-300 min-w-0 break-words">
                        Выпраўленне: <span className="font-bold text-purple-400 underline decoration-purple-400/60 underline-offset-2">{activeIssue.suggestion}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-auto">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdate({ proofreadIssues: undefined });
                            setActiveIssue(null);
                          }}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer shrink-0 ${
                            theme === 'dark'
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                          }`}
                          title="Скасаваць усе заўвагі ШІ на гэтай картцы"
                        >
                          Скасаваць
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (activeIssue.suggestion) {
                              const newText = localTransText.replace(activeIssue.word, activeIssue.suggestion);
                              const remaining = (entry.proofreadIssues || []).filter((i) => i.word !== activeIssue.word);
                              setLocalTransText(newText);
                              lastCommittedTransRef.current = newText;
                              onUpdate({ translatedText: newText, proofreadIssues: remaining });
                              if (remaining.length > 0) {
                                setActiveIssue(remaining[0]);
                              } else {
                                setActiveIssue(null);
                              }
                            }
                          }}
                          className="px-3.5 py-1.5 text-xs font-bold rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors cursor-pointer shrink-0 shadow-xs whitespace-nowrap"
                        >
                          Прымяніць выпраўленне
                        </button>
                      </div>
                    </div>
                  )}
                </div>,
                document.body
              )}

              {/* GrammarDB Lookup Floating Modal Popup */}
              {grammarDbResult && grammarDbPos && typeof document !== 'undefined' && createPortal(
                <div
                  id="grammardb-portal-modal"
                  style={{
                    position: 'fixed',
                    top: `${grammarDbPos.top}px`,
                    left: `${grammarDbPos.left}px`,
                    width: `${grammarDbPos.width}px`,
                    maxHeight: `calc(100vh - ${grammarDbPos.top + 16}px)`,
                    zIndex: 9999,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className={`p-3.5 rounded-xl shadow-2xl border flex flex-col justify-between gap-2.5 transition-all pointer-events-auto overflow-y-auto animate-in fade-in duration-150 ${
                    theme === 'dark'
                      ? 'bg-slate-900/98 backdrop-blur border-emerald-500/60 text-slate-100 shadow-emerald-950/90 ring-1 ring-emerald-500/40'
                      : 'bg-white border-emerald-500 text-slate-900 shadow-2xl shadow-slate-400/80 ring-1 ring-emerald-500/40'
                  }`}
                >
                  <div className="flex items-center justify-between pb-1.5 border-b border-emerald-500/20">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                      <Database className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-bold font-mono text-[11px] opacity-75">гб</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setGrammarDbResult(null); }}
                      className="text-slate-400 hover:text-emerald-400 font-bold px-1.5 py-0.5 text-xs cursor-pointer rounded hover:bg-emerald-500/10 transition-colors"
                      title="Закрыць"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="flex flex-col gap-2.5 text-xs">
                    {/* 1. ВЕРХНЯЯ ЗОНА: Памылкі, адзначаныя ў картцы (толькі з поля пераклад) */}
                    {(() => {
                      const result: Array<{
                        text: string;
                        isError: boolean;
                        errorType?: 'red' | 'yellow' | 'purple';
                        tooltip?: string;
                        suggestion?: string;
                        suggestions?: string[];
                        field: 'trans';
                        isIgnored?: boolean;
                      }> = [];

                      const seen = new Set<string>();
                      const queryWord = grammarDbResult.query || '';
                      const queryClean = stripAccents(queryWord).toLowerCase().trim();

                      // Памылкі правапісу з поля перакладу
                      if (localTransText) {
                        const rawTokens = getBelarusianSpellTokens(localTransText, new Set(), { 
                          includeSuggestions: true, 
                          previousText,
                          ignoredCapitalization: new Set(),
                        });
                        for (const t of rawTokens) {
                          if (t.isError || t.isIgnored) {
                            const key = stripAccents(t.text).toLowerCase().trim();
                            const isCapWarning = t.errorType === 'yellow' && t.tooltip === 'Гэты сказ пачынаецца не з вялікай літары';
                            const isIgnored = isCapWarning 
                              ? ignoredCapitalization.has(key) 
                              : (t.errorType !== 'yellow' && ignoredWords.has(key));

                            // Паказваем актыўныя памылкі альбо вылучанае слова, калі яно было ігнараванае
                            if (!isIgnored || (queryClean && key === queryClean)) {
                              if (!seen.has(key)) {
                                seen.add(key);
                                result.push({
                                  text: t.text,
                                  isError: !isIgnored,
                                  errorType: t.errorType || 'red',
                                  tooltip: t.tooltip,
                                  suggestion: t.suggestion,
                                  suggestions: t.suggestions || (t.suggestion ? [t.suggestion] : []),
                                  field: 'trans',
                                  isIgnored,
                                });
                              }
                            }
                          }
                        }
                      }

                      // Калі вылучанае слова знаходзіцца ў ігнараваных, але яго яшчэ няма ў result (для чырвоных памылак правапісу або ігнараваных вялікіх літар)
                      if (queryClean && !seen.has(queryClean)) {
                        if (ignoredWords.has(queryClean)) {
                          const testTokens = getBelarusianSpellTokens(queryWord, new Set(), { includeSuggestions: true, checkCapitalization: false, ignoredCapitalization: new Set() });
                          const errToken = testTokens.find(t => (t.isError || t.isIgnored) && t.errorType !== 'yellow');
                          if (errToken) {
                            seen.add(queryClean);
                            result.unshift({
                              text: queryWord,
                              isError: false,
                              errorType: errToken.errorType || 'red',
                              tooltip: errToken.tooltip || 'Памылка правапісу',
                              suggestion: errToken.suggestion,
                              suggestions: errToken.suggestions || (errToken.suggestion ? [errToken.suggestion] : []),
                              field: 'trans',
                              isIgnored: true,
                            });
                          }
                        } else if (ignoredCapitalization.has(queryClean)) {
                          const testTokens = getBelarusianSpellTokens(queryWord, new Set(), { includeSuggestions: true, checkCapitalization: true, ignoredCapitalization: new Set() });
                          const capToken = testTokens.find(t => (t.isError || t.isIgnored) && t.errorType === 'yellow' && t.tooltip === 'Гэты сказ пачынаецца не з вялікай літары');
                          if (capToken) {
                            seen.add(queryClean);
                            result.unshift({
                              text: queryWord,
                              isError: false,
                              errorType: 'yellow',
                              tooltip: capToken.tooltip || 'Гэты сказ пачынаецца не з вялікай літары',
                              suggestion: capToken.suggestion,
                              suggestions: capToken.suggestions || (capToken.suggestion ? [capToken.suggestion] : []),
                              field: 'trans',
                              isIgnored: true,
                            });
                          }
                        }
                      }

                      // Сартуем, каб вылучанае слова (калі мае памылку) ішло першым
                      if (queryClean) {
                        result.sort((a, b) => {
                          const aMatch = stripAccents(a.text).toLowerCase().trim() === queryClean;
                          const bMatch = stripAccents(b.text).toLowerCase().trim() === queryClean;
                          if (aMatch && !bMatch) return -1;
                          if (!aMatch && bMatch) return 1;
                          return 0;
                        });
                      }

                      // Калі ў картцы няма памылак — НІЧОГА не паказваем (ніякіх лішніх блокаў і надпісаў)
                      if (result.length === 0) {
                        return null;
                      }

                      return (
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-1 pb-2 border-b border-emerald-500/20">
                          {result.map((token, idx) => {
                            const isQueried = stripAccents(token.text).toLowerCase().trim() === queryClean;
                            const isCapWarning = token.errorType === 'yellow' && token.tooltip === 'Гэты сказ пачынаецца не з вялікай літары';
                            const isRedError = token.errorType !== 'yellow';
                            const canIgnore = isRedError || isCapWarning;
                            const isIgnored = token.isIgnored || (isCapWarning ? ignoredCapitalization.has(stripAccents(token.text).toLowerCase().trim()) : (isRedError && ignoredWords.has(stripAccents(token.text).toLowerCase().trim())));

                            // Ачышчаем лішнія шаблонныя надпісы (Магчымая памылка ... -> ужывайце ..., Памылка/русізм ... і г.д.)
                            let cleanTip = '';
                            if (token.tooltip) {
                              const raw = token.tooltip.trim();
                              if (
                                !/^магчымая памылка/i.test(raw) &&
                                !/^памылка\/русізм/i.test(raw) &&
                                !/^невядомае/i.test(raw) &&
                                raw !== 'Памылка правапісу' &&
                                !raw.includes('-> ужывайце')
                              ) {
                                cleanTip = raw;
                              }
                            }

                            // Збіраем усе ўнікальныя прапановы Hunspell / Дамераў-Левенштэйна з GrammarDB
                            const allSuggestions = Array.from(
                              new Set([
                                ...(token.suggestions || []),
                                ...(token.suggestion ? [token.suggestion] : [])
                              ])
                            ).filter((s) => Boolean(s) && s !== token.text);

                            return (
                              <div
                                key={idx}
                                className={`p-2 rounded-lg border flex flex-col gap-1.5 text-xs transition-colors ${
                                  isQueried
                                    ? (theme === 'dark' ? 'bg-amber-950/40 border-amber-500/50 shadow-xs' : 'bg-amber-50 border-amber-400 shadow-xs')
                                    : (theme === 'dark' ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-50/80 border-slate-200')
                                }`}
                              >
                                {/* 1. Верхні радок: слова + кнопка "Ігнараваць" (для чырвоных памылак і пачатку сказа) + кароткае правіла */}
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                                    <span className={`font-bold font-mono px-1.5 py-0.5 rounded text-[11px] border shrink-0 ${
                                      isIgnored
                                        ? (theme === 'dark' ? 'bg-slate-800/80 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-500 border-slate-300')
                                        : token.errorType === 'yellow'
                                          ? (theme === 'dark' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-amber-100 text-amber-950 border-amber-300 font-semibold')
                                          : (theme === 'dark' ? 'bg-red-500/20 text-red-300 border-red-500/40' : 'bg-red-100 text-red-950 border-red-300 font-semibold')
                                    }`}>
                                      "{token.text}"
                                    </span>

                                    {/* Кнопка "Ігнараваць" / "Паказваць" даступная для чырвоных памылак (заносяцца ў Гласарый) і для пачатку сказа з малой літары (ігнаруецца асобна, не заносіцца ў Гласарый) */}
                                    {canIgnore && (
                                      isIgnored ? (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isCapWarning) {
                                              handleUnignoreCapitalization(token.text);
                                            } else {
                                              handleUnignoreWord(token.text);
                                            }
                                          }}
                                          className={`px-2 py-0.5 text-[10.5px] font-bold rounded border flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
                                            theme === 'dark'
                                              ? 'bg-sky-950/80 hover:bg-sky-900 text-sky-300 border-sky-500/50 hover:text-white'
                                              : 'bg-sky-50 hover:bg-sky-100 text-sky-800 border-sky-300 shadow-2xs'
                                          }`}
                                          title="Вярнуць праверку і паказваць памылку"
                                        >
                                          <Eye className={`w-3 h-3 ${theme === 'dark' ? 'text-sky-400' : 'text-sky-600'}`} />
                                          Паказваць
                                        </button>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isCapWarning) {
                                              handleIgnoreCapitalization(token.text);
                                            } else {
                                              handleIgnoreWord(token.text);
                                            }
                                          }}
                                          className={`px-2 py-0.5 text-[10.5px] font-medium rounded border flex items-center gap-1 transition-colors cursor-pointer shrink-0 ${
                                            theme === 'dark'
                                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 hover:text-white'
                                              : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                                          }`}
                                          title={isCapWarning ? 'Ігнараваць папярэджанне пра вялікую літару' : 'Дадаць у гласарый і ігнараваць гэтую памылку'}
                                        >
                                          <EyeOff className={`w-3 h-3 ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`} />
                                          Ігнараваць
                                        </button>
                                      )
                                    )}

                                    {cleanTip ? (
                                      <span className={`text-[11px] leading-tight font-medium ${
                                        theme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                                      }`}>
                                        {cleanTip}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>

                                {/* 2. Ніжні радок: Прапановы выпраўленняў Hunspell / Дамераў-Левенштэйна з GrammarDB (калі слова не ігнаруецца) */}
                                {!isIgnored && allSuggestions.length > 0 && (
                                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                    {allSuggestions.map((sug, sIdx) => (
                                      <button
                                        key={sIdx}
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleFixWord(token.text, sug, token.field);
                                        }}
                                        className="px-2.5 py-1 text-[11px] font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                                        title={`Выправіць "${token.text}" -> "${sug}"`}
                                      >
                                        <Check className="w-3 h-3" />
                                        {sug}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* 2. НІЖНЯЯ ЗОНА: Граматычная база выдзеленага слова */}
                    <div className="flex flex-col gap-2">
                      {grammarDbResult.found && grammarDbResult.stressed ? (
                        <div className={`flex items-center justify-between gap-2 p-2.5 rounded-lg border ${
                          theme === 'dark'
                            ? 'bg-emerald-950/30 border-emerald-500/30'
                            : 'bg-emerald-50 border-emerald-200 text-slate-900 shadow-2xs'
                        }`}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              applyGrammarDbReplacement(grammarDbResult.stressed);
                            }}
                            className={`text-left font-extrabold cursor-pointer hover:underline transition-all ${
                              theme === 'dark' ? 'text-base text-emerald-300 hover:text-emerald-200' : 'text-base text-emerald-950 hover:text-emerald-700'
                            }`}
                            title={
                              grammarDbResult.sourceField === 'orig'
                                ? "Націсніце, каб уставіць форму з націскам у арыгінал"
                                : "Націсніце, каб уставіць форму з націскам у пераклад"
                            }
                          >
                            {grammarDbResult.stressed}
                          </button>
                          {grammarDbResult.phonetic && (
                            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                              theme === 'dark' ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50' : 'bg-white text-emerald-900 border-emerald-200'
                            }`}>
                              [{grammarDbResult.phonetic}]
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className={`p-2.5 rounded-lg border text-center flex flex-col gap-1.5 ${
                          theme === 'dark'
                            ? 'bg-slate-950/60 border-slate-800 text-slate-300'
                            : 'bg-slate-50 border-slate-200 text-slate-700'
                        }`}>
                          <span className="text-xs font-medium">
                            {grammarDbResult.errorMessage || (
                              grammarDbResult.query
                                ? `Слова «${grammarDbResult.query}» адсутнічае ў граматычнай базе`
                                : 'Слова не абрана'
                            )}
                          </span>
                          {grammarDbResult.suggestions && grammarDbResult.suggestions.length > 0 && (
                            <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                              {grammarDbResult.suggestions.map((sug, sIdx) => (
                                <button
                                  key={sIdx}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    applyGrammarDbReplacement(sug);
                                  }}
                                  className="px-2.5 py-1 text-[11px] font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                                  title={`Уставіць "${sug}"`}
                                >
                                  <Check className="w-3 h-3" />
                                  {sug}
                                </button>
                              ))}
                            </div>
                          )}
                          {grammarDbResult.dbReady === false && (
                            <span className="text-[11px] text-amber-400 font-normal">
                              База дадзеных (2.38M слоў) яшчэ рыхтуецца альбо патрабуецца пераапублікаваць праект.
                            </span>
                          )}
                        </div>
                      )}

                      {grammarDbResult.forms && grammarDbResult.forms.length > 0 && (
                        <div className="flex flex-col gap-1 mt-0.5">
                          <div className={`flex flex-wrap gap-1 max-h-36 overflow-y-auto p-1.5 rounded-lg border text-[11px] ${
                            theme === 'dark'
                              ? 'bg-slate-950/40 border-slate-800'
                              : 'bg-slate-50 border-slate-200'
                          }`}>
                            {grammarDbResult.forms.map((f, fIdx) => (
                              <button
                                key={fIdx}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  applyGrammarDbReplacement(f.stressed || f.word);
                                }}
                                className={`px-2 py-0.5 rounded cursor-pointer transition-colors border ${
                                  theme === 'dark'
                                    ? 'bg-emerald-950/60 hover:bg-emerald-800 text-emerald-200 border-emerald-800/80'
                                    : 'bg-white hover:bg-emerald-700 text-emerald-950 hover:text-white border-emerald-300 font-medium shadow-2xs'
                                }`}
                                title={
                                  grammarDbResult.sourceField === 'orig'
                                    ? "Націсніце, каб уставіць гэтую форму ў арыгінал"
                                    : "Націсніце, каб уставіць гэтую форму ў пераклад"
                                }
                              >
                                {f.stressed || f.word}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>,
                document.body
              )}

              {/* Standard Textarea */}
              <textarea
                ref={transTextareaRef}
                value={localTransText}
                onChange={(e) => handleTransTextChange(e.target.value)}
                onBlur={handleTransTextBlur}
                onScroll={(e) => {
                  if (transBackdropRef.current) {
                    transBackdropRef.current.scrollTop = e.currentTarget.scrollTop;
                    transBackdropRef.current.scrollLeft = e.currentTarget.scrollLeft;
                  }
                }}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                placeholder="Пераклад..."
                spellCheck={false}
                lang="be"
                style={{
                  fontFamily: 'Arial, Helvetica, sans-serif',
                  fontSize: `${fontSize}px`,
                  lineHeight: '1.45',
                  padding: '6px 10px',
                  margin: 0,
                  boxSizing: 'border-box',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
                className={`col-start-1 row-start-1 relative z-10 w-full h-full rounded-xl outline-none transition-colors resize-none border leading-normal overflow-hidden ${
                  theme === 'dark'
                    ? 'bg-slate-950 border-slate-900 focus:border-white text-slate-200 focus:ring-1 focus:ring-white/20'
                    : 'bg-white border-slate-300 text-slate-900 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 font-medium'
                }`}
              />
            </div>
          </div>
        </div>

      {/* Footer Controls & Voice widgets */}
      <div className={`flex flex-wrap items-center justify-between pt-1.5 border-t gap-1.5 ${
        theme === 'dark' ? 'border-slate-800' : 'border-slate-200'
      }`}>
        <div className="flex flex-wrap items-center gap-1">
          {/* Voiceover Speech synthesis trigger */}
          <button
            onClick={handleSynthesizeClick}
            disabled={isGenerating || !entry.translatedText?.trim()}
            className={`px-1.5 py-0.5 text-[8.5px] font-semibold border rounded-md transition-all flex items-center gap-0.5 ${
              entry.audioUrl
                ? theme === 'dark' ? 'bg-slate-950 border-slate-850 text-slate-400 hover:text-white' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                : theme === 'dark' ? 'bg-indigo-600/10 border-indigo-500/20 text-indigo-400 hover:bg-indigo-600/25' : 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100'
            } ${!entry.translatedText?.trim() ? 'opacity-50 cursor-not-allowed' : ''}`}
            title={entry.translatedText?.trim() ? "Агучыць пераклад" : "Спачатку перакладзіце альбо ўвядзіце тэкст перакладу"}
          >
            {isGenerating ? (
              <RefreshCw className="h-2 w-2 animate-spin text-slate-400 shrink-0" />
            ) : (
              <Volume2 className="h-2 w-2 shrink-0" />
            )}
            агучыць
          </button>

          {/* Generated Wave Sound Widget */}
          {entry.audioUrl && (
            <>
              <button
                onClick={handlePlayAudio}
                className={`px-1.5 py-0.5 border font-semibold rounded-md transition-all text-[8.5px] flex items-center gap-0.5 animate-fade-in cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-indigo-950/40 hover:bg-indigo-900/50 border-slate-850 text-indigo-300 hover:text-indigo-100'
                    : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700 hover:text-indigo-900'
                }`}
                title="Прайграць сінтэзаванае агучванне"
              >
                <Play className="h-2 w-2 fill-current shrink-0 text-indigo-500 dark:text-indigo-400" />
                слухаць
              </button>
              <div 
                className={`flex items-center gap-0.5 px-1 py-0.5 rounded-md border text-[8.5px] animate-fade-in ${
                  theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-400' : 'bg-slate-100 border-slate-200 text-slate-700'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="font-medium text-[8px]">хуткасць:</span>
                <select
                  value={entry.audioSpeed || 1.0}
                  onChange={(e) => onUpdate({ audioSpeed: parseFloat(e.target.value) })}
                  className="bg-transparent text-amber-500 font-bold border-none outline-none focus:ring-0 cursor-pointer text-[8.5px] p-0 pr-0.5 select-none font-mono"
                >
                  <option value="0.1" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>0.1x</option>
                  <option value="0.25" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>0.25x</option>
                  <option value="0.5" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>0.5x</option>
                  <option value="0.75" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>0.75x</option>
                  <option value="1" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>1.0x</option>
                  <option value="1.25" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>1.25x</option>
                  <option value="1.5" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>1.5x</option>
                  <option value="1.75" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>1.75x</option>
                  <option value="2" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>2.0x</option>
                </select>
              </div>
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  const speed = entry.audioSpeed || 1.0;
                  const safeStartTime = entry.startTime.replace(/[:]/g, '-').replace(/,/g, '_');
                  const filename = `${safeStartTime}_${selectedVoice}.wav`;

                  setIsDownloading(true);
                  try {
                    let audioBlob: Blob | null = null;

                    audioBlob = await stretchSingleAudio(entry.audioUrl || '', speed, entry.id);

                    if (!audioBlob) {
                      throw new Error('Не ўдалося атрымаць аўдыяфайл');
                    }

                    const downloadUrl = URL.createObjectURL(audioBlob);
                    const link = document.createElement('a');
                    link.href = downloadUrl;
                    link.download = filename;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
                  } catch (err) {
                    console.error("Error stretching or downloading single voiceover:", err);
                  } finally {
                    setIsDownloading(false);
                  }
                }}
                disabled={isDownloading}
                className={`px-1.5 py-0.5 border font-semibold rounded-md transition-all text-[8.5px] flex items-center gap-0.5 shadow-xs animate-fade-in disabled:opacity-50 ${
                  theme === 'dark'
                    ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 hover:text-white'
                    : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800'
                }`}
                title="Спампаваць згенераваную агучку карткі"
              >
                {isDownloading ? (
                  <RefreshCw className="h-2 w-2 animate-spin shrink-0" />
                ) : (
                  <Download className="h-2 w-2 shrink-0" />
                )}
                зах.агучку
              </button>

              {/* Delete single card voiceover button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (entry.audioUrl && entry.audioUrl.startsWith('blob:')) {
                    try {
                      URL.revokeObjectURL(entry.audioUrl);
                    } catch (err) {
                      // ignore
                    }
                  }
                  onUpdate({ audioUrl: undefined, audioError: undefined });
                }}
                className={`px-1 py-0.5 border rounded-md transition-all text-[8.5px] flex items-center justify-center shadow-xs animate-fade-in cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-slate-800 hover:bg-red-500/20 border-slate-700 hover:border-red-500/40 text-slate-400 hover:text-red-400'
                    : 'bg-slate-100 hover:bg-red-50 border-slate-300 hover:border-red-300 text-slate-600 hover:text-red-600'
                }`}
                title="Выдаліць агучку гэтай карткі"
              >
                <Trash2 className="h-2.5 w-2.5 shrink-0" />
              </button>
            </>
          )}

          {entry.audioError && (() => {
            const isLimitError = 
              entry.audioError.includes('ліміт') || 
              entry.audioError.includes('Ліміт') || 
              entry.audioError.includes('Quota') || 
              entry.audioError.includes('quota') || 
              entry.audioError.includes('limit') || 
              entry.audioError.includes('429') || 
              entry.audioError.includes('RESOURCE_EXHAUSTED');

            return (
              <span 
                className={`text-[8.5px] flex items-center gap-0.5 px-1 py-0.5 rounded border select-none ${
                  isLimitError
                    ? 'text-amber-500 bg-amber-500/10 border-amber-500/25'
                    : 'text-red-500 bg-red-500/10 border-red-500/25'
                }`}
                title={
                  isLimitError
                    ? "Дзённы ліміт квоты мадэлі Gemini AI. Выберыце 'TTS Маруся' у верхнім меню для неабмежаванага агучвання."
                    : entry.audioError
                }
              >
                <AlertCircle className="h-2 w-2 shrink-0" />
                <span>
                  {isLimitError ? 'Ліміт API' : (entry.audioError || 'Памылка сінтэзу')}
                </span>
              </span>
            );
          })()}
        </div>
        
        <div className="flex items-center gap-1 ml-auto shrink-0">
          {/* Add subtitle line before this card */}
          <button
            onClick={(e) => { e.stopPropagation(); onAddBefore(); }}
            className={`px-1.5 py-0.5 rounded-md transition-all text-[8.5px] font-semibold flex items-center gap-0.5 border ${
              theme === 'dark'
                ? 'text-indigo-400/90 hover:text-indigo-300 bg-indigo-950/10 hover:bg-indigo-950/30 border-indigo-500/20 hover:border-indigo-500/40'
                : 'text-slate-500 hover:text-slate-800 bg-slate-100/70 hover:bg-slate-200/80 border-slate-200 hover:border-slate-300'
            }`}
            title="Дадаць новую картку перад гэтай (з бягучага часу плэера або перад карткай)"
          >
            <ArrowUp className="h-2 w-2 shrink-0" />
            + картку
          </button>
 
          {/* Add subtitle line after this card */}
          <button
            onClick={(e) => { e.stopPropagation(); onAddAfter(); }}
            className={`px-1.5 py-0.5 rounded-md transition-all text-[8.5px] font-semibold flex items-center gap-0.5 border ${
              theme === 'dark'
                ? 'text-indigo-400/90 hover:text-indigo-300 bg-indigo-950/10 hover:bg-indigo-950/30 border-indigo-500/20 hover:border-indigo-500/40'
                : 'text-slate-500 hover:text-slate-800 bg-slate-100/70 hover:bg-slate-200/80 border-slate-200 hover:border-slate-300'
            }`}
            title="Дадаць новую картку пасля гэтай (з бягучага часу плэера або пасля карткі)"
          >
            <ArrowDown className="h-2 w-2 shrink-0" />
            + картку
          </button>

          {/* Delete row button */}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className={`px-1.5 py-0.5 rounded-md transition-all border flex items-center justify-center ${
              theme === 'dark'
                ? 'text-red-400 hover:text-red-350 bg-red-950/10 hover:bg-red-950/25 border-red-500/10 hover:border-red-500/30 opacity-60 hover:opacity-100'
                : 'text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 border-red-200'
            }`}
            title="Выдаліць картку"
          >
            <Trash2 className="h-2.5 w-2.5 shrink-0" />
          </button>
        </div>
      </div>

      {/* Verbum.by Dictionary Modal */}
      {isVerbumModalOpen && (
        <VerbumDictionaryModal
          isOpen={isVerbumModalOpen}
          onClose={() => setIsVerbumModalOpen(false)}
          initialQuery={verbumSearchQuery}
          theme={theme}
          onApplyWord={handleApplyVerbumWord}
        />
      )}

    </div>
  );
};

export default React.memo(SubtitleItem, (prevProps, nextProps) => {
  return (
    prevProps.theme === nextProps.theme &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isOverlapping === nextProps.isOverlapping &&
    prevProps.index === nextProps.index &&
    prevProps.selectedVoice === nextProps.selectedVoice &&
    prevProps.autoSpellCheck === nextProps.autoSpellCheck &&
    prevProps.previousText === nextProps.previousText &&
    prevProps.hunspellRevision === nextProps.hunspellRevision &&
    prevProps.entry.id === nextProps.entry.id &&
    prevProps.entry.text === nextProps.entry.text &&
    prevProps.entry.translatedText === nextProps.entry.translatedText &&
    prevProps.entry.actor === nextProps.entry.actor &&
    prevProps.entry.originalActor === nextProps.entry.originalActor &&
    prevProps.entry.startTime === nextProps.entry.startTime &&
    prevProps.entry.endTime === nextProps.entry.endTime &&
    prevProps.entry.audioUrl === nextProps.entry.audioUrl &&
    prevProps.entry.audioSpeed === nextProps.entry.audioSpeed &&
    prevProps.entry.isGeneratingAudio === nextProps.entry.isGeneratingAudio &&
    prevProps.entry.audioError === nextProps.entry.audioError &&
    prevProps.entry.proofreadIssues === nextProps.entry.proofreadIssues &&
    prevProps.fontSize === nextProps.fontSize
  );
});
