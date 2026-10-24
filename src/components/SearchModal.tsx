/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  X, 
  ChevronUp, 
  ChevronDown, 
  Clock, 
  FileText, 
  Languages, 
  User, 
  Check,
  Replace,
  Undo2,
  Redo2
} from 'lucide-react';
import { SubtitleEntry } from '../types';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  subtitles: SubtitleEntry[];
  activeSubtitleIndex: number;
  onSelectSubtitle: (index: number) => void;
  onUpdateSubtitles?: (updatedSubtitles: SubtitleEntry[], toastMessage?: string) => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  theme?: 'dark' | 'light';
}

type SearchScope = 'all' | 'original' | 'translation' | 'actor';

interface SearchMatch {
  subtitleIndex: number;
  entry: SubtitleEntry;
  matchedInOriginal: boolean;
  matchedInTranslation: boolean;
  matchedInActor: boolean;
  matchedInOrigActor: boolean;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  subtitles,
  activeSubtitleIndex,
  onSelectSubtitle,
  onUpdateSubtitles,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';
  const [query, setQuery] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      if (matches.length > 0) {
        const target = matches[currentMatchIdx] || matches[0];
        if (target) {
          onSelectSubtitle(target.subtitleIndex);
        }
      }
    }
  }, [isOpen]);

  // Compute matches
  const matches: SearchMatch[] = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return [];

    let regex: RegExp;
    try {
      const flags = (caseSensitive ? 'g' : 'gi') + 'u';
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord
        ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
        : escaped;
      regex = new RegExp(pattern, flags);
    } catch {
      return [];
    }

    const list: SearchMatch[] = [];

    subtitles.forEach((sub, idx) => {
      regex.lastIndex = 0;
      const inOrig = Boolean(sub.text && regex.test(sub.text));
      regex.lastIndex = 0;
      const inTrans = Boolean(sub.translatedText && regex.test(sub.translatedText));
      regex.lastIndex = 0;
      const inActor = Boolean(sub.actor && regex.test(sub.actor));
      regex.lastIndex = 0;
      const inOrigActor = Boolean(sub.originalActor && regex.test(sub.originalActor));
      regex.lastIndex = 0;

      let isMatch = false;
      if (scope === 'all') {
        isMatch = inOrig || inTrans || inActor || inOrigActor;
      } else if (scope === 'original') {
        isMatch = inOrig;
      } else if (scope === 'translation') {
        isMatch = inTrans;
      } else if (scope === 'actor') {
        isMatch = inActor || inOrigActor;
      }

      if (isMatch) {
        list.push({
          subtitleIndex: idx,
          entry: sub,
          matchedInOriginal: inOrig,
          matchedInTranslation: inTrans,
          matchedInActor: inActor,
          matchedInOrigActor: inOrigActor,
        });
      }
    });

    return list;
  }, [query, scope, caseSensitive, wholeWord, subtitles]);

  const prevSearchRef = useRef({ query, scope, caseSensitive, wholeWord });

  // Reset match index and make first found card active (with checkmark) when search query or options change
  useEffect(() => {
    if (!isOpen) return;
    const prev = prevSearchRef.current;
    const searchChanged =
      prev.query !== query ||
      prev.scope !== scope ||
      prev.caseSensitive !== caseSensitive ||
      prev.wholeWord !== wholeWord;

    if (searchChanged) {
      prevSearchRef.current = { query, scope, caseSensitive, wholeWord };
      setCurrentMatchIdx(0);
      if (matches.length > 0) {
        onSelectSubtitle(matches[0].subtitleIndex);
      }
    }
  }, [isOpen, query, scope, caseSensitive, wholeWord, matches, onSelectSubtitle]);

  // Keep currentMatchIdx in bounds when matches list changes
  useEffect(() => {
    if (!isOpen) return;

    if (matches.length === 0) {
      if (currentMatchIdx !== 0) {
        setCurrentMatchIdx(0);
      }
      return;
    }

    if (currentMatchIdx >= matches.length) {
      const clamped = matches.length - 1;
      setCurrentMatchIdx(clamped);
      if (matches[clamped]) {
        onSelectSubtitle(matches[clamped].subtitleIndex);
      }
    }
  }, [isOpen, matches, currentMatchIdx, onSelectSubtitle]);

  // Navigate to current match
  const jumpToMatch = useCallback((idx: number) => {
    if (idx < 0 || idx >= matches.length) return;
    setCurrentMatchIdx(idx);
    const target = matches[idx];
    if (target) {
      onSelectSubtitle(target.subtitleIndex);
    }
  }, [matches, onSelectSubtitle]);

  // Auto-scroll active match item into view inside modal list
  useEffect(() => {
    if (!resultsContainerRef.current || matches.length === 0) return;
    const activeEl = resultsContainerRef.current.querySelector(
      `[data-match-idx="${currentMatchIdx}"]`
    ) as HTMLElement | null;

    if (activeEl) {
      activeEl.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentMatchIdx, matches]);

  const handleNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    const next = (currentMatchIdx + 1) % matches.length;
    jumpToMatch(next);
  }, [matches.length, currentMatchIdx, jumpToMatch]);

  const handlePrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    const prev = (currentMatchIdx - 1 + matches.length) % matches.length;
    jumpToMatch(prev);
  }, [matches.length, currentMatchIdx, jumpToMatch]);

  // Replacement logic for the currently selected card (matches[currentMatchIdx])
  const handleReplaceSingle = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || matches.length === 0 || !onUpdateSubtitles || !replaceText.trim()) return;

    const currentMatch = matches[currentMatchIdx] || matches[0];
    if (!currentMatch) return;

    const targetIdx = currentMatch.subtitleIndex;
    const targetSub = subtitles[targetIdx];
    if (!targetSub) return;

    let regex: RegExp;
    try {
      const flags = (caseSensitive ? 'g' : 'gi') + 'u';
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord
        ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
        : escaped;
      regex = new RegExp(pattern, flags);
    } catch {
      return;
    }

    const replaceInStr = (str: string | undefined): { newStr: string; changed: boolean } => {
      if (!str) return { newStr: '', changed: false };
      regex.lastIndex = 0;
      if (!regex.test(str)) return { newStr: str, changed: false };
      regex.lastIndex = 0;
      const newStr = str.replace(regex, () => replaceText);
      return { newStr, changed: newStr !== str };
    };

    let textChanged = false;
    let transChanged = false;
    let actorChanged = false;

    let newText = targetSub.text;
    let newTrans = targetSub.translatedText;
    let newActor = targetSub.actor;
    let newOrigActor = targetSub.originalActor;

    if (scope === 'all' || scope === 'original') {
      const res = replaceInStr(targetSub.text);
      if (res.changed) {
        newText = res.newStr;
        textChanged = true;
      }
    }

    if (scope === 'all' || scope === 'translation') {
      const res = replaceInStr(targetSub.translatedText);
      if (res.changed) {
        newTrans = res.newStr;
        transChanged = true;
      }
    }

    if (scope === 'all' || scope === 'actor') {
      if (targetSub.actor) {
        const res = replaceInStr(targetSub.actor);
        if (res.changed) {
          newActor = res.newStr;
          actorChanged = true;
        }
      }
      if (targetSub.originalActor) {
        const res = replaceInStr(targetSub.originalActor);
        if (res.changed) {
          newOrigActor = res.newStr;
          actorChanged = true;
        }
      }
    }

    if (!textChanged && !transChanged && !actorChanged) {
      return;
    }

    const updatedSub: SubtitleEntry = {
      ...targetSub,
      text: newText,
      translatedText: newTrans,
      actor: newActor,
      originalActor: newOrigActor,
    };

    if (textChanged || transChanged) {
      if (targetSub.audioUrl) {
        URL.revokeObjectURL(targetSub.audioUrl);
        updatedSub.audioUrl = undefined;
      }
    }
    if (transChanged) {
      updatedSub.proofreadIssues = undefined;
    }

    const nextSubtitles = subtitles.map((s, i) => (i === targetIdx ? updatedSub : s));
    onUpdateSubtitles(nextSubtitles, `Заменена ў картцы #${targetIdx + 1}`);
  }, [
    query,
    replaceText,
    matches,
    currentMatchIdx,
    subtitles,
    scope,
    caseSensitive,
    wholeWord,
    onUpdateSubtitles,
  ]);

  // Replacement logic across all cards
  const handleReplaceAll = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed || matches.length === 0 || !onUpdateSubtitles || !replaceText.trim()) return;

    let regex: RegExp;
    try {
      const flags = (caseSensitive ? 'g' : 'gi') + 'u';
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord
        ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
        : escaped;
      regex = new RegExp(pattern, flags);
    } catch {
      return;
    }

    const replaceInStr = (str: string | undefined): { newStr: string; changed: boolean } => {
      if (!str) return { newStr: '', changed: false };
      regex.lastIndex = 0;
      if (!regex.test(str)) return { newStr: str, changed: false };
      regex.lastIndex = 0;
      const newStr = str.replace(regex, () => replaceText);
      return { newStr, changed: newStr !== str };
    };

    let modifiedCards = 0;

    const nextSubtitles = subtitles.map((sub) => {
      let textChanged = false;
      let transChanged = false;
      let actorChanged = false;

      let newText = sub.text;
      let newTrans = sub.translatedText;
      let newActor = sub.actor;
      let newOrigActor = sub.originalActor;

      if (scope === 'all' || scope === 'original') {
        const res = replaceInStr(sub.text);
        if (res.changed) {
          newText = res.newStr;
          textChanged = true;
        }
      }

      if (scope === 'all' || scope === 'translation') {
        const res = replaceInStr(sub.translatedText);
        if (res.changed) {
          newTrans = res.newStr;
          transChanged = true;
        }
      }

      if (scope === 'all' || scope === 'actor') {
        if (sub.actor) {
          const res = replaceInStr(sub.actor);
          if (res.changed) {
            newActor = res.newStr;
            actorChanged = true;
          }
        }
        if (sub.originalActor) {
          const res = replaceInStr(sub.originalActor);
          if (res.changed) {
            newOrigActor = res.newStr;
            actorChanged = true;
          }
        }
      }

      if (textChanged || transChanged || actorChanged) {
        modifiedCards++;
        const updatedSub: SubtitleEntry = {
          ...sub,
          text: newText,
          translatedText: newTrans,
          actor: newActor,
          originalActor: newOrigActor,
        };

        if (textChanged || transChanged) {
          if (sub.audioUrl) {
            URL.revokeObjectURL(sub.audioUrl);
            updatedSub.audioUrl = undefined;
          }
        }
        if (transChanged) {
          updatedSub.proofreadIssues = undefined;
        }
        return updatedSub;
      }

      return sub;
    });

    if (modifiedCards > 0) {
      onUpdateSubtitles(nextSubtitles, `Заменена ва ўсіх картках (${modifiedCards} шт.)`);
    }
  }, [
    query,
    replaceText,
    matches,
    subtitles,
    scope,
    caseSensitive,
    wholeWord,
    onUpdateSubtitles,
  ]);

  // Handle keyboard shortcuts inside modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        if (document.activeElement === replaceInputRef.current) {
          handleReplaceSingle();
        } else {
          if (e.shiftKey) {
            handlePrevMatch();
          } else {
            handleNextMatch();
          }
        }
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      if (cmdOrCtrl && (e.code === 'KeyF' || e.key === 'f' || e.key === 'F' || e.key === 'а' || e.key === 'А')) {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose, handleNextMatch, handlePrevMatch, handleReplaceSingle]);

  // Helper to highlight matched query in text
  const highlightText = (text: string | undefined, isMatched: boolean) => {
    if (!text) return <span className="opacity-40 italic">няма тэксту</span>;
    if (!isMatched || !query.trim()) return <span>{text}</span>;

    try {
      const flags = (caseSensitive ? 'g' : 'gi') + 'u';
      const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = wholeWord
        ? `(?<![\\p{L}\\p{N}_])(${escaped})(?![\\p{L}\\p{N}_])`
        : `(${escaped})`;
      const regex = new RegExp(pattern, flags);
      const parts = text.split(regex);

      return (
        <span>
          {parts.map((part, i) => {
            const isMatch = caseSensitive
              ? part === query.trim()
              : part.toLowerCase() === query.trim().toLowerCase();
            return isMatch ? (
              <mark
                key={i}
                className={`px-0.5 py-0.2 rounded font-semibold ${
                  isDark
                    ? 'bg-amber-400/30 text-amber-200 ring-1 ring-amber-400/50'
                    : 'bg-amber-300 text-amber-950 font-bold'
                }`}
              >
                {part}
              </mark>
            ) : (
              <span key={i}>{part}</span>
            );
          })}
        </span>
      );
    } catch {
      return <span>{text}</span>;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 pt-12 sm:pt-16 bg-black/60 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-2xl rounded-2xl shadow-2xl border flex flex-col overflow-hidden max-h-[85vh] ${
              isDark
                ? 'bg-slate-900 border-slate-700/80 text-slate-100 shadow-purple-950/40'
                : 'bg-white border-slate-200 text-slate-800 shadow-slate-300/60'
            }`}
          >
            {/* Header & Search Bar */}
            <div className={`px-3.5 py-2.5 sm:px-4 sm:py-3 border-b flex flex-col gap-2 ${isDark ? 'border-slate-800 bg-slate-900/90' : 'border-slate-200 bg-slate-50/80'}`}>
              <div className="flex items-center justify-end -mb-1">
                <button
                  type="button"
                  onClick={onClose}
                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                    isDark ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
                  }`}
                  title="Закрыць (Esc)"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Main Input Row */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                <div className={`flex items-center flex-1 rounded-lg border px-2.5 py-1 sm:py-1.5 transition-all ${
                  isDark
                    ? 'bg-slate-950 border-slate-700 focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/20'
                    : 'bg-white border-slate-300 focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-400/20'
                }`}>
                  <Search className={`w-3.5 h-3.5 mr-1.5 shrink-0 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Увядзіце слова ці фразу для пошуку..."
                    className="w-full bg-transparent border-none outline-hidden text-xs sm:text-sm placeholder:text-slate-500"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery('');
                        inputRef.current?.focus();
                      }}
                      className="text-slate-400 hover:text-slate-200 p-0.5 cursor-pointer rounded shrink-0"
                      title="Ачысціць"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Match Counter & Prev/Next */}
                <div className="flex items-center gap-1 shrink-0">
                  <div className={`text-[11px] sm:text-xs font-mono px-2 py-1 sm:py-1.5 rounded-lg border font-bold min-w-[58px] sm:min-w-[66px] text-center ${
                    matches.length > 0
                      ? isDark
                        ? 'bg-purple-950/40 text-purple-300 border-purple-800/60'
                        : 'bg-purple-50 text-purple-800 border-purple-200'
                      : isDark
                        ? 'bg-slate-800/60 text-slate-500 border-slate-700'
                        : 'bg-slate-100 text-slate-400 border-slate-200'
                  }`}>
                    {query.trim() ? (matches.length > 0 ? `${currentMatchIdx + 1} / ${matches.length}` : '0') : `${subtitles.length}`}
                  </div>

                  <button
                    type="button"
                    disabled={matches.length === 0}
                    onClick={handlePrevMatch}
                    title="Папярэдняе супадзенне (Shift+Enter)"
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                      isDark
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                        : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    disabled={matches.length === 0}
                    onClick={handleNextMatch}
                    title="Наступнае супадзенне (Enter)"
                    className={`p-1.5 rounded-lg border transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                      isDark
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                        : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200'
                    }`}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Replace Row */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                <div className={`flex items-center flex-1 rounded-lg border px-2.5 py-1 sm:py-1.5 transition-all ${
                  isDark
                    ? 'bg-slate-950 border-slate-700 focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500/20'
                    : 'bg-white border-slate-300 focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-400/20'
                }`}>
                  <Replace className={`w-3.5 h-3.5 mr-1.5 shrink-0 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                  <input
                    ref={replaceInputRef}
                    type="text"
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    placeholder="На што замяніць"
                    className="w-full bg-transparent border-none outline-hidden text-xs sm:text-sm placeholder:text-slate-500"
                  />
                  {replaceText && (
                    <button
                      type="button"
                      onClick={() => {
                        setReplaceText('');
                        replaceInputRef.current?.focus();
                      }}
                      className="text-slate-400 hover:text-slate-200 p-0.5 cursor-pointer rounded shrink-0"
                      title="Ачысціць"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Grey Replacement Buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={!query.trim() || matches.length === 0 || !replaceText.trim()}
                    onClick={handleReplaceAll}
                    title="Замяніць ва ўсіх картках"
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed ${
                      isDark
                        ? 'bg-slate-800 hover:bg-slate-700 active:bg-slate-650 text-slate-200 hover:text-white border-slate-700 hover:border-slate-600'
                        : 'bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-800 hover:text-slate-900 border-slate-300 hover:border-slate-400'
                    }`}
                  >
                    замяніць усё
                  </button>

                  <button
                    type="button"
                    disabled={!query.trim() || matches.length === 0 || !matches[currentMatchIdx] || !replaceText.trim()}
                    onClick={handleReplaceSingle}
                    title="Замяніць у выбранай картцы"
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-lg border transition-all cursor-pointer select-none disabled:opacity-40 disabled:cursor-not-allowed ${
                      isDark
                        ? 'bg-slate-800 hover:bg-slate-700 active:bg-slate-650 text-slate-200 hover:text-white border-slate-700 hover:border-slate-600'
                        : 'bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-800 hover:text-slate-900 border-slate-300 hover:border-slate-400'
                    }`}
                  >
                    замяніць
                  </button>
                </div>
              </div>

              {/* Scopes & Options Filter Row */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                {/* Scope buttons */}
                <div className="flex items-center gap-1">
                  <span className={`text-[11px] font-semibold mr-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Дзе:
                  </span>
                  {(
                    [
                      { id: 'all', label: 'Усюды' },
                      { id: 'original', label: 'Арыгінал' },
                      { id: 'translation', label: 'Пераклад' },
                      { id: 'actor', label: 'Роля' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setScope(tab.id)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer border ${
                        scope === tab.id
                          ? isDark
                            ? 'bg-purple-600 text-white border-purple-500 shadow-xs'
                            : 'bg-purple-600 text-white border-purple-600 shadow-xs'
                          : isDark
                            ? 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-800 hover:text-slate-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}

                  {/* Undo / Redo controls right after "Роля" */}
                  <div className={`flex items-center gap-0.5 ml-1 pl-1.5 border-l ${
                    isDark ? 'border-slate-800' : 'border-slate-200'
                  }`}>
                    <button
                      type="button"
                      onClick={onUndo}
                      disabled={!canUndo}
                      title="Адмяніць апошняе дзеянне (Ctrl+Z)"
                      className={`p-1 rounded-md transition-colors ${
                        canUndo
                          ? isDark
                            ? 'hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer'
                            : 'hover:bg-slate-200 text-slate-700 hover:text-slate-900 cursor-pointer'
                          : 'opacity-30 cursor-not-allowed text-slate-500'
                      }`}
                    >
                      <Undo2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={onRedo}
                      disabled={!canRedo}
                      title="Вярнуць дзеянне (Ctrl+Y / Ctrl+Shift+Z)"
                      className={`p-1 rounded-md transition-colors ${
                        canRedo
                          ? isDark
                            ? 'hover:bg-slate-800 text-slate-300 hover:text-white cursor-pointer'
                            : 'hover:bg-slate-200 text-slate-700 hover:text-slate-900 cursor-pointer'
                          : 'opacity-30 cursor-not-allowed text-slate-500'
                      }`}
                    >
                      <Redo2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Match options */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCaseSensitive((prev) => !prev)}
                    className={`px-2 py-1 text-xs font-mono font-bold rounded-lg border transition-all cursor-pointer ${
                      caseSensitive
                        ? isDark
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/50'
                          : 'bg-purple-100 text-purple-800 border-purple-300'
                        : isDark
                          ? 'bg-slate-800/40 text-slate-500 border-slate-700/50 hover:text-slate-300'
                          : 'bg-slate-100 text-slate-500 border-slate-200 hover:text-slate-700'
                    }`}
                    title="Улічваць рэгістр (Aa)"
                  >
                    Aa
                  </button>

                  <button
                    type="button"
                    onClick={() => setWholeWord((prev) => !prev)}
                    className={`px-2 py-1 text-xs font-mono font-bold rounded-lg border transition-all cursor-pointer ${
                      wholeWord
                        ? isDark
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/50'
                          : 'bg-purple-100 text-purple-800 border-purple-300'
                        : isDark
                          ? 'bg-slate-800/40 text-slate-500 border-slate-700/50 hover:text-slate-300'
                          : 'bg-slate-100 text-slate-500 border-slate-200 hover:text-slate-700'
                    }`}
                    title="Цэлыя словы"
                  >
                    [w]
                  </button>
                </div>
              </div>
            </div>

            {/* Results List */}
            <div 
              ref={resultsContainerRef}
              className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 max-h-[55vh]"
            >
              {!query.trim() ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <Search className={`w-8 h-8 opacity-30 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
                  <p className={`text-xs font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Увядзіце тэкст для пошуку па ўсіх {subtitles.length} картках субцітраў
                  </p>
                  <span className={`text-[11px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                    Выкарыстоўвайце Enter / Shift+Enter для хуткага пераходу
                  </span>
                </div>
              ) : matches.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
                  <div className={`p-3 rounded-full ${isDark ? 'bg-slate-800/60 text-slate-500' : 'bg-slate-100 text-slate-400'}`}>
                    <Search className="w-6 h-6" />
                  </div>
                  <p className={`text-sm font-semibold ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                    Нічога не знойдзена
                  </p>
                  <p className={`text-xs ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                    Па запыце «{query}» у абранай вобласці няма супадзенняў
                  </p>
                </div>
              ) : (
                matches.map((match, idx) => {
                  const isCurrent = idx === currentMatchIdx;
                  const isSelectedInApp = isCurrent || match.subtitleIndex === activeSubtitleIndex;

                  return (
                    <div
                      key={match.entry.id}
                      data-match-idx={idx}
                      onClick={() => {
                        jumpToMatch(idx);
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 ${
                        isCurrent
                          ? isDark
                            ? 'bg-purple-950/30 border-purple-500 ring-2 ring-purple-500/30'
                            : 'bg-purple-50/80 border-purple-400 ring-2 ring-purple-400/30 shadow-xs'
                          : isDark
                            ? 'bg-slate-800/40 border-slate-750 hover:bg-slate-800/80 hover:border-slate-600'
                            : 'bg-slate-50 border-slate-200/90 hover:bg-slate-100/90 hover:border-slate-300'
                      }`}
                    >
                      {/* Top Bar: Subtitle #, Time range, Actor, Badge */}
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold text-[11px] select-none transition-colors ${
                            isCurrent
                              ? 'text-purple-600 dark:text-purple-400'
                              : isDark
                                ? 'text-slate-400'
                                : 'text-slate-500'
                          }`}>
                            #{match.subtitleIndex + 1}
                          </span>

                          <div className={`flex items-center gap-1 font-mono text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span>{match.entry.startTime} → {match.entry.endTime}</span>
                          </div>

                          {/* Original actor / role */}
                          {match.entry.originalActor && (
                            <span 
                              title="Роля арыгінала"
                              className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                match.matchedInOrigActor
                                  ? isDark
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : isDark
                                    ? 'bg-slate-800 text-slate-400'
                                    : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              <User className="w-2.5 h-2.5 opacity-70" />
                              {highlightText(match.entry.originalActor, match.matchedInOrigActor)}
                            </span>
                          )}

                          {/* Translation actor / role */}
                          {match.entry.actor && (
                            <span 
                              title="Роля перакладу"
                              className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                match.matchedInActor
                                  ? isDark
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                                  : isDark
                                    ? 'bg-slate-800 text-slate-400'
                                    : 'bg-slate-200 text-slate-600'
                              }`}
                            >
                              <User className="w-2.5 h-2.5" />
                              {highlightText(match.entry.actor, match.matchedInActor)}
                            </span>
                          )}
                        </div>

                        {isSelectedInApp && (
                          <span 
                            title="Актыўны субцітр" 
                            className={`p-0.5 rounded-full ${
                              isDark ? 'text-emerald-400 bg-emerald-500/10' : 'text-emerald-700 bg-emerald-100'
                            }`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>

                      {/* Content: Original (Top) & Translation (Bottom) */}
                      <div className="flex flex-col gap-1 text-xs">
                        {/* Content: Original */}
                        {match.entry.text && (
                          <div className="flex items-start gap-1.5">
                            <FileText className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${match.matchedInOriginal ? 'text-purple-400' : isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                            <div className={`leading-relaxed break-words font-medium ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                              {highlightText(match.entry.text, match.matchedInOriginal)}
                            </div>
                          </div>
                        )}

                        {/* Content: Translation */}
                        <div className={`flex items-start gap-1.5 ${match.entry.text ? 'mt-0.5 pt-1 border-t ' + (isDark ? 'border-slate-800/80' : 'border-slate-200/80') : ''}`}>
                          <Languages className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${match.matchedInTranslation ? 'text-purple-400' : isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                          <div className={`leading-relaxed break-words font-medium ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>
                            {highlightText(match.entry.translatedText, match.matchedInTranslation)}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
