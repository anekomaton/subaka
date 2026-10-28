/**
 * Belarusian Orthoepic Stress Helper
 * Implements identical stress logic across Web and Desktop (Tauri).
 * Grounded in GrammarDB, BelG2P, PravilnaBy and Belarusian orthoepic rules.
 */

import { amohrafyTxt } from '../belg2p/dataFiles';

// Non-stressed words (clitics / prepositions / particles)
export const NIENACISKNYJA = new Set([
  'а', 'аж', 'бо', 'бы', 'быў', 'во', 'вось', 'вот', 'вунь', 'га',
  'дзе', 'ды', 'дык', 'ж', 'жа', 'і', 'каб', 'мо', 'на', 'нат', 'не', 'ні', 'ну', 'ня',
  'ось', 'от', 'так', 'там', 'тут', 'унь', 'хай', 'хоць', 'ці', 'чым', 'што', 'як',
  'аб', 'ад', 'без', 'бяз', 'бліз', 'ва', 'да', 'для', 'за', 'збок', 'зверх', 'звыш',
  'з-за', 'з-над', 'з-пад', 'з-прад', 'ка', 'край', 'кром', 'круг', 'ла', 'ля', 'між',
  'над', 'па', 'пад', 'паўз', 'пра', 'прад', 'праз', 'проць', 'проч', 'пры', 'са',
  'скрай', 'скрозь', 'скруг', 'срэдзь', 'у', 'ў', 'з', 'к'
]);

const VOWELS_SET = 'аеёіоуыэюяАЕЁІОУЫЭЮЯ';

function buildAmohrafyDict(): Record<string, string> {
  const dict: Record<string, string> = {};
  if (!amohrafyTxt) return dict;
  for (const rawLine of amohrafyTxt.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const plainWord = line.replace(/[\+\u0301\u00B4]/g, '').toLowerCase();
    if (plainWord) {
      let am = line.replace(new RegExp(`([${VOWELS_SET}])[\\+\\u00B4]`, 'g'), '$1\u0301');
      am = am.replace(new RegExp(`[\\+\\u00B4]([${VOWELS_SET}])`, 'g'), '$1\u0301');
      am = am.replace(/[\+\u00B4]/g, '');
      dict[plainWord] = am;
    }
  }
  return dict;
}

const AMOHRAFY_DICT = buildAmohrafyDict();

export const OVERRIDE_DICT: Record<string, string> = {
  ...AMOHRAFY_DICT,
  'магу': 'магу́',
  'трасецца': 'трасе́цца',
  'багатая': 'бага́тая',
  'твае': 'твае́',
  'свае': 'свае́',
  'мае': 'мае́',
  'яе': 'яе́',
  'чые': 'чые́',
  'бывай': 'быва́й',
  'бывайце': 'быва́йце',
  'дзякуй': 'дзя́куй',
  'прабач': 'праба́ч',
  'прабачце': 'праба́чце',
  'аўтаадказчык': 'аўтаадка́зчык',
};

export function hasStressMark(s: string): boolean {
  return Boolean(s && (s.includes('\u0301') || s.includes('+') || s.includes('´')));
}

export function cleanWord(w: string): string {
  if (!w) return '';
  const norm = w.normalize('NFC').replace(/[\u0301+´]/g, '');
  return norm
    .toLowerCase()
    .replace(/и/g, 'й')
    .replace(/^[^а-яёіўґa-z0-9]+/gi, '')
    .replace(/[^а-яёіўґa-z0-9]+$/gi, '')
    .trim();
}

export function restoreBelarusianLetters(str: string): string {
  if (!str) return str;
  let res = str.replace(/и/g, 'й').replace(/И/g, 'Й');
  const vowelPattern = '([аеёіоуыэюяАЕЁІОУЫЭЮЯ]\\u0301?)';
  res = res.replace(new RegExp(vowelPattern + 'у', 'gi'), (match, p1) => {
    return p1 + (match.endsWith('У') ? 'Ў' : 'ў');
  });
  return res;
}

export function applyStressToOriginal(original: string, stressed: string): string {
  if (!original || !stressed) return original;
  const origNfc = original.normalize('NFC');
  if (hasStressMark(origNfc)) return origNfc;

  const stressedNfc = stressed.normalize('NFC');
  const stressesAfterBaseIndex = new Set<number>();
  let baseCount = 0;

  for (const ch of stressedNfc) {
    if (ch === '\u0301' || ch === '+' || ch === '\u00B4') {
      if (baseCount > 0) {
        stressesAfterBaseIndex.add(baseCount - 1);
      }
    } else {
      baseCount++;
    }
  }

  if (stressesAfterBaseIndex.size === 0) {
    return origNfc;
  }

  const res: string[] = [];
  let currBaseIndex = 0;

  for (const ch of origNfc) {
    res.push(ch);
    if (!/\p{M}/u.test(ch)) {
      if (stressesAfterBaseIndex.has(currBaseIndex)) {
        res.push('\u0301');
      }
      currBaseIndex++;
    }
  }

  return res.join('');
}

