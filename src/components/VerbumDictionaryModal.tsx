import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Search, X, RefreshCw, ExternalLink, ArrowRight, CornerDownLeft, Sparkles, Filter } from 'lucide-react';
import { 
  VERBUM_DICTIONARIES, 
  VERBUM_SECTIONS, 
  VerbumArticle, 
  VerbumSectionFilter, 
  filterVerbumArticles 
} from '../types/verbum';
import { useVerbumDbFullStatus } from '../utils/useVerbumDbStatus';
import { isTauriDesktop, lookupDesktopVerbum, fetchVerbumOnlineNative } from '../utils/tauriBridge';

interface VerbumDictionaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
  theme?: 'dark' | 'light';
  onApplyWord?: (word: string) => void;
}

export const VerbumDictionaryModal: React.FC<VerbumDictionaryModalProps> = ({
  isOpen,
  onClose,
  initialQuery = '',
  theme = 'dark',
  onApplyWord,
}) => {
  const isDark = theme === 'dark';
  
  // Persistent filter from localStorage (defaults to 'all')
  const [sectionFilter, setSectionFilter] = useState<VerbumSectionFilter>(() => {
    try {
      const saved = localStorage.getItem('subaka_verbum_dict_filter');
      if (saved && ['all', 'main', 'authors', 'encyclopedias'].includes(saved)) {
        return saved as VerbumSectionFilter;
      }
    } catch {
      // ignore
    }
    return 'all';
  });

  const handleSetSectionFilter = (filter: VerbumSectionFilter) => {
    setSectionFilter(filter);
    try {
      localStorage.setItem('subaka_verbum_dict_filter', filter);
    } catch {
      // ignore
    }
  };

  const verbumDbStatus = useVerbumDbFullStatus();
  const [fromOfflineFallback, setFromOfflineFallback] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);

  const [query, setQuery] = useState(initialQuery);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [articles, setArticles] = useState<VerbumArticle[]>([]);
  const [lastSearchedWord, setLastSearchedWord] = useState('');
  
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync initial query when opened
  useEffect(() => {
    if (isOpen) {
      const clean = (initialQuery || '').trim();
      setQuery(clean);
      if (clean) {
        performSearch(clean);
      } else {
        setArticles([]);
        setLastSearchedWord('');
        setError(null);
        setFromOfflineFallback(false);
        setOfflineNotice(null);
      }
      setTimeout(() => {
        inputRef.current?.select();
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen, initialQuery]);

  // Handle Escape key to close
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

  const performSearch = async (searchWord: string) => {
    const term = searchWord.trim();
    if (!term) return;

    setIsLoading(true);
    setError(null);
    setFromOfflineFallback(false);
    setOfflineNotice(null);

    // If running in Desktop mode, try native offline SQLite dictionaries in resources/ first
    if (isTauriDesktop()) {
      try {
        const desktopArticles = await lookupDesktopVerbum(term);
        if (desktopArticles && desktopArticles.length > 0) {
          const mapped: VerbumArticle[] = desktopArticles.map((a: any) => ({
            DictionaryID: a.dict_id,
            ID: a.id,
            Content: a.html,
            Headword: a.headword,
            IsOffline: true,
          }));
          setArticles(mapped);
          setLastSearchedWord(term);
          setFromOfflineFallback(true);
          setOfflineNotice('Аўтаномны пошук у лакальных слоўніках (папка resources)');
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.warn('[Verbum Modal] Desktop offline search fallback:', e);
      }

      // In desktop mode, if not found in offline DB, try online verbum.by API via native network driver (bypasses CORS)
      try {
        const targetUrl = `https://verbum.by/api/search?q=${encodeURIComponent(term)}`;
        const onlineData = await fetchVerbumOnlineNative(targetUrl);
        if (onlineData && Array.isArray(onlineData.Articles)) {
          const rawArticles: VerbumArticle[] = onlineData.Articles;
          const cleanArticles = rawArticles.filter(a => a.DictionaryID !== 'grammardb');
          if (cleanArticles.length > 0) {
            setArticles(cleanArticles);
            setLastSearchedWord(term);
            setFromOfflineFallback(false);
            setOfflineNotice('Анлайн-пошук на verbum.by');
            setIsLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn('[Verbum Modal] Desktop native online search error:', err);
      }

      setArticles([]);
      setLastSearchedWord(term);
      setError(`Слова «${term}» не знойдзена ў аўтаномных слоўніках (папка resources) і на verbum.by`);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch(`/api/verbum/search?q=${encodeURIComponent(term)}`);
      const contentType = res.headers.get('content-type') || '';
      if (!res.ok || !contentType.includes('application/json')) {
        throw new Error(`Слоўнік verbum.by часова недасяжны (код ${res.status})`);
      }
      const data = await res.json();
      const rawArticles: VerbumArticle[] = Array.isArray(data.Articles) ? data.Articles : [];
      // Strictly exclude grammardb
      const cleanArticles = rawArticles.filter(a => a.DictionaryID !== 'grammardb');
      setArticles(cleanArticles);
      setLastSearchedWord(term);
      setFromOfflineFallback(Boolean(data.fromOfflineFallback));
      setOfflineNotice(data.offlineNotice || null);

      if (data.error && cleanArticles.length === 0) {
        setError(data.error);
      }
    } catch (err: any) {
      console.error('[Verbum Modal] Search error:', err);
      setError(err?.message || 'Не ўдалося атрымаць вынікі са слоўнікаў verbum.by');
      setArticles([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(query);
  };

  // Filter articles based on active section
  const filteredArticles = useMemo(() => {
    return filterVerbumArticles(articles, sectionFilter);
  }, [articles, sectionFilter]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div 
      className="fixed inset-0 z-[10000] flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl border flex flex-col overflow-hidden transition-all ${
          isDark 
            ? 'bg-slate-900 border-indigo-500/50 text-slate-100 shadow-indigo-950/70' 
            : 'bg-white border-indigo-200 text-slate-800 shadow-2xl shadow-indigo-900/10'
        }`}
      >
        {/* Modal Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b shrink-0 ${
          isDark ? 'border-slate-800 bg-slate-900/90' : 'border-slate-100 bg-slate-50/80'
        }`}>
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${isDark ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-tight">Слоўнікі Verbum</span>
                <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase ${
                  isDark ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-slate-200/70 text-slate-600 border-slate-300'
                }`}>
                  сл
                </span>
                <span className={`text-[11px] font-medium hidden sm:inline ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  (Alt+4)
                </span>

                {fromOfflineFallback ? (
                  <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20" title="verbum.by недасяжны. Пошук выкананы праз аўтаномную базу на серверы.">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                    аўтаномны рэзерв (verbum.by недасяжны)
                  </span>
                ) : verbumDbStatus.building ? (
                  <span className="inline-flex items-center gap-1 text-[9px] font-medium text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 animate-pulse" title={verbumDbStatus.lastLog || 'Разгортванне рэзервовай базы слоўнікаў...'}>
                    <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                    разгортванне рэзерву
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[9px] font-medium text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20" title={verbumDbStatus.ready ? "Асноўны пошук па ўсіх 19 слоўніках verbum.by. Аўтаномны рэзерв на серверы напагатове." : "Пошук па 19 адкрытых слоўніках verbum.by"}>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    verbum.by анлайн
                  </span>
                )}
              </div>
              <p className={`text-[11px] leading-none mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Пошук па 19 адкрытых слоўніках беларускай мовы (verbum.by)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {lastSearchedWord && (
              <a 
                href={`https://verbum.by/?q=${encodeURIComponent(lastSearchedWord)}`}
                target="_blank"
                rel="noreferrer noopener"
                className={`p-1.5 rounded-lg border text-xs flex items-center gap-1 transition-colors ${
                  isDark 
                    ? 'border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-200' 
                    : 'border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-slate-900'
                }`}
                title="Адкрыць на verbum.by у новым акне"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-[11px]">verbum.by</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                isDark ? 'hover:bg-slate-800 text-slate-400 hover:text-white' : 'hover:bg-slate-100 text-slate-500 hover:text-slate-900'
              }`}
              title="Закрыць (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Bar & Input */}
        <div className={`p-3.5 border-b shrink-0 flex flex-col gap-2.5 ${
          isDark ? 'border-slate-800 bg-slate-950/40' : 'border-slate-100 bg-slate-50/40'
        }`}>
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className={`w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none ${
                isDark ? 'text-slate-500' : 'text-slate-400'
              }`} />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Увядзіце слова для пошуку ў слоўніках..."
                className={`w-full pl-9 pr-8 py-2 rounded-xl text-sm font-medium outline-none border transition-all ${
                  isDark
                    ? 'bg-slate-950 border-slate-800 focus:border-indigo-500 text-slate-100 placeholder:text-slate-600 focus:ring-2 focus:ring-indigo-500/20'
                    : 'bg-white border-slate-200 focus:border-indigo-600 text-slate-900 placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500/20'
                }`}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    inputRef.current?.focus();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 rounded cursor-pointer"
                  title="Ачысціць"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 disabled:opacity-50 disabled:pointer-events-none text-white font-bold text-xs shadow-md transition-all flex items-center gap-1.5 shrink-0 cursor-pointer"
            >
              {isLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CornerDownLeft className="w-3.5 h-3.5" />
              )}
              <span>Шукаць</span>
            </button>
          </form>

          {/* Dictionary Section Selector (Tabs) */}
          <div className="flex items-center justify-between gap-2 flex-wrap pt-0.5">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
              <span className={`text-[11px] font-semibold mr-1 flex items-center gap-1 shrink-0 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                <Filter className="w-3 h-3" />
                Слоўнікі:
              </span>
              {VERBUM_SECTIONS.map((sec) => {
                const isActive = sectionFilter === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => handleSetSectionFilter(sec.id)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
                      isActive
                        ? isDark
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-xs'
                          : 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                        : isDark
                          ? 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                          : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                    }`}
                  >
                    {sec.name}
                  </button>
                );
              })}
            </div>

            {lastSearchedWord && !isLoading && (
              <span className={`text-[11px] font-medium shrink-0 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                Знойдзена артыкулаў: <strong className={isDark ? 'text-slate-200' : 'text-slate-800'}>{filteredArticles.length}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Modal Body / Results Container */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 divide-y divide-slate-800/40 dark:divide-slate-800/40">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-500" />
              <span className={`text-xs font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Пошук у слоўніках verbum.by...
              </span>
            </div>
          )}

          {!isLoading && error && (
            <div className={`p-4 rounded-xl border text-center flex flex-col items-center gap-2 ${
              isDark ? 'bg-rose-950/30 border-rose-800/40 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-700'
            }`}>
              <span className="text-sm font-semibold">{error}</span>
              <button
                type="button"
                onClick={() => performSearch(query)}
                className="px-3 py-1 text-xs font-bold rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer"
              >
                Паспрабаваць зноў
              </button>
            </div>
          )}

          {!isLoading && !error && fromOfflineFallback && (
            <div className={`p-2.5 rounded-xl border flex items-center justify-between gap-2 text-xs shrink-0 ${
              isDark ? 'bg-amber-950/30 border-amber-800/40 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800'
            }`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span className="truncate">{offlineNotice || 'Вынікі атрыманы з аўтаномнай базы слоўнікаў на серверы (fallback)'}</span>
              </div>
              <span className="font-mono text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/30 shrink-0">
                Offline
              </span>
            </div>
          )}

          {!isLoading && !error && !lastSearchedWord && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <BookOpen className={`w-8 h-8 opacity-30 ${isDark ? 'text-slate-400' : 'text-slate-500'}`} />
              <p className={`text-sm font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Увядзіце слова і націсніце «Шукаць», альбо вылучыце слова ў тэксце карткі.
              </p>
            </div>
          )}

          {!isLoading && !error && lastSearchedWord && filteredArticles.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <span className="text-2xl">🔍</span>
              <p className={`text-sm font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                У абранай катэгорыі «{VERBUM_SECTIONS.find(s => s.id === sectionFilter)?.name}» нічога не знойдзена
              </p>
              <p className={`text-xs max-w-md ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                {articles.length > 0 ? (
                  <>
                    У іншых слоўніках ёсць {articles.length} арт. Паспрабуйце пераключыць фільтр на{' '}
                    <button 
                      type="button" 
                      onClick={() => handleSetSectionFilter('all')}
                      className="text-indigo-400 hover:underline font-bold cursor-pointer"
                    >
                      «Усе»
                    </button>.
                  </>
                ) : (
                  `Слова «${lastSearchedWord}» не знойдзена ў слоўніках verbum.by.`
                )}
              </p>
            </div>
          )}

          {!isLoading && !error && filteredArticles.length > 0 && (
            <div className="flex flex-col gap-4">
              {filteredArticles.map((article, idx) => {
                const dictMeta = VERBUM_DICTIONARIES[article.DictionaryID];
                const dictTitle = dictMeta?.title || article.DictionaryID;
                const dictShort = dictMeta?.shortTitle || article.DictionaryID;

                return (
                  <div 
                    key={`${article.DictionaryID}-${article.ID}-${idx}`}
                    className={`p-3.5 rounded-xl border flex flex-col gap-2 transition-all ${
                      isDark 
                        ? 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700' 
                        : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Dictionary badge */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${
                          isDark 
                            ? 'bg-indigo-950/70 text-indigo-300 border-indigo-800/60' 
                            : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                        }`}>
                          {dictShort}
                        </span>
                        {(article.IsOffline || fromOfflineFallback) && (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            рэзерв
                          </span>
                        )}
                        <span className={`text-[11px] line-clamp-1 max-w-sm hidden sm:inline ${
                          isDark ? 'text-slate-400' : 'text-slate-500'
                        }`} title={dictTitle}>
                          {dictTitle}
                        </span>
                      </div>

                      {onApplyWord && (
                        <button
                          type="button"
                          onClick={() => {
                            // Strip HTML to get clean headword
                            const tmp = document.createElement('div');
                            tmp.innerHTML = article.Content;
                            const hwElem = tmp.querySelector('.hw') || tmp.querySelector('strong');
                            const wordToApply = (hwElem?.textContent || article.ID || '').trim();
                            if (wordToApply) {
                              onApplyWord(wordToApply);
                              onClose();
                            }
                          }}
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded border transition-colors flex items-center gap-1 cursor-pointer shrink-0 ${
                            isDark
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 hover:text-white'
                              : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                          }`}
                          title="Уставіць гэтае слова ў рэдактар карткі"
                        >
                          <ArrowRight className="w-3 h-3" />
                          <span>Уставіць</span>
                        </button>
                      )}
                    </div>

                    {/* Article Content formatted according to Verbum HTML */}
                    <div 
                      className={`verbum-article-html text-xs sm:text-[13px] leading-relaxed pt-1 break-words ${
                        isDark ? 'text-slate-200' : 'text-slate-800'
                      }`}
                      dangerouslySetInnerHTML={{ __html: article.Content }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
