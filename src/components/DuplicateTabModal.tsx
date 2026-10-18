import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, AlertTriangle, ArrowRight } from 'lucide-react';

interface DuplicateTabModalProps {
  isOpen: boolean;
  onTakeOver: () => void;
  theme?: 'dark' | 'light';
}

export const DuplicateTabModal: React.FC<DuplicateTabModalProps> = ({
  isOpen,
  onTakeOver,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md select-none">
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 15 }}
            transition={{ duration: 0.2 }}
            className={`w-full max-w-md rounded-2xl shadow-2xl border p-5 sm:p-6 overflow-hidden flex flex-col items-center text-center ${
              isDark
                ? 'bg-slate-900 border-amber-500/30 text-slate-100 shadow-amber-950/40'
                : 'bg-white border-amber-200 text-slate-800 shadow-slate-400/50'
            }`}
          >
            {/* Icon Banner */}
            <div className="relative mb-3.5 flex items-center justify-center">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center text-amber-500 shadow-inner">
                <Layers className="w-7 h-7" />
              </div>
              <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-amber-500 text-slate-950 shadow-md">
                <AlertTriangle className="w-3.5 h-3.5 stroke-[2.5]" />
              </div>
            </div>

            {/* Header */}
            <h2 className="text-base sm:text-lg font-bold tracking-tight mb-2 text-slate-900 dark:text-slate-100">
              SUBaka ўжо адкрытая
            </h2>

            {/* User message */}
            <p className={`text-xs sm:text-sm leading-relaxed px-1 sm:px-3 mb-5 ${
              isDark ? 'text-slate-300' : 'text-slate-700'
            }`}>
              SUBaka ўжо адкрытая. Каб пазбегнуць перазапісу праекта ў IndexedDB, калі ласка, працуйце ў першай укладцы або зачыніце яе.
            </p>

            {/* Action Buttons */}
            <div className="w-full space-y-2 pt-1 border-t border-slate-200 dark:border-slate-800/80">
              <button
                onClick={onTakeOver}
                className="w-full py-2.5 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98]"
              >
                <span>Усё роўна працягнуць у гэтай укладцы</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default DuplicateTabModal;
