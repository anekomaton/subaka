import { convertTextBelG2P } from './belG2P';
import { convertTextEnG2P } from './enG2P';

export function isCyrillic(text: string): boolean {
  return /[а-яёіўґ]/i.test(text);
}

export function stripBrackets(str: string): string {
  return (str || '')
    .trim()
    .replace(/^\[+/, '')
    .replace(/\]+$/, '')
    .trim();
}

/**
 * Перавярае, ці пададзены тэкст у беларускай школьнай фанетычнай транскрыпцыі
 * (напрыклад: "[с'н'а́г]", "дз'е́ц'і", "л'іс'ц'е́", "з'л'адз'ен'е́л'і")
 */
export function isSchoolTranscription(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return true;
  return /[абвгґдджзеёжзійклмнопрстуўфхцчшщыьэюя]'|͡|ː|:/i.test(trimmed);
}

/**
 * Звязвае асобныя адналітарныя прыназоўнікі і злучнікі з наступным націскным словам.
 * Прыназоўнік з'яўляецца праклітыкай і не мае ўласнага націску, зліваючыся з націскным словам.
 * Паводле правілаў беларускай фанетыкі:
 * - Перад глухімі зычнымі [т, к, п, ф, х, с, ц] прыназоўнікі "з" ці "с" зліваюцца ў глухі гук [с]:
 *   "з табой" / "с табой" -> "стабой" (сінтэзатар вымаўляе чысты зычны гук [с], а не назву літары "эс")
 * - Перад шыпячымі [ч, ш] "з" / "ш" зліваюцца ў [ш]:
 *   "з часам" / "ш часам" -> "шчасам"
 * - Перад мяккімі шыпячымі/свісцячымі [сь, ць]: "з сябрам" -> "сьсябрам"
 * - Перад звонкімі зычнымі і галоснымі звязвае злучком "з-мамай", каб захаваць гук [з].
 */
