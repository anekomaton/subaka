import nspell from 'nspell';

export const HUNSPELL_VERSION = '0.5.2 (spell.by-reservation.com)';

let spellInstance: ReturnType<typeof nspell> | null = null;
let initPromise: Promise<ReturnType<typeof nspell> | null> | null = null;

function getFromIDB(): Promise<{ aff: string; dic: string } | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open('hunspell_cache_db', 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('dict')) {
          req.result.createObjectStore('dict');
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('dict', 'readonly');
          const store = tx.objectStore('dict');
          const getReq = store.get('be_BY_v0.5.2');
          getReq.onsuccess = () => {
            resolve(getReq.result || null);
          };
          getReq.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function saveToIDB(data: { aff: string; dic: string }): void {
  if (typeof indexedDB === 'undefined') return;
  try {
    const req = indexedDB.open('hunspell_cache_db', 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('dict')) {
        req.result.createObjectStore('dict');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      try {
        const tx = db.transaction('dict', 'readwrite');
        const store = tx.objectStore('dict');
        store.put(data, 'be_BY_v0.5.2');
      } catch {
        // ignore
      }
    };
  } catch {
    // ignore
  }
}

async function fetchDictText(): Promise<{ aff: string; dic: string }> {
  if (typeof window === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path');
      const affPath = path.resolve(process.cwd(), 'public/dict/be_BY.aff');
      const dicPath = path.resolve(process.cwd(), 'public/dict/be_BY.dic');
      return {
        aff: fs.readFileSync(affPath, 'utf-8'),
        dic: fs.readFileSync(dicPath, 'utf-8'),
      };
    } catch (e) {
      console.error('Failed to load dict in Node:', e);
      return { aff: '', dic: '' };
    }
  }

  // Check client-side IndexedDB cache first
  try {
    const cached = await getFromIDB();
    if (cached && cached.aff && cached.dic) {
      return cached;
    }
  } catch {
    // Ignore cache error, continue with fetch
  }

  try {
    const [affRes, dicRes] = await Promise.all([
      fetch('/dict/be_BY.aff'),
      fetch('/dict/be_BY.dic'),
    ]);
    const aff = await affRes.text();
    const dic = await dicRes.text();
    if (aff && dic) {
      saveToIDB({ aff, dic });
    }
    return { aff, dic };
  } catch (err) {
    console.error('Failed to fetch dictionary files in browser:', err);
    return { aff: '', dic: '' };
  }
}

export async function initHunspell(): Promise<ReturnType<typeof nspell> | null> {
  if (spellInstance) return spellInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const { aff, dic } = await fetchDictText();
      if (aff && dic) {
        spellInstance = nspell(aff, dic);
        clearHunspellCache();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('hunspell-ready'));
        }
      }
    } catch (err) {
      console.error('Failed to initialize Hunspell be_BY:', err);
    }
    return spellInstance;
  })();

  return initPromise;
}

export function onHunspellReady(callback: () => void): () => void {
  if (spellInstance) {
    callback();
    return () => {};
  }
  if (typeof window === 'undefined') return () => {};

  const handler = () => callback();
  window.addEventListener('hunspell-ready', handler);
  return () => window.removeEventListener('hunspell-ready', handler);
}

// Auto-trigger init on module import in browser
if (typeof window !== 'undefined') {
  initHunspell().catch(() => {});
}

export function getHunspellInstance(): ReturnType<typeof nspell> | null {
  if (!spellInstance && typeof window === 'undefined') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const path = require('path');
      const affPath = path.resolve(process.cwd(), 'public/dict/be_BY.aff');
      const dicPath = path.resolve(process.cwd(), 'public/dict/be_BY.dic');
      if (fs.existsSync(affPath) && fs.existsSync(dicPath)) {
        spellInstance = nspell(
          fs.readFileSync(affPath, 'utf-8'),
          fs.readFileSync(dicPath, 'utf-8')
        );
      }
    } catch (e) {
      // ignore
    }
  }
  return spellInstance;
}

export function isHunspellReady(): boolean {
  return getHunspellInstance() !== null;
}

const hunspellCache = new Map<string, boolean>();

export function clearHunspellCache(): void {
  hunspellCache.clear();
}

export function isWordValidHunspell(word: string): boolean {
  if (!word) return true;
  const clean = word.replace(/[\u0300\u0301\u00B4\u02CA\u02CB]/g, '');
  if (!clean || /^\d+$/.test(clean)) return true;

  const cached = hunspellCache.get(clean);
  if (cached !== undefined) {
    return cached;
  }

  const spell = getHunspellInstance();
  if (!spell) {
    // If dictionary is still loading, do NOT cache the result
    return true;
  }

  const normApos = clean.replace(/[’ʼ]/g, "'");
  const lowerNorm = normApos.toLowerCase();

  const res = spell.correct(clean) || spell.correct(normApos) || spell.correct(lowerNorm);
  hunspellCache.set(clean, res);
  return res;
}

export function getHunspellSuggestions(word: string): string[] {
  if (!word) return [];
  const clean = word.replace(/[\u0301\u00B4]/g, '');
  const spell = getHunspellInstance();
  if (!spell) return [];

  const normApos = clean.replace(/[’ʼ]/g, "'");
  const lowerNorm = normApos.toLowerCase();

  const suggestions = spell.suggest(clean) || spell.suggest(normApos) || spell.suggest(lowerNorm) || [];
  
  if (/^[А-ЯЁІЎ]/.test(clean)) {
    return suggestions.map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  }
  return suggestions;
}
