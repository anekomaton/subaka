/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

import React, { useRef, useState, useEffect } from 'react';
import { 
  Upload, 
  Mic, 
  Download, 
  Volume2, 
  Sun, 
  Moon,
  ChevronDown,
  FileText,
  FileCode,
  Users,
  Undo2,
  Redo2,
  Keyboard,
  Search,
  Type,
  Minus,
  Plus,
  Film,
  Key,
  BookMarked,
  HelpCircle
} from 'lucide-react';
import { SubtitleEntry } from '../types';
import { parseSubtitleContent } from '../utils/assParser';
import { SubakaLogo } from './SubakaLogo';
import { isTauriDesktop } from '../utils/tauriBridge';

interface HeaderProps {
  geminiApiKey?: string;
  onOpenGeminiKeyModal?: () => void;
  onSubtitlesLoaded: (entries: SubtitleEntry[], autoTranslateSelected: boolean, format?: 'srt' | 'ass', rawHeader?: string) => void;
  onTranslationSubtitlesLoaded: (entries: SubtitleEntry[]) => void;
  onMediaFileLoaded?: (file: File) => void;
  subtitles: SubtitleEntry[];
  mediaFile?: File | null;
  mediaFileName?: string;
  onDownloadOriginalSrt: () => void;
  onDownloadOriginalAss: () => void;
  onDownloadTranslatedSrt: () => void;
  onDownloadTranslatedAss: () => void;
  onDownloadTranslatedByActorSrt: () => void;
  onDownloadTranslated?: () => void;
  onDownloadOriginal?: () => void;
  onDownloadFullVoiceover: () => void;
  isMergingFull: boolean;
  isTranslatingAll?: boolean;
  onTranslateAll?: () => void;
  onCancelTranslate?: () => void;
  isSynthesizingAll: boolean;
  onSynthesizeAll: () => Promise<void>;
  onCancelSynthesizeAll?: () => void;
  theme?: 'dark' | 'light';
  onToggleTheme?: () => void;
  isTranscribing?: boolean;
  transcribeProgress?: string;
  hasAutoSubtitles?: boolean;
  autoSubtitlesCount?: number;
  isSubtitlesOnlyPlay?: boolean;
  onToggleIsSubtitlesOnlyPlay?: (enabled: boolean) => void;
  showActorsOnPlayer?: boolean;
  onToggleShowActorsOnPlayer?: (enabled: boolean) => void;
  selectedVoice?: string;
  onVoiceChange?: (voice: string) => void;
  autoTranslate?: boolean;
  onToggleAutoTranslate?: (val: boolean) => void;
  autoSpellCheck?: boolean;
  onToggleAutoSpellCheck?: (val: boolean) => void;
  addToast?: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onOpenFormatHelp?: () => void;
  onOpenHotkeys?: () => void;
  onOpenSearch?: () => void;
  lastSavedTime?: string | null;
  isSaving?: boolean;
  subtitleFontSize?: number;
  onSubtitleFontSizeChange?: (size: number) => void;
  projectName?: string;
  onProjectNameChange?: (name: string) => void;
  ignoredWordsCount?: number;
  onOpenGlossaryModal?: () => void;
  totalAiRemarksCount?: number;
  cpsExcessCount?: number;
  yellowErrorsCount?: number;
  redErrorsCount?: number;
  activeQuickFilter?: 'comments' | 'errors' | null;
  onToggleQuickFilter?: (filter: 'comments' | 'errors') => void;
}