export function getUAlternationVariants(word: string): string[] {
  if (!word) return [];
  const list = [word];
  const wLower = word.toLowerCase();

  if (wLower.startsWith('ў')) {
    list.push('у' + word.slice(1));
    list.push('У' + word.slice(1));
  } else if (wLower.startsWith('у')) {
    list.push('ў' + word.slice(1));
    list.push('Ў' + word.slice(1));
  }

  if (/[ўЎ]/.test(word)) {
    list.push(word.replace(/ў/g, 'у').replace(/Ў/g, 'У'));
  }
  if (/[уУ]/.test(word)) {
    list.push(word.replace(/у/g, 'ў').replace(/У/g, 'Ў'));
  }
  if (/[ґҐ]/.test(word)) {
    list.push(word.replace(/ґ/g, 'г').replace(/Ґ/g, 'Г'));
  }

  return Array.from(new Set(list));
}

export function fallbackStress(word: string): string {
  if (!word || hasStressMark(word)) return word;
  const wLower = word.toLowerCase();
  if (NIENACISKNYJA.has(wLower)) return word;
  if (OVERRIDE_DICT[wLower]) {
    return applyStressToOriginal(word, OVERRIDE_DICT[wLower]);
  }

  const vowelMatches = Array.from(word.matchAll(/[аеёіоуыэюяАЕЁІОУЫЭЮЯ]/g));
  if (vowelMatches.length === 0) return word;

  // 1. 'ё' is ALWAYS stressed
  const yoMatches = vowelMatches.filter(m => m[0].toLowerCase() === 'ё');
  if (yoMatches.length === 1) {
    const idx = yoMatches[0].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  if (vowelMatches.length === 1) {
    const idx = vowelMatches[0].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  // 2. Infinitives -сці, -зці, -гчы, -кчы -> stress on last vowel
  if (/([сз]ці|[гк]чы)$/i.test(word)) {
    const idx = vowelMatches[vowelMatches.length - 1].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  // 3. Past verbs -шлі, -шла, -шло -> stress on last vowel
  if (/ш(лі|ла|ло)$/i.test(word)) {
    const idx = vowelMatches[vowelMatches.length - 1].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  // 4. 'о' is ALWAYS stressed
  const oMatches = vowelMatches.filter(m => m[0].toLowerCase() === 'о');
  if (oMatches.length === 1) {
    const idx = oMatches[0].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  // 5. Common suffixes (-чык, -шчык)
  const m = /[аеіоуыэюя][тдзс]?[чш]ык[а-яеіў]*$/i.exec(word);
  if (m) {
    const idx = m.index;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  return word;
}

/**
 * Universal batch word stress processor:
 * Combines in-memory rules (OVERRIDE_DICT, NIENACISKNYJA, fallbackStress)
 * with an optional DB lookup function for unknown words.
 */
export async function applyOrthoepicStressToWords(
  words: string[],
  dbLookupFn?: (cleanedWords: string[]) => Promise<Record<string, string>>
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  const cleanedMap: Record<string, string[]> = {};

  for (const w of words) {
    const c = cleanWord(w);
    if (c && !NIENACISKNYJA.has(c)) {
      if (OVERRIDE_DICT[c]) {
        results[w] = applyStressToOriginal(w, OVERRIDE_DICT[c]);
      } else {
        const variants = getUAlternationVariants(c);
        let foundInOverride = false;
        for (const v of variants) {
          if (OVERRIDE_DICT[v]) {
            results[w] = applyStressToOriginal(w, OVERRIDE_DICT[v]);
            foundInOverride = true;
            break;
          }
        }
        if (!foundInOverride) {
          for (const v of variants) {
            if (!cleanedMap[v]) cleanedMap[v] = [];
            if (!cleanedMap[v].includes(w)) cleanedMap[v].push(w);
          }
        }
      }
    } else if (c && NIENACISKNYJA.has(c)) {
      results[w] = w;
    }
  }

  const keysToQuery = Object.keys(cleanedMap);
  if (dbLookupFn && keysToQuery.length > 0) {
    try {
      const dbResults = await dbLookupFn(keysToQuery);
      for (const [key, stressed] of Object.entries(dbResults)) {
        if (stressed && hasStressMark(stressed)) {
          const originals = cleanedMap[key] || [];
          for (const origW of originals) {
            const res = applyStressToOriginal(origW, stressed);
            if (hasStressMark(res)) {
              results[origW] = res;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[StressHelper] DB lookup failed, using fallback rules:', e);
    }
  }

  for (const w of words) {
    if (!results[w] || !hasStressMark(results[w])) {
      results[w] = fallbackStress(w);
    }
  }

  return results;
}

/**
 * Stresses a full line of text using orthoepic rules and DB lookups
 */
export async function stressTextWithOrthoepy(
  text: string,
  dbLookupFn?: (cleanedWords: string[]) => Promise<Record<string, string>>
): Promise<string> {
  if (!text || !text.trim()) return text;
  const words = text.match(/[\p{L}'’ʼʹʲ\u0300\u0301\+´]+/gu);
  if (!words) return text;

  const wordsToStress = words.filter(
    (w) => !w.includes('\u0301') && !w.includes('\u0300') && !w.includes('+') && !w.includes('´')
  );
  const stressMap = await applyOrthoepicStressToWords(wordsToStress, dbLookupFn);

  return text.replace(/[\p{L}'’ʼʹʲ\u0300\u0301\+´]+/gu, (w) => {
    if (w.includes('\u0301') || w.includes('\u0300') || w.includes('+') || w.includes('´')) {
      return w;
    }
    return stressMap[w] || w;
  });
}
