import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HelpCircle, X, Film, Music, FileText, BookMarked, CheckCircle2, AlertTriangle, HardDrive } from 'lucide-react';
import { isTauriDesktop, DesktopStorageInfo } from '../utils/tauriBridge';

interface FormatHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'dark' | 'light';
  desktopStorage?: DesktopStorageInfo | null;
}

export const FormatHelpModal: React.FC<FormatHelpModalProps> = ({
  isOpen,
  onClose,
  theme = 'dark',
  desktopStorage,
}) => {
  const isDark = theme === 'dark';

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-lg rounded-2xl shadow-2xl border p-4 sm:p-5 overflow-hidden flex flex-col max-h-[90vh] ${
              isDark
                ? 'bg-slate-900 border-slate-700 text-slate-100 shadow-amber-950/30'
                : 'bg-white border-slate-200 text-slate-800 shadow-slate-300/60'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-700/50 mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  <HelpCircle className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs sm:text-sm">Даведка пра фарматы</h3>
                </div>
              </div>
              <button
                onClick={onClose}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                  isDark ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200' : 'hover:bg-slate-100 text-slate-500'
                }`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Body */}
            <div className="space-y-3 overflow-y-auto pr-1 text-xs leading-relaxed scrollbar-thin">
              
              {/* Section 1: Video */}
              <div className={`p-2.5 rounded-xl border ${
                isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/80'
              }`}>
                <div className="flex items-center gap-1.5 font-bold text-amber-500 mb-1.5">
                  <Film className="w-4 h-4 shrink-0" />
                  <span>Відэа:</span>
                </div>
                
                <div className="space-y-1.5 pl-1">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Усе браўзеры:</span>
                    <p className={`font-mono text-[11px] ${isDark ? 'text-amber-300/90' : 'text-amber-800'}`}>
                      .mp4 (H.264 / AAC), .webm (VP8/VP9/AV1), .mov (H.264)
                    </p>
                  </div>

                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">Фармат MKV (.mkv):</span>
                    <ul className="list-disc list-inside space-y-1 mt-0.5 text-[11px] text-slate-700 dark:text-slate-300">
                      <li>
                        <strong className="font-mono text-purple-700 dark:text-purple-400">x264 / H.264:</strong> Прайграецца ў Chrome, Edge, Safari; у Firefox можа спатрэбіцца стандартны .mp4.
                      </li>
                      <li>
                        <strong className="font-mono text-purple-700 dark:text-purple-400">x265 / HEVC:</strong> Прайграецца ў Chrome (107+) і Safari; Firefox не падтрымлівае з-за ліцэнзійных абмежаванняў.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Section 2: Audio Server Processing */}
              <div className={`p-2.5 rounded-xl border ${
                isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/80'
              }`}>
                <div className="flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-500 mb-1">
                  <Music className="w-4 h-4 shrink-0" />
                  <span>Аўтаматычная апрацоўка аўдыя:</span>
                </div>
                <p className={`pl-1 font-mono text-[11px] ${isDark ? 'text-emerald-300/90' : 'text-emerald-800 font-medium'}`}>
                  любыя медыяфайлы (.mp3, .wav, .aac, .m4a, .ogg, .flac, .ac3, .eac3 і інш.)
                </p>
              </div>

              {/* Section 3: Subtitles */}
              <div className={`p-2.5 rounded-xl border ${
                isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/80'
              }`}>
                <div className="flex items-center gap-1.5 font-bold text-sky-600 dark:text-cyan-500 mb-1">
                  <FileText className="w-4 h-4 shrink-0" />
                  <span>Субцітры (Імпарт / Экспарт):</span>
                </div>
                <ul className="space-y-1 pl-1 text-[11px] text-slate-700 dark:text-slate-300">
                  <li className="flex items-start gap-1">
                    <span className="font-mono font-bold text-sky-700 dark:text-cyan-400 shrink-0">.srt</span>
                    <span>- стандартныя субцітры SubRip</span>
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="font-mono font-bold text-sky-700 dark:text-cyan-400 shrink-0">.ass</span>
                    <span>- Advanced SubStation Alpha (з падтрымкай роляў)</span>
                  </li>
                </ul>
                <p className={`mt-1.5 pt-1 border-t text-[10.5px] italic flex items-start gap-1 ${
                  isDark ? 'border-slate-700/50 text-slate-400' : 'border-slate-200 text-slate-600'
                }`}>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>(калі ў файле іншы фармат субцітраў, яны будуць паказвацца ў спісе субцітраў файла, але не могуць быць апрацаваныя)</span>
                </p>
              </div>

              {/* Section 4: Glossary */}
              <div className={`p-2.5 rounded-xl border ${
                isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/80'
              }`}>
                <div className="flex items-center gap-1.5 font-bold text-indigo-600 dark:text-indigo-400 mb-1">
                  <BookMarked className="w-4 h-4 shrink-0" />
                  <span>Гласарый (Імпарт / Экспарт):</span>
                </div>
                <p className={`pl-1 font-mono text-[11px] ${isDark ? 'text-indigo-300/90' : 'text-indigo-800 font-medium'}`}>
                  .csv, .txt
                </p>
              </div>

              {/* Section 5: Desktop Paths & Storage (Windows) - ONLY VISIBLE IN DESKTOP MODE */}
              {isTauriDesktop() && (
                <div className={`p-2.5 rounded-xl border ${
                  isDark ? 'bg-slate-800/60 border-amber-500/30' : 'bg-amber-50/90 border-amber-300/90'
                }`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5 font-bold text-amber-700 dark:text-amber-400">
                      <HardDrive className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="uppercase text-[11px] tracking-wide font-bold">ДЭСКТОПНЫЯ ШЛЯХІ І СХОВІШЧА (WINDOWS):</span>
                    </div>
                    <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/30 font-medium">
                      Дэсктопны рэжым
                    </span>
                  </div>
                  <div className={`font-mono text-[10.5px] space-y-2 p-2.5 rounded-lg border break-all select-all leading-relaxed ${
                    isDark
                      ? 'bg-slate-950/70 border-slate-700/70 text-slate-200'
                      : 'bg-white border-amber-200/90 text-slate-900 shadow-xs'
                  }`}>
                    <div>
                      <span className="text-sky-700 dark:text-sky-400 font-bold">Папка resources (слоўнікі і граматыка):</span>{' '}
                      <span className="text-slate-900 dark:text-slate-100 font-semibold">{desktopStorage?.resources_dir || '<Папка_Праграмы>\\resources\\'}</span>
                      <span className="text-slate-600 dark:text-slate-400 text-[10px] block font-sans mt-0.5">
                        Файлы grammardb.sqlite3 (~128 МБ) і verbum_offline.sqlite3 (~60 МБ). Загружаюцца пры ўсталёўцы праграмы.
                      </span>
                    </div>
                    <div>
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">Бягучы стан і праекты:</span>{' '}
                      <span className="text-slate-900 dark:text-slate-100 font-semibold">{desktopStorage?.app_data_dir || '%LOCALAPPDATA%\\com.subaka.desktop'}</span>
                      <span className="text-slate-600 dark:text-slate-400 text-[10px] block font-sans mt-0.5">
                        IndexedDB (SubakaWorkspaceDB) і LocalStorage профілю WebView2 (карткі, налады, гласарый).
                      </span>
                    </div>
                    <div>
                      <span className="text-amber-700 dark:text-amber-400 font-bold">Кэш і часовыя файлы:</span>{' '}
                      <span className="text-slate-900 dark:text-slate-100 font-semibold">{desktopStorage?.cache_dir || desktopStorage?.temp_dir || '%TEMP%\\subaka_*'}</span>
                      <span className="text-slate-600 dark:text-slate-400 text-[10px] block font-sans mt-0.5">
                        Часовыя і прамежкавыя файлы. Ачышчаюцца кнопкай «Ачысціць усё» без выдалення баз і гласарыя.
                      </span>
                    </div>
                    {desktopStorage?.grammardb_path && (
                      <div className="pt-1.5 border-t border-slate-200 dark:border-slate-800">
                        <span className="text-indigo-700 dark:text-indigo-400 font-bold">Актыўная база GrammarDB:</span>{' '}
                        <span className="text-slate-900 dark:text-slate-100 font-semibold">{desktopStorage.grammardb_path} {desktopStorage.grammardb_size_mb ? `(${desktopStorage.grammardb_size_mb} МБ)` : ''}</span>
                      </div>
                    )}
                    {desktopStorage?.verbum_path && (
                      <div className={desktopStorage?.grammardb_path ? '' : 'pt-1.5 border-t border-slate-200 dark:border-slate-800'}>
                        <span className="text-indigo-700 dark:text-indigo-400 font-bold">Актыўныя слоўнікі Verbum:</span>{' '}
                        <span className="text-slate-900 dark:text-slate-100 font-semibold">{desktopStorage.verbum_path} {desktopStorage.verbum_size_mb ? `(${desktopStorage.verbum_size_mb} МБ)` : ''}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

            </div>

            {/* Footer */}
            <div className="mt-3.5 pt-2 border-t border-slate-700/40 flex justify-end shrink-0">
              <button
                onClick={onClose}
                className="px-3.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold rounded-lg shadow-2xs transition-colors cursor-pointer"
              >
                Зразумела
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default FormatHelpModal;