export default function Header({
  onSubtitlesLoaded,
  onTranslationSubtitlesLoaded,
  onMediaFileLoaded,
  subtitles,
  mediaFile,
  mediaFileName,
  onDownloadOriginalSrt,
  onDownloadOriginalAss,
  onDownloadTranslatedSrt,
  onDownloadTranslatedAss,
  onDownloadTranslatedByActorSrt,
  onDownloadTranslated,
  onDownloadOriginal,
  onDownloadFullVoiceover,
  isMergingFull,
  isTranslatingAll,
  onTranslateAll,
  onCancelTranslate,
  isSynthesizingAll,
  onSynthesizeAll,
  onCancelSynthesizeAll,
  geminiApiKey,
  onOpenGeminiKeyModal,
  theme = 'dark',
  onToggleTheme,
  isTranscribing = false,
  transcribeProgress,
  hasAutoSubtitles = false,
  autoSubtitlesCount,
  isSubtitlesOnlyPlay = true,
  onToggleIsSubtitlesOnlyPlay,
  showActorsOnPlayer = true,
  onToggleShowActorsOnPlayer,
  selectedVoice = 'Ales',
  onVoiceChange,
  autoTranslate: autoTranslateProp,
  onToggleAutoTranslate,
  autoSpellCheck: autoSpellCheckProp,
  onToggleAutoSpellCheck,
  addToast,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onOpenFormatHelp,
  onOpenHotkeys,
  onOpenSearch,
  lastSavedTime,
  isSaving = false,
  subtitleFontSize = 12,
  onSubtitleFontSizeChange,
  projectName = '',
  onProjectNameChange,
  ignoredWordsCount = 0,
  onOpenGlossaryModal,
  totalAiRemarksCount = 0,
  cpsExcessCount = 0,
  yellowErrorsCount = 0,
  redErrorsCount = 0,
  activeQuickFilter = null,
  onToggleQuickFilter,
}: HeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const translationFileInputRef = useRef<HTMLInputElement>(null);
  const mediaFileInputRef = useRef<HTMLInputElement>(null);
  const [localAutoTranslate, setLocalAutoTranslate] = useState(false);
  const currentAutoTranslate = autoTranslateProp !== undefined ? autoTranslateProp : localAutoTranslate;

  const [localAutoSpellCheck, setLocalAutoSpellCheck] = useState(true);
  const currentAutoSpellCheck = autoSpellCheckProp !== undefined ? autoSpellCheckProp : localAutoSpellCheck;

  const [isSubDownloadOpen, setIsSubDownloadOpen] = useState(false);
  const [isUploadDropdownOpen, setIsUploadDropdownOpen] = useState(false);
  const [isFontSizeOpen, setIsFontSizeOpen] = useState(false);
  const subDropdownRef = useRef<HTMLDivElement>(null);
  const uploadDropdownRef = useRef<HTMLDivElement>(null);
  const fontSizeDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (uploadDropdownRef.current && !uploadDropdownRef.current.contains(e.target as Node)) {
        setIsUploadDropdownOpen(false);
      }
      if (subDropdownRef.current && !subDropdownRef.current.contains(e.target as Node)) {
        setIsSubDownloadOpen(false);
      }
      if (fontSizeDropdownRef.current && !fontSizeDropdownRef.current.contains(e.target as Node)) {
        setIsFontSizeOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsUploadDropdownOpen(false);
        setIsSubDownloadOpen(false);
        setIsFontSizeOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleAutoTranslateToggle = (val: boolean) => {
    setLocalAutoTranslate(val);
    onToggleAutoTranslate?.(val);
  };

  const handleAutoSpellCheckToggle = (val: boolean) => {
    setLocalAutoSpellCheck(val);
    onToggleAutoSpellCheck?.(val);
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { entries, format, rawHeader } = parseSubtitleContent(text, file.name);
      if (entries.length > 0) {
        onSubtitlesLoaded(entries, currentAutoTranslate, format, rawHeader);
      } else {
        addToast?.("Не ўдалося распазнаць субцітры. Пераканайцеся, што гэта сапраўды .srt або .ass файл.", "error");
      }
    };
    reader.readAsText(file);
    // Reset file input value
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTranslationFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { entries } = parseSubtitleContent(text, file.name);
      if (entries.length > 0) {
        onTranslationSubtitlesLoaded(entries);
      } else {
        addToast?.("Не ўдалося распазнаць субцітры перакладу. Пераканайцеся, што гэта сапраўды .srt або .ass файл.", "error");
      }
    };
    reader.readAsText(file);
    if (translationFileInputRef.current) {
      translationFileInputRef.current.value = '';
    }
  };

  const handleMediaFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onMediaFileLoaded?.(file);
    }
    if (mediaFileInputRef.current) {
      mediaFileInputRef.current.value = '';
    }
  };

  const hasSubtitles = subtitles.length > 0;
  const hasVoiceoverAudio = subtitles.some((s) => !!s.audioUrl);
  const hasMedia = !!mediaFile || (!!mediaFileName && mediaFileName.trim().length > 0);
  const canSave = hasSubtitles;
  const isAnyHeaderDropdownOpen = isUploadDropdownOpen || isSubDownloadOpen || isFontSizeOpen;

  return (
    <header
      className={`w-full max-w-full px-2 md:px-4 lg:px-6 py-0.5 md:py-1 shrink-0 relative ${
        isAnyHeaderDropdownOpen ? 'z-[99999]' : 'z-40'
      }`}
      style={isAnyHeaderDropdownOpen ? { zIndex: 99999 } : undefined}
      id="app-header-container"
    >
      <div
        className={`${
          theme === 'dark'
            ? 'bg-slate-900/95 border-slate-800 text-slate-100 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.8)]'
            : 'bg-white border-slate-200 text-slate-900 shadow-[0_12px_28px_-6px_rgba(0,0,0,0.15)]'
        } backdrop-blur-md border rounded-xl p-2 md:p-2.5 relative overflow-visible flex flex-col gap-2 w-full mx-auto transition-colors duration-200 ${
          isAnyHeaderDropdownOpen ? 'z-[99999]' : ''
        }`}
        style={isAnyHeaderDropdownOpen ? { zIndex: 99999 } : undefined}
      >
        
        {/* Decorative background glow projecting DOWNWARD from header (both left and right sides) */}
        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
          <div className="absolute left-4 -bottom-10 w-96 h-40 bg-indigo-600/10 dark:bg-indigo-500/15 blur-3xl rounded-full" />
          <div className="absolute right-4 -bottom-10 w-96 h-40 bg-indigo-600/10 dark:bg-indigo-500/15 blur-3xl rounded-full" />
        </div>

        {/* Responsive Header Container: Single row on desktop, 2 structured rows on narrow windows */}
        <div
          className={`flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1.5 lg:gap-3 w-full relative ${
            isAnyHeaderDropdownOpen ? 'z-[99999]' : 'z-10'
          }`}
          style={isAnyHeaderDropdownOpen ? { zIndex: 99999 } : undefined}
        >
          
          {/* Group 1: Gemini API Key, Logo, Stats, Controls, Autosave */}
          <div className="flex items-center justify-between lg:justify-start gap-1.5 sm:gap-2 flex-wrap">
            {/* Gemini API Key Button */}
            <div className={`flex items-center gap-1 shrink-0 pr-1.5 border-r ${theme === 'dark' ? 'border-slate-800/50' : 'border-slate-200'}`}>
              <button
                type="button"
                onClick={onOpenGeminiKeyModal}
                className={`flex items-center gap-1 px-1.5 py-0.5 text-[7px] leading-[14px] font-bold border rounded-lg transition-all cursor-pointer shadow-xs active:scale-95 whitespace-nowrap ${
                  geminiApiKey
                    ? theme === 'dark'
                      ? 'bg-purple-950/40 hover:bg-purple-900/60 border-purple-500/50 text-purple-300 shadow-purple-950/30'
                      : 'bg-purple-50 hover:bg-purple-100 border-purple-300 text-purple-700 shadow-purple-100'
                    : theme === 'dark'
                      ? 'bg-slate-900/80 hover:bg-purple-950/50 border-slate-700 hover:border-purple-500/40 text-slate-300 hover:text-purple-300'
                      : 'bg-slate-100 hover:bg-purple-50 border-slate-300 hover:border-purple-300 text-slate-700 hover:text-purple-700'
                }`}
                title="Асабісты Gemini API Key для квот Gemini AI"
              >
                <Key className={`w-2 h-2 text-[4px] leading-[7px] ${geminiApiKey ? 'text-purple-400' : 'text-slate-400'} shrink-0`} />
                <span>Gemini API Key</span>
                {geminiApiKey && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title="Асабісты ключ актыўны" />
                )}
              </button>
            </div>

            {/* Logo and Brand - Interactive Theme Toggle Button */}
            <button
              onClick={onToggleTheme}
              className="flex items-center gap-1.5 shrink-0 p-0.5 rounded-xl transition-all hover:bg-amber-500/10 hover:ring-1 hover:ring-amber-500/20 cursor-pointer text-left active:scale-95 group"
              title={theme === 'dark' ? 'Пераключыць на светлую тэму' : 'Пераключыць на цёмную тэму'}
            >
              <div className="w-9 h-9 rounded-xl border border-transparent bg-transparent flex items-center justify-center shrink-0 group-hover:scale-105 group-hover:border-amber-500/50 transition-all p-1 overflow-hidden">
                <SubakaLogo className="w-full h-full object-contain" id="header-dog-logo" aria-label="Лагатып SUBaka" />
              </div>
              <div className="leading-tight">
                <h1 className="text-xs sm:text-sm font-extrabold tracking-tight text-amber-500 dark:text-amber-400 flex items-center gap-1">
                  {isTauriDesktop() ? 'SUBaka' : 'SUBaka'}
                  <span className={`font-mono text-[8px] border px-1 py-0.5 rounded flex items-center gap-0.5 leading-none ${
                    theme === 'dark'
                      ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
                      : 'text-blue-700 bg-blue-50 border-blue-200'
                  }`}>
                    {theme === 'dark' ? (
                      <Sun className="w-2 h-2 text-amber-400 fill-amber-400 shrink-0" />
                    ) : (
                      <Moon className="w-2 h-2 text-indigo-600 fill-indigo-600 shrink-0" />
                    )}
                    {isTauriDesktop() && <span>пк</span>}
                  </span>
                </h1>
                <p className={`text-[8px] leading-none ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600 font-semibold'}`}>
                  рэдактар субцітраў
                </p>
              </div>
            </button>

            {/* Separator after logo before help & hotkeys */}
            <div className={`h-3.5 w-px shrink-0 ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-300'}`} />

            {/* Format Help Modal trigger (?) */}
            {onOpenFormatHelp && (
              <button
                type="button"
                onClick={onOpenFormatHelp}
                title="Даведка пра фарматы (?)"
                style={{ fontSize: '10px', lineHeight: '12px' }}
                className={`p-0.5 rounded transition-colors flex items-center justify-center font-bold text-[10px] leading-[12px] shrink-0 ${
                  theme === 'dark'
                    ? 'hover:bg-slate-800 text-slate-400 hover:text-amber-400 cursor-pointer'
                    : 'hover:bg-slate-200 text-slate-600 hover:text-amber-600 cursor-pointer'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Hotkeys trigger */}
            {onOpenHotkeys && (
              <button
                type="button"
                onClick={onOpenHotkeys}
                title="Клавіятура (Hotkeys)"
                style={{ fontSize: '10px', lineHeight: '12px' }}
                className={`p-0.5 rounded transition-colors flex items-center gap-1 text-[10px] leading-[12px] shrink-0 ${
                  theme === 'dark'
                    ? 'hover:bg-slate-800 text-slate-400 hover:text-amber-400 cursor-pointer'
                    : 'hover:bg-slate-200 text-slate-600 hover:text-amber-600 cursor-pointer'
                }`}
              >
                <Keyboard className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Subtitle Font Size Control (Applies to both Original and Translation) */}
            <div
              className={`relative shrink-0 flex items-center ${isFontSizeOpen ? 'z-[99999]' : ''}`}
              style={isFontSizeOpen ? { zIndex: 99999 } : undefined}
              ref={fontSizeDropdownRef}
            >
              <div 
                className={`px-1 rounded flex items-center gap-0.5 h-4 border ${
                  theme === 'dark' ? 'bg-slate-950/40 border-slate-800/40' : 'bg-slate-50 border-slate-200'
                }`}
                title="Памер тэксту субцітраў (арыгінал і пераклад). Па змаўчанні: 12px"
              >
                <Type className="w-2 h-2 text-amber-500 shrink-0" />
                <button
                  type="button"
                  onClick={() => onSubtitleFontSizeChange?.(Math.max(10, subtitleFontSize - 1))}
                  title="Паменшыць шрыфт субцітраў (A-)"
                  disabled={subtitleFontSize <= 10}
                  className={`w-3 h-3 flex items-center justify-center rounded text-[8px] font-bold leading-none cursor-pointer transition-colors ${
                    subtitleFontSize <= 10
                      ? 'opacity-30 cursor-not-allowed text-slate-500'
                      : theme === 'dark'
                        ? 'hover:bg-slate-800 text-slate-300 hover:text-white'
                        : 'hover:bg-slate-200 text-slate-700 hover:text-slate-900'
                  }`}
                >
                  <Minus className="w-2 h-2" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIsFontSizeOpen((prev) => !prev);
                    setIsUploadDropdownOpen(false);
                    setIsSubDownloadOpen(false);
                  }}
                  className={`px-0.5 py-0 text-[8.5px] font-bold font-mono rounded flex items-center gap-0.5 cursor-pointer transition-colors ${
                    isFontSizeOpen
                      ? 'bg-amber-500 text-slate-950'
                      : subtitleFontSize === 12
                        ? theme === 'dark' ? 'text-slate-300 hover:text-amber-400' : 'text-slate-700 hover:text-amber-600'
                        : 'text-amber-500 font-extrabold hover:underline'
                  }`}
                  title="Націсніце для выбару памеру шрыфту са спісу"
                >
                  <span>{subtitleFontSize}px</span>
                  <ChevronDown className={`w-1.5 h-1.5 opacity-70 transition-transform duration-150 ${isFontSizeOpen ? 'rotate-180' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={() => onSubtitleFontSizeChange?.(Math.min(24, subtitleFontSize + 1))}
                  title="Павялічыць шрыфт субцітраў (A+)"
                  disabled={subtitleFontSize >= 24}
                  className={`w-3 h-3 flex items-center justify-center rounded text-[8px] font-bold leading-none cursor-pointer transition-colors ${
                    subtitleFontSize >= 24
                      ? 'opacity-30 cursor-not-allowed text-slate-500'
                      : theme === 'dark'
                        ? 'hover:bg-slate-800 text-slate-300 hover:text-white'
                        : 'hover:bg-slate-200 text-slate-700 hover:text-slate-900'
                  }`}
                >
                  <Plus className="w-2 h-2" />
                </button>
              </div>

              {isFontSizeOpen && (
                <div
                  style={{ zIndex: 99999 }}
                  className={`absolute top-full mt-1 left-0 z-[99999] rounded-lg shadow-xl border p-0.5 min-w-[110px] flex flex-col gap-0.5 animate-in fade-in duration-100 ${
                    theme === 'dark'
                      ? 'bg-slate-900 border-slate-700 text-slate-200 shadow-slate-950/80'
                      : 'bg-white border-slate-200 text-slate-800 shadow-slate-300/60'
                  }`}
                >
                  <div className="flex items-center justify-between px-1 py-0.5 border-b border-slate-200 dark:border-slate-800 mb-0.5">
                    <span className="text-[7.5px] font-bold uppercase tracking-wider opacity-60">Шрыфт</span>
                    {subtitleFontSize !== 12 && (
                      <button
                        type="button"
                        onClick={() => {
                          onSubtitleFontSizeChange?.(12);
                          setIsFontSizeOpen(false);
                        }}
                        className="text-[7.5px] text-amber-500 hover:underline font-semibold cursor-pointer"
                        title="Скінуць на стандартны памер (12px)"
                      >
                        12px
                      </button>
                    )}
                  </div>
                  {[10, 11, 12, 13, 14, 15, 16, 18, 20, 22].map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => {
                        onSubtitleFontSizeChange?.(sz);
                        setIsFontSizeOpen(false);
                      }}
                      className={`text-[8.5px] py-0.5 px-1.5 rounded flex items-center justify-between cursor-pointer transition-colors ${
                        subtitleFontSize === sz
                          ? 'bg-amber-500 text-slate-950 font-bold'
                          : theme === 'dark'
                            ? 'hover:bg-slate-800 text-slate-300 hover:text-white'
                            : 'hover:bg-slate-100 text-slate-700 hover:text-slate-950'
                      }`}
                    >
                      <span className="font-mono">{sz}px</span>
                      {sz === 12 && (
                        <span className={`text-[7px] px-0.5 py-0 rounded font-normal ${
                          subtitleFontSize === sz ? 'bg-black/20 text-slate-950' : 'opacity-60'
                        }`}>
                          па змаўч.
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Separator between Subtitle Font Size Control and Voice Selector */}
            {onVoiceChange && (
              <div className={`h-3.5 w-px shrink-0 mx-0.5 ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-300'}`} />
            )}

            {/* Voice Selector */}
            {onVoiceChange && (
              <div className="flex items-center gap-1 shrink-0">
                <span className={`text-[10px] font-bold tracking-wider flex items-center gap-0.5 whitespace-nowrap ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                  <Mic className="h-3 w-3 text-indigo-500 shrink-0" />                  
                </span>
                <select
                  id="header-voice-select"
                  value={selectedVoice}
                  onChange={(e) => onVoiceChange(e.target.value)}
                  className={`text-[10px] font-semibold rounded-md px-1.5 py-0.5 outline-none border cursor-pointer transition-all ${
                    theme === 'dark'
                      ? 'bg-slate-950 border-slate-800/60 hover:border-slate-700/60 text-slate-200 focus:border-indigo-500/80'
                      : 'bg-slate-50 border-slate-300 hover:border-slate-400 text-slate-900 focus:border-indigo-500'
                  }`}
                >
                  <option value="Ales" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>TTS Алесь</option>
                  <option value="BelG2P" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>TTS Маруся</option>
                  <option value="Zephyr" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>AI Zephyr (котка)</option>
                  <option value="Kore" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>AI Kore (котка)</option>
                  <option value="Puck" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>AI Puck (мастацкі)</option>
                  <option value="Charon" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>AI Charon (сабака)</option>
                  <option value="Fenrir" className={theme === 'dark' ? 'bg-slate-900 text-slate-200' : 'bg-white text-slate-900'}>AI Fenrir (сабака)</option>
                </select>
              </div>
            )}

             {/* Undo / Redo / Search controls */}
            <div className={`flex items-center gap-1.5 sm:gap-2 ml-1 px-1.5 border-l border-r ${
              theme === 'dark' ? 'border-slate-800' : 'border-slate-300'
            }`}>
                <button
                  type="button"
                  onClick={onUndo}
                  disabled={!canUndo}
                  title="Адмяніць апошняе дзеянне (Ctrl+Z)"
                  style={{ fontWeight: 'bold', fontSize: '10px', lineHeight: '12px' }}
                  className={`p-1 rounded transition-all font-bold text-[10px] leading-[12px] ${
                    canUndo
                      ? 'text-[#9333ea] dark:text-[#c084fc] hover:text-[#7e22ce] dark:hover:text-white hover:bg-purple-500/15 drop-shadow-[0_0_5px_#a855f7] hover:drop-shadow-[0_0_9px_#c084fc] cursor-pointer'
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
                  style={{ fontWeight: 'bold', fontSize: '10px', lineHeight: '12px' }}
                  className={`p-1 rounded transition-all font-bold text-[10px] leading-[12px] ${
                    canRedo
                      ? 'text-[#9333ea] dark:text-[#c084fc] hover:text-[#7e22ce] dark:hover:text-white hover:bg-purple-500/15 drop-shadow-[0_0_5px_#a855f7] hover:drop-shadow-[0_0_9px_#c084fc] cursor-pointer'
                      : 'opacity-30 cursor-not-allowed text-slate-500'
                  }`}
                >
                  <Redo2 className="w-3.5 h-3.5" />
                </button>

                {onOpenSearch && (
                  <button
                    type="button"
                    onClick={onOpenSearch}
                    title="Пошук па субцітрах (Ctrl+F)"
                    style={{ fontWeight: 'bold', fontSize: '10px', lineHeight: '12px' }}
                    className="p-1 rounded transition-all flex items-center gap-1 font-bold text-[10px] leading-[12px] text-[#9333ea] dark:text-[#c084fc] hover:text-[#7e22ce] dark:hover:text-white hover:bg-purple-500/15 drop-shadow-[0_0_5px_#a855f7] hover:drop-shadow-[0_0_9px_#c084fc] cursor-pointer"
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Project Name Input */}
              <div className="flex items-center ml-1.5 shrink min-w-0">
                <input
                  type="text"
                  id="header-project-name-input"
                  value={projectName}
                  onChange={(e) => onProjectNameChange?.(e.target.value)}
                  placeholder="Назва праекта..."
                  title="Назва праекта (выкарыстоўваецца для назваў экспартаваных файлаў)"
                  style={{ fontWeight: 'normal', fontSize: '11px', lineHeight: '14px', width: '380px' }}
                  className={`px-2 py-0.5 rounded-md border transition-all w-[380px] max-w-full text-[11px] font-normal outline-none shadow-sm ${
                    theme === 'dark'
                      ? 'bg-slate-950/80 border-slate-700/80 text-emerald-400 placeholder:text-emerald-300/70 hover:border-slate-600 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/40'
                      : 'bg-white border-slate-300 text-emerald-700 placeholder:text-emerald-600/60 hover:border-slate-400 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/30'
                  }`}
                />
              </div>

              {/* Glossary (Гласарый) Header Trigger */}
              {onOpenGlossaryModal && (
                <button
                  type="button"
                  id="header-glossary-button"
                  onClick={onOpenGlossaryModal}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md border transition-all cursor-pointer select-none group shrink-0 active:scale-95 ${
                    theme === 'dark'
                      ? 'bg-slate-950/80 hover:bg-slate-900 border-slate-700/80 hover:border-emerald-500/50 text-slate-200'
                      : 'bg-white hover:bg-emerald-50/60 border-slate-300 hover:border-emerald-300 text-slate-800 shadow-2xs'
                  }`}
                  title="Адкрыць гласарый (Alt+5)"
                >
                  <BookMarked className="w-3.5 h-3.5 text-emerald-500 shrink-0 group-hover:scale-110 transition-transform" />
                  <span className={`font-bold lowercase tracking-wider text-[8.5px] group-hover:underline ${
                    theme === 'dark' ? 'text-slate-300' : 'text-slate-700'
                  }`}>
                    Гласарый
                  </span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[8px] font-mono font-bold transition-colors ${
                    ignoredWordsCount > 0
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 group-hover:bg-emerald-500/25'
                      : theme === 'dark' ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {ignoredWordsCount} {ignoredWordsCount === 1 ? 'слова' : (ignoredWordsCount >= 2 && ignoredWordsCount <= 4) ? 'словы' : 'слоў'}
                  </span>
                </button>
              )}

              {/* Interactive Statistics Cards: заўвагі, CPS, памылкі */}
              {onToggleQuickFilter && (
                <div className="flex items-center gap-1 shrink-0 ml-0.5" id="header-interactive-stats-buttons">
                  {/* AI Remarks ("заўвагі:") */}
                  <button
                    type="button"
                    id="header-filter-comments-button"
                    onClick={() => onToggleQuickFilter('comments')}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[8px] leading-none transition-all cursor-pointer select-none active:scale-95 ${
                      activeQuickFilter === 'comments'
                        ? theme === 'dark'
                          ? 'bg-purple-950/80 border-purple-500 text-purple-200 ring-1 ring-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)]'
                          : 'bg-purple-100 border-purple-500 text-purple-900 ring-1 ring-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.25)]'
                        : theme === 'dark'
                        ? 'bg-slate-950/80 hover:bg-slate-900 border-slate-700/80 hover:border-purple-500/50 text-slate-300'
                        : 'bg-white hover:bg-purple-50/50 border-slate-300 hover:border-purple-300 text-slate-700 shadow-2xs'
                    }`}
                    title={
                      activeQuickFilter === 'comments'
                        ? 'Зняць фільтр (паказаны толькі карткі з заўвагамі ШІ)'
                        : 'Фільтраваць па заўвагах (паказаць толькі карткі з заўвагамі ШІ)'
                    }
                  >
                    <span className={`${activeQuickFilter === 'comments' ? 'font-bold text-purple-300 dark:text-purple-200' : 'text-slate-400 font-sans'} text-[7px] leading-none`}>
                      заўвагі:
                    </span>
                    <strong className={`font-mono font-bold leading-none text-[8.5px] ${
                      activeQuickFilter === 'comments'
                        ? 'text-purple-200 dark:text-purple-100'
                        : 'text-purple-500 dark:text-purple-400'
                    }`}>
                      {totalAiRemarksCount}
                    </strong>
                  </button>

                  {/* Errors ("памылкі:") */}
                  <button
                    type="button"
                    id="header-filter-errors-button"
                    onClick={() => {
                      if (!currentAutoSpellCheck) return;
                      onToggleQuickFilter('errors');
                    }}
                    disabled={!currentAutoSpellCheck}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[8px] leading-none transition-all select-none ${
                      !currentAutoSpellCheck
                        ? theme === 'dark'
                          ? 'bg-slate-950/40 border-slate-800/50 text-slate-500 opacity-40 cursor-not-allowed'
                          : 'bg-slate-100/70 border-slate-300/60 text-slate-400 opacity-50 cursor-not-allowed'
                        : activeQuickFilter === 'errors'
                        ? theme === 'dark'
                          ? 'bg-purple-950/80 border-purple-500 text-purple-200 ring-1 ring-purple-400 shadow-[0_0_8px_rgba(168,85,247,0.4)] cursor-pointer active:scale-95'
                          : 'bg-purple-100 border-purple-500 text-purple-900 ring-1 ring-purple-400 shadow-[0_0_6px_rgba(168,85,247,0.25)] cursor-pointer active:scale-95'
                        : theme === 'dark'
                        ? 'bg-slate-950/80 hover:bg-slate-900 border-slate-700/80 hover:border-red-500/50 text-slate-300 cursor-pointer active:scale-95'
                        : 'bg-white hover:bg-red-50/50 border-slate-300 hover:border-red-300 text-slate-700 shadow-2xs cursor-pointer active:scale-95'
                    }`}
                    title={
                      !currentAutoSpellCheck
                        ? 'Праверка правапісу выключана'
                        : activeQuickFilter === 'errors'
                        ? 'Зняць фільтр (паказаны толькі карткі з чырвонымі памылкамі правапісу)'
                        : 'Фільтраваць па памылках (паказаць толькі карткі з чырвонымі арфаграфічнымі памылкамі)'
                    }
                  >
                    <span className={`${
                      !currentAutoSpellCheck
                        ? 'text-slate-500 font-sans'
                        : activeQuickFilter === 'errors'
                        ? 'font-bold text-purple-300 dark:text-purple-200'
                        : 'text-slate-400 font-sans'
                    } text-[7px] leading-none`}>
                      памылкі:
                    </span>
                    {currentAutoSpellCheck ? (
                      <>
                        <strong className="text-amber-500 dark:text-amber-400 font-mono font-bold leading-none text-[8.5px]">
                          {yellowErrorsCount}
                        </strong>
                        <span className="text-slate-400 font-normal leading-none text-[7.5px]">-</span>
                        <strong className="text-red-500 dark:text-red-400 font-mono font-bold leading-none text-[8.5px]">
                          {redErrorsCount}
                        </strong>
                      </>
                    ) : (
                      <span className="text-slate-500 font-mono font-normal leading-none text-[7.5px]">
                        —
                      </span>
                    )}
                  </button>
                </div>
              )}
            </div>

          {/* Group 2: Action Controls - Responsive alignment on narrow windows */}
          <div
            className={`flex items-center gap-1 sm:gap-1.5 justify-start lg:justify-end flex-wrap gap-y-1 relative ${
              isAnyHeaderDropdownOpen ? 'z-[99999]' : ''
            }`}
            style={isAnyHeaderDropdownOpen ? { zIndex: 99999 } : undefined}
          >
            {/* Auto translate & Auto spellcheck toggles column */}
            <div className="flex flex-col justify-center gap-0.5 shrink-0">
              {/* Auto translate toggle */}
              <label
                className={`flex items-center gap-1 py-0 px-1 select-none cursor-pointer transition-colors shrink-0 ${
                  theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                }`}
                title="Аўтаматычна перакладаць загружаны арыгінал"
              >
                <input
                  type="checkbox"
                  id="header-autotranslate-checkbox"
                  title="Аўтаматычна перакладаць загружаны арыгінал"
                  checked={currentAutoTranslate}
                  onChange={(e) => handleAutoTranslateToggle(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-2.5 h-2.5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                    currentAutoTranslate
                      ? theme === 'dark'
                        ? 'border-purple-400 bg-purple-500/30 shadow-[0_0_8px_#a855f7,0_0_12px_rgba(192,132,252,0.7)]'
                        : 'border-purple-600 bg-purple-100/80 shadow-[0_0_5px_rgba(147,51,234,0.4)]'
                      : theme === 'dark'
                      ? 'border-slate-600 bg-slate-950/60'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {currentAutoTranslate && (
                    <div
                      className={`w-1 h-1 rounded-full ${
                        theme === 'dark'
                          ? 'bg-purple-300 shadow-[0_0_6px_#c084fc]'
                          : 'bg-purple-600 shadow-[0_0_3px_rgba(147,51,234,0.7)]'
                      }`}
                    />
                  )}
                </div>
                <span className="text-[9.5px] font-medium leading-none whitespace-nowrap">
                  перакл.адразу
                </span>
              </label>

              {/* Automatic spell check toggle (пад кнопкай "перакл.адразу") */}
              <label
                className={`flex items-center gap-1 py-0 px-1 select-none cursor-pointer transition-colors shrink-0 ${
                  theme === 'dark' ? 'text-slate-300 hover:text-slate-100' : 'text-slate-700 hover:text-slate-900'
                }`}
                title="Аўтаматычная праверка правапісу перакладу (Alt+3)"
              >
                <input
                  type="checkbox"
                  id="header-autospellcheck-checkbox"
                  title="Аўтаматычная праверка правапісу перакладу"
                  checked={currentAutoSpellCheck}
                  onChange={(e) => handleAutoSpellCheckToggle(e.target.checked)}
                  className="sr-only"
                />
                <div
                  className={`w-2.5 h-2.5 rounded-full border flex items-center justify-center shrink-0 transition-all ${
                    currentAutoSpellCheck
                      ? theme === 'dark'
                        ? 'border-purple-400 bg-purple-500/30 shadow-[0_0_8px_#a855f7,0_0_12px_rgba(192,132,252,0.7)]'
                        : 'border-purple-600 bg-purple-100/80 shadow-[0_0_5px_rgba(147,51,234,0.4)]'
                      : theme === 'dark'
                      ? 'border-slate-600 bg-slate-950/60'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {currentAutoSpellCheck && (
                    <div
                      className={`w-1 h-1 rounded-full ${
                        theme === 'dark'
                          ? 'bg-purple-300 shadow-[0_0_6px_#c084fc]'
                          : 'bg-purple-600 shadow-[0_0_3px_rgba(147,51,234,0.7)]'
                      }`}
                    />
                  )}
                </div>
                <span className="text-[9.5px] font-medium leading-none whitespace-nowrap">
                  праверка правапісу
                </span>
              </label>
            </div>

            {/* Separator before upload subtitles */}
            <div className={`h-3.5 w-px shrink-0 ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-300'}`} />

            {/* Upload Subtitles Combined Dropdown */}
            <div
              className={`relative shrink-0 ${isUploadDropdownOpen ? 'z-[99999]' : ''}`}
              style={isUploadDropdownOpen ? { zIndex: 99999 } : undefined}
              ref={uploadDropdownRef}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".srt, .vtt, .ass"
                className="hidden"
                id="srt-upload-btn"
              />
              <input
                type="file"
                ref={translationFileInputRef}
                onChange={handleTranslationFileUpload}
                accept=".srt, .vtt, .ass"
                className="hidden"
                id="srt-translation-upload-btn"
              />
              <input
                type="file"
                ref={mediaFileInputRef}
                onChange={handleMediaFileUpload}
                accept="video/*,audio/*,.mkv,.mp4,.webm,.avi,.mov,.m4v,.flv,.ogv,.mts,.m2ts,.3gp,.ts,.ac3,.eac3,.e-ac3,.m4a,.aac,.mp3,.wav,.ogg,.flac"
                className="hidden"
                id="header-media-upload-btn"
              />

              <button
                onClick={() => {
                  setIsUploadDropdownOpen((prev) => !prev);
                  setIsSubDownloadOpen(false);
                  setIsFontSizeOpen(false);
                }}
                className={`px-1.5 py-1 text-[10px] font-semibold border rounded-lg transition-all flex items-center gap-1 shadow cursor-pointer whitespace-nowrap shrink-0 ${
                  theme === 'dark'
                    ? 'bg-purple-950/40 hover:bg-purple-900/50 border-purple-500/40 text-purple-300 hover:text-purple-100'
                    : 'bg-purple-50 hover:bg-purple-100 border-purple-300 text-purple-800 hover:text-purple-950 font-bold'
                }`}
                title="Загрузіць субцітры або медыяфайл"
              >
                <Upload className="h-3 w-3 text-purple-500 dark:text-purple-400 shrink-0" />
                <span>загрузіць</span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${isUploadDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {isUploadDropdownOpen && (
                <div
                  style={{ zIndex: 99999 }}
                  className={`absolute right-0 mt-1 w-52 max-w-[calc(100vw-24px)] rounded-xl border shadow-2xl z-[99999] py-1 flex flex-col text-xs ${
                    theme === 'dark'
                      ? 'bg-slate-900 border-slate-800/80 text-slate-200 shadow-slate-950/90'
                      : 'bg-white border-slate-200 text-slate-800 shadow-slate-400/50'
                  }`}
                >
                  <div className="px-3 py-1 text-[8.5px] font-bold uppercase tracking-wider text-purple-400">
                    Выберыце тып файла
                  </div>

                  {/* Blue Option: арыгінал */}
                  <button
                    onClick={() => {
                      setIsUploadDropdownOpen(false);
                      fileInputRef.current?.click();
                    }}
                    className={`px-3 py-2 text-left flex items-center gap-2 transition-colors cursor-pointer ${
                      theme === 'dark'
                        ? 'hover:bg-blue-950/40 text-blue-400 hover:text-blue-300'
                        : 'hover:bg-blue-50 text-blue-600 hover:text-blue-700'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-bold text-[11px] text-blue-600 dark:text-blue-400">
                        арыгінал
                      </span>
                      <span className="text-[8.5px] text-slate-400">
                        Зыходны файл субцітраў (.srt/.ass)
                      </span>
                    </div>
                  </button>

                  {/* Amber/Yellow Option: пераклад */}
                  <button
                    onClick={() => {
                      setIsUploadDropdownOpen(false);
                      translationFileInputRef.current?.click();
                    }}
                    className={`px-3 py-2 text-left flex items-center gap-2 transition-colors cursor-pointer border-t ${
                      theme === 'dark'
                        ? 'hover:bg-amber-950/40 text-amber-400 hover:text-amber-300 border-slate-800/80'
                        : 'hover:bg-amber-50 text-amber-600 hover:text-amber-700 border-slate-100'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-bold text-[11px] text-amber-600 dark:text-amber-400">
                        пераклад
                      </span>
                      <span className="text-[8.5px] text-slate-400">
                        Файл свайго перакладу
                      </span>
                    </div>
                  </button>

                  {/* Purple Option: медыяфайл */}
                  <button
                    onClick={() => {
                      setIsUploadDropdownOpen(false);
                      mediaFileInputRef.current?.click();
                    }}
                    className={`px-3 py-2 text-left flex items-center gap-2 transition-colors cursor-pointer border-t ${
                      theme === 'dark'
                        ? 'hover:bg-purple-950/40 text-purple-400 hover:text-purple-300 border-slate-800/80'
                        : 'hover:bg-purple-50 text-purple-600 hover:text-purple-700 border-slate-100'
                    }`}
                  >
                    <Film className="h-3.5 w-3.5 text-purple-500 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-bold text-[11px] text-purple-600 dark:text-purple-400">
                        загрузіць медыяфайл
                      </span>
                      <span className="text-[8.5px] text-slate-400">
                        Файл відэа ці аўдыя (.mp4, .mkv, .mp3...)
                      </span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            <div className={`h-4 w-[1px] mx-0.5 hidden sm:block shrink-0 ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-200'}`}></div>

            {/* Download Subtitles Dropdown (Original & Translated) */}
            <div
              className={`relative shrink-0 ${isSubDownloadOpen ? 'z-[99999]' : ''}`}
              style={isSubDownloadOpen ? { zIndex: 99999 } : undefined}
              ref={subDropdownRef}
            >
              <button
                onClick={() => {
                  if (!canSave) return;
                  setIsSubDownloadOpen((prev) => !prev);
                  setIsUploadDropdownOpen(false);
                  setIsFontSizeOpen(false);
                }}
                disabled={!canSave}
                className={`px-1.5 py-1 text-[10px] font-semibold border rounded-lg transition-all flex items-center gap-1 shadow whitespace-nowrap ${
                  !canSave
                    ? 'opacity-40 cursor-not-allowed border-transparent'
                    : theme === 'dark'
                      ? 'bg-amber-950/40 hover:bg-amber-900/50 border-amber-500/40 text-amber-300 hover:text-amber-100 cursor-pointer'
                      : 'bg-amber-50 hover:bg-amber-100 border-amber-300 text-amber-800 hover:text-amber-950 font-bold cursor-pointer'
                }`}
                title="Захаваць субцітры або агучку на лакальны камп'ютар"
              >
                <Download className="h-3 w-3 text-amber-500 dark:text-amber-400 shrink-0" />
                <span>захаваць</span>
                <ChevronDown className={`h-3 w-3 transition-transform ${isSubDownloadOpen ? 'rotate-180' : ''}`} />
              </button>

              {isSubDownloadOpen && hasSubtitles && (
                <div
                  style={{ zIndex: 99999 }}
                  className={`absolute right-0 mt-1 w-60 max-w-[calc(100vw-24px)] rounded-xl border shadow-2xl z-[99999] py-1.5 flex flex-col text-xs ${
                    theme === 'dark'
                      ? 'bg-slate-900 border-slate-800/80 text-slate-200 shadow-slate-950/90'
                      : 'bg-white border-slate-200 text-slate-800 shadow-slate-400/50'
                  }`}
                >
                  <div className="px-3 py-0.5 text-[8.5px] font-bold uppercase tracking-wider text-slate-500">
                    Экспарт і захаванне
                  </div>

                  {/* Original group */}
                  <div className={`px-3 pt-1 pb-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    theme === 'dark' ? 'text-blue-400/80' : 'text-blue-600'
                  }`}>
                    Арыгінальныя субцітры
                  </div>

                  <button
                    onClick={() => {
                      setIsSubDownloadOpen(false);
                      onDownloadOriginalSrt();
                    }}
                    className={`px-3 py-1.5 text-left flex items-center gap-2 transition-colors cursor-pointer ${
                      theme === 'dark' ? 'hover:bg-blue-950/30 text-blue-300 hover:text-blue-200' : 'hover:bg-blue-50 text-blue-700 hover:text-blue-800'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px] text-blue-600 dark:text-blue-400">
                        зах.арыгінал.srt
                      </span>
                      <span className="text-[9px] text-slate-400">Стандартны фармат SRT</span>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setIsSubDownloadOpen(false);
                      onDownloadOriginalAss();
                    }}
                    className={`px-3 py-1.5 text-left flex items-center gap-2 transition-colors cursor-pointer border-t ${
                      theme === 'dark' ? 'hover:bg-blue-950/30 text-blue-300 hover:text-blue-200 border-slate-800/60' : 'hover:bg-blue-50 text-blue-700 hover:text-blue-800 border-slate-100'
                    }`}
                  >
                    <FileCode className="h-3.5 w-3.5 text-blue-500 dark:text-blue-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px] text-blue-600 dark:text-blue-400">
                        зах.арыгінал.ass
                      </span>
                      <span className="text-[9px] text-slate-400">Фармат SubStation Alpha</span>
                    </div>
                  </button>

                  {/* Divider */}
                  <div className={`my-1 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-slate-100'}`} />

                  {/* Translated group - Yellow / Amber */}
                  <div className={`px-3 py-1 text-[9px] font-bold uppercase tracking-wider ${
                    theme === 'dark' ? 'text-amber-400/90' : 'text-amber-600'
                  }`}>
                    Перакладзеныя субцітры
                  </div>

                  <button
                    onClick={() => {
                      setIsSubDownloadOpen(false);
                      onDownloadTranslatedSrt();
                    }}
                    className={`px-3 py-1.5 text-left flex items-center gap-2 transition-colors cursor-pointer ${
                      theme === 'dark' ? 'hover:bg-amber-950/40 text-amber-300 hover:text-amber-200' : 'hover:bg-amber-50 text-amber-700 hover:text-amber-800'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px] text-amber-600 dark:text-amber-400">
                        зах.пераклад.srt
                      </span>
                      <span className="text-[9px] text-slate-400">Пераклад у фармаце SRT</span>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setIsSubDownloadOpen(false);
                      onDownloadTranslatedAss();
                    }}
                    className={`px-3 py-1.5 text-left flex items-center gap-2 transition-colors cursor-pointer border-t ${
                      theme === 'dark' ? 'hover:bg-amber-950/40 text-amber-300 hover:text-amber-200 border-slate-800/60' : 'hover:bg-amber-50 text-amber-700 hover:text-amber-800 border-slate-100'
                    }`}
                  >
                    <FileCode className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px] text-amber-600 dark:text-amber-400">
                        зах.пераклад.ass
                      </span>
                      <span className="text-[9px] text-slate-400">Пераклад з ролямі (.ass)</span>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setIsSubDownloadOpen(false);
                      onDownloadTranslatedByActorSrt();
                    }}
                    className={`px-3 py-1.5 text-left flex items-center gap-2 transition-colors cursor-pointer border-t ${
                      theme === 'dark' ? 'hover:bg-emerald-950/40 text-emerald-300 hover:text-emerald-200 border-slate-800/60' : 'hover:bg-emerald-50 text-emerald-700 hover:text-emerald-800 border-slate-100'
                    }`}
                  >
                    <Users className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 shrink-0" />
                    <div className="flex flex-col">
                      <span className="font-semibold text-[11px] text-emerald-600 dark:text-emerald-400">
                        зах.пер.ролі.srt
                      </span>
                      <span className="text-[9px] text-slate-400">Асобныя SRT па ролях (.zip)</span>
                    </div>
                  </button>

                  {/* Voiceover group */}
                  {hasVoiceoverAudio && (
                    <>
                      <div className={`my-1 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-slate-100'}`} />

                      <button
                        onClick={() => {
                          setIsSubDownloadOpen(false);
                          onDownloadFullVoiceover();
                        }}
                        disabled={isMergingFull}
                        className={`px-3 py-1.5 text-left flex items-center gap-2 transition-colors cursor-pointer ${
                          theme === 'dark' ? 'hover:bg-purple-950/40 text-purple-300 hover:text-purple-200' : 'hover:bg-purple-50 text-purple-700 hover:text-purple-800'
                        }`}
                      >
                        <Volume2 className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400 shrink-0" />
                        <div className="flex flex-col">
                          <span className="font-semibold text-[11px] text-purple-600 dark:text-purple-400">
                            {isMergingFull ? 'звядзенне агучкі...' : 'зах.агучку.wav'}
                          </span>
                          <span className="text-[9px] text-slate-400">Поўная зведзеная агучка (.wav)</span>
                        </div>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

          </div>
 
        </div>
 
      </div>
    </header>
  );
}
