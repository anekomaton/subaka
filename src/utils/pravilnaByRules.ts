/**
 * Правілы беларускай арфаграфіі (паводле Закона Рэспублікі Беларусь ад 23 ліпеня 2008 г. № 420-З
 * і імплементацыі pravilnaby: https://github.com/alroniks/pravilnaby)
 */

import { BELARUSIAN_STRESS_DICT } from './belStress';
import { GRAMMAR_DB_LEXICON } from './grammarDbData';
import { isWordValidHunspell, getHunspellSuggestions, isHunspellReady } from './hunspellChecker';

export const VOWELS = new Set(['а', 'е', 'ё', 'і', 'о', 'у', 'ы', 'э', 'ю', 'я']);
export const CONSONANTS = new Set([
  'б', 'в', 'г', 'д', 'ж', 'з', 'й', 'к', 'л', 'м',
  'н', 'п', 'р', 'с', 'т', 'ў', 'ф', 'х', 'ц', 'ч', 'ш'
]);

/**
 * Правіла 15: Выключэнні, дзе захоўваецца "у" і НЕ адбываецца пераход у "ў"
 */

// 1. Уласныя імёны і геаграфічныя назвы з вялікай літары У (п. 4 Правіла 15)
// Заўсёды пішуцца з вялікай літары У складовае без надрадковага значка:
// "ва Узбекістан", "на Уральскіх дарогах", "на Украіне", "за Уладзіміра", "каля Уладзіслава", "да Усяслава"
export const PROPER_NAMES_U = new Set([
  'уладзімір', 'уладзіслава', 'уладзіслаў', 'усяслаў', 'улад', 'усцін', 'усціння', 'усцінья',
  'ульяна', 'уршуля', 'улас', 'усцім', 'украіна', 'украіны', 'украіне', 'украіну', 'украінай',
  'узбекістан', 'узбекістана', 'узбекістане', 'уругвай', 'уругвая', 'уганда', 'уганды',
  'урал', 'урала', 'урале', 'уральскі', 'уральскіх', 'уральскія', 'уральскага',
  'уфа', 'уфы', 'уфе', 'ула', 'улы', 'унеча', 'унечы', 'уэльс', 'уэльса', 'умань', 'умані',
  'ульянаўск', 'ульянаўска', 'ухта', 'ухты', 'усурыйск', 'усурыйска', 'умба', 'уда'
]);

// 2. Гук [у] пад націскам не чаргуецца з [ў] (п. 2 Правіла 15)
export const STRESSED_INITIAL_U_WORDS = new Set([
  'урна', 'урны', 'урну', 'урнаў', 'урнам', 'урнамі', 'урнах',
  'унія', 'уніі', 'унію', 'уній', 'уніям', 'уніямі', 'уніях',
  'ультра', 'узус', 'узусу', 'узусам',
  'унты', 'унтаў', 'унтам', 'унтамі', 'унтах',
  'уханне', 'ухання', 'уханні', 'ухаць', 'ухае', 'ухаюць', 'ухаў', 'ухала',
  'уран', 'урану', 'уранам', 'уране',
  'уступ', 'уступу', 'уступы', 'уступаў', 'уступам', 'уступамі', 'уступах',
  'уціск', 'уціску', 'уціскам', 'угалас', 'унікум', 'унікумы', 'унікумаў', 'умбра',
  // Выклічнікі пад націскам:
  'ух', 'уй', 'ура', 'угу',
  // Унутры слоў пад націскам:
  'аул', 'аулы', 'аула', 'аулам', 'ауламі', 'аулах',
  'баул', 'баулы', 'баула', 'баулам', 'бауламі', 'баулах',
  'аукаць', 'аукае', 'аукаюць', 'аукнуць', 'аукнулі',
  'траур', 'траўр', 'траурны', 'траурнага', 'траурным'
]);

