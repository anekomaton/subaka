import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { HelpCircle, X, Film, Music, FileText, BookMarked, CheckCircle2, AlertTriangle } from 'lucide-react';

interface FormatHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'dark' | 'light';
}

export const FormatHelpModal: React.FC<FormatHelpModalProps> = ({
  isOpen,
  onClose,
  theme = 'dark',
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
                    <span className="font-semibold text-slate-300 dark:text-slate-200">Усе браўзеры:</span>
                    <p className={`font-mono text-[11px] ${isDark ? 'text-amber-300/90' : 'text-amber-700'}`}>
                      .mp4 (H.264 / AAC), .webm (VP8/VP9/AV1), .mov (H.264)
                    </p>
                  </div>

                  <div>
                    <span className="font-semibold text-slate-300 dark:text-slate-200">Фармат MKV (.mkv):</span>
                    <ul className="list-disc list-inside space-y-1 mt-0.5 text-[11px]">
                      <li>
                        <strong className="font-mono text-purple-400">x264 / H.264:</strong> Прайграецца ў Chrome, Edge, Safari; у Firefox можа спатрэбіцца стандартны .mp4.
                      </li>
                      <li>
                        <strong className="font-mono text-purple-400">x265 / HEVC:</strong> Прайграецца ў Chrome (107+) і Safari; Firefox не падтрымлівае з-за ліцэнзійных абмежаванняў.
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Section 2: Audio Server Processing */}
              <div className={`p-2.5 rounded-xl border ${
                isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/80'
              }`}>
                <div className="flex items-center gap-1.5 font-bold text-emerald-500 mb-1">
                  <Music className="w-4 h-4 shrink-0" />
                  <span>Аўтаматычная апрацоўка аўдыя:</span>
                </div>
                <p className={`pl-1 font-mono text-[11px] ${isDark ? 'text-emerald-300/90' : 'text-emerald-700'}`}>
                  любыя медыяфайлы (.mp3, .wav, .aac, .m4a, .ogg, .flac, .ac3, .eac3 і інш.)
                </p>
              </div>

              {/* Section 3: Subtitles */}
              <div className={`p-2.5 rounded-xl border ${
                isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/80'
              }`}>
                <div className="flex items-center gap-1.5 font-bold text-cyan-500 mb-1">
                  <FileText className="w-4 h-4 shrink-0" />
                  <span>Субцітры (Імпарт / Экспарт):</span>
                </div>
                <ul className="space-y-1 pl-1 text-[11px]">
                  <li className="flex items-start gap-1">
                    <span className="font-mono font-bold text-cyan-400 shrink-0">.srt</span>
                    <span>- стандартныя субцітры SubRip</span>
                  </li>
                  <li className="flex items-start gap-1">
                    <span className="font-mono font-bold text-cyan-400 shrink-0">.ass</span>
                    <span>- Advanced SubStation Alpha (з падтрымкай роляў)</span>
                  </li>
                </ul>
                <p className={`mt-1.5 pt-1 border-t text-[10.5px] italic flex items-start gap-1 ${
                  isDark ? 'border-slate-700/50 text-slate-400' : 'border-slate-200 text-slate-500'
                }`}>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>(калі ў файле іншы фармат субцітраў, яны будуць паказвацца ў спісе субцітраў файла, але не могуць быць апрацаваныя)</span>
                </p>
              </div>

              {/* Section 4: Glossary */}
              <div className={`p-2.5 rounded-xl border ${
                isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/80'
              }`}>
                <div className="flex items-center gap-1.5 font-bold text-indigo-500 mb-1">
                  <BookMarked className="w-4 h-4 shrink-0" />
                  <span>Гласарый (Імпарт / Экспарт):</span>
                </div>
                <p className={`pl-1 font-mono text-[11px] ${isDark ? 'text-indigo-300/90' : 'text-indigo-700'}`}>
                  .csv, .txt
                </p>
              </div>

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
