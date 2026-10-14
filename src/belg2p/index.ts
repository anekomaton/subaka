/**
 * BelG2P: Беларускі фанетычны канвертар
 * Поўны і дакладны порт арыгінальнага рухавіка BelG2P (https://github.com/Belarus/BelG2P)
 * Працуе выключна на падставе арыгінальных канфігурацыйных файлаў (TSV/TXT) праекта BelG2P.
 */

import { Huk } from './types';
import { WordInitialConverter } from './wordInitialConverter';
import { Fanetyka3 } from './fanetyka3';
import { ToStringIPA2TTS, ToStringSkolny } from './toString';
import { FanetykaText } from './fanetykaText';

export interface BelG2POptions {
  wrapBrackets?: boolean;
  preservePunctuation?: boolean;
  format?: 'skolny' | 'ipa' | 'ipa2tts';
}

/**
 * Канвертаванне асобнага слова ці злучэння слоў (фанетычнага слова)
 */
export function convertPhoneticPhraseBelG2P(
  phrase: string,
  format: 'skolny' | 'ipa' | 'ipa2tts' = 'skolny'
): string {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const converters: WordInitialConverter[] = [];
  let nextWord: WordInitialConverter | null = null;
  for (let i = words.length - 1; i >= 0; i--) {
    const w = new WordInitialConverter(words[i], nextWord);
    converters.unshift(w);
    nextWord = w;
  }

  const allHuki: Huk[] = [];
  for (const c of converters) {
    allHuki.push(...c.huki);
  }

  const engine = new Fanetyka3(allHuki);
  engine.process();

  if (format === 'ipa') {
    return engine.toIPA();
  } else if (format === 'ipa2tts') {
    return engine.toString(new ToStringIPA2TTS());
  } else {
    return engine.toString(new ToStringSkolny());
  }
}

/**
 * Канвертаванне беларускага тэксту (з захаваннем знакаў прыпынку і пераносаў)
 * Выкарыстоўвае FanetykaText праекта BelG2P.
 */
export function convertTextBelG2P(text: string, options: BelG2POptions = {}): string {
  if (!text || !text.trim()) return '';

  const { wrapBrackets = false, format = 'skolny' } = options;

  const ft = new FanetykaText(text);
  let finalOutput: string;
  if (format === 'ipa') {
    finalOutput = ft.ipa;
  } else if (format === 'ipa2tts') {
    finalOutput = ft.ipa2tts;
  } else {
    finalOutput = ft.skola;
  }

  finalOutput = finalOutput.trim();
  if (wrapBrackets) {
    finalOutput = `[${finalOutput}]`;
  }
  return finalOutput;
}

export * from './types';
export * from './fanetyka3';
export * from './wordInitialConverter';
export * from './toString';
export * from './fanetykaText';