// 3. Запазычаныя словы на -ум, -ус і вытворныя ад іх (п. 3 Правіла 15)
// Гук [у] захоўваецца перад канчаткамі/суфіксамі -ум, -ус: "прэзідыум", "радыус", "соус", "страус"
export const LOANWORDS_UM_US = new Set([
  'прэзідыум', 'прэзідыума', 'прэзідыуме', 'прэзідыумам',
  'кансіліум', 'кансіліума', 'кансіліуме', 'кансіліумам',
  'радыус', 'радыуса', 'радыусе', 'радыусам', 'радыусы', 'радыусаў',
  'страус', 'страуса', 'страусе', 'страусам', 'страусы', 'страусаў', 'страусіны', 'страусінага', 'страусіным',
  'соус', 'соуса', 'соусе', 'соусам', 'соусы', 'соусаў', 'соусны', 'соуснага', 'кактэйль-соус',
  'індывідуум', 'індывідуума', 'акварыум', 'акварыума', 'акварыуме', 'акварыумам', 'акварыумы',
  'колеум', 'сімпозіум', 'сімпозіума', 'медыум', 'форум', 'форуму', 'форуме', 'форумам', 'форумы',
  'подыум', 'подыума', 'вакуум', 'вакууму', 'вакуумам', 'цытрус', 'цытруса', 'цытрусавы', 'цытрусавыя',
  'конус', 'конуса', 'конусам', 'конусы', 'глобус', 'глобуса', 'глобусам', 'глобусы',
  'вірус', 'віруса', 'вірусам', 'вірусы', 'вірусны', 'віруснага',
  'тонус', 'тонусу', 'тонусам', 'плюс', 'плюса', 'плюсам', 'плюсы',
  'фокус', 'фокуса', 'фокусам', 'фокусы', 'фокуснік', 'фокусніка',
  'мінімум', 'максімум', 'оптымум', 'альбум', 'калоквіум', 'атрыум', 'рэзідуум', 'корпус'
]);

// 4. У канцы запазычаных слоў ненаціскное [у] не скарачаецца (п. 1 Правіла 15)
export const LOANWORDS_END_U = new Set([
  'фрау', 'шоу', 'ландо', 'ландау', 'каратау', 'дахау', 'цеміртау',
  'ток-шоу', 'ноу-хау', 'па-дэ-дэ', 'радэа', 'какаду', 'брута', 'нета'
]);

// 5. Абрэвіятуры
export const ABBREVIATIONS = new Set([
  'бду', 'цум', 'уус', 'уефа', 'уэфа', 'унп', 'упа'
]);

// 6. Словы з памылковым "ў" замест "у" або іншых літар
export const WRONG_U_SHORT_FIXES: Record<string, string> = {
  'соўс': 'соус',
  'соўсам': 'соусам',
  'соўсы': 'соусы',
  'соўса': 'соуса',
  'соўсе': 'соусе',
  'соўсаў': 'соусаў',
  'страўс': 'страус',
  'страўса': 'страуса',
  'страўсе': 'страусе',
  'страўсам': 'страусам',
  'страўсы': 'страусы',
  'страўсаў': 'страусаў',
  'страўсіны': 'страусіны',
  'страўсінага': 'страусінага',
  'радыўс': 'радыус',
  'радыўса': 'радыуса',
  'радыўсам': 'радыусам',
  'радыўсы': 'радыусы',
  'радыўсе': 'радыусе',
  'прэзідыўм': 'прэзідыум',
  'прэзідыўма': 'прэзідыума',
  'кансіліўм': 'кансіліум',
  'акварыўм': 'акварыум',
  'вакуўм': 'вакуум',
  'цытраўс': 'цытрус',
  'шоў': 'шоу',
  'ток-шоў': 'ток-шоу',
  'ноў-хаў': 'ноу-хау',
  'фраў': 'фрау',
  'траўр': 'траур',
  'траўрны': 'траурны',
  'паўка': 'палка',
  'памыўка': 'памылка',
  'сеяўка': 'сеялка',
  'боўгарыя': 'Балгарыя',
  'воўга': 'Волга',
  'ўкраіна': 'Украіна',
  'ўкраіны': 'Украіны',
  'ўкраіне': 'Украіне',
  'ўкраіну': 'Украіну',
  'ўладзімір': 'Уладзімір',
  'ўладзіслава': 'Уладзіслава',
  'ўладзіслаў': 'Уладзіслаў',
  'ўсяслаў': 'Усяслаў',
  'ўрал': 'Урал',
  'ўзбекістан': 'Узбекістан',
  'ўругвай': 'Уругвай'
};

/**
 * Праверка ці з'яўляецца слова выключэннем, дзе захоўваецца літара "у"
 */
