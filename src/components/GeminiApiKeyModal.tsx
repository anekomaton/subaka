import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Key, X, ExternalLink, Eye, EyeOff, Check, Trash2, ShieldCheck, Sparkles } from 'lucide-react';
import { isTauriDesktop } from '../utils/tauriBridge';

interface GeminiApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string;
  onSaveKey: (key: string) => void;
  theme?: 'dark' | 'light';
}

export const GeminiApiKeyModal: React.FC<GeminiApiKeyModalProps> = ({
  isOpen,
  onClose,
  apiKey,
  onSaveKey,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';
  const [inputVal, setInputVal] = useState(apiKey || '');
  const [showKey, setShowKey] = useState(false);
  const [isSavedRecently, setIsSavedRecently] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setInputVal(apiKey || '');
      setShowKey(false);
      setIsSavedRecently(false);
    }
  }, [isOpen, apiKey]);

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

  const handleSave = () => {
    const trimmed = inputVal.trim();
    onSaveKey(trimmed);
    setIsSavedRecently(true);
    setTimeout(() => {
      onClose();
    }, 600);
  };

  const handleClear = () => {
    setInputVal('');
    onSaveKey('');
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
          {/* Backdrop click */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className={`relative w-full max-w-lg rounded-2xl shadow-2xl border p-6 flex flex-col gap-5 z-10 ${
              isDark
                ? 'bg-slate-900 border-slate-700/80 text-slate-100 shadow-purple-950/20'
                : 'bg-white border-slate-200 text-slate-900 shadow-slate-300/50'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 dark:bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-400 shrink-0">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <span>Gemini API Key</span>
                    {apiKey && (
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Актыўны
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Асабісты Gemini API Key для квот Gemini AI
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors cursor-pointer"
                title="Закрыць"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Explanatory Prompt Text Required by User */}
            <div
              className={`p-4 rounded-xl border flex flex-col gap-3 text-sm leading-relaxed ${
                isDark
                  ? 'bg-purple-950/20 border-purple-800/40 text-purple-200'
                  : 'bg-purple-50/80 border-purple-200 text-purple-900'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <Sparkles className="w-5 h-5 text-purple-500 shrink-0 mt-0.5" />
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-[13.5px]">
                    Кожны карыстальнік з акаўнтам Google (з Беларусі спатрэбіцца VPN) можа перайсці на{' '}
                    <a
                      href="https://aistudio.google.com/api-keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-bold text-purple-600 dark:text-purple-300 underline hover:text-purple-500 transition-colors"
                    >
                      Google AI Studio (aistudio.google.com)
                      <ExternalLink className="w-3.5 h-3.5 inline" />
                    </a>{' '}
                    і атрымаць асабісты ключ (GEMINI_API_KEY)
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
                    Бясплатна - Free Tier без уводу банкаўскай карты. Ключ забяспечвае асабісты ліміт запытаў.{' '}
                    {isTauriDesktop()
                      ? 'Калі ключ не ўведзены, AI функцыі не працуюць (з Беларусі спатрэбіцца VPN).'
                      : 'Калі ключ не ўведзены, выкарыстоўваецца агульны API-ключ праграмы.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Input Form */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="gemini-key-input"
                className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 flex items-center justify-between"
              >
                <span>Ваш GEMINI_API_KEY</span>
                {inputVal && (
                  <span className="text-[10px] lowercase font-normal text-slate-400">
                    {inputVal.length} сімвалаў
                  </span>
                )}
              </label>

              <div className="relative flex items-center">
                <input
                  id="gemini-key-input"
                  type={showKey ? 'text' : 'password'}
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder="Асабісты Gemini API Key для квот Gemini AI"
                  autoComplete="off"
                  spellCheck="false"
                  className={`w-full px-3.5 py-2.5 pr-20 text-sm font-mono rounded-xl border outline-hidden transition-all ${
                    isDark
                      ? 'bg-slate-950/80 border-slate-700 focus:border-purple-500 text-slate-100 placeholder-slate-600 focus:ring-2 focus:ring-purple-500/20'
                      : 'bg-slate-50 border-slate-300 focus:border-purple-600 text-slate-900 placeholder-slate-400 focus:ring-2 focus:ring-purple-500/20'
                  }`}
                />

                <div className="absolute right-2 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                    title={showKey ? 'Схаваць ключ' : 'Паказаць ключ'}
                  >
                    {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  {inputVal && (
                    <button
                      type="button"
                      onClick={() => setInputVal('')}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 transition-colors cursor-pointer"
                      title="Ачысціць поле"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 px-1 pt-1">
                <span className="flex items-center gap-1 text-[11px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                  Ключ захоўваецца лакальна на вашым камп'ютары
                </span>
                {apiKey && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="text-red-500 hover:text-red-400 hover:underline flex items-center gap-1 text-[11px] cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                    Выдаліць захаваны ключ
                  </button>
                )}
              </div>
            </div>

            {/* Automatic Model Selection Indicator */}
            <div className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
              isDark
                ? 'bg-slate-950/60 border-slate-800/80 text-slate-300'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  Аўтаматычны выбар мадэлі Gemini AI
                </span>
              </div>
              <span className="text-[11px] text-purple-600 dark:text-purple-400 font-mono">
                ад самай новай
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={handleSave}
                className={`w-full sm:w-auto px-5 py-2 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md active:scale-95 ${
                  isSavedRecently
                    ? 'bg-emerald-600 text-white'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/25'
                }`}
              >
                {isSavedRecently ? (
                  <>
                    <Check className="w-4 h-4" />
                    Захавана!
                  </>
                ) : (
                  <>
                    <Key className="w-4 h-4" />
                    Захаваць
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
