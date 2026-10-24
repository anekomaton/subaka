/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

import { SubtitleEntry } from '../types';
import { BELARUSIAN_STRESS_DICT } from './belStress';
import { getHunspellSuggestions, isHunspellReady } from './hunspellChecker';
import {
  VOWELS,
  CONSONANTS,
  isExceptionPreservingU,
  verifyBelarusianWord,
  WRONG_U_SHORT_FIXES
} from './pravilnaByRules';

/**
 * Strips HTML tags (e.g. <b>, <i>, <u>, <font>) from subtitle text for clean audio/TTS synthesis.
 */
export function stripSrtTags(text: string): string {
  if (!text) return '';
  return text.replace(/<[^>]*>/g, '').trim();
}

/**
 * Sanitizes and formats SRT text with HTML tags (b, i, u, font) for HTML rendering.
 * Converts newlines to <br /> and normalizes tag casing.
 */
export function sanitizeSrtHtml(text: string): string {
  if (!text) return '';

  // Remove <font ...> and </font> tags (e.g. <font face="Serif" size="18">)
  let formatted = text.replace(/<\/?font[^>]*>/gi, '');

  // Standardize SRT HTML tag casing (e.g., <B> -> <b>, </I> -> </i>, <U> -> <u>)
  formatted = formatted
    .replace(/<(\/)?b>/gi, '<$1b>')
    .replace(/<(\/)?i>/gi, '<$1i>')
    .replace(/<(\/)?u>/gi, '<$1u>');

  // Convert newlines to <br /> for HTML rendering
  formatted = formatted.replace(/\r?\n/g, '<br />');

  return formatted;
}

/**
 * Converts a subtitle timestamp string (HH:MM:SS,MS or HH:MM:SS.MS) into total seconds.
 */
export function srtTimeToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  // Clean up format, replace comma with dot for easier splitting
  const clean = timeStr.trim().replace(/^[\[\(]+|[\]\)]+$/g, '').trim();
  const normalized = clean.replace(',', '.');
  const parts = normalized.split(':');

  if (parts.length === 1) {
    const parsed = parseFloat(parts[0]);
    return isNaN(parsed) ? 0 : Math.max(0, parsed);
  }
  if (parts.length === 2) {
    const mins = parseFloat(parts[0]) || 0;
    const secs = parseFloat(parts[1]) || 0;
    return Math.max(0, mins * 60 + secs);
  }

  const hours = parseFloat(parts[0]) || 0;
  const minutes = parseFloat(parts[1]) || 0;
  const seconds = parseFloat(parts[2]) || 0;

  return Math.max(0, hours * 3600 + minutes * 60 + seconds);
}

/**
 * Converts seconds into subtitle timestamp string formatted as HH:MM:SS,MS (SRT format)
 */