export function isExceptionPreservingU(cleanWord: string): boolean {
  const lower = cleanWord.toLowerCase();
  
  // 1. Вялікая літара 'У' (уласныя імёны і геаграфічныя назвы)
  if (cleanWord.startsWith('У') && PROPER_NAMES_U.has(lower)) {
    return true;
  }
  // Наогул уласныя імёны з вялікай У (п. 4)
  if (cleanWord.startsWith('У') && cleanWord.length > 2 && /^[А-ЯЁІ]/.test(cleanWord)) {
    return true;
  }

  // 2. Націскное пачатковае 'у'
  if (STRESSED_INITIAL_U_WORDS.has(lower)) {
    return true;
  }

  // 3. Запазычанні на -ум, -ус і вытворныя
  if (LOANWORDS_UM_US.has(lower)) {
    return true;
  }
  if (lower.endsWith('ум') || lower.endsWith('ус') || lower.endsWith('уму') || lower.endsWith('умам') || lower.endsWith('усам') || lower.endsWith('уса')) {
    if (/(прэзіды|кансілі|рады|стра|со|індывід|аквары|сімпозі|меды|фор|поды|ваку|цытр|кон|глоб|вір|тон|плю|фок|мінім|максім|оптым)/i.test(lower)) {
      return true;
    }
  }

  // 4. Ненаціскное [у] на канцы запазычанняў
  if (LOANWORDS_END_U.has(lower)) {
    return true;
  }

  // 5. Абрэвіятуры
  if (ABBREVIATIONS.has(lower) || /^[А-ЯЁІЎ]{2,}$/.test(cleanWord)) {
    return true;
  }

  return false;
}

/**
 * Хуткая праверка па граматычнай базе (GrammarDB).
 * Паводле запыту:
 * "hunspell для хуткай праверкі, калі знаходзіцца памылка, адпраўляецца ў пошук па граматычнай базе, дадаткова правілы"
 */
export function isWordInGrammarDatabase(word: string): boolean {
  if (!word) return true;
  const clean = word.replace(/[\u0300\u0301\u00B4\u02CA\u02CB]/g, '');
  if (!clean || /^\d+$/.test(clean)) return true;

  const lower = clean.toLowerCase();
  const normApos = lower.replace(/[’ʼ]/g, "'");

  // Варыянты з улікам чаргавання у / ў на пачатку слова і апострафа
  const variants = [lower, normApos];
  if (lower.startsWith('ў')) {
    const altU = 'у' + lower.slice(1);
    variants.push(altU, altU.replace(/[’ʼ]/g, "'"));
  } else if (lower.startsWith('у')) {
    const altW = 'ў' + lower.slice(1);
    variants.push(altW, altW.replace(/[’ʼ]/g, "'"));
  }

  // 1. Праверка па лакальным слоўніку граматычнай базы і націскаў
  for (const v of variants) {
    if (BELARUSIAN_STRESS_DICT[v] || GRAMMAR_DB_LEXICON[v]) {
      return true;
    }
    // 2. Уласныя імёны і геаграфічныя назвы з правілаў
    if (PROPER_NAMES_U.has(v) || STRESSED_INITIAL_U_WORDS.has(v) || LOANWORDS_UM_US.has(v) || LOANWORDS_END_U.has(v)) {
      return true;
    }
    // 3. Прыслоўі на -чна, утвораныя ад прыметнікаў на -чны (напр. хірургічна -> хірургічны)
    if (v.endsWith('чна')) {
      const adjCandidate = v.slice(0, -1) + 'ы';
      if (isWordValidHunspell(adjCandidate) || GRAMMAR_DB_LEXICON[adjCandidate]) {
        return true;
      }
    }

    // 4. Дзеяслоўныя формы загаднага і будучага часу на -стань / -станьце / -стану / -станеш / -стане і інш. (напр. перастань, дастань, застань)
    if (/(стань|станьце|стану|станеш|стане|станём|станяце|стануць)$/.test(v)) {
      const prefix = v.replace(/(стань|станьце|стану|станеш|стане|станём|станяце|стануць)$/, '');
      const verbCandidates = [
        prefix + 'стаць',
        prefix + 'стаю',
        prefix + 'стаяць',
        prefix + 'ставаць'
      ];
      if (verbCandidates.some(cand => isWordValidHunspell(cand) || GRAMMAR_DB_LEXICON[cand])) {
        return true;
      }
      // Агульныя прыстаўкі да -стаць (пера-, да-, за-, пры-, ад-, паў-, на-, аб-, вы-)
      if (/^(пера|да|за|пры|ад|паў|на|аб|вы|пад|пра|у|ў)?$/.test(prefix)) {
        return true;
      }
    }

    // 5. Дзеепрыслоўі на -ючы / -ючыся, -ачы / -ачыся, -ячы / -ячыся, -ўшы / -ўшыся, -шы / -шыся (напр. здабываючы, чытаючы, зрабіўшы)
    if (/(ючы|ючыся|ачы|ачыся|ячы|ячыся|ўшы|ўшыся|шы|шыся)$/.test(v)) {
      const stem = v.replace(/(ся)?$/, '');
      if (stem.endsWith('ючы')) {
        const verb1st = stem.slice(0, -3) + 'ю'; // напр. здабываючы -> здабываю, чытаючы -> чытаю
        if (isWordValidHunspell(verb1st) || GRAMMAR_DB_LEXICON[verb1st]) {
          return true;
        }
      } else if (stem.endsWith('ачы') || stem.endsWith('ячы')) {
        const verb1st = stem.slice(0, -3) + 'у';
        const verbInfA = stem.slice(0, -3) + 'аць';
        const verbInfY = stem.slice(0, -3) + 'яць';
        if (
          isWordValidHunspell(verb1st) || GRAMMAR_DB_LEXICON[verb1st] ||
          isWordValidHunspell(verbInfA) || GRAMMAR_DB_LEXICON[verbInfA] ||
          isWordValidHunspell(verbInfY) || GRAMMAR_DB_LEXICON[verbInfY]
        ) {
          return true;
        }
      } else if (stem.endsWith('ўшы') || stem.endsWith('шы')) {
        const verbPast = stem.replace(/(ўшы|шы)$/, 'ў'); // напр. зрабіўшы -> зрабіў
        const verbInf = stem.replace(/(ўшы|шы)$/, 'ць');   // напр. зрабіўшы -> зрабіць
        if (
          isWordValidHunspell(verbPast) || GRAMMAR_DB_LEXICON[verbPast] ||
          isWordValidHunspell(verbInf) || GRAMMAR_DB_LEXICON[verbInf]
        ) {
          return true;
        }
      }
    }

    // 6. Міжнародавыя навукова-тэхнічныя запазычанні на -оід / -оіда / -оіды / -оідаў (напр. гуманоід, андроід, астэроід, калоід, эліпсоід)
    if (/(оід|оіда|оіду|оідам|оідзе|оіды|оідаў|оідамі|оідах|оідны|оідная|оіднае|оідныя)$/.test(v)) {
      return true;
    }
  }

  return false;
}

