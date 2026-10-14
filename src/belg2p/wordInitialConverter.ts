/**
 * BelG2P Word Initial Converter
 * Port of org.alex73.fanetyka.impl.WordInitialConverter
 */

import {
  BAZAVY_HUK,
  HALOSNYJA,
  Huk,
  MIAKKASC_PAZNACANAJA,
  PADZIEL_APOSTRAF,
  PADZIEL_KARANI,
  PADZIEL_PRYNAZOUNIK,
  PADZIEL_PRYSTAUKA,
  PADZIEL_SLOVY,
  PADZIEL_ZLUCOK,
  WordContext
} from './types';
import {
  prystaukiTxt,
  prystaukiZlucokTxt,
  nienacisknyjaTxt,
  amohrafyTxt
} from './dataFiles';
import { applyBelarusianStress } from '../utils/belStress';

interface Prystauka {
  beg: string;
  result: string;
}

const PRYSTAUKI: Prystauka[] = [];
for (const rawLine of prystaukiTxt.split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const parts = line.split('=');
  if (parts.length === 2) {
    PRYSTAUKI.push({ beg: parts[0].trim(), result: parts[1].trim() });
  }
}
// Sort by prefix length descending
PRYSTAUKI.sort((a, b) => b.beg.length - a.beg.length);

const PRYSTAUKI_ZLUCOK: string[] = [];
for (const rawLine of prystaukiZlucokTxt.split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  PRYSTAUKI_ZLUCOK.push(line);
}

const NIENACISKNYJA = new Set<string>();
for (const rawLine of nienacisknyjaTxt.split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const word = line.includes('/') ? line.split('/')[1].trim() : line;
  if (word) {
    NIENACISKNYJA.add(word.toLowerCase());
  }
}
// Additional standard unstressed clitics and prepositions
['і', 'а', 'ды', 'ў', 'у', 'на', 'да', 'за', 'пад', 'над', 'праз', 'цераз', 'аб', 'ад', 'па', 'як', 'ці', 'ні', 'не', 'без', 'бяз', 'з', 'са', 'пры', 'бы', 'б', 'жа', 'ж', 'хай', 'хоць', 'вось', 'во', 'ну', 'ня'].forEach(w => NIENACISKNYJA.add(w));

const AMOHRAFY = new Map<string, string>();
for (const rawLine of amohrafyTxt.split('\n')) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const plainWord = line.replace(/[\+\u0301\u00B4]/g, '').toLowerCase();
  if (plainWord) {
    AMOHRAFY.set(plainWord, line);
  }
}

const VOWEL_CHARS = new Set(['а', 'е', 'ё', 'і', 'о', 'у', 'ў', 'ы', 'э', 'ю', 'я']);

function countSyllables(w: string): number {
  let count = 0;
  for (const ch of w.toLowerCase()) {
    if (VOWEL_CHARS.has(ch) && ch !== 'ў') count++;
  }
  return count;
}

function hasStress(w: string): boolean {
  return w.includes('\u0301') || w.includes('+');
}

export class WordInitialConverter {
  word: string;
  nextWord: WordInitialConverter | null = null;
  appendToNextWord: boolean = false;
  huki: Huk[] = [];
  wordContext: WordContext;

  constructor(
    wordToProcess: string,
    nextWord: WordInitialConverter | null = null
  ) {
    this.word = wordToProcess;
    this.nextWord = nextWord;
    this.wordContext = { word: wordToProcess };

    this.zamienaSimvalau();

    const wlower = this.word.toLowerCase();
    if (wlower === 'ў' || NIENACISKNYJA.has(wlower)) {
      // Non-stressed simple word
    } else {
      this.word = this.zBazy(this.word);
    }

    this.checkNextWord();
    this.word = this.paznacymVybuchnojeG(this.word);
    this.stvarajemBazavyjaHuki();
  }

