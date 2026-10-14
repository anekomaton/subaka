/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, Sparkles, CheckCircle2, Volume2, Square, RefreshCw, ChevronDown, Trash2 } from 'lucide-react';
import { SubtitleEntry } from '../types';

interface ControlsPanelProps {
  subtitles: SubtitleEntry[];
  onShiftAll: (seconds: number) => void;
  onResetOriginalTime?: () => void;
  isTranscribing: boolean;
  isAudioProcessing?: boolean;
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  translatedCount: number;
  synthesizedCount: number;
  mediaLoadingProgress: number | null;
  mediaFileName: string;
  transcribeProgress?: string | null;
  hasAutoSubtitles?: boolean;
  autoSubtitlesCount?: number;
  onClearSubtitles: () => void;
  onClearMedia?: () => void;
  onClearVoiceover?: () => void;
  onClearAll: () => void;
  isTranslatingAll?: boolean;
  onTranslateAll?: () => void;
  onCancelTranslate?: () => void;
  onProofreadTranslation?: () => void;
  onCancelProofread?: () => void;
  isProofreadingTranslation?: boolean;
  onBatchConvertPhonetics?: () => void;
  isConvertingPhoneticsAll?: boolean;
  onOpenTranscribeModal?: () => void;
  onTranscribe?: (engineChoice?: string, modelChoice?: string, targetTrackNum?: number, isExternalTrack?: boolean) => void;
  onCancelTranscribe?: () => void;
  onApplyAutoSubtitles?: () => void;
  isSynthesizingAll?: boolean;
  onSynthesizeAll?: () => Promise<void>;
  onCancelSynthesizeAll?: () => void;
  isMergingFull?: boolean;
  onDownloadFullVoiceover?: () => void;
  theme?: 'dark' | 'light';
}