export function secondsToSrtTime(secondsNum: number): string {
  if (isNaN(secondsNum) || secondsNum < 0) secondsNum = 0;
  
  const totalMs = Math.round(secondsNum * 1000);
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const secs = totalSecs % 60;
  const totalMins = Math.floor(totalSecs / 60);
  const mins = totalMins % 60;
  const hours = Math.floor(totalMins / 60);

  const pad = (num: number, size: number) => num.toString().padStart(size, '0');

  return `${pad(hours, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

/**
 * Detects subtitle entries that overlap in time.
 * Returns a Set of SubtitleEntry IDs that have overlapping time ranges.
 */
export function getOverlappingSubtitleIds(subtitles: SubtitleEntry[]): Set<string> {
  const overlappingIds = new Set<string>();
  if (subtitles.length === 0) return overlappingIds;

  const items = subtitles.map((s, idx) => ({
    id: s.id,
    start: srtTimeToSeconds(s.startTime),
    end: srtTimeToSeconds(s.endTime),
    originalIndex: idx
  }));

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (isNaN(item.start) || isNaN(item.end) || item.end <= item.start) {
      overlappingIds.add(item.id);
    }
  }

  // Sort by start time for sweep-line O(N log N)
  items.sort((a, b) => a.start - b.start);

  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    if (isNaN(current.start) || isNaN(current.end)) continue;

    for (let j = i + 1; j < items.length; j++) {
      const next = items[j];
      if (isNaN(next.start) || isNaN(next.end)) continue;
      // If next item starts after or when current item ends, no further items can overlap with current
      if (next.start >= current.end) {
        break;
      }
      overlappingIds.add(current.id);
      overlappingIds.add(next.id);
    }
  }

  return overlappingIds;
}

/**
 * Merges original subtitle entries and translation subtitle entries by time matching.
 * - If start & end times match (within threshold e.g. 0.5s), they merge into ONE card (original text + translation text).
 * - If times overlap or differ (without matching start/end times), a NEW card is created for the translation,
 *   so they remain separate cards on the timeline.
 */
export function mergeSubtitlesByTime(
  originalEntries: SubtitleEntry[],
  translationEntries: SubtitleEntry[]
): SubtitleEntry[] {
  if (originalEntries.length === 0 && translationEntries.length === 0) {
    return [];
  }

  if (originalEntries.length === 0) {
    return translationEntries.map((entry) => ({
      ...entry,
      text: '',
      translatedText: entry.translatedText || entry.text || '',
    }));
  }

  if (translationEntries.length === 0) {
    return originalEntries.map((entry) => ({
      ...entry,
      text: entry.text || '',
      translatedText: entry.translatedText || '',
    }));
  }

  const origList = originalEntries.map((item) => ({
    item,
    startSec: srtTimeToSeconds(item.startTime),
    endSec: srtTimeToSeconds(item.endTime),
  }));

  const transList = translationEntries.map((item) => ({
    item,
    startSec: srtTimeToSeconds(item.startTime),
    endSec: srtTimeToSeconds(item.endTime),
    transText: item.translatedText || item.text || '',
  }));

  // Match threshold in seconds for matching start and end times
  const MATCH_THRESHOLD_SEC = 0.5;

  interface MatchCandidate {
    origIdx: number;
    transIdx: number;
    diffScore: number;
  }

  const candidates: MatchCandidate[] = [];

  for (let i = 0; i < origList.length; i++) {
    const o = origList[i];
    for (let j = 0; j < transList.length; j++) {
      const t = transList[j];

      const startDiff = Math.abs(o.startSec - t.startSec);
      const endDiff = Math.abs(o.endSec - t.endSec);

      // Phrases match in time if start and end times coincide within threshold
      if (startDiff <= MATCH_THRESHOLD_SEC && endDiff <= MATCH_THRESHOLD_SEC) {
        candidates.push({
          origIdx: i,
          transIdx: j,
          diffScore: startDiff + endDiff,
        });
      }
    }
  }

  // Sort candidates by best (lowest) time difference first
  candidates.sort((a, b) => a.diffScore - b.diffScore);

  const matchedOrig = new Set<number>();
  const matchedTrans = new Set<number>();
  const origToTransMatch = new Map<number, number>();

  for (const cand of candidates) {
    if (!matchedOrig.has(cand.origIdx) && !matchedTrans.has(cand.transIdx)) {
      matchedOrig.add(cand.origIdx);
      matchedTrans.add(cand.transIdx);
      origToTransMatch.set(cand.origIdx, cand.transIdx);
    }
  }

  const result: SubtitleEntry[] = [];

  // 1. Process all original entries
  for (let i = 0; i < origList.length; i++) {
    const o = origList[i];
    if (origToTransMatch.has(i)) {
      const tIdx = origToTransMatch.get(i)!;
      const t = transList[tIdx];

      const oldAudioUrl = o.item.translatedText === t.transText ? o.item.audioUrl : undefined;
      if (o.item.translatedText !== t.transText && o.item.audioUrl) {
        URL.revokeObjectURL(o.item.audioUrl);
      }

      result.push({
        id: o.item.id || Math.random().toString(36).substring(4),
        startTime: o.item.startTime,
        endTime: o.item.endTime,
        text: o.item.text || '',
        translatedText: t.transText,
        actor: t.item.actor || o.item.actor,
        originalActor: o.item.originalActor || o.item.actor,
        audioUrl: oldAudioUrl,
      });
    } else {
      // Unmatched original entry stays as its own card
      result.push({
        id: o.item.id || Math.random().toString(36).substring(4),
        startTime: o.item.startTime,
        endTime: o.item.endTime,
        text: o.item.text || '',
        translatedText: o.item.translatedText || '',
        actor: o.item.actor,
        originalActor: o.item.originalActor || o.item.actor,
        audioUrl: o.item.audioUrl,
      });
    }
  }

  // 2. Process all unmatched translation entries -> create NEW cards for them with distinct IDs!
  for (let j = 0; j < transList.length; j++) {
    if (!matchedTrans.has(j)) {
      const t = transList[j];
      const newId = `trans-${t.item.id || j + 1}-${Math.random().toString(36).substring(2, 7)}`;
      result.push({
        id: newId,
        startTime: t.item.startTime,
        endTime: t.item.endTime,
        text: '', // original is empty
        translatedText: t.transText,
        actor: t.item.actor,
        originalActor: t.item.originalActor,
      });
    }
  }

  // 3. Sort all cards chronologically by startTime
  result.sort((a, b) => srtTimeToSeconds(a.startTime) - srtTimeToSeconds(b.startTime));

  // 4. Ensure 100% unique IDs across all entries in result
  const seenIds = new Set<string>();
  for (let idx = 0; idx < result.length; idx++) {
    let currentId = result[idx].id;
    if (!currentId || seenIds.has(currentId)) {
      currentId = `sub-${idx + 1}-${Math.random().toString(36).substring(2, 8)}`;
      result[idx] = { ...result[idx], id: currentId };
    }
    seenIds.add(currentId);
  }

  return result;
}

/**
 * Parses SRT string into SubtitleEntry list.
 * Handles standard double-newline SRTs, un-numbered continuous SRTs, missing blank lines,
 * 2-part MM:SS timestamps, and lead text before timestamp 1.
 */
export function parseSrt(srtText: string, maxMediaDurationSec?: number): SubtitleEntry[] {
  const entries: SubtitleEntry[] = [];
  if (!srtText) return entries;

  const rawLines = srtText.replace(/\r\n/g, '\n').split('\n');

  // Match any timestamp lines (HH:MM:SS,MS, MM:SS,MS, HH:MM:SS, etc. with or without brackets, with --> or -> or -)
  const timestampRegex = /(?:^|\s)[\[\(]?\s*((?:\d{1,2}:){1,2}\d{1,2}(?:[,.]\d{1,3})?)\s*[\]\)]?\s*(?:-->|->|~|-)\s*[\[\(]?\s*((?:\d{1,2}:){1,2}\d{1,2}(?:[,.]\d{1,3})?)\s*[\]\)]?(?:$|\s)/;

  interface FoundTimestamp {
    lineIdx: number;
    startStr: string;
    endStr: string;
  }

  const foundTimestamps: FoundTimestamp[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trim();
    const match = line.match(timestampRegex);
    if (match) {
      foundTimestamps.push({
        lineIdx: i,
        startStr: match[1].trim(),
        endStr: match[2].trim(),
      });
    }
  }

  if (foundTimestamps.length === 0) {
    // Check for single-timestamp lines (e.g. "[00:12.50] Тэкст" or "00:12 - Тэкст" or "(00:01:23) Тэкст")
    const singleTsRegex = /^[\[\(]?\s*((?:\d{1,2}:){1,2}\d{1,2}(?:[,.]\d{1,3})?)\s*[\]\)]?[\s:-]*(.*)$/;
    const singleMatches: { timeSec: number; text: string }[] = [];

    for (const rawLine of rawLines) {
      const line = rawLine.trim();
      if (!line || /^\d+$/.test(line) || /^(WEBVTT|NOTE|Kind:|Language:|```)/i.test(line)) continue;
      const m = line.match(singleTsRegex);
      if (m && m[1]) {
        const tSec = srtTimeToSeconds(m[1]);
        const cleanTxt = (m[2] || '').replace(/<\/?font[^>]*>/gi, '').trim();
        if (cleanTxt) {
          singleMatches.push({ timeSec: tSec, text: cleanTxt });
        }
      }
    }

    if (singleMatches.length > 0) {
      for (let i = 0; i < singleMatches.length; i++) {
        const cur = singleMatches[i];
        const nextTime = i + 1 < singleMatches.length ? singleMatches[i + 1].timeSec : cur.timeSec + 3.0;
        const endSec = nextTime > cur.timeSec ? nextTime : cur.timeSec + 2.5;
        entries.push({
          id: `sub-${i + 1}-${Math.random().toString(36).substring(2, 7)}`,
          startTime: secondsToSrtTime(cur.timeSec),
          endTime: secondsToSrtTime(endSec),
          text: cur.text,
        });
      }
      return entries;
    }

    // Fallback: If no timestamps found at all, split non-empty lines into progressive timed cards
    const cleanLines = rawLines
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^\d+$/.test(l) && !/^(WEBVTT|NOTE|Kind:|Language:|```|here|this|transcription|subrip|subtitle|sure|okay)/i.test(l));

    if (cleanLines.length > 0) {
      let currentClock = 0;
      for (let i = 0; i < cleanLines.length; i++) {
        const cl = cleanLines[i];
        const text = cl.replace(/<\/?font[^>]*>/gi, '').trim();
        if (text) {
          const dur = Math.min(6.0, Math.max(2.0, text.split(/\s+/).length * 0.4));
          entries.push({
            id: `sub-${i + 1}-${Math.random().toString(36).substring(2, 7)}`,
            startTime: secondsToSrtTime(currentClock),
            endTime: secondsToSrtTime(currentClock + dur),
            text,
          });
          currentClock += dur + 0.1;
        }
      }
      return entries;
    }

    return entries;
  }

  // Handle orphan lead text that appeared BEFORE the very first timestamp line
  const firstTsIdx = foundTimestamps[0].lineIdx;
  if (firstTsIdx > 0) {
    const leadTextLines: string[] = [];
    for (let k = 0; k < firstTsIdx; k++) {
      const line = rawLines[k].trim();
      if (!line) continue;
      if (/^\d+$/.test(line)) continue; // ignore block index numbers
      if (/^(WEBVTT|NOTE|Kind:|Language:|```|here|this|transcription|subrip|subtitle|sure|okay)/i.test(line)) continue;
      leadTextLines.push(line);
    }
    const leadText = leadTextLines.join('\n').replace(/<\/?font[^>]*>/gi, '').trim();
    if (leadText) {
      const firstTsStartSec = srtTimeToSeconds(foundTimestamps[0].startStr);
      const endSec = firstTsStartSec > 0 ? firstTsStartSec : 2.5;
      entries.push({
        id: `sub-0-${Math.random().toString(36).substring(2, 7)}`,
        startTime: secondsToSrtTime(0),
        endTime: secondsToSrtTime(endSec),
        text: leadText,
      });
    }
  }

  // Process each timestamp line and its corresponding text lines
  for (let j = 0; j < foundTimestamps.length; j++) {
    const currentTs = foundTimestamps[j];
    const nextTsLineIdx = (j + 1 < foundTimestamps.length) ? foundTimestamps[j + 1].lineIdx : rawLines.length;

    const textLines: string[] = [];
    for (let k = currentTs.lineIdx + 1; k < nextTsLineIdx; k++) {
      const line = rawLines[k].trim();
      if (!line) continue;
      if (/^\d+$/.test(line)) continue; // ignore block index numbers
      if (/^(WEBVTT|NOTE|Kind:|Language:)/i.test(line)) continue;
      textLines.push(line);
    }

    const rawText = textLines.join('\n').trim();
    const text = rawText.replace(/<\/?font[^>]*>/gi, '').trim();

    const startSec = srtTimeToSeconds(currentTs.startStr);
    let endSec = srtTimeToSeconds(currentTs.endStr);

    if (endSec <= startSec) {
      endSec = startSec + 1.5;
    } else if (endSec - startSec > 14.0) {
      // Guard against cards stretched across long silence or instrumental gaps
      const words = text.split(/\s+/).filter(Boolean).length;
      const plausibleDur = Math.max(2.5, words * 0.45 + 1.0);
      if (endSec - startSec > plausibleDur * 2.2) {
        endSec = startSec + plausibleDur;
      }
    }

    if (maxMediaDurationSec && maxMediaDurationSec > 0) {
      if (startSec >= maxMediaDurationSec - 0.2) continue;
      endSec = Math.min(endSec, maxMediaDurationSec);
    }

    const normStart = secondsToSrtTime(startSec);
    const normEnd = secondsToSrtTime(endSec);

    const id = `sub-${j + 1}-${Math.random().toString(36).substring(2, 7)}`;

    entries.push({
      id,
      startTime: normStart,
      endTime: normEnd,
      originalStartTime: normStart,
      originalEndTime: normEnd,
      text: text || '',
    });
  }

  return entries;
}