export function bindSingleLetterPrepositions(text: string): string {
  if (!text) return '';
  let s = text;

  // 1. Асіміляцыя прыназоўнікаў "з" / "с" перад глухімі зычнымі -> злітнае зліццё [с]
  s = s.replace(/(^|[\s\p{P}])[зсЗС]['’ʹʼʻʲ]?\s+([ткпфхсцТКПФХСЦ])/gu, '$1с$2');

  // 2. Асіміляцыя перад шыпячымі [ч, ш] -> злітнае зліццё [ш]
  s = s.replace(/(^|[\s\p{P}])[зсшЗСШ]['’ʹʼʻʲ]?\s+([чшЧШ])/gu, '$1ш$2');

  // 3. Асіміляцыя перад мяккімі свісцячымі/афрыкатамі -> [сь]
  s = s.replace(/(^|[\s\p{P}])[зсЗС]['’ʹʼʻʲ]?\s+(с[еёіюяь]|ц[еёіюяь]|сь|ць)/gui, '$1сь$2');

  // 4. Захаванне рэшты адналітарных прыназоўнікаў (з, ў, в, к, б, у) перад звонкімі/галоснымі (злучнікі "а" і "і" не злучаюцца здэфісам)
  return s.replace(/(^|[\s\p{P}])([зўвкбuуЗЎВКБUУ])\s+([а-яёіўа-зй-шыьэюяА-ЯЁІЎA-Za-z0-9])/gu, '$1$2-$3');
}

/**
 * Нормалізуе школьную фанетычную транскрыпцыю ў маўленчы тэкст з захаваннем націскаў,
 * які ідэальна счытваецца і агучваецца мадэллю Alesya / BelG2P.
 * Вучыць Алесю разумець мяккасць перад [э] (напрыклад: таб'э́ -> табе́).
 */
export function normalizeSchoolTranscriptionForSpeech(text: string): string {
  if (!text) return '';
  let str = text.trim();

  // Выдаляем знешнія квадратныя дужкі [...]
  str = str.replace(/^\[+/, '').replace(/\]+$/, '').trim();

  // 0. Асіміляцыя праклітычных прыназоўнікаў па глухасці:
  // [с табой] / [з табой] -> стабой (вымаўляецца чысты глухі зычны [с] перад [т], без чытання літары "эс")
  str = str.replace(/(^|[\s\p{P}])[зсЗС]['’ʹʼʻʲ]?\s+([ткпфхсцТКПФХСЦ])/gu, '$1с$2');
  str = str.replace(/(^|[\s\p{P}])[зсшЗСШ]['’ʹʼʻʲ]?\s+([чшЧШ])/gu, '$1ш$2');
  str = str.replace(/(^|[\s\p{P}])[зсЗС]['’ʹʼʻʲ]?\s+(с[еёіюяь]|ц[еёіюяь]|сь|ць)/gui, '$1сь$2');

  // Аднаўленне пачатковага "і" для слоў тыпу "імя" / "імгненне" пасля галосных ([адно йм'а] -> адно ім'я́)
  str = str.replace(/(^|[\s\p{P}])(й|Й)м['’ʹʼʻʲ`]?([аеёіоуыэюяАЕЁІОУЫЭЮЯ])/giu, (_, p, j, v) => p + (j === 'Й' ? 'І' : 'і') + "м'" + v);
  str = str.replace(/(^|[\s\p{P}])(і|І)м['’ʹʼʻʲ`]?([аяАЯ])([\u0300\u0301]?)(?=[\s\p{P}]|$)/giu, '$1$2м\'я\u0301');

  // 1. Нормалізуем усе варыянты апострафаў ды знакаў націску
  str = str.replace(/[’ʼ`ʹʻʲ]/g, "'");
  str = str.replace(/´/g, '\u0301');
  str = str.replace(/͡/g, '');

  // 2. Раскрываем падоўжаныя зычныя і знакі даўжыні (ː, ˑ і ўнутрыслоўны ':')
  // У беларускай мове падоўжаныя мяккія зычныя (жыц':а́ -> жыцця́, суд͡з':а́ -> суддзя́, в'ас'эл':э -> вяселле, со́л':у -> со́ллю)
  // перад галоснымі пішуцца як падвоены зычны + ятаваная галосная (я, е, ё, ю, і).
  const softLengthenedIotatedMap: Record<string, string> = {
    'а': 'я', 'э': 'е', 'е': 'е', 'ё': 'ьо', 'о': 'ьо', 'у': 'ю', 'і': 'і', 'ы': 'і', 'я': 'я', 'ю': 'ю'
  };

  str = str.replace(/(дз|[абвгґдзклмнопрстўфхцчшж])\s*['’ʹʼʻʲ][:ːːˑ]\s*(\u0301?)([аэеёоуіыяю])(\u0301?)/gi, (_, cons, s1, v, s2) => {
    const vL = v.toLowerCase();
    const mappedV = softLengthenedIotatedMap[vL] || v;
    const stress = s1 || s2 || '';
    const cL = cons.toLowerCase();
    const prefix = cL === 'дз' ? 'ддз' : cons + cons;
    return prefix + mappedV + stress;
  });

  // Падоўжаны мяккі зычны без галоснага альбо перад зычным:
  str = str.replace(/(дз|[абвгґдзклмнопрстўфхцчшж])\s*['’ʹʼʻʲ][:ːːˑ]/gi, (_, cons) => {
    const cL = cons.toLowerCase();
    return cL === 'дз' ? 'дзьдзь' : cons + 'ь' + cons + 'ь';
  });

  // Цвёрдыя падоўжаныя зычныя: ноч:у -> ноччу
  str = str.replace(/(дз|[абвгґдзклмнопрстўфхцчшж])[:ːːˑ]/gi, (_, cons) => {
    const cL = cons.toLowerCase();
    return cL === 'дз' ? 'дздз' : cons + cons;
  });

  // 3. Раскрыццё фанетычных ятаваных галосных са школьнай транскрыпцыі:
  // [гэ́тыйа] -> гэ́тыя, [майа́] -> мая́, [тваё] / [твайо] -> тваё
  str = str.replace(/й([аэеёоуіы])(\u0301?)/gi, (_, v, acc) => {
    const vL = v.toLowerCase();
    const map: Record<string, string> = {
      'а': 'я',
      'э': 'е',
      'е': 'є',
      'ё': 'йо',
      'о': 'йо',
      'у': 'ю',
      'і': 'ї',
      'ы': 'и',
    };
    return (map[vL] || v) + (acc || '');
  });

  // 4. Зацвярдзелыя ч, ж, ш, р, дж (з апострафам ці без): [ч'э] -> чэ, [ч'і] -> чы
  // У беларускай мове ч, ж, ш, р, дж — ЗАЎСЁДЫ ЦВЁРДЫЯ!
  const hardAlwaysVowelMap: Record<string, string> = {
    'э': 'е',
    'е': 'е',
    'і': 'и',
    'ы': 'и',
    'а': 'а',
    'я': 'а',
    'о': 'о',
    'ё': 'о',
    'у': 'у',
    'ю': 'у',
  };
  str = str.replace(/(ч|дж|ж|ш|р)'?\s*(\u0301?)([аэеёоуіыяю])(\u0301?)/gi, (_, cons, stress1, vowel, stress2) => {
    const vLower = vowel.toLowerCase();
    const hardV = hardAlwaysVowelMap[vLower] || vowel;
    const stress = stress1 || stress2 || '';
    return cons + hardV + stress;
  });

  // 5. Фанетычнае цэканне і дзеканне для мяккіх т' і д':
  // Т' у беларускай мове заўсёды пераходзіць у ц' (цэканне): [т'э] -> це, [т'а] -> ця, [т'] -> ць!
  // УВАГА: звычайны цвёрды Т перад Ы (як у "гэ́тыйа") АПАСТРАФА НЕ МАЕ і застаецца цвёрдым Т!
  str = str.replace(/т'\s*(\u0301?)([аэеёоуіыяю])(\u0301?)/gi, (_, s1, v, s2) => {
    const vL = v.toLowerCase();
    const map: Record<string, string> = {
      'а': 'я', 'э': 'е', 'е': 'є', 'ё': 'ьо', 'о': 'ьо', 'у': 'ю', 'і': 'і', 'ы': 'і'
    };
    return 'ц' + (map[vL] || v) + (s1 || s2 || '');
  });
  str = str.replace(/т'/gi, 'ць');

  // Д' у беларускай мове заўсёды пераходзіць у дз' (дзеканне): [д'э] -> дзе, [д'а] -> дзя, [д'] -> дзь
  str = str.replace(/д'\s*(\u0301?)([аэеёоуіыяю])(\u0301?)/gi, (_, s1, v, s2) => {
    const vL = v.toLowerCase();
    const map: Record<string, string> = {
      'а': 'я', 'э': 'е', 'е': 'є', 'ё': 'ьо', 'о': 'ьо', 'у': 'ю', 'і': 'і', 'ы': 'і'
    };
    return 'дз' + (map[vL] || v) + (s1 || s2 || '');
  });
  str = str.replace(/д'/gi, 'дзь');

  // 6. Парныя мяккія зычныя з апострафам ' + галосны
  const softVowelMap: Record<string, string> = {
    'а': 'я',
    'э': 'е',
    'е': 'е',
    'ё': 'ьо',
    'о': 'ьо',
    'у': 'ю',
    'і': 'і',
    'ы': 'і',
  };
  str = str.replace(/(дз|[абвгґдзеёжзійклмнопрстуўфхцчшщыьэюя])'\s*(\u0301?)([аэеёоуіыяю])(\u0301?)/gi, (_, cons, stress1, vowel, stress2) => {
    const vLower = vowel.toLowerCase();
    const softV = softVowelMap[vLower] || vowel;
    const stress = stress1 || stress2 || '';
    return cons + softV + stress;
  });

  // 7. Мяккія зычныя з апострафам перад зычнымі ці на канцы слова
  str = str.replace(/ч'/gi, 'ч')
           .replace(/ж'/gi, 'ж')
           .replace(/ш'/gi, 'ш')
           .replace(/р'/gi, 'р')
           .replace(/дж'/gi, 'дж')
           .replace(/ц'/gi, 'ць')
           .replace(/с'/gi, 'сь')
           .replace(/з'/gi, 'зь')
           .replace(/л'/gi, 'ль')
           .replace(/н'/gi, 'нь')
           .replace(/дз'/gi, 'дзь')
           .replace(/б'/gi, 'б')
           .replace(/п'/gi, 'п')
           .replace(/м'/gi, 'м')
           .replace(/в'/gi, 'в')
           .replace(/ф'/gi, 'ф')
           .replace(/г'/gi, 'г')
           .replace(/ґ'/gi, 'ґ')
           .replace(/к'/gi, 'к')
           .replace(/х'/gi, 'х');

  // 7.5. Спецыяльная апрацоўка для указальных займеннікаў ("гэты", "гэтым", "гэтых", "гэтыя"):
  // Захоўваем 100% цвёрды зубны зычны [т] і галосны 'ы', каб рухавік не змякчаў у [т']/[ц'] ("гэцім", "гэція")!

  // 7.6. Запазычаныя імёны "Пітэр" / "Юпітэр":
  // Захоўваем 100% цвёрды зубны зычны [т] адзіным злітным словам без паўзы/дэфіса:
  str = str.replace(/([Пп]і|[Юю]пі|[пП]['’ʹʼʻʲ`'']?і|[юЮ]п['’ʹʼʻʲ`'']?і)([\u0301\u0300]?)т([эе])([\u0301\u0300]?)р([ауеыі]|ам|ах|ом)?(?=[^\p{L}]|$)/gu, '$1$2тер$5');

  // Пазбаўляемся падвойных мяккіх знакаў у асіміляцыйных спалучэннях
  str = str.replace(/сьць/g, 'сць')
           .replace(/Сьць/g, 'Сць')
           .replace(/сьці/g, 'сці')
           .replace(/Сьці/g, 'Сці')
           .replace(/зьдзі/g, 'здзі')
           .replace(/Зьдзі/g, 'Здзі');

  // 8. Акустычна-фанетычная адаптацыя для беларускага галасавога сінтэзу:
  // 1. ў -> у
  str = str.replace(/ў/g, 'у').replace(/Ў/g, 'У');

  // 2. ць -> ть (мяккае [ц'] / [т'] без цвёрдасці [ts])
  str = str.replace(/([цЦ])ь/g, (m, c) => (c === 'Ц' ? 'Т' : 'т') + 'ь');

  // 3. ця / Ця -> тя / Тя
  str = str.replace(/(^|[^цЦ])ц(\u0301?)([яЯ])/g, (m, p, s, v) => p + (v === 'Я' ? 'Т' : 'т') + s + v);

  // 4. це / Це -> те / Те (мяккае цэканне)
  str = str.replace(/(^|[^цЦ])ц(\u0301?)([еЕ])/g, (m, p, s, v) => p + (v === 'Е' ? 'Т' : 'т') + s + v);

  // 5. ці / Ці -> ти / Ти (мяккае цэканне без цвёрдага [цы])
  str = str.replace(/(^|[^цЦ])ц(\u0301?)([іІ])/g, (m, p, s, v) => p + (v === 'І' ? 'Т' : 'т') + s + (v === 'І' ? 'И' : 'и'));

  // 6. Падоўжанае цц (жыцця -> жыття, жыццё -> жыттьо)
  str = str.replace(/цц(\u0301?)([яЯ])/g, (m, s, v) => (v === 'Я' ? 'ТТ' : 'тт') + s + v)
           .replace(/Цц(\u0301?)([яЯ])/g, (m, stress, v) => 'Тт' + stress + v)
           .replace(/ЦЦ(\u0301?)([яЯ])/g, (m, stress, v) => 'ТТ' + stress + v)
           .replace(/цц(\u0301?)([еЕ])/g, (m, s, v) => 'тт' + s + v)
           .replace(/цц(\u0301?)([ёЁ])/g, (m, s, v) => 'тт' + s + (v === 'Ё' ? 'ЬО' : 'ьо'))
           .replace(/цц(\u0301?)([юЮ])/g, (m, s, v) => 'тт' + s + v);

  // 7. Зацвярдзелыя зычныя ў беларускай мове: ж, ш, ч, р, дж (і пасля іх -> ы, у іншых выпадках -> и)
  const alwaysHardConsonants = 'жшчрджЖШЧРДЖ';

  let res = '';
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    let prev = '';
    for (let k = i - 1; k >= 0; k--) {
      if (str[k] !== '\u0301' && str[k] !== '\u0300') {
        prev = str[k];
        break;
      }
    }

    if (ch === 'і' || ch === 'І') {
      if (prev && alwaysHardConsonants.includes(prev)) {
        res += (ch === 'І' ? 'Ы' : 'ы');
      } else {
        res += (ch === 'І' ? 'И' : 'и');
      }
    } else {
      res += ch;
    }
  }

  // 9. Звязваем адналітарныя прыназоўнікі
  return bindSingleLetterPrepositions(res);
}

/**
 * Лакальная імгненная фанетычная канвертацыя (без квадратных дужак).
 * Для беларускай мовы выкарыстоўваецца выключна BelG2P!
 */
export function convertPhoneticsLocal(text: string): string {
  if (!text || !text.trim()) return '';

  if (isCyrillic(text)) {
    return stripBrackets(convertTextBelG2P(text, { wrapBrackets: false }));
  } else {
    return stripBrackets(convertTextEnG2P(text));
  }
}

/**
 * Расставіць націскі ў тэксце праз поўную базу GrammarDB (2.38M слоў)
 */
export async function stressTextOnline(text: string): Promise<string> {
  const trimmed = (text || '').trim();
  if (!trimmed) return text;

  try {
    const res = await fetch('/api/stress-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.text) return data.text;
    }
  } catch (e) {
    console.warn('GrammarDB online stress failed, using text as is:', e);
  }
  return text;
}

/**
 * Расставіць націскі ва ўсім .SRT файле праз GrammarDB
 */
export async function stressSrtOnline(srtContent: string): Promise<string> {
  if (!srtContent || !srtContent.trim()) return srtContent;

  try {
    const res = await fetch('/api/stress-srt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ srt: srtContent }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.srt) return data.srt;
    }
  } catch (e) {
    console.warn('GrammarDB SRT stress failed:', e);
  }
  return srtContent;
}

/**
 * Атрымаць фанетычную транскрыпцыю для аднаго радка:
 * Выкарыстоўвае GrammarDB (для дакладных націскаў) + BelG2P (для правіл асіміляцыі і фанетыкі)
 */
export async function getPhoneticTranscription(text: string): Promise<string> {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';

  try {
    const res = await fetch('/api/phonetics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: [{ id: 'single', text: trimmed }]
      })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0 && data.results[0].phonetic) {
        return stripBrackets(data.results[0].phonetic);
      }
    }
  } catch (e) {
    console.warn('Phonetics API call fallback to local G2P:', e);
  }

  // Лакальны фалбэк
  return convertPhoneticsLocal(trimmed);
}

/**
 * Пакетная фанетычная канвертацыя для масіва картак субцітраў:
 * Усе карткі праходзяць праз поўную базу GrammarDB і BelG2P на серверы.
 */
export async function batchConvertPhonetics(
  entries: { id: string | number; text: string }[]
): Promise<{ id: string | number; phonetic: string; stressed?: string }[]> {
  if (!entries || entries.length === 0) return [];

  try {
    const res = await fetch('/api/phonetics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.results && Array.isArray(data.results)) {
        return data.results.map((r: any) => ({
          id: r.id,
          phonetic: stripBrackets(r.phonetic),
          stressed: r.stressed,
        }));
      }
    }
  } catch (e) {
    console.warn('Batch phonetics API call fallback to local G2P:', e);
  }

  // Лакальны фалбэк пры адсутнасці сувязі з серверам
  return entries.map((entry) => ({
    id: entry.id,
    phonetic: convertPhoneticsLocal(entry.text)
  }));
}
