/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookMarked,
  Search,
  X,
  Download,
  Upload,
  Plus,
  Trash2,
  FileSpreadsheet,
  FileText,
  ChevronDown
} from 'lucide-react';
import { stripAccents } from '../utils/subtitleUtils';

interface GlossaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  ignoredWords: Set<string>;
  onAddWord: (word: string) => void;
  onRemoveWord: (word: string) => void;
  onClearAll: () => void;
  onExport: (format: 'csv' | 'txt') => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement> | File | FileList | File[]) => void;
  theme?: 'dark' | 'light';
}

export const GlossaryModal: React.FC<GlossaryModalProps> = ({
  isOpen,
  onClose,
  ignoredWords,
  onAddWord,
  onRemoveWord,
  onClearAll,
  onExport,
  onImport,
  theme = 'dark',
}) => {
  const isDark = theme === 'dark';
  const [searchQuery, setSearchQuery] = useState('');
  const [newWordInput, setNewWordInput] = useState('');
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Close export menu when clicking outside
  useEffect(() => {
    if (!isExportMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setIsExportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExportMenuOpen]);

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsExportMenuOpen(false);
      setIsDraggingFile(false);
      setIsConfirmingClear(false);
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearchQuery('');
      setNewWordInput('');
      setIsExportMenuOpen(false);
      setIsDraggingFile(false);
      setIsConfirmingClear(false);
    }
  }, [isOpen]);

  // Handle ESC key to close modal
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImport(e.dataTransfer.files);
    }
  };

  // Sorted and filtered list
  const sortedWords = useMemo(() => {
    return (Array.from(ignoredWords) as string[]).sort((a, b) => a.localeCompare(b, 'be'));
  }, [ignoredWords]);

  const filteredWords = useMemo(() => {
    const q = stripAccents(searchQuery).toLowerCase().trim();
    if (!q) return sortedWords;
    return sortedWords.filter((w) => stripAccents(w).toLowerCase().includes(q));
  }, [sortedWords, searchQuery]);

  const handleAddNewWord = useCallback(() => {
    const clean = stripAccents(newWordInput).toLowerCase().trim();
    if (!clean) return;
    onAddWord(clean);
    setNewWordInput('');
  }, [newWordInput, onAddWord]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 pt-12 sm:pt-16 bg-black/60 backdrop-blur-xs select-none"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`relative w-full max-w-2xl rounded-2xl shadow-2xl border flex flex-col overflow-hidden max-h-[85vh] ${
              isDark
                ? 'bg-slate-900 border-slate-700/80 text-slate-100 shadow-emerald-950/30'
                : 'bg-white border-slate-200 text-slate-800 shadow-slate-300/60'
            }`}
          >
            {/* Hidden file input for CSV/TXT/TSV/JSON/DIC import inside modal content */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv,.json,.dic,text/plain,text/csv,text/tab-separated-values,application/json"
              style={{ display: 'none' }}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                e.stopPropagation();
                onImport(e);
              }}
            />

            {/* Drag & Drop Visual Overlay */}
            {isDraggingFile && (
              <div className="absolute inset-0 z-70 flex flex-col items-center justify-center bg-emerald-950/85 backdrop-blur-xs border-2 border-dashed border-emerald-400 text-emerald-200 p-6 rounded-2xl animate-in fade-in duration-150">
                <Upload className="w-12 h-12 mb-3 text-emerald-400 animate-bounce" />
                <h3 className="text-base font-bold text-white mb-1">Адпусціце файл для загрузкі</h3>
                <p className="text-xs text-emerald-300/80 text-center max-w-sm">
                  Падтрымліваюцца .csv, .txt, .tsv, .json і .dic спісы слоў
                </p>
              </div>
            )}

            {/* Header */}
            <div
              className={`px-4 py-3 border-b flex items-center justify-between gap-2 ${
                isDark ? 'border-slate-800 bg-slate-900/95' : 'border-slate-200 bg-slate-50/90'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-500">
                  <BookMarked className="w-4 h-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-sm leading-none">Гласарый ігнараваных слоў</h3>
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                        ignoredWords.size > 0
                          ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                          : isDark
                          ? 'bg-slate-800 text-slate-400'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {ignoredWords.size}{' '}
                      {ignoredWords.size === 1
                        ? 'слова'
                        : ignoredWords.size >= 2 && ignoredWords.size <= 4
                        ? 'словы'
                        : 'слоў'}
                    </span>
                  </div>
                  <p className={`text-[11px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Словы, якія ігнаруюцца пры праверцы правапісу і лічацца правільнымі
                  </p>
                </div>
              </div>

              {/* Actions & Close Button */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                      fileInputRef.current.click();
                    }
                  }}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    isDark
                      ? 'bg-slate-800/90 hover:bg-slate-700 text-sky-300 border-slate-700 hover:border-sky-500/40'
                      : 'bg-sky-50 hover:bg-sky-100 text-sky-700 border-sky-200 hover:border-sky-300 shadow-2xs'
                  }`}
                  title="Загрузіць спіс з .csv або .txt файла"
                >
                  <Upload className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                  <span>загрузіць</span>
                </button>

                {/* Export dropdown for CSV and TXT */}
                <div className="relative" ref={exportMenuRef}>
                  <button
                    type="button"
                    onClick={() => {
                      if (ignoredWords.size > 0) {
                        setIsExportMenuOpen((prev) => !prev);
                      }
                    }}
                    disabled={ignoredWords.size === 0}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      ignoredWords.size === 0
                        ? 'opacity-40 cursor-not-allowed border-transparent'
                        : isDark
                        ? 'bg-slate-800/90 hover:bg-slate-700 text-emerald-300 border-slate-700 hover:border-emerald-500/40 cursor-pointer'
                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-200 hover:border-emerald-300 shadow-2xs cursor-pointer'
                    }`}
                    title={ignoredWords.size === 0 ? 'Гласарый пусты' : 'Захаваць спіс ігнараваных слоў (.csv або .txt)'}
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span>захаваць</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${isExportMenuOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Dropdown menu */}
                  {isExportMenuOpen && (
                    <div
                      className={`absolute right-0 top-full mt-1 w-44 rounded-xl border shadow-xl py-1 z-60 animate-in fade-in zoom-in-95 duration-100 ${
                        isDark
                          ? 'bg-slate-900 border-slate-700 text-slate-200 shadow-black/60'
                          : 'bg-white border-slate-200 text-slate-800 shadow-slate-300/80'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onExport('csv');
                          setIsExportMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors cursor-pointer ${
                          isDark ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-emerald-50 text-slate-700'
                        }`}
                      >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-500 shrink-0" />
                        <div>
                          <div className="font-semibold leading-tight">.CSV файл</div>
                          <div className="text-[10px] text-slate-400">для Excel / LibreOffice</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          onExport('txt');
                          setIsExportMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors cursor-pointer border-t ${
                          isDark
                            ? 'border-slate-800 hover:bg-slate-800 text-slate-200'
                            : 'border-slate-100 hover:bg-emerald-50 text-slate-700'
                        }`}
                      >
                        <FileText className="w-4 h-4 text-sky-500 shrink-0" />
                        <div>
                          <div className="font-semibold leading-tight">.TXT файл</div>
                          <div className="text-[10px] text-slate-400">просты тэкставы спіс</div>
                        </div>
                      </button>
                    </div>
                  )}
                </div>

                {ignoredWords.size > 0 && (
                  isConfirmingClear ? (
                    <div className="flex items-center gap-1.5 bg-red-500/10 border border-red-500/30 px-2 py-1 rounded-lg text-xs animate-in fade-in zoom-in-95 duration-100">
                      <span className="text-red-500 dark:text-red-400 font-semibold text-[11px] whitespace-nowrap">Ачысціць усё?</span>
                      <button
                        type="button"
                        onClick={() => {
                          onClearAll();
                          setIsConfirmingClear(false);
                        }}
                        className="px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold text-[10px] shadow-2xs transition-colors cursor-pointer"
                      >
                        Так
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsConfirmingClear(false)}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer ${
                          isDark ? 'bg-slate-800 hover:bg-slate-700 text-slate-300' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'
                        }`}
                      >
                        Скасаваць
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsConfirmingClear(true)}
                      className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                        isDark
                          ? 'bg-slate-800/60 hover:bg-red-950/50 text-slate-400 hover:text-red-400 border-slate-700 hover:border-red-800'
                          : 'bg-white hover:bg-red-50 text-slate-400 hover:text-red-600 border-slate-200 hover:border-red-200 shadow-2xs'
                      }`}
                      title="Ачысціць увесь гласарый"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )
                )}

                <button
                  type="button"
                  onClick={onClose}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ml-1 ${
                    isDark
                      ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                      : 'hover:bg-slate-200 text-slate-500 hover:text-slate-800'
                  }`}
                  title="Закрыць (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Search & Add word toolbar */}
            <div
              className={`p-3 border-b flex flex-col sm:flex-row items-stretch sm:items-center gap-2 ${
                isDark ? 'border-slate-800/80 bg-slate-950/40' : 'border-slate-200/80 bg-slate-100/60'
              }`}
            >
              {/* Search Bar */}
              <div
                className={`flex items-center flex-1 rounded-xl border px-3 py-1.5 transition-all ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20'
                    : 'bg-white border-slate-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-400/20 shadow-2xs'
                }`}
              >
                <Search className={`w-3.5 h-3.5 mr-2 shrink-0 ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Пошук у гласарыі..."
                  className="w-full bg-transparent border-none outline-hidden text-xs placeholder:text-slate-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="p-0.5 text-slate-400 hover:text-slate-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Add New Word directly */}
              <div className="flex items-center gap-1.5">
                <div
                  className={`flex items-center rounded-xl border px-3 py-1.5 transition-all flex-1 sm:w-56 ${
                    isDark
                      ? 'bg-slate-950 border-slate-800 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20'
                      : 'bg-white border-slate-300 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-400/20 shadow-2xs'
                  }`}
                >
                  <input
                    type="text"
                    value={newWordInput}
                    onChange={(e) => setNewWordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddNewWord();
                      }
                    }}
                    placeholder="Дадаць новае слова..."
                    className="w-full bg-transparent border-none outline-hidden text-xs placeholder:text-slate-500"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAddNewWord}
                  disabled={!newWordInput.trim()}
                  className={`flex items-center justify-center px-3 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    !newWordInput.trim()
                      ? 'opacity-40 cursor-not-allowed border-transparent'
                      : isDark
                      ? 'bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border-emerald-700/60 cursor-pointer shadow-2xs'
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white border-emerald-600 shadow-2xs cursor-pointer'
                  }`}
                  title="Дадаць слова ў гласарый"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  <span>Дадаць</span>
                </button>
              </div>
            </div>

            {/* Words Content Area */}
            <div className="flex-1 overflow-y-auto p-4 min-h-[220px] max-h-[50vh]">
              {ignoredWords.size === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10 px-4">
                  <div className="p-3 rounded-full bg-slate-800/40 text-slate-500 mb-2">
                    <FileSpreadsheet className="w-8 h-8 stroke-[1.5]" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">Гласарый пакуль пусты</h4>
                  <p className={`text-xs max-w-sm ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Вы можаце дадаваць словы непасрэдна ў картках субцітраў праз кнопку «Ігнараваць», увесці слова ў полі вышэй альбо загрузіць файл праз кнопку «загрузіць» уверсе.
                  </p>
                </div>
              ) : filteredWords.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-10 px-4">
                  <div className="p-3 rounded-full bg-slate-800/40 text-slate-500 mb-2">
                    <Search className="w-8 h-8 stroke-[1.5]" />
                  </div>
                  <h4 className="font-semibold text-sm mb-1">Слоў не знойдзена</h4>
                  <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Па запыце «<span className="font-mono font-medium">{searchQuery}</span>» нічога не знойдзена.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      onAddWord(searchQuery);
                      setSearchQuery('');
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Дадаць «{searchQuery.trim()}» у гласарый</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-[11px] text-slate-400 px-0.5">
                    <span>
                      {searchQuery
                        ? `Знойдзена: ${filteredWords.length} з ${ignoredWords.size}`
                        : `Спіс слоў (${filteredWords.length}):`}
                    </span>
                    <span className="italic">націсніце ✕ каб прыбраць слова</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {filteredWords.map((word) => (
                      <div
                        key={word}
                        className={`group inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg text-xs border font-mono transition-all ${
                          isDark
                            ? 'bg-slate-950/80 hover:bg-slate-800/80 text-slate-200 border-slate-800 hover:border-slate-700'
                            : 'bg-slate-50 hover:bg-white text-slate-800 border-slate-200 hover:border-slate-300 shadow-2xs'
                        }`}
                      >
                        <span className="select-text">{word}</span>
                        <button
                          type="button"
                          onClick={() => onRemoveWord(word)}
                          className="p-0.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                          title={`Выдаліць «${word}» з гласарыя`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