/**
 * Interface representing a detected Belarusian spellcheck token.
 */
export interface SpellToken {
  text: string;
  isError: boolean;
  errorType?: 'red' | 'yellow';
  tooltip?: string;
  suggestion?: string;
  suggestions?: string[];
  isIgnored?: boolean;
}

/**
 * Searches for spelling candidates using 1-edit distance and transpositions (Damerau-Levenshtein)
 * in the Belarusian stress/lexicon dictionary (GrammarDB + BelG2P).
 */
export function getDamerauLevenshteinGrammarDbSuggestions(word: string, limit = 5): string[] {
  if (!word || word.length < 3) return [];
  const lower = word.toLowerCase().replace(/[\u0301\u00B4]/g, '');
  const alphabet = 'абвгдэёжзійклмнопрстуўфхцчшыьэюя';
  const candidates: string[] = [];
  const seen = new Set<string>();

  const addCand = (cand: string) => {
    if (cand !== lower && !seen.has(cand) && BELARUSIAN_STRESS_DICT[cand]) {
      seen.add(cand);
      candidates.push(cand);
    }
  };

  // 1. Transpositions (adjacent character swaps, e.g. кырху -> крыху)
  for (let i = 0; i < lower.length - 1; i++) {
    const cand = lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2);
    addCand(cand);
    if (candidates.length >= limit) return candidates;
  }

  // 2. Substitutions (1 typo letter)
  for (let i = 0; i < lower.length; i++) {
    for (const char of alphabet) {
      if (char === lower[i]) continue;
      const cand = lower.slice(0, i) + char + lower.slice(i + 1);
      addCand(cand);
      if (candidates.length >= limit) return candidates;
    }
  }

  // 3. Deletions (1 extra letter, e.g. крынху -> крыху)
  for (let i = 0; i < lower.length; i++) {
    const cand = lower.slice(0, i) + lower.slice(i + 1);
    addCand(cand);
    if (candidates.length >= limit) return candidates;
  }

  // 4. Insertions (1 missing letter)
  for (let i = 0; i <= lower.length; i++) {
    for (const char of alphabet) {
      const cand = lower.slice(0, i) + char + lower.slice(i);
      addCand(cand);
      if (candidates.length >= limit) return candidates;
    }
  }

  return candidates;
}