  /**
   * Паводле правілаў беларускай арфаэпіі (школьная і навуковая транскрыпцыя):
   * У словах, дзе паводле літаратурнага вымаўлення прысутнічае выбухны гук [ґ] (IPA [g]):
   * 1. Пазіцыйна пасля свісцячага з (мазгі, розгі, дрозгі, лязгаць, брызгі, нізгі, абздонзг, мазглівы)
   * 2. У спрадвечных і засвоеных каранях (ганак, гузік, агрэст, швагер, гарнец, гонта, газда, шлагбаўм, цыган, лягер, гешэфт, гзымс, крэнгі, джыгіт, кангрэс, бургамістр, гірса, нягеглы, гвалт, гзых, цэгла, манга, чунга-чанга, пакгаўз)
   * 3. У запазычаннях на -інг / -ынг (мітынг, боўлінг, маркетынг, рэйтынг, спарынг, холдынг, паркінг, трэнінг, роўмінг, кемпінг, серфінг, банкінг, пудынг, лізінг, картынг, бодыбілдынг, кастынг, смокінг, спінінг, дайвінг, лобінг...)
   */
  private paznacymVybuchnojeG(w: string): string {
    if (!w || !/[гГ]/.test(w)) return w;

    // 1. Пазіцыйнае спалучэнне зг (мазгі, розгі, дрозгі, лязгаць, брызгі, нізгі...)
    let s = w.replace(/([зЗ])(\p{M}*)\s*г/gu, '$1$2ґ')
             .replace(/([зЗ])(\p{M}*)\s*Г/gu, '$1$2Ґ');

    // 2. Англіцызмы на -інг / -ынг (мітынг, боўлінг, маркетынг, спарынг...)
    s = s.replace(/([іыІЫ])(\p{M}*н\p{M}*)г(?=[\p{L}\p{M}]*)/giu, '$1$2ґ');

    // 3. Спрадвечныя і засвоеныя карані (правяраем па ачышчанай ад націскаў і межаў прыставак форме)
    const clean = s.replace(/[\p{M}|/]/gu, '').toLowerCase();

    const rootRegexes = [
      /(?:^|[^\p{L}])(?:\p{L}*)?ган(?:ак|к|ач|ачн|ц)/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гузі[кчн]/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?агрэст/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?шваг[еэаоя]?р/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гарн(?:[ея]ц|ц|чык)/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гонт/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?газд/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?шлагба[ўу]м/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?цыган/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?лягер/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гешэфт/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гзымс/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?крэнг/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?джыгіт/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?кангрэс/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?бургамістр/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гірс/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?нягегл/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гвалт/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гзых/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?(?:цэ|ца)г(?:[еэ]|л|альн)/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?манг[аіуеыо]/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?чунга-чанга/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?пакга[ўу]з/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гаг(?:а|ну)/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?гег(?:а|ну)/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?га-га/iu,
      /(?:^|[^\p{L}])(?:\p{L}*)?ге-ге/iu
    ];

    for (const r of rootRegexes) {
      if (r.test(clean)) {
        s = s.replace(/г/gi, (c) => c === 'Г' ? 'Ґ' : 'ґ');
        break;
      }
    }

    return s;
  }