export default function ControlsPanel({
  subtitles,
  onShiftAll,
  onResetOriginalTime,
  isTranscribing,
  isAudioProcessing = false,
  selectedVoice,
  onVoiceChange,
  translatedCount,
  synthesizedCount,
  mediaLoadingProgress,
  mediaFileName,
  transcribeProgress,
  hasAutoSubtitles = false,
  autoSubtitlesCount,
  onClearSubtitles,
  onClearMedia,
  onClearVoiceover,
  onClearAll,
  isTranslatingAll = false,
  onTranslateAll,
  onCancelTranslate,
  onProofreadTranslation,
  onCancelProofread,
  isProofreadingTranslation = false,
  onBatchConvertPhonetics,
  isConvertingPhoneticsAll = false,
  onOpenTranscribeModal,
  onTranscribe,
  onCancelTranscribe,
  onApplyAutoSubtitles,
  isSynthesizingAll = false,
  onSynthesizeAll,
  onCancelSynthesizeAll,
  isMergingFull = false,
  onDownloadFullVoiceover,
  theme = 'dark',
}: ControlsPanelProps) {
  const [shiftValue, setShiftValue] = useState<string>('0');
  const [isClearMenuOpen, setIsClearMenuOpen] = useState(false);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const clearMenuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<{ bottom: number; left: number } | null>(null);

  const toggleClearMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClearMenuOpen) {
      setIsClearMenuOpen(false);
      return;
    }
    if (clearButtonRef.current) {
      const rect = clearButtonRef.current.getBoundingClientRect();
      const bottom = Math.max(8, window.innerHeight - rect.top + 6);
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 175));
      setMenuPosition({ bottom, left });
      setIsClearMenuOpen(true);
    }
  };

  useEffect(() => {
    if (!isClearMenuOpen) return;

    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (clearButtonRef.current && clearButtonRef.current.contains(target)) {
        return;
      }
      if (clearMenuRef.current && clearMenuRef.current.contains(target)) {
        return;
      }
      setIsClearMenuOpen(false);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsClearMenuOpen(false);
    };

    const timer = setTimeout(() => {
      document.addEventListener('click', handleDocumentClick);
      document.addEventListener('keydown', handleKeyDown);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleDocumentClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isClearMenuOpen]);

  const handleShiftClick = () => {
    const ms = parseFloat(shiftValue);
    if (isNaN(ms) || ms === 0) return;
    const seconds = ms / 1000;
    onShiftAll(seconds);
  };

  const totalCount = subtitles.length;
  const hasSubtitles = totalCount > 0;
  
  const translatedSubs = subtitles.filter((sub) => (sub.translatedText || '').trim());
  const isAllProofread = translatedSubs.length > 0 && translatedSubs.every((sub) => sub.proofreadIssues !== undefined);

  return (
    <section className="w-full max-w-full px-1 sm:px-2 md:px-4 lg:px-6 py-0.5 md:py-1 shrink-0 relative z-20" id="bottom-render-progress-indicator">
      <div className={`${
        theme === 'dark'
          ? 'bg-slate-900/95 border-slate-800 text-slate-100 shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.8)]'
          : 'bg-white border-slate-200 text-slate-900 shadow-[0_-12px_28px_-6px_rgba(0,0,0,0.15)]'
      } backdrop-blur-md border rounded-xl p-1.5 sm:p-2 md:p-2.5 relative overflow-hidden flex flex-col gap-1 sm:gap-2 w-full mx-auto transition-colors duration-200`}>
        
        {/* Decorative background glow projecting UPWARD from footer (both left and right sides) */}
        <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none">
          <div className="absolute left-4 -top-10 w-96 h-40 bg-indigo-600/10 dark:bg-indigo-500/15 blur-3xl rounded-full" />
          <div className="absolute right-4 -top-10 w-96 h-40 bg-indigo-600/10 dark:bg-indigo-500/15 blur-3xl rounded-full" />
        </div>

        {/* ROW 1: Controls (3 sections: Left controls, Center status, Right buttons & voice) */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-2 lg:gap-3 relative z-10 w-full">
          
          {/* 1. Left Side: Time shift & editing actions */}
          <div className="flex flex-wrap lg:flex-nowrap items-center gap-1 sm:gap-1.5 py-0.5 min-w-0 justify-start max-w-full shrink-0">
            <input
              id="timeshift-input-bottom"
              type="number"
              value={shiftValue}
              onChange={(e) => setShiftValue(e.target.value)}
              step="10"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleShiftClick();
                }
              }}
              disabled={!hasSubtitles}
              placeholder="0"
              className={`w-14 sm:w-16 shrink-0 text-[10px] font-semibold rounded-md py-0.5 text-center outline-none border transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
                theme === 'dark'
                  ? 'bg-slate-950 border-slate-800/60 text-slate-200 focus:border-indigo-500/80'
                  : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-indigo-500'
              }`}
              title="Зрух субцітраў у мс (+ наперад, - назад)"
            />
            <span className={`text-[9px] font-medium shrink-0 mr-0.5 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-600'}`}>мс</span>
            
            <button
              onClick={handleShiftClick}
              disabled={!hasSubtitles || parseFloat(shiftValue) === 0 || isNaN(parseFloat(shiftValue))}
              className={`py-1 px-2 text-[9.5px] font-bold rounded-md border shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer ${
                theme === 'dark'
                  ? 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30 hover:border-indigo-500/50'
                  : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border-indigo-200'
              }`}
              title="Зрушыць усе субцітры на зададзеную колькасць мілісекундаў (+ наперад, - назад)"
            >
              зрух
            </button>
            <button
              onClick={() => onResetOriginalTime?.()}
              disabled={!hasSubtitles}
              className={`py-1 px-1.5 text-[9.5px] font-bold rounded-md border shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap cursor-pointer ${
                theme === 'dark'
                  ? 'bg-slate-800/80 hover:bg-slate-750 text-slate-300 border-slate-800/60 hover:border-slate-700/60'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
              }`}
              title="Вярнуць арыгінальны час субцітраў да ссоўвання"
            >
              ар.час
            </button>

            {/* Spacer with visual divider */}
            <div className={`w-px h-4 mx-0.5 self-center shrink-0 ${theme === 'dark' ? 'bg-slate-800/80' : 'bg-slate-200'}`} />

            {/* Clear combined button with dropdown choice */}
            <div className="relative shrink-0">
              <button
                ref={clearButtonRef}
                type="button"
                onClick={toggleClearMenu}
                className={`py-1 px-2 text-[9.5px] font-semibold text-red-500 hover:text-red-600 bg-red-500/10 hover:bg-red-500/20 rounded-md border border-red-500/20 transition-all cursor-pointer whitespace-nowrap shrink-0 flex items-center gap-1 ${
                  isClearMenuOpen ? 'ring-1 ring-red-500/60 bg-red-500/20' : ''
                }`}
                title="Ачысціць субцітры альбо ўсё"
              >
                <Trash2 className="h-2.5 w-2.5 shrink-0" />
                <span>ачысціць</span>
                <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-150 ${isClearMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {isClearMenuOpen && menuPosition && createPortal(
                <div
                  ref={clearMenuRef}
                  style={{
                    position: 'fixed',
                    bottom: `${menuPosition.bottom}px`,
                    left: `${menuPosition.left}px`,
                    zIndex: 99999,
                  }}
                  className={`min-w-[155px] rounded-lg shadow-2xl border py-1 animate-in fade-in zoom-in-95 duration-75 select-none ${
                    theme === 'dark'
                      ? 'bg-slate-900 border-slate-750 text-slate-200 shadow-black/80'
                      : 'bg-white border-slate-200 text-slate-800 shadow-slate-400/50'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsClearMenuOpen(false);
                      onClearSubtitles();
                    }}
                    disabled={!hasSubtitles}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-semibold flex items-center justify-between transition-colors whitespace-nowrap ${
                      !hasSubtitles
                        ? 'opacity-40 cursor-not-allowed text-slate-500'
                        : theme === 'dark'
                          ? 'hover:bg-red-950/50 text-red-400 hover:text-red-300 cursor-pointer'
                          : 'hover:bg-red-50 text-red-600 hover:text-red-700 cursor-pointer'
                    }`}
                    title="Ачысціць усе субцітры з працоўнай вобласці"
                  >
                    <span>ачысціць субцітры</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsClearMenuOpen(false);
                      onClearMedia?.();
                    }}
                    disabled={!mediaFileName}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-semibold flex items-center justify-between transition-colors whitespace-nowrap ${
                      !mediaFileName
                        ? 'opacity-40 cursor-not-allowed text-slate-500'
                        : theme === 'dark'
                          ? 'hover:bg-red-950/50 text-red-400 hover:text-red-300 cursor-pointer'
                          : 'hover:bg-red-50 text-red-600 hover:text-red-700 cursor-pointer'
                    }`}
                    title="Ачысціць медыяфайл і аўдыядарожкі"
                  >
                    <span>ачысціць медыя</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsClearMenuOpen(false);
                      onClearVoiceover?.();
                    }}
                    disabled={synthesizedCount === 0}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-semibold flex items-center justify-between transition-colors whitespace-nowrap ${
                      synthesizedCount === 0
                        ? 'opacity-40 cursor-not-allowed text-slate-500'
                        : theme === 'dark'
                          ? 'hover:bg-red-950/50 text-red-400 hover:text-red-300 cursor-pointer'
                          : 'hover:bg-red-50 text-red-600 hover:text-red-700 cursor-pointer'
                    }`}
                    title="Ачысціць усю згенераваную агучку субцітраў"
                  >
                    <span>ачысціць агучку</span>
                  </button>

                  <div className={`h-px my-0.5 ${theme === 'dark' ? 'bg-slate-800' : 'bg-slate-100'}`} />

                  <button
                    type="button"
                    onClick={() => {
                      setIsClearMenuOpen(false);
                      onClearAll();
                    }}
                    className={`w-full text-left px-3 py-1.5 text-[10px] font-semibold flex items-center justify-between transition-colors whitespace-nowrap ${
                      theme === 'dark'
                        ? 'hover:bg-red-950/50 text-red-400 hover:text-red-300 cursor-pointer'
                        : 'hover:bg-red-50 text-red-600 hover:text-red-700 cursor-pointer'
                    }`}
                    title="Ачысціць усе лакальныя даныя, медыя і субцітры"
                  >
                    <span>ачысціць усё</span>
                  </button>
                </div>,
                document.body
              )}
            </div>

            {/* Translate all (перакласці ўсё) */}
            {isTranslatingAll ? (
              <button
                type="button"
                onClick={onCancelTranslate}
                className={`py-1 px-1.5 text-[9.5px] font-bold rounded-md border transition-all flex items-center gap-1 shrink-0 cursor-pointer whitespace-nowrap shadow-sm ${
                  theme === 'dark'
                    ? 'bg-red-950/80 hover:bg-red-900 border-red-500/50 text-red-300'
                    : 'bg-red-600 hover:bg-red-700 text-white border-red-700 shadow-md ring-1 ring-red-400/30'
                }`}
                title="Спыніць пакетны пераклад"
              >
                <Square className={`h-2.5 w-2.5 shrink-0 animate-pulse ${theme === 'dark' ? 'text-red-400 fill-red-400' : 'text-white fill-white'}`} />
                спыніць пераклад
              </button>
            ) : (
              <button
                type="button"
                onClick={onTranslateAll}
                disabled={!hasSubtitles}
                className={`py-1 px-1.5 text-[9.5px] font-bold rounded-md border transition-all flex items-center gap-1 shrink-0 whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed ${
                  !hasSubtitles
                    ? 'border-transparent text-slate-500'
                    : theme === 'dark'
                      ? 'bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 hover:text-indigo-200 border-indigo-500/40 cursor-pointer shadow-sm'
                      : 'bg-indigo-100 hover:bg-indigo-200 text-indigo-950 border-indigo-300 font-bold hover:text-indigo-900 cursor-pointer shadow-sm'
                }`}
                title="Перакласці ўсе субцітры на беларускую мову праз Gemini"
              >
                <Sparkles className={`h-2.5 w-2.5 shrink-0 ${theme === 'dark' ? 'text-indigo-400' : 'text-indigo-600'}`} />
                перакласці ўсё
              </button>
            )}

            {/* Proofread translation */}
            {isProofreadingTranslation ? (
              <button
                type="button"
                onClick={onCancelProofread}
                className={`py-1 px-1.5 text-[9.5px] font-bold rounded-md border transition-all flex items-center gap-1 shrink-0 cursor-pointer whitespace-nowrap shadow-sm ${
                  theme === 'dark'
                    ? 'bg-red-950/80 hover:bg-red-900 border-red-500/50 text-red-300'
                    : 'bg-red-600 hover:bg-red-700 text-white border-red-700 shadow-md ring-1 ring-red-400/30'
                }`}
                title="Спыніць праверку перакладу"
              >
                <Square className={`h-2.5 w-2.5 shrink-0 animate-pulse ${theme === 'dark' ? 'text-red-400 fill-red-400' : 'text-white fill-white'}`} />
                спыніць праверку
              </button>
            ) : (
              <button
                type="button"
                onClick={onProofreadTranslation}
                disabled={!hasSubtitles}
                className={`py-1 px-1.5 text-[9.5px] font-bold rounded-md border disabled:opacity-30 disabled:cursor-not-allowed text-center transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 shrink-0 ${
                  isAllProofread
                    ? theme === 'dark'
                      ? 'bg-slate-800/80 text-slate-400 border-slate-700/80 hover:bg-slate-700/80 hover:text-slate-300'
                      : 'bg-slate-200/90 text-slate-500 border-slate-300 hover:bg-slate-300 hover:text-slate-700'
                    : theme === 'dark'
                      ? 'text-purple-300 hover:text-purple-200 bg-purple-500/15 hover:bg-purple-500/25 border-purple-500/30'
                      : 'text-purple-900 hover:text-purple-950 bg-purple-100 hover:bg-purple-200 border-purple-300 font-bold'
                }`}
                title={
                  isAllProofread
                    ? "Праверана ШІ: усе карткі апрацаваны (націсніце, каб пераправерыць)"
                    : "Праверыць беларускі пераклад і выправіць арфаграфію і граматыку ШІ"
                }
              >
                <Sparkles className={`h-2.5 w-2.5 shrink-0 ${isAllProofread ? 'text-slate-400' : 'text-purple-400'}`} />
                праверыць пераклад
              </button>
            )}

            {/* 1.3. Batch Convert Phonetics */}
            <button
              type="button"
              onClick={onBatchConvertPhonetics}
              disabled={!hasSubtitles || isConvertingPhoneticsAll || isTranscribing}
              className={`py-1 px-1.5 text-[9.5px] font-bold leading-[14.25px] rounded-md border transition-all flex items-center gap-1 shadow-sm shrink-0 ${
                !hasSubtitles
                  ? 'bg-slate-900/50 text-slate-600 border-slate-800/40 cursor-not-allowed opacity-40'
                  : isConvertingPhoneticsAll
                    ? 'bg-indigo-950/60 border-indigo-800/80 text-indigo-300 animate-pulse cursor-pointer'
                    : theme === 'dark'
                      ? 'text-indigo-300 hover:text-indigo-200 bg-indigo-500/15 hover:bg-indigo-500/25 border-indigo-500/30 cursor-pointer'
                      : 'text-indigo-900 hover:text-indigo-950 bg-indigo-100 hover:bg-indigo-200 border-indigo-300 font-bold cursor-pointer'
              }`}
              title={
                !hasSubtitles
                  ? "Дадайце або загрузіце субцітры для канвертацыі"
                  : "Канвертаваць усе карткі арыгіналу ў школьную транскрыпцыю. Як чуецца - так не пішацца. І як пішацца - так НЯ чуецца."
              }
            >
              {isConvertingPhoneticsAll ? (
                <RefreshCw className="h-2.5 w-2.5 animate-spin text-indigo-400 shrink-0" />
              ) : (
                <AudioLines className={`h-2.5 w-2.5 shrink-0 ${!hasSubtitles ? 'text-slate-600' : 'text-indigo-400'}`} />
              )}
              арфаэпія
            </button>
          </div>

          {/* 2. Center: Generation Progress Status */}
          {(isTranscribing || hasAutoSubtitles) && (
            <div className="flex items-center justify-center min-w-0">
              <div className={`py-1 px-2.5 rounded-md flex items-center gap-1.5 h-7 border shrink-0 ${
                theme === 'dark' ? 'bg-slate-950/60 border-slate-800/80' : 'bg-slate-50 border-slate-200'
              }`} title={isTranscribing ? "Генерацыя субцітраў" : "Аўтасубцітры паспяхова сфарміраваны"}>
                {isTranscribing ? (
                  <>
                    <span className={`text-[9.5px] font-bold tracking-wider ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'}`}>
                      генерацыя:
                    </span>
                    <span className="text-[10.5px] font-bold font-mono text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                      {transcribeProgress === "Апрацоўка Gemini..." ? (
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="h-3 w-3 text-indigo-500 animate-spin" style={{ animationDuration: '3s' }} />
                          <span className="animate-pulse">Апрацоўка Gemini...</span>
                        </span>
                      ) : (
                        <span className="animate-pulse">{transcribeProgress || 'у працэсе...'}</span>
                      )}
                    </span>
                  </>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 whitespace-nowrap">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                      аўтасубцітры гатовыя
                    </span>
                    {onApplyAutoSubtitles && (
                      <button
                        type="button"
                        onClick={onApplyAutoSubtitles}
                        className="px-1.5 py-0.5 text-[9.5px] font-bold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center gap-0.5 shadow-sm cursor-pointer active:scale-95 whitespace-nowrap"
                        title="Уставіць сфарміраваныя аўтасубцітры ў арыгінал"
                      >
                        ужыць
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 3. Right Side: Under Player (Subtitle Generation Buttons & Voice Selector) */}
          <div className="flex flex-wrap lg:flex-nowrap items-center justify-start lg:justify-end gap-1.5 md:gap-2 shrink-0 max-w-full">
            {/* Transcribe / Create Subtitles (.srt) button */}
            {(() => {
              const isTranscribeDisabled = isTranscribing || !mediaFileName || isAudioProcessing || (mediaLoadingProgress !== null && mediaLoadingProgress < 100);
              let transcribeTitle = "Аўтаматычна распазнаць мову і стварыць субцітры з медыяфайла";
              if (!mediaFileName) {
                transcribeTitle = "Загрузіце медыяфайл для генерацыі субцітраў";
              } else if (isAudioProcessing || (mediaLoadingProgress !== null && mediaLoadingProgress < 100)) {
                transcribeTitle = "Аўдыядарожка яшчэ апрацоўваецца, калі ласка, пачакайце...";
              } else {
                transcribeTitle = "Аўтаматычна распазнаць мову і стварыць субцітры з медыяфайла";
              }

              if (isTranscribing) {
                return (
                  <button
                    id="transcribe-btn-bottom"
                    onClick={onCancelTranscribe}
                    className={`py-1 px-1.5 text-[9.5px] font-bold rounded-md border transition-all flex items-center gap-1 shadow cursor-pointer whitespace-nowrap shrink-0 ${
                      theme === 'dark'
                        ? 'border-red-500/50 bg-red-950/80 hover:bg-red-900 text-red-300'
                        : 'bg-red-600 hover:bg-red-700 text-white border-red-700'
                    }`}
                    title="Спыніць генерацыю субцітраў"
                  >
                    <Square className={`h-2.5 w-2.5 shrink-0 animate-pulse ${theme === 'dark' ? 'text-red-400 fill-red-400' : 'text-white fill-white'}`} />
                    спыніць генерацыю
                  </button>
                );
              }

              return (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    id="transcribe-server-btn"
                    onClick={() => {
                      if (onOpenTranscribeModal) {
                        onOpenTranscribeModal();
                      } else {
                        onTranscribe?.();
                      }
                    }}
                    disabled={isTranscribeDisabled}
                    className={`py-1 px-2.5 text-[9.5px] leading-[14.25px] font-bold rounded-md border transition-all flex items-center gap-1.5 shadow cursor-pointer whitespace-nowrap shrink-0 ${
                      isTranscribeDisabled
                        ? 'bg-slate-800/40 text-slate-500 border-slate-700/40 cursor-not-allowed opacity-50'
                        : theme === 'dark'
                          ? 'border-indigo-500/50 bg-indigo-950/80 hover:bg-indigo-900 text-indigo-200'
                          : 'border-indigo-400 bg-indigo-100 hover:bg-indigo-200 text-indigo-900 font-bold'
                    }`}
                    title={transcribeTitle}
                  >
                    {isAudioProcessing ? (
                      <RefreshCw className="h-3 w-3 shrink-0 text-amber-400 animate-spin" />
                    ) : (
                      <AudioLines className={`h-3 w-3 shrink-0 ${isTranscribeDisabled ? 'text-slate-500' : 'text-indigo-400 animate-pulse'}`} />
                    )}
                    {isAudioProcessing ? "Апрацоўка дарожкі..." : "генераваць субцітры"}
                  </button>
                </div>
              );
            })()}

            {/* Synthesize All button (moved to bottom controls) */}
            {isSynthesizingAll ? (
              <button
                onClick={onCancelSynthesizeAll}
                className={`py-1 px-1.5 text-[9.5px] font-bold rounded-md border transition-all flex items-center gap-1 shadow cursor-pointer whitespace-nowrap shrink-0 ${
                  theme === 'dark'
                    ? 'bg-red-950/80 hover:bg-red-900 border border-red-500/50 text-red-300'
                    : 'bg-red-600 hover:bg-red-700 text-white border border-red-700 shadow-md'
                }`}
                title="Спыніць працэс агучвання"
              >
                <Square className={`h-2.5 w-2.5 shrink-0 animate-pulse ${theme === 'dark' ? 'text-red-400 fill-red-400' : 'text-white fill-white'}`} />
                спыніць агучку
              </button>
            ) : (
              <button
                onClick={onSynthesizeAll}
                disabled={!hasSubtitles}
                className={`py-1 px-1.5 text-[9.5px] font-bold rounded-md border transition-all flex items-center gap-1 shadow cursor-pointer whitespace-nowrap shrink-0 ${
                  !hasSubtitles
                    ? 'bg-slate-900/50 text-slate-600 border-slate-800/40 cursor-not-allowed opacity-40'
                    : theme === 'dark'
                      ? 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200 hover:text-white'
                      : 'bg-slate-100 hover:bg-slate-200 border-slate-300 text-slate-800 font-bold'
                }`}
                title="Агучыць усе перакладзеныя карткі"
              >
                <Volume2 className="h-2.5 w-2.5 text-indigo-500 shrink-0" />
                агучыць усё
              </button>
            )}
          </div>

        </div>

      </div>
    </section>
  );
}