/**
 * Checks Belarusian orthography and grammar issues according to Pravily-2008
 * and Russian interference filter (11 steps):
 *
 * 1. Akanne (unaccented 'о' -> 'а', 'э' in roots -> 'а')
 * 2. Yakanne (pre-tonic 'е/ё' -> 'я', except 'семсот', 'восемсот')
 * 3. Dzekanne & Tsekanne (soft 'д' -> 'дз', soft 'т' -> 'ц', except loanwords)
 * 4. Hard consonants (ж, ш, ч, р, дж, ц are always hard, no 'ь' or soft vowels)
 * 5. U neskladovaye ('у' after vowel -> 'ў', 'ў' after consonant/start -> 'у')
 * 6. Separation signs (Apostrophe vs Soft sign)
 * 7. Transition 'і' -> 'ы' after prefixes
 * 8. Stop-letters & phonetics ('и' -> 'і', 'щ' -> 'шч', 'ъ' -> '\'')
 * 9. Non-full-vowel calques ('бре-', 'дре-', 'гре-', 'пре-', 'гла-' -> 'бера-', 'дзера-', 'гара-', 'пера-', 'гала-')
 * 10. Syntactic preposition governance ('дзякаваць каму', 'смяяцца з', 'ісці па', 'хварэць на', 'ажаніцца з')
 * 11. Ikanne / Yakanne interference filter
 */

export interface BelarusianSpellOptions {
  ignoredWords?: Set<string> | string[];
  ignoredCapitalization?: Set<string> | string[];
  checkCapitalization?: boolean;
  checkPositionalU?: boolean;
  previousText?: string;
  includeSuggestions?: boolean;
}

/**
 * Strips all Unicode stress and accent marks (combining acute \u0301, grave \u0300, spacing acute \u00B4, modifier accents)
 */
export function stripAccents(str: string): string {
  if (!str) return '';
  return str.replace(/[\u0300\u0301\u00B4\u02CA\u02CB]/g, '');
}

// In-memory cache for spell check results to make toggling spell check instantaneous
const spellTokensCache = new Map<string, SpellToken[]>();

export function clearSpellTokensCache(): void {
  spellTokensCache.clear();
}

// Global in-memory cache for ignored words to avoid JSON.parse on every lookup
let cachedIgnoredWords: Set<string> | null = null;

export const getStoredIgnoredWords = (): Set<string> => {
  if (cachedIgnoredWords !== null) {
    return cachedIgnoredWords;
  }
  if (typeof window === 'undefined') {
    return new Set();
  }
  try {
    const saved = localStorage.getItem('subaka_ignored_words');
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) {
        cachedIgnoredWords = new Set(
          arr.map((w: string) => stripAccents(String(w)).toLowerCase().trim()).filter(Boolean)
        );
        return cachedIgnoredWords;
      }
    }
  } catch {
    // ignore
  }
  cachedIgnoredWords = new Set();
  return cachedIgnoredWords;
};

// Global in-memory cache for ignored capitalization warnings
let cachedIgnoredCapitalization: Set<string> | null = null;

export const getStoredIgnoredCapitalization = (): Set<string> => {
  if (cachedIgnoredCapitalization !== null) {
    return cachedIgnoredCapitalization;
  }
  if (typeof window === 'undefined') {
    return new Set();
  }
  try {
    const saved = localStorage.getItem('subaka_ignored_capitalization');
    if (saved) {
      const arr = JSON.parse(saved);
      if (Array.isArray(arr)) {
        cachedIgnoredCapitalization = new Set(
          arr.map((w: string) => stripAccents(String(w)).toLowerCase().trim()).filter(Boolean)
        );
        return cachedIgnoredCapitalization;
      }
    }
  } catch {
    // ignore
  }
  cachedIgnoredCapitalization = new Set();
  return cachedIgnoredCapitalization;
};

if (typeof window !== 'undefined') {
  window.addEventListener('hunspell-ready', () => {
    clearSpellTokensCache();
  });
  window.addEventListener('subaka-ignored-words-updated', (e: Event) => {
    cachedIgnoredWords = null;
    const customEv = e as CustomEvent<{ word?: string }>;
    const changedWord = customEv?.detail?.word;
    if (changedWord) {
      const cleanChanged = stripAccents(changedWord).toLowerCase().trim();
      // Surgical invalidation: only evict entries whose text actually contains the changed word (ignoring accents)
      for (const key of Array.from(spellTokensCache.keys())) {
        if (stripAccents(key).toLowerCase().includes(cleanChanged)) {
          spellTokensCache.delete(key);
        }
      }
    } else {
      clearSpellTokensCache();
    }
  });
  window.addEventListener('subaka-ignored-capitalization-updated', (e: Event) => {
    cachedIgnoredCapitalization = null;
    clearSpellTokensCache();
  });
  window.addEventListener('storage', (e) => {
    if (e.key === 'subaka_ignored_words' || e.key === 'subaka_ignored_capitalization') {
      cachedIgnoredWords = null;
      cachedIgnoredCapitalization = null;
      clearSpellTokensCache();
    }
  });
}