  private zamienaSimvalau() {
    let raw = this.word;

    // Normalize Unicode combining characters (NFD then NFC normalization handling)
    raw = raw.replace(/[\(\)]/g, '');
    raw = raw.replace(/['`’ʼ]/g, "'");

    // Replace precomposed accented vowels
    raw = raw
      .replace(/а́|á/gi, 'а\u0301')
      .replace(/е́|é/gi, 'е\u0301')
      .replace(/ё́/gi, 'ё\u0301')
      .replace(/і́|í/gi, 'і\u0301')
      .replace(/о́|ó/gi, 'о\u0301')
      .replace(/у́|ú/gi, 'у\u0301')
      .replace(/ы́|ý/gi, 'ы\u0301')
      .replace(/э́/gi, 'э\u0301')
      .replace(/ю́/gi, 'ю\u0301')
      .replace(/я́/gi, 'я\u0301');

    const CONSONANTS = "бвгґджзйклмнпрстфхцчшў'БВГҐДЖЗЙКЛМНПРСТФХЦЧШЎ";
    const VOWELS = "аеёіоуыэюяАЕЁІОУЫЭЮЯ";

    // 1. Postfix notation: immediately AFTER a vowel (гэ+та -> гэ́та, пры+клад -> пры́клад)
    raw = raw.replace(new RegExp(`([${VOWELS}])[\\+\\u00B4]`, 'g'), '$1\u0301');

    // 2. Direct prefix: immediately BEFORE a vowel (г+эта -> гэ́та, пр+ыклад -> пры́клад)
    raw = raw.replace(new RegExp(`[\\+\\u00B4]([${VOWELS}])`, 'g'), '$1\u0301');

    // 3. Word-initial prefix before onset consonants (+гэта -> гэ́та, +дзеці -> дзе́ці)
    raw = raw.replace(new RegExp(`^[\\+\\u00B4]([${CONSONANTS}]+)([${VOWELS}])`, 'g'), '$1$2\u0301');

    // Clean any remaining stray pluses or acute marks
    raw = raw.replace(/[\+\u00B4]/g, '');
    raw = raw.replace(/\u0301+/g, '\u0301');

    this.word = raw;

    if (!hasStress(this.word)) {
      const plain = this.word.toLowerCase();
      const amohraf = AMOHRAFY.get(plain);
      if (amohraf) {
        // Apply stress from amohraf
        let am = amohraf.replace(new RegExp(`([${VOWELS}])[\\+\\u00B4]`, 'g'), '$1\u0301');
        am = am.replace(new RegExp(`[\\+\\u00B4]([${VOWELS}])`, 'g'), '$1\u0301');
        am = am.replace(/[\+\u00B4]/g, '');
        if (this.word[0] === this.word[0].toUpperCase() && this.word[0] !== this.word[0].toLowerCase()) {
          this.word = am[0].toUpperCase() + am.slice(1);
        } else {
          this.word = am;
        }
      }
    }
  }

  private checkNextWord() {
    if (this.nextWord) {
      const wl = this.word.replace(/[\u0301+]/g, '').toLowerCase();
      switch (wl) {
        case 'не':
        case 'без':
        case 'бяз':
        case 'праз':
        case 'з':
        case 'пад':
        case 'пада':
        case 'над':
        case 'нада':
        case 'перад':
        case 'перада':
        case 'ад':
        case 'ада':
        case 'аб':
        case 'аба':
        case 'к':
        case 'цераз':
          this.appendToNextWord = true;
          break;
      }
    }
  }

  private zBazy(w: string): string {
    // 1. If word already has stress, keep it
    if (!hasStress(w)) {
      // Check stress dictionary and morphological rules
      const stressed = applyBelarusianStress(w);
      if (hasStress(stressed)) {
        w = stressed.replace(/[\u00B4+]/g, '\u0301');
      } else {
        const wLower = w.toLowerCase();
        const pYo = wLower.indexOf('ё');
        if (pYo >= 0) {
          // Automatic stress on 'ё'
          w = w.substring(0, pYo + 1) + '\u0301' + w.substring(pYo + 1);
        } else if (countSyllables(w) === 1) {
          // Single syllable word
          for (let i = 0; i < w.length; i++) {
            if (VOWEL_CHARS.has(w[i].toLowerCase()) && w[i].toLowerCase() !== 'ў') {
              w = w.substring(0, i + 1) + '\u0301' + w.substring(i + 1);
              break;
            }
          }
        }
      }
    }

    // 2. Mark prefixes from prystauki.txt
    const wUnstressed = w.replace(/[\u0301+]/g, '');
    const wUnstressedLower = wUnstressed.toLowerCase();

    for (const p of PRYSTAUKI) {
      if (
        wUnstressedLower.startsWith(p.beg) &&
        wUnstressedLower.length > p.beg.length
      ) {
        const nextChar = wUnstressedLower[p.beg.length];
        const nextChar2 = p.beg.length + 1 < wUnstressedLower.length ? wUnstressedLower[p.beg.length + 1] : '';

        let validPrefix = false;
        if (p.beg.endsWith('й')) {
          validPrefix = true;
        } else if (nextChar === "'" && 'еёюя'.includes(nextChar2)) {
          validPrefix = true;
        } else if (VOWEL_CHARS.has(nextChar)) {
          validPrefix = true;
        } else if (
          p.beg.endsWith('з') ||
          p.beg.endsWith('с') ||
          p.beg.endsWith('д') ||
          p.beg.endsWith('т') ||
          p.beg.endsWith('б') ||
          p.beg.endsWith('п') ||
          p.beg.endsWith('ў')
        ) {
          validPrefix = true;
        }

        if (validPrefix) {
          // Insert prefix boundary marker in original word (accounting for stress marks)
          let unCount = 0;
          let insertPos = 0;
          for (let i = 0; i < w.length; i++) {
            if (w[i] !== '\u0301' && w[i] !== '+') {
              unCount++;
            }
            if (unCount === p.beg.length) {
              insertPos = i + 1;
              if (insertPos < w.length && (w[insertPos] === '\u0301' || w[insertPos] === '+')) {
                insertPos++;
              }
              break;
            }
          }
          if (insertPos > 0) {
            const delim = p.result.endsWith('/') ? '/' : '|';
            w = w.substring(0, insertPos) + delim + w.substring(insertPos);
          }
          break;
        }
      }
    }

    return w;
  }

  private stvarajemBazavyjaHuki() {
    this.huki = [];
    const wl = this.word.toLowerCase();
    let papiaredniHuk: Huk | null = null;

    for (let i = 0; i < wl.length; i++) {
      const c = wl[i];
      let novyHuk: Huk | null = null;

      switch (c) {
        case 'а':
          novyHuk = new Huk('а', BAZAVY_HUK.а);
          break;
        case 'б':
          novyHuk = new Huk('б', BAZAVY_HUK.б);
          break;
        case 'в':
          novyHuk = new Huk('в', BAZAVY_HUK.в);
          break;
        case 'г':
          novyHuk = new Huk('г', BAZAVY_HUK.г);
          break;
        case 'ґ':
          novyHuk = new Huk('ґ', BAZAVY_HUK.ґ);
          break;
        case 'д':
          novyHuk = new Huk('д', BAZAVY_HUK.д);
          break;
        case 'е':
          novyHuk = new Huk('е', BAZAVY_HUK.э);
          novyHuk.miakki = MIAKKASC_PAZNACANAJA;
          break;
        case 'ё':
          novyHuk = new Huk('ё', BAZAVY_HUK.о);
          novyHuk.miakki = MIAKKASC_PAZNACANAJA;
          break;
        case 'ж':
          if (
            papiaredniHuk &&
            papiaredniHuk.zychodnyjaLitary === 'д' &&
            papiaredniHuk.padzielPasla === 0
          ) {
            papiaredniHuk.zychodnyjaLitary = 'дж';
            papiaredniHuk.bazavyHuk = BAZAVY_HUK.дж;
          } else {
            novyHuk = new Huk('ж', BAZAVY_HUK.ж);
          }
          break;
        case 'з':
          if (
            papiaredniHuk &&
            papiaredniHuk.zychodnyjaLitary === 'д' &&
            papiaredniHuk.padzielPasla === 0
          ) {
            papiaredniHuk.zychodnyjaLitary = 'дз';
            papiaredniHuk.bazavyHuk = BAZAVY_HUK.дз;
          } else {
            novyHuk = new Huk('з', BAZAVY_HUK.з);
          }
          break;
        case 'і':
          novyHuk = new Huk('і', BAZAVY_HUK.і);
          novyHuk.miakki = MIAKKASC_PAZNACANAJA;
          break;
        case 'й':
          novyHuk = new Huk('й', BAZAVY_HUK.j);
          novyHuk.miakki = MIAKKASC_PAZNACANAJA;
          break;
        case 'к':
          novyHuk = new Huk('к', BAZAVY_HUK.к);
          break;
        case 'л':
          novyHuk = new Huk('л', BAZAVY_HUK.л);
          break;
        case 'м':
          novyHuk = new Huk('м', BAZAVY_HUK.м);
          break;
        case 'н':
          novyHuk = new Huk('н', BAZAVY_HUK.н);
          break;
        case 'о':
          novyHuk = new Huk('о', BAZAVY_HUK.о);
          break;
        case 'п':
          novyHuk = new Huk('п', BAZAVY_HUK.п);
          break;
        case 'р':
          novyHuk = new Huk('р', BAZAVY_HUK.р);
          break;
        case 'с':
          novyHuk = new Huk('с', BAZAVY_HUK.с);
          break;
        case 'т':
          novyHuk = new Huk('т', BAZAVY_HUK.т);
          break;
        case 'у':
          novyHuk = new Huk('у', BAZAVY_HUK.у);
          break;
        case 'ў':
          novyHuk = new Huk('ў', BAZAVY_HUK.ў);
          break;
        case 'ф':
          novyHuk = new Huk('ф', BAZAVY_HUK.ф);
          break;
        case 'х':
          novyHuk = new Huk('х', BAZAVY_HUK.х);
          break;
        case 'ц':
          novyHuk = new Huk('ц', BAZAVY_HUK.ц);
          break;
        case 'ч':
          novyHuk = new Huk('ч', BAZAVY_HUK.ч);
          break;
        case 'ш':
          novyHuk = new Huk('ш', BAZAVY_HUK.ш);
          break;
        case 'ы':
          novyHuk = new Huk('ы', BAZAVY_HUK.ы);
          break;
        case 'ь':
          if (papiaredniHuk) {
            papiaredniHuk.miakki = MIAKKASC_PAZNACANAJA;
          }
          break;
        case 'э':
          novyHuk = new Huk('э', BAZAVY_HUK.э);
          break;
        case 'ю':
          novyHuk = new Huk('ю', BAZAVY_HUK.у);
          novyHuk.miakki = MIAKKASC_PAZNACANAJA;
          break;
        case 'я':
          novyHuk = new Huk('я', BAZAVY_HUK.а);
          novyHuk.miakki = MIAKKASC_PAZNACANAJA;
          break;
        case "'":
          if (papiaredniHuk) {
            papiaredniHuk.padzielPasla |= PADZIEL_APOSTRAF;
          }
          break;
        case '/':
          if (papiaredniHuk) {
            papiaredniHuk.padzielPasla |= PADZIEL_PRYSTAUKA;
          }
          break;
        case '|':
          if (papiaredniHuk) {
            papiaredniHuk.padzielPasla |= PADZIEL_KARANI;
          }
          break;
        case '-':
          if (papiaredniHuk) {
            papiaredniHuk.padzielPasla |= PADZIEL_ZLUCOK;
          }
          break;
        case '\u0301':
        case '+':
          if (papiaredniHuk && HALOSNYJA.has(papiaredniHuk.bazavyHuk)) {
            papiaredniHuk.stress = true;
          }
          break;
        default:
          break;
      }

      if (novyHuk) {
        novyHuk.wordContext = this.wordContext;
        this.huki.push(novyHuk);
        papiaredniHuk = novyHuk;
      }
    }

    if (this.huki.length > 0) {
      this.huki[this.huki.length - 1].padzielPasla |= PADZIEL_SLOVY;
      if (this.nextWord && this.appendToNextWord) {
        this.huki[this.huki.length - 1].padzielPasla |= PADZIEL_PRYNAZOUNIK;
      }
    }
  }
}
