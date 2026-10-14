import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Keyboard, X, Play, ArrowLeft, ArrowRight, Undo2, Redo2, Save, Search, Sparkles, Database, CheckCircle2, BookMarked, BookOpen, Plus } from 'lucide-react';

interface HotkeysModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme?: 'dark' | 'light';
}

export const HotkeysModal: React.FC<HotkeysModalProps> = ({
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

  const shortcuts = [
    {
      keys: ['Ctrl', 'F'],
      description: 'Пошук па субцітрах',
      icon: <Search className="w-3.5 h-3.5 text-purple-400" />,
    },
    {
      keys: ['Ctrl', 'Space'],
      description: 'Прайграць/паставіць на паўзу',
      icon: <Play className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      keys: ['Alt', '←'],
      description: 'Пераход да папярэдняга субцітра і перамотка відэа',
      icon: <ArrowLeft className="w-3.5 h-3.5 text-cyan-400" />,
    },
    {
      keys: ['Alt', '→'],
      description: 'Пераход да наступнага субцітра і перамотка відэа',
      icon: <ArrowRight className="w-3.5 h-3.5 text-cyan-400" />,
    },
    {
      keys: ['Ctrl', 'Z'],
      description: 'Адмяніць апошняе дзеянне',
      icon: <Undo2 className="w-3.5 h-3.5 text-amber-400" />,
    },
    {
      keys: ['Ctrl', 'Y'],
      altKeys: ['Ctrl', 'Shift', 'Z'],
      description: 'Вярнуць адмененае дзеянне',
      icon: <Redo2 className="w-3.5 h-3.5 text-amber-400" />,
    },
    {
      keys: ['Ctrl', 'S'],
      description: 'Захаваць праект у лакальнае сховішча (браўзера)',
      icon: <Save className="w-3.5 h-3.5 text-blue-400" />,
    },
    {
      keys: ['Alt', '1'],
      description: 'Праверка перакладу праз AI («пр»)',
      icon: <Sparkles className="w-3.5 h-3.5 text-purple-400" />,
    },
    {
      keys: ['Alt', '2'],
      description: 'Памылкі і пошук у граматычнай базе выдзеленага слова («гб»)',
      icon: <Database className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      keys: ['Alt', '3'],
      description: 'Уключыць/выключыць аўтаматычную праверку правапісу',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />,
    },
    {
      keys: ['Alt', '4'],
      description: 'Пошук слова ў слоўніках verbum.by («сл»)',
      icon: <BookOpen className="w-3.5 h-3.5 text-indigo-400" />,
    },
    {
      keys: ['Alt', '5'],
      description: 'Адкрыць / закрыць гласарый',
      icon: <BookMarked className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      keys: ['Alt', 'N'],
      description: 'Стварыць новую картку з бягучага часу плэера',
      icon: <Plus className="w-3.5 h-3.5 text-amber-400" />,
    },
    {
      keys: ['Esc'],
      description: 'Закрыць',
      icon: <X className="w-3.5 h-3.5 text-rose-400" />,
    },
  ];

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
            className={`w-full max-w-md rounded-2xl shadow-2xl border p-4 sm:p-5 overflow-hidden ${
              isDark
                ? 'bg-slate-900 border-slate-700 text-slate-100 shadow-indigo-950/40'
                : 'bg-white border-slate-200 text-slate-800 shadow-slate-300/60'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-2.5 border-b border-slate-700/50 mb-3">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  <Keyboard className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-xs sm:text-sm">Клавіятура (Hotkeys)</h3>
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

            {/* Shortcuts list - display all items cleanly without scrollbar */}
            <div className="space-y-1.5">
              {shortcuts.map((sc, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-1.5 rounded-lg border transition-colors ${
                    isDark
                      ? 'bg-slate-800/40 border-slate-700/60 hover:bg-slate-800/70'
                      : 'bg-slate-50 border-slate-200/80 hover:bg-slate-100/70'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 pr-2">
                    <div className="shrink-0">{sc.icon}</div>
                    <span className="text-[11px] font-medium leading-tight">
                      {sc.description}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {sc.keys.map((k, kIdx) => (
                      <React.Fragment key={kIdx}>
                        <kbd
                          className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border shadow-2xs ${
                            isDark
                              ? 'bg-slate-800 border-slate-600 text-slate-200'
                              : 'bg-white border-slate-300 text-slate-700'
                          }`}
                        >
                          {k}
                        </kbd>
                        {kIdx < sc.keys.length - 1 && (
                          <span className="text-slate-500 text-[10px]">+</span>
                        )}
                      </React.Fragment>
                    ))}
                    {sc.altKeys && (
                      <>
                        <span className="text-slate-500 text-[10px] mx-0.5">або</span>
                        {sc.altKeys.map((k, kIdx) => (
                          <kbd
                            key={`alt-${kIdx}`}
                            className={`px-1 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                              isDark
                                ? 'bg-slate-800 border-slate-600 text-slate-300'
                                : 'bg-white border-slate-300 text-slate-700'
                            }`}
                          >
                            {k}
                          </kbd>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="mt-3.5 pt-2 border-t border-slate-700/40 flex justify-end">
              <button
                onClick={onClose}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer"
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

export default HotkeysModal;