const wordVerificationCache = new Map<string, { isValid: boolean; source: 'hunspell' | 'grammardb' | 'none' }>();

export function clearWordVerificationCache(): void {
  wordVerificationCache.clear();
}

if (typeof window !== 'undefined') {
  window.addEventListener('hunspell-ready', () => {
    clearWordVerificationCache();
  });
}

/**
 * Поўная праверка валіднасці слова:
 * 1. Хуткі Hunspell
 * 2. Калі не знойдзена -> пошук па Граматычнай базе (GrammarDB)
 */
export function verifyBelarusianWord(rawWord: string): {
  isValid: boolean;
  source: 'hunspell' | 'grammardb' | 'none';
} {
  const clean = rawWord.replace(/[\u0300\u0301\u00B4\u02CA\u02CB]/g, '');
  if (!clean || /^\d+$/.test(clean)) {
    return { isValid: true, source: 'hunspell' };
  }

  const cached = wordVerificationCache.get(clean);
  if (cached) {
    return cached;
  }

  let result: { isValid: boolean; source: 'hunspell' | 'grammardb' | 'none' };

  // Крок 1: Hunspell для хуткай праверкі
  if (isWordValidHunspell(clean)) {
    result = { isValid: true, source: 'hunspell' };
  } else if (isWordInGrammarDatabase(clean)) {
    // Крок 2: Калі знаходзіцца памылка ў hunspell -> пошук па граматычнай базе
    result = { isValid: true, source: 'grammardb' };
  } else {
    result = { isValid: false, source: 'none' };
  }

  // Не кэшуем вынік, калі слоўнік яшчэ не загружаны ў памяць, каб не захоўваць заўчасны станоўчы вынік
  if (isHunspellReady()) {
    wordVerificationCache.set(clean, result);
  }
  return result;
}

/**
 * Пошук найлепшай прапановы для выпраўлення памылковага слова:
 * Спачатку спецыяльныя правілы (выключэнні U/Ў, зацвярдзелыя, дзеканне/цеканне),
 * потым Hunspell прапановы, потым граматычная база.
 */
export function getBestSuggestionForWord(word: string): string | undefined {
  const clean = word.replace(/[\u0301\u00B4]/g, '');
  const lower = clean.toLowerCase();

  // 1. Праверка выпраўленняў Правіла 15 для памылковых слоў з "ў"
  if (WRONG_U_SHORT_FIXES[lower]) {
    const fix = WRONG_U_SHORT_FIXES[lower];
    return /^[А-ЯЁІ]/.test(clean) ? fix.charAt(0).toUpperCase() + fix.slice(1) : fix;
  }

  // 2. Hunspell прапановы
  const hunspellSuggs = getHunspellSuggestions(clean);
  if (hunspellSuggs && hunspellSuggs.length > 0) {
    return hunspellSuggs[0];
  }

  return undefined;
}