export function getBelarusianSpellTokens(
  text: string, 
  ignoredWordsOrOptions?: Set<string> | string[] | BelarusianSpellOptions,
  extraOptions?: BelarusianSpellOptions
): SpellToken[] {
  if (!text) return [];

  let ignoredSet: Set<string>;
  let checkCapitalization = true;
  let checkPositionalU = true;
  let previousText: string | undefined = undefined;
  let includeSuggestions = false;
  let passedCap: Set<string> | string[] | undefined = undefined;

  if (ignoredWordsOrOptions instanceof Set) {
    ignoredSet = ignoredWordsOrOptions;
    if (extraOptions) {
      checkCapitalization = extraOptions.checkCapitalization ?? true;
      checkPositionalU = extraOptions.checkPositionalU ?? (extraOptions.checkCapitalization ?? true);
      previousText = extraOptions.previousText;
      includeSuggestions = extraOptions.includeSuggestions ?? false;
      passedCap = extraOptions.ignoredCapitalization;
    }
  } else if (Array.isArray(ignoredWordsOrOptions)) {
    ignoredSet = new Set(ignoredWordsOrOptions);
    if (extraOptions) {
      checkCapitalization = extraOptions.checkCapitalization ?? true;
      checkPositionalU = extraOptions.checkPositionalU ?? (extraOptions.checkCapitalization ?? true);
      previousText = extraOptions.previousText;
      includeSuggestions = extraOptions.includeSuggestions ?? false;
      passedCap = extraOptions.ignoredCapitalization;
    }
  } else if (ignoredWordsOrOptions && typeof ignoredWordsOrOptions === 'object') {
    const opts = ignoredWordsOrOptions;
    checkCapitalization = opts.checkCapitalization ?? true;
    checkPositionalU = opts.checkPositionalU ?? (opts.checkCapitalization ?? true);
    previousText = opts.previousText;
    includeSuggestions = opts.includeSuggestions ?? false;
    passedCap = opts.ignoredCapitalization;
    ignoredSet = opts.ignoredWords
      ? (opts.ignoredWords instanceof Set ? opts.ignoredWords : new Set(opts.ignoredWords))
      : new Set<string>();
  } else {
    ignoredSet = new Set<string>();
  }

  let ignoredCapSet: Set<string>;
  if (passedCap instanceof Set) {
    ignoredCapSet = passedCap;
  } else if (Array.isArray(passedCap)) {
    ignoredCapSet = new Set(passedCap.map((w: string) => stripAccents(String(w)).toLowerCase().trim()).filter(Boolean));
  } else {
    ignoredCapSet = getStoredIgnoredCapitalization();
  }

  const prevClean = previousText ? stripSrtTags(previousText).trim() : '';
  const prevWithoutTrailingQuotes = prevClean.replace(/["'»”)\]}]+$/g, '').trim();
  const prevLastChar = prevWithoutTrailingQuotes.slice(-1);
  const prevEndsSentence = !prevClean || /[.!?…]/.test(prevLastChar);
  const prevEndsPunct = /[.,!?:;…—–\-"'«»“”()\[\]{}\/\\]/.test(prevLastChar);
  const prevCyrMatch = prevClean.replace(/[\u0300\u0301\u00B4\u02CA\u02CB]/g, '').match(/[а-яА-ЯёЁіІўЎ]/g);
  const prevLastCyr = prevCyrMatch ? prevCyrMatch[prevCyrMatch.length - 1].toLowerCase() : '';

  // Fast cache lookup (omits ignoredSet.size so unaffected entries are never purged)
  const cacheKey = `${text}_cap:${checkCapitalization ? 1 : 0}_u:${checkPositionalU ? 1 : 0}_pr:${prevEndsSentence ? 1 : 0}_${prevEndsPunct ? 1 : 0}_${prevLastCyr}_sug:${includeSuggestions ? 1 : 0}`;
  const cached = spellTokensCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Match words, HTML tags, or non-word symbols (including Belarusian modifier apostrophe U+02BC)
  const regex = /(<[^>]+>)|([a-zA-Zа-яА-ЯёЁіІўЎ\u0300\u0301\u00B4\u02CA\u02CB'’ʼ]+)|([^a-zA-Zа-яА-ЯёЁіІўЎ\u0300\u0301\u00B4\u02CA\u02CB'’ʼ<]+)/g;

  const matches: { text: string; isTag: boolean; isWord: boolean; index: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) matches.push({ text: match[1], isTag: true, isWord: false, index: match.index });
    else if (match[2]) matches.push({ text: match[2], isTag: false, isWord: true, index: match.index });
    else if (match[3]) matches.push({ text: match[3], isTag: false, isWord: false, index: match.index });
  }

  // Multi-word syntactic governance checks
  interface SyntaxRange {
    start: number;
    end: number;
    tooltip: string;
  }
  const syntaxRanges: SyntaxRange[] = [];

  const syntaxRules = [
    {
      pattern: /(дзякаваць|падзякаваць|дзякуй|дзякую|дзякуем|дзякуеце|дзякуюць)\s+(вас|яго|яе|іх)\b/gi,
      tooltip: 'Сінтаксічнае кіраванне: "дзякаваць" ужываецца з давальным склонам (каму? — вам, яму, ёй, ім)'
    },
    {
      pattern: /(смяяцца|смяешся|смяецца|смяемся|смяецеся|смяюцца|пасмяяцца|здзекавацца)\s+над\b/gi,
      tooltip: 'Сінтаксічнае кіраванне: "смяяцца з" + родны склон (замест "над" + творны)'
    },
    {
      pattern: /(ісці|іду|ідзеш|ідзе|ідзём|ідзяце|ідуць|пайсці|пайшоў|пайшла|пайшлі)\s+за\s+[а-яа-яёіў']+(ом|ем|ам|ем|ой|ай|ю)\b/gi,
      tooltip: 'Сінтаксічнае кіраванне: мэта руху — "ісці па" + вінавальны склон (ісці па ваду, па хлеб)'
    },
    {
      pattern: /(хварэць|хварэе|хварэюць|захварэў|захварэла)\s+(грыпам|кавідам|ангінай|навірам)\b/gi,
      tooltip: 'Сінтаксічнае кіраванне: "хварэць на" + вінавальны склон (хварэць на грып)'
    },
    {
      pattern: /ажаніцца\s+на\b/gi,
      tooltip: 'Сінтаксічнае кіраванне: "ажаніцца з" + творны склон (ажаніцца з ёй)'
    }
  ];

  for (const sr of syntaxRules) {
    let m: RegExpExecArray | null;
    while ((m = sr.pattern.exec(text)) !== null) {
      syntaxRanges.push({
        start: m.index,
        end: m.index + m[0].length,
        tooltip: sr.tooltip
      });
    }
  }

  const COMMON_TYPOS: Record<string, string> = {
    'крынху': 'крыху',
    'сонце': 'сонца',
    'серце': 'сэрца',
    'що': 'што',
    'це': 'гэта',
    'дуже': 'вельмі',
    'якщо': 'калі',
    'хтось': 'хтосьці',
    'штось': 'штосьці',
    'де': 'дзе',
    'котрий': 'які',
    'але-ж': 'але ж',
    'так-як': 'бо',
    'під': 'пад',
    'сьогодні': 'сёння',
    'завтра': 'заўтра',
    'вчора': 'учора',
    'хорошо': 'добра',
    'пожалуйста': 'калі ласка',
    'спасибо': 'дзякуй',
    'сейчас': 'зараз',
    'всегда': 'заўсёды',
    'никогда': 'ніколі',
    'только': 'толькі',
    'что': 'што',
    'когда': 'калі',
    'его': 'яго',
    'ее': 'яе',
    'ещё': 'яшчэ',
    'еще': 'яшчэ',
    'или': 'або',
    'если': 'калі',
    'как': 'як',
    'будет': 'будзе',
    'меня': 'мяне',
    'тебя': 'цябе',
    'себя': 'сябе',
    'это': 'гэта',
    'этот': 'гэты',
    'нет': 'няма',
    'даже': 'нават',
    'тогда': 'тады',
    'потому': 'таму',
    'чтобы': 'каб',
    'очень': 'вельмі',
    'тоже': 'таксама',
    'уже': 'ужо',
    'сегодня': 'сёння',
    'какой': 'які',
    'какая': 'якая',
    'какое': 'якое',
    'какие': 'якія',
    'здесь': 'тут',
    'время': 'час',
    'город': 'горад',
    'сладкий': 'салодкі',
    'краткий': 'кароткі',
    'белорусский': 'беларускі',
    'советский': 'савецкі',
    'советскі': 'савецкі'
  };

  // Words that are allowed exceptions for dzekanne/tsekanne loanwords or prefix/suffix
  const loanwordsAllowed = new Set([
    'дырэктар', 'дыпламат', 'тэма', 'тэлефон', 'тэкст', 'тып', 'таварыстве', 'адвезці',
    'прэзідыум', 'герой', 'метад', 'семсот', 'восемсот', 'шоу', 'урал'
  ]);

  const tokens: SpellToken[] = [];
  let isSentenceStart = checkCapitalization;
  let hadPunctuationSinceLastWord = checkCapitalization;
  let lastWordEndingVowel = false;
  let lastWordEndingConsonant = false;

  if (prevClean.length > 0) {
    if (!prevEndsSentence) {
      // Папярэдняя картка не заканчваецца знакам прыпынку канца сказа (. ! ? …)
      // Гэта значыць, што першае слова ў бягучай картцы - гэта працяг сказа,
      // і калі яно з маленькай літары, гэта не памылка (жоўтая памылка не паказваецца).
      isSentenceStart = false;
    }

    if (prevEndsPunct) {
      hadPunctuationSinceLastWord = true;
    } else {
      hadPunctuationSinceLastWord = false;
      if (prevLastCyr) {
        lastWordEndingVowel = VOWELS.has(prevLastCyr);
        lastWordEndingConsonant = CONSONANTS.has(prevLastCyr);
      }
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const item = matches[i];

    if (item.isTag || !item.isWord) {
      const cleanText = item.text.replace(/<[^>]+>/g, '');
      // Знакі канца сказа або падвойны перанос радка (новы абзац / рэпліка)
      if (checkCapitalization && (/[.!?…]/.test(cleanText) || /\n\s*\n/.test(cleanText))) {
        isSentenceStart = true;
        hadPunctuationSinceLastWord = true;
        lastWordEndingVowel = false;
        lastWordEndingConsonant = false;
      } else if (/[.,!?:;…—–\-"«»“”()\[\]{}\/\\]/.test(cleanText)) {
        hadPunctuationSinceLastWord = true;
        lastWordEndingVowel = false;
        lastWordEndingConsonant = false;
      }
      // Звычайны прабел альбо адзіночны перанос радка (\n) лічыцца за прабел —
      // таму стан папярэдняга слова (lastWordEndingVowel / lastWordEndingConsonant)
      // захоўваецца без змен праз перанос радка!
      tokens.push({ text: item.text, isError: false });
      continue;
    }

    let isError = false;
    let errorType: 'red' | 'yellow' = 'red';
    let tooltip = '';
    let suggestion: string | undefined = undefined;
    let suggestionsList: string[] = [];

    const word = item.text;
    const cleanWord = stripAccents(word);
    const lowerWord = cleanWord.toLowerCase().trim();
    const wordStartIdx = item.index;
    const wordEndIdx = item.index + word.length;

    // 0. User-ignored words check - IMMEDIATE EXIT (O(1))
    // Bypasses all grammar rules, stop-letters, Hunspell lookups, and suggestion generators
    if (
      ignoredSet.has(lowerWord) ||
      ignoredSet.has(cleanWord) ||
      ignoredSet.has(word) ||
      ignoredSet.has(word.toLowerCase())
    ) {
      isSentenceStart = false;
      hadPunctuationSinceLastWord = false;

      const cyrLetters = cleanWord.match(/[а-яА-ЯёЁіІўЎ]/g);
      if (cyrLetters && cyrLetters.length > 0) {
        const lastChar = cyrLetters[cyrLetters.length - 1].toLowerCase();
        lastWordEndingVowel = VOWELS.has(lastChar);
        lastWordEndingConsonant = CONSONANTS.has(lastChar);
      } else {
        lastWordEndingVowel = false;
        lastWordEndingConsonant = false;
      }

      tokens.push({
        text: item.text,
        isError: false,
        isIgnored: true,
      });
      continue;
    }

    // 1. Check if this word falls inside a syntax governance range (Yellow warning)
    const matchingSyntax = syntaxRanges.find((r) => wordStartIdx >= r.start && wordEndIdx <= r.end);
    if (matchingSyntax) {
      isError = true;
      errorType = 'yellow';
      tooltip = matchingSyntax.tooltip;
      if (/вас/i.test(word)) suggestion = word.replace(/вас/gi, 'вам');
      else if (/яго/i.test(word)) suggestion = word.replace(/яго/gi, 'яму');
      else if (/яе/i.test(word)) suggestion = word.replace(/яе/gi, 'ёй');
      else if (/іх/i.test(word)) suggestion = word.replace(/іх/gi, 'ім');
    }
    // 2. Russian stop-letters (и, щ, ъ) (Red error)
    else if (/[иИ]/.test(word)) {
      isError = true;
      errorType = 'red';
      tooltip = 'Стоп-літара: замяніце рускую літару "и" -> "і"';
      suggestion = word.replace(/и/g, 'і').replace(/И/g, 'І');
    } else if (/[щЩ]/.test(word)) {
      isError = true;
      errorType = 'red';
      tooltip = 'Стоп-літара: замяніце рускую літару "щ" -> "шч"';
      suggestion = word.replace(/щ/g, 'шч').replace(/Щ/g, 'Шч');
    } else if (/[ъЪ]/.test(word)) {
      isError = true;
      errorType = 'red';
      tooltip = 'Стоп-літара: замяніце рускі цвёрды знак "ъ" -> "\'" (апостраф)';
      suggestion = word.replace(/ъ/g, "'").replace(/Ъ/g, "'");
    }
    // 3. Known typos / Russian interference
    else if (COMMON_TYPOS[lowerWord]) {
      const sugg = COMMON_TYPOS[lowerWord];
      if (sugg && sugg !== lowerWord) {
        isError = true;
        errorType = 'red';
        suggestion = /^[А-ЯЁІЎ]/.test(cleanWord) ? sugg.charAt(0).toUpperCase() + sugg.slice(1) : sugg;
        tooltip = `Памылка/русізм "${word}" -> ужывайце "${suggestion}"`;
      }
    }
    // 4. Rule 15 specific fixes (соўс -> соус, страўс -> страус, шоў -> шоу і інш.)
    else if (WRONG_U_SHORT_FIXES[lowerWord]) {
      isError = true;
      errorType = 'red';
      const fixed = WRONG_U_SHORT_FIXES[lowerWord];
      suggestion = /^[А-ЯЁІ]/.test(cleanWord) ? fixed.charAt(0).toUpperCase() + fixed.slice(1) : fixed;
      tooltip = `Выключэнне (Правіла 15): у гэтым слове пішацца "у" (замест "ў") -> "${suggestion}"`;
    }
    // 5. Official Hunspell be_BY Dictionary -> fallback to GrammarDB Lexicon
    else {
      const verification = verifyBelarusianWord(cleanWord);
      if (!verification.isValid) {
        isError = true;
        errorType = 'red';

        // Check specific phonetic replacement heuristics if available
        if (/[жшчрЖШЧР][іиІИ]/.test(word)) {
          suggestion = word.replace(/([жшчрЖШЧР])[іиІИ]/gi, (m, g1) => g1 + (g1 === g1.toUpperCase() ? 'Ы' : 'ы'));
          tooltip = 'Зацвярдзелыя (ж, ш, ч, р): пасля іх пішацца "ы" (замест "і/и")';
        } else if (/[жшчрЖШЧР]ь/.test(word)) {
          suggestion = word.replace(/([жшчрЖШЧР])ь/gi, '$1');
          tooltip = 'Зацвярдзелыя (ж, ш, ч, р): не могуць мець мяккі знак "ь"';
        } else if (/[чрЧР][еёюя]/i.test(word) && !loanwordsAllowed.has(lowerWord)) {
          suggestion = word.replace(/([чрЧР])[еёюя]/gi, '$1а');
          tooltip = 'Зацвярдзелыя (ч, р): пасля іх пішуцца цвёрдыя галосныя';
        } else if (/(^|[^з])д[еёіюяь]/i.test(word) && !loanwordsAllowed.has(lowerWord) && !lowerWord.startsWith('дыр') && !lowerWord.startsWith('дып')) {
          suggestion = word.replace(/д([еёіюяь])/gi, (m, g1) => (m.charAt(0) === 'Д' ? 'Дз' : 'дз') + g1);
          tooltip = 'Дзеканне: мяккае "д" пераходзіць у "дз"';
        } else if (/(^|[^с])т[еёіюяь]/i.test(word) && !loanwordsAllowed.has(lowerWord) && !lowerWord.startsWith('тэма') && !lowerWord.startsWith('тэк') && !lowerWord.startsWith('тып')) {
          suggestion = word.replace(/т([еёіюяь])/gi, (m, g1) => (m.charAt(0) === 'Т' ? 'Ц' : 'ц') + g1);
          tooltip = 'Цеканне: мяккае "т" пераходзіць у "ц"';
        } else if (/[аеёіоуыэюяа-яА-Я]ть$/i.test(word) && !/^(есть|дать|пить|лить|бить|вить|шить)$/i.test(cleanWord)) {
          suggestion = word.replace(/ть$/i, 'ць');
          tooltip = 'Рускі канчатак дзеяслова "-ть" замест "-ць"';
        } else if (/[аеёіоуыэюяа-яА-Я]тся$/i.test(word)) {
          suggestion = word.replace(/тся$/i, 'цца');
          tooltip = 'Рускі канчатак "-тся" замест "-цца"';
        }

        // Collect candidate suggestions only when includeSuggestions is explicitly requested (e.g. GrammarDB popup)
        // This avoids running heavy Damerau-Levenshtein and Hunspell permutations during real-time typing and error counting
        if (includeSuggestions) {
          const seenSuggs = new Set<string>();
          const isCap = /^[А-ЯЁІЎ]/.test(cleanWord);

          const addCandidate = (cand: string) => {
            if (!cand) return;
            const formatted = isCap ? cand.charAt(0).toUpperCase() + cand.slice(1) : cand;
            const key = formatted.toLowerCase();
            if (!seenSuggs.has(key) && key !== lowerWord) {
              seenSuggs.add(key);
              suggestionsList.push(formatted);
            }
          };

          if (suggestion) {
            addCandidate(suggestion);
          }

          // 1. Hunspell be_BY suggestions
          const hunspellSuggs = getHunspellSuggestions(cleanWord);
          if (hunspellSuggs && hunspellSuggs.length > 0) {
            for (const s of hunspellSuggs) {
              addCandidate(s);
            }
          }

          // 2. Damerau-Levenshtein suggestions from GrammarDB / Stress Dictionary
          const damerauSuggs = getDamerauLevenshteinGrammarDbSuggestions(cleanWord, 5);
          for (const ds of damerauSuggs) {
            addCandidate(ds);
          }

          if (!suggestion && suggestionsList.length > 0) {
            suggestion = suggestionsList[0];
          }
        }

        if (!tooltip) {
          tooltip = suggestion ? 'Памылка правапісу' : `Невядомае слова "${word}"`;
        }
      }
    }

    // 6. Sentence Capitalization check (Yellow warning for lowercase word at start of sentence)
    if (!isError && checkCapitalization && isSentenceStart && /^[а-яёіў]/.test(cleanWord)) {
      if (ignoredCapSet.has(lowerWord)) {
        if (includeSuggestions) {
          tokens.push({
            text: word,
            isError: false,
            isIgnored: true,
            errorType: 'yellow',
            tooltip: 'Гэты сказ пачынаецца не з вялікай літары',
            suggestion: cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1),
            suggestions: [cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1)],
          });
          isSentenceStart = false;
          hadPunctuationSinceLastWord = false;
          continue;
        }
      } else {
        isError = true;
        errorType = 'yellow';
        tooltip = 'Гэты сказ пачынаецца не з вялікай літары';
        suggestion = cleanWord.charAt(0).toUpperCase() + cleanWord.slice(1);
      }
    }

    // 7. Pravilna.by Rule 15: 'у' / 'ў' positional rule and punctuation exceptions
    if (!isError && checkPositionalU) {
      if (lowerWord.startsWith('у')) {
        // Калі пачатак сказа альбо пасля знакаў прыпынку (.,!?:;... і пад.) - заўсёды пішацца У/у!
        if (isSentenceStart || hadPunctuationSinceLastWord) {
          // Пасля знакаў прыпынку альбо ў пачатку сказа пішацца "у" (захоўваецца без памылак)
        } else if (/^[У]/.test(cleanWord)) {
          // П. 4 Правіла 15: ва ўласных імёнах і назвах заўсёды вялікае У складовае (не мяняецца на Ў)
        } else if (lastWordEndingVowel && !isExceptionPreservingU(cleanWord)) {
          // Паміж словамі толькі чысты прабел (без знакаў прыпынку), папярэдняе слова на галосную і гэта не выключэнне
          isError = true;
          errorType = 'red';
          tooltip = 'Пасля галосных ужываецца "ў" (замест "у")';
          suggestion = 'ў' + word.slice(1);
        }
      } else if (lowerWord.startsWith('ў')) {
        if (isSentenceStart) {
          isError = true;
          errorType = 'red';
          tooltip = 'У пачатку сказа ужываецца "у" (замест "ў")';
          suggestion = (word.startsWith('Ў') ? 'У' : 'у') + word.slice(1);
        } else if (hadPunctuationSinceLastWord) {
          isError = true;
          errorType = 'red';
          tooltip = 'Пасля знакаў прыпынку ужываецца "у" (замест "ў")';
          suggestion = (word.startsWith('Ў') ? 'У' : 'у') + word.slice(1);
        } else if (lastWordEndingConsonant || !lastWordEndingVowel) {
          isError = true;
          errorType = 'red';
          tooltip = 'Пасля зычных ужываецца "у" (замест "ў")';
          suggestion = (word.startsWith('Ў') ? 'У' : 'у') + word.slice(1);
        }
      }
    }

    // 8. User-ignored words override
    if (ignoredSet.has(lowerWord) || ignoredSet.has(word)) {
      isError = false;
      tooltip = '';
      suggestion = undefined;
      suggestionsList = [];
    }

    if (suggestion && !suggestionsList.includes(suggestion)) {
      suggestionsList.unshift(suggestion);
    }

    isSentenceStart = false;
    hadPunctuationSinceLastWord = false;

    const cyrLetters = word.replace(/\u0301/g, '').match(/[а-яА-ЯёЁіІўЎ]/g);
    if (cyrLetters && cyrLetters.length > 0) {
      const lastChar = cyrLetters[cyrLetters.length - 1].toLowerCase();
      lastWordEndingVowel = VOWELS.has(lastChar);
      lastWordEndingConsonant = CONSONANTS.has(lastChar);
    } else {
      lastWordEndingVowel = false;
      lastWordEndingConsonant = false;
    }

    tokens.push({
      text: item.text,
      isError,
      errorType: isError ? errorType : undefined,
      tooltip: isError ? tooltip : undefined,
      suggestion: isError ? suggestion : undefined,
      suggestions: isError && suggestionsList.length > 0 ? suggestionsList : (suggestion ? [suggestion] : undefined),
    });
  }

  // Cache up to 5000 results only if Hunspell dictionary is fully ready
  if (isHunspellReady()) {
    if (spellTokensCache.size > 5000) {
      spellTokensCache.clear();
    }
    spellTokensCache.set(cacheKey, tokens);
  }

  return tokens;
}

/**
 * Shifts start and end timestamps of all subtitle entries by offsetSec seconds.
 */
export function shiftSubtitlesTime(subtitles: SubtitleEntry[], offsetSec: number): SubtitleEntry[] {
  if (!subtitles || subtitles.length === 0 || offsetSec === 0) return subtitles;
  return subtitles.map((sub) => {
    const startSec = Math.max(0, srtTimeToSeconds(sub.startTime) + offsetSec);
    const endSec = Math.max(0.1, srtTimeToSeconds(sub.endTime) + offsetSec);
    return {
      ...sub,
      startTime: secondsToSrtTime(startSec),
      endTime: secondsToSrtTime(endSec)
    };
  });
}

/**
 * Encodes SubtitleEntry array into standard SRT string.
 * It uses the translated Belarusian text if available, otherwise falls back to original.
 */
export function stringifySrt(entries: SubtitleEntry[], useTranslation: boolean = false): string {
  return entries
    .map((entry, index) => {
      const textToUse = useTranslation ? (entry.translatedText ?? '') : entry.text;
      return `${index + 1}\n${entry.startTime} --> ${entry.endTime}\n${textToUse}`;
    })
    .join('\n\n');
}

/**
 * Sanitizes project name for use in file names:
 * Replaces spaces and other non-alphanumeric characters with underscores.
 * E.g. "Майстар і Маргарыта (Эпізод 1)" -> "Майстар_і_Маргарыта_Эпізод_1"
 * Format requirement: "назва праекта" (без прабелаў, прабелы ды іншыя знакі замяняй ніжнім падкрэсліваннем)
 */
export function sanitizeProjectName(name?: string, fallback: string = 'subaka'): string {
  if (!name || !name.trim()) return fallback;
  const clean = name
    .trim()
    // Replace non-alphanumeric unicode characters / spaces with underscores
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    // Remove leading and trailing underscores
    .replace(/^_+|_+$/g, '');
  return clean || fallback;
}

/**
 * Helper to generate simple initial subtitles so the user has immediately playable demo content
 */
export function getDemoSubtitles(): SubtitleEntry[] {
  return [
    {
      id: "1",
      startTime: "00:00:01,200",
      endTime: "00:00:05,000",
      text: "Welcome to the Belarusian subtitle translator and voiceover studio!",
      translatedText: "Вітаем у студыі перакладу субцітраў і агучвання на беларускую мову!",
    },
    {
      id: "2",
      startTime: "00:00:05,500",
      endTime: "00:00:10,200",
      text: "You can edit subtitle text, adjust timestamps, and perform instant AI translation.",
      translatedText: "Вы можаце рэдагаваць тэкст субцітраў, наладжваць часавыя пазнакі і рабіць імгненны пераклад штучным інтэлектам.",
    },
    {
      id: "3",
      startTime: "00:00:10,700",
      endTime: "00:00:15,500",
      text: "Listen to the generated voiceover synchronized perfectly with the audio timeline.",
      translatedText: "Слухайце згенераванае агучванне, ідэальна сіхранізаванае з часовай шкалой аўдыя.",
    }
  ];
}
