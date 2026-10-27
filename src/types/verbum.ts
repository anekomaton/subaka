/**
 * Dictionaries supported by Verbum.by (excluding grammardb as requested).
 */
export interface VerbumDictionaryMeta {
  id: string;
  title: string;
  shortTitle: string;
  section: 'main' | 'authors' | 'encyclopedias' | 'other';
}

export const VERBUM_DICTIONARIES: Record<string, VerbumDictionaryMeta> = {
  tsblm2022: {
    id: 'tsblm2022',
    title: 'Тлумачальны слоўнік беларускай літаратурнай мовы (І. Л. Капылоў, 2022)',
    shortTitle: 'ТСБЛМ (2022)',
    section: 'main',
  },
  tsblm: {
    id: 'tsblm',
    title: 'Тлумачальны слоўнік беларускай літаратурнай мовы (2002)',
    shortTitle: 'ТСБЛМ (2002)',
    section: 'other',
  },
  tsbm: {
    id: 'tsbm',
    title: 'Тлумачальны слоўнік беларускай мовы (К. Крапіва, 1977—1984)',
    shortTitle: 'ТСБМ (Крапіва)',
    section: 'main',
  },
  klyshka: {
    id: 'klyshka',
    title: 'Слоўнік сінонімаў і блізказначных слоў (М. Клышка)',
    shortTitle: 'Сінонімы (Клышка)',
    section: 'main',
  },
  brs: {
    id: 'brs',
    title: 'Беларуска-рускі слоўнік, 4-е выданне (2012)',
    shortTitle: 'БРС-4 (2012)',
    section: 'main',
  },
  rbs10: {
    id: 'rbs10',
    title: 'Руска-беларускі слоўнік НАН Беларусі, 10-е выданне (2012)',
    shortTitle: 'РБС-10 (2012)',
    section: 'main',
  },
  rbs: {
    id: 'rbs',
    title: 'Руска-беларускі слоўнік НАН Беларусі, 8-е выданне',
    shortTitle: 'РБС-8',
    section: 'other',
  },
  esbm: {
    id: 'esbm',
    title: 'Этымалагічны слоўнік беларускай мовы (1978—2017)',
    shortTitle: 'ЭСБМ',
    section: 'main',
  },
  sis1999: {
    id: 'sis1999',
    title: 'Слоўнік іншамоўных слоў (А. Булыка, 1999)',
    shortTitle: 'СІС (1999)',
    section: 'other',
  },
  sis2005: {
    id: 'sis2005',
    title: 'Слоўнік іншамоўных слоў. Актуальная лексіка (А. Булыка, 2005)',
    shortTitle: 'СІС (2005)',
    section: 'other',
  },
  bhn1971: {
    id: 'bhn1971',
    title: 'Беларускія геаграфічныя назвы. Тапаграфія. Гідралогія (І. Яшкін, 1971)',
    shortTitle: 'Геагр. назвы',
    section: 'other',
  },
  proverbia: {
    id: 'proverbia',
    title: 'Шасцімоўны слоўнік прыказак, прымавак і крылатых слоў (1993)',
    shortTitle: 'Прыказкі',
    section: 'other',
  },
  hsbm: {
    id: 'hsbm',
    title: 'Гістарычны слоўнік беларускай мовы (1982—2017)',
    shortTitle: 'ГСБМ',
    section: 'other',
  },
  abs: {
    id: 'abs',
    title: 'Ангельска-беларускі слоўнік (В. Пашкевіч, 2006, класічны правапіс)',
    shortTitle: 'Англ-Бел (Пашкевіч)',
    section: 'authors',
  },
  susha: {
    id: 'susha',
    title: 'Англійска-беларускі слоўнік (Т. Суша, 2013, актуальны правапіс)',
    shortTitle: 'Англ-Бел (Суша)',
    section: 'main',
  },
  pbs: {
    id: 'pbs',
    title: 'Польска-беларускі слоўнік (Я. Волкава, В. Авілава, 2004)',
    shortTitle: 'Польск-Бел',
    section: 'other',
  },
  beldeu: {
    id: 'beldeu',
    title: "Беларуска-нямецкі слоўнік (М. Кур'янка, 2010)",
    shortTitle: 'Бел-Ням (Кур’янка)',
    section: 'authors',
  },
  kurjanka: {
    id: 'kurjanka',
    title: "Нямецка-беларускі слоўнік (М. Кур'янка, 2006)",
    shortTitle: 'Ням-Бел (Кур’янка)',
    section: 'authors',
  },
  belen: {
    id: 'belen',
    title: 'Беларуская Энцыклапедыя (1996—2004)',
    shortTitle: 'Бел. Энцыклапедыя',
    section: 'encyclopedias',
  },
  belse: {
    id: 'belse',
    title: 'Беларуская Савецкая Энцыклапедыя (1969—1976)',
    shortTitle: 'БелСЭ',
    section: 'encyclopedias',
  },
  grammardb: {
    id: 'grammardb',
    title: 'Граматычная база беларускай мовы (GrammarDB / verbum.by)',
    shortTitle: 'Грамбаза',
    section: 'other',
  },
};

export type VerbumSectionFilter = 'all' | 'main' | 'authors' | 'encyclopedias';

export interface VerbumArticle {
  ID: string;
  DictionaryID: string;
  Content: string;
  Headword?: string;
  IsOffline?: boolean;
}

export interface VerbumSearchResult {
  Q: string;
  Articles: VerbumArticle[];
  DictIDs?: string[];
  fromOfflineFallback?: boolean;
  offlineNotice?: string;
}

export const VERBUM_SECTIONS = [
  { id: 'all' as VerbumSectionFilter, name: 'Усе' },
  { id: 'main' as VerbumSectionFilter, name: 'Асноўныя' },
  { id: 'authors' as VerbumSectionFilter, name: 'Аўтарскія' },
  { id: 'encyclopedias' as VerbumSectionFilter, name: 'Энцыклапедыі' },
];

/**
 * Filter articles by section and grammar database option.
 */
export function filterVerbumArticles(
  articles: VerbumArticle[], 
  section: VerbumSectionFilter,
  includeGrammarDb: boolean = false
): VerbumArticle[] {
  if (!Array.isArray(articles)) return [];
  
  return articles.filter((art) => {
    // If GrammarDB is not enabled and this is a grammardb article, filter out
    if (!includeGrammarDb && art.DictionaryID === 'grammardb') return false;

    if (section === 'all') return true;

    const meta = VERBUM_DICTIONARIES[art.DictionaryID];
    if (section === 'main') {
      return meta?.section === 'main';
    }
    if (section === 'authors') {
      return meta?.section === 'authors';
    }
    if (section === 'encyclopedias') {
      return meta?.section === 'encyclopedias';
    }
    return true;
  });
}
