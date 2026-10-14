/**
 * BelG2P FanetykaText
 * Port of org.alex73.fanetyka.impl.FanetykaText
 *
 * Тэкставы канвертар BelG2P:
 * - Разбівае тэкст на словы і знакі прыпынку
 * - Выконвае міжслоўныя фанетычныя пераходы
 * - Генеруе IPA, школьную транскрыпцыю і IPA спецыяльна для TTS (ToStringIPA2TTS)
 */

import { Huk } from './types';
import { WordInitialConverter } from './wordInitialConverter';
import { Fanetyka3 } from './fanetyka3';
import { ToStringIPA, ToStringIPA2TTS, ToStringSkolny } from './toString';

export class FanetykaText {
  ipa: string = '';
  skola: string = '';
  ipa2tts: string = '';

  constructor(text: string) {
    let word = '';
    const words: string[] = [];

    const processWords = () => {
      if (words.length === 0) return;

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

      const f = new Fanetyka3(allHuki);
      f.process();

      this.ipa += f.toString(new ToStringIPA());
      this.skola += f.toString(new ToStringSkolny());
      this.ipa2tts += f.toString(new ToStringIPA2TTS());

      words.length = 0;
    };

    for (let i = 0; i < text.length; i++) {
      const c = text.charAt(i);
      let letter = this.isLetter(c);
      if (c === '-' && i > 0 && !this.isLetter(text.charAt(i - 1))) {
        letter = false;
      }
      if (letter) {
        word += c;
      } else {
        if (word.length > 0) {
          words.push(word);
          word = '';
        } else if (c === ' ') {
          this.ipa += c;
          this.skola += c;
          this.ipa2tts += c;
        }
        if (c !== ' ') {
          processWords();
          this.ipa += c;
          this.skola += c;
          this.ipa2tts += c;
        }
      }
    }

    if (word.length > 0) {
      words.push(word);
    }
    processWords();
  }

  private isLetter(c: string): boolean {
    const cl = c.toLowerCase();
    return (
      "ёйцукенгшўзх'фывапролджэячсмітьбюґ|-\u0301" +
      "'`’ʼ" +
      "\u00B4+"
    ).includes(cl);
  }
}
