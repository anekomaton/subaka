/**
 * Беларускі модуль пераўтварэння лічбаў і лічэбнікаў у тэкставы запіс словамі
 * для паўнавартаснага і дакладнага агучвання ў сінтэзатары маўлення (TTS).
 */

const ONES: Record<number, string> = {
  0: "нуль",
  1: "адзін",
  2: "два",
  3: "тры",
  4: "чатыры",
  5: "пяць",
  6: "шэсць",
  7: "сем",
  8: "восем",
  9: "дзевяць",
  10: "дзесяць",
  11: "адзінаццаць",
  12: "дванаццаць",
  13: "трынаццаць",
  14: "чатырнаццаць",
  15: "пятнаццаць",
  16: "шаснаццаць",
  17: "сямнаццаць",
  18: "васямнаццаць",
  19: "дзевятнаццаць",
};

const TENS: Record<number, string> = {
  2: "дваццаць",
  3: "трыццаць",
  4: "сорак",
  5: "пяцьдзясят",
  6: "шэсцьдзясят",
  7: "семдзесят",
  8: "восемдзесят",
  9: "дзевяноста",
};

const HUNDREDS: Record<number, string> = {
  1: "сто",
  2: "дзвесце",
  3: "трыста",
  4: "чатырыста",
  5: "пяцьсот",
  6: "шэсцьсот",
  7: "семсот",
  8: "восемсот",
  9: "дзевяцьсот",
};

// Парадкавыя лічэбнікі (назоўны склон мужчынскі род)
const ORDINAL_ONES: Record<number, string> = {
  1: "першы",
  2: "другі",
  3: "трэці",
  4: "чацвёрты",
  5: "пяты",
  6: "шосты",
  7: "сёмы",
  8: "восьмы",
  9: "дзявяты",
  10: "дзясяты",
  11: "адзінаццаты",
  12: "дванаццаты",
  13: "трынаццаты",
  14: "чатырнаццаты",
  15: "пятнаццаты",
  16: "шаснаццаты",
  17: "сямнаццаты",
  18: "васямнаццаты",
  19: "дзевятнаццаты",
};

const ORDINAL_TENS: Record<number, string> = {
  2: "дваццаты",
  3: "трыццаты",
  4: "саракавы",
  5: "пяцідзясяты",
  6: "шасцідзясяты",
  7: "сямідзясяты",
  8: "васьмідзясяты",
  9: "дзевяносты",
};

const ORDINAL_HUNDREDS: Record<number, string> = {
  1: "соты",
  2: "двухсоты",
  3: "трохсоты",
  4: "чатырохсоты",
  5: "пяцісоты",
  6: "шасцісоты",
  7: "сямісоты",
  8: "васьмісоты",
  9: "дзевяцісоты",
};

// Скланенне для месяцаў (родны склон: 1 студзеня, 3 ліпеня...)
const MONTHS_GENITIVE = [
  "студзеня", "лютага", "сакавіка", "красавіка", "траўня", "чэрвеня",
  "ліпеня", "жніўня", "верасня", "кастрычніка", "лістапада", "снежня",
  "мая"
];

function getScaleName(scaleIndex: number, count: number): string {
  const lastTwo = count % 100;
  const lastOne = count % 10;
  if (scaleIndex === 1) {
    if (lastTwo >= 11 && lastTwo <= 19) return "тысяч";
    if (lastOne === 1) return "тысяча";
    if (lastOne >= 2 && lastOne <= 4) return "тысячы";
    return "тысяч";
  } else if (scaleIndex === 2) {
    if (lastTwo >= 11 && lastTwo <= 19) return "мільёнаў";
    if (lastOne === 1) return "мільён";
    if (lastOne >= 2 && lastOne <= 4) return "мільёны";
    return "мільёнаў";
  } else if (scaleIndex === 3) {
    if (lastTwo >= 11 && lastTwo <= 19) return "мільярдаў";
    if (lastOne === 1) return "мільярд";
    if (lastOne >= 2 && lastOne <= 4) return "мільярды";
    return "мільярдаў";
  }
  return "";
}

function triadToWords(num: number, isFem: boolean = false): string[] {
  const words: string[] = [];
  const h = Math.floor(num / 100);
  const rem = num % 100;

  if (h > 0 && HUNDREDS[h]) {
    words.push(HUNDREDS[h]);
  }

  if (rem >= 1 && rem <= 19) {
    if (rem === 1 && isFem) {
      words.push("адна");
    } else if (rem === 2 && isFem) {
      words.push("дзве");
    } else {
      words.push(ONES[rem]);
    }
  } else if (rem >= 20) {
    const t = Math.floor(rem / 10);
    const o = rem % 10;
    if (TENS[t]) words.push(TENS[t]);
    if (o > 0) {
      if (o === 1 && isFem) {
        words.push("адна");
      } else if (o === 2 && isFem) {
        words.push("дзве");
      } else if (ONES[o]) {
        words.push(ONES[o]);
      }
    }
  }
  return words;
}

/**
 * Ператварае цэлы дадатны лік у колькасны лічэбнік (напр. 2024 -> дзве тысячы дваццаць чатыры)
 */
export function integerToCardinalBelarusian(num: number): string {
  if (num === 0) return "нуль";
  if (num < 0) return "мінус " + integerToCardinalBelarusian(-num);

  const triads: number[] = [];
  let temp = num;
  while (temp > 0) {
    triads.push(temp % 1000);
    temp = Math.floor(temp / 1000);
  }

  const parts: string[] = [];
  for (let i = triads.length - 1; i >= 0; i--) {
    const val = triads[i];
    if (val === 0) continue;
    const isFem = i === 1; // для тысяч ("адна тысяча", "дзве тысячы")
    const triadWords = triadToWords(val, isFem);
    parts.push(...triadWords);
    const scale = getScaleName(i, val);
    if (scale) parts.push(scale);
  }

  return parts.join(" ");
}

/**
 * Ператварае лік у парадкавы лічэбнік у родным ці месным склоне для дат і гадоў:
 */
export function integerToOrdinalBelarusian(num: number, grammaticalCase: "nom" | "gen" | "dat" | "acc" | "ins" | "loc" | "plural_nom" | "plural_gen" = "nom"): string {
  if (num <= 0 || num > 9999) {
    return integerToCardinalBelarusian(num);
  }

  const thousands = Math.floor(num / 1000);
  const rem1000 = num % 1000;
  const hundreds = Math.floor(rem1000 / 100);
  const rem100 = rem1000 % 100;

  const prefixParts: string[] = [];
  let lastVal = 0;

  if (thousands > 0) {
    if (rem1000 === 0) {
      lastVal = thousands * 1000;
    } else {
      if (thousands === 1) {
        prefixParts.push("тысяча");
      } else if (thousands === 2) {
        prefixParts.push("дзве тысячы");
      } else {
        prefixParts.push(...triadToWords(thousands, true), getScaleName(1, thousands));
      }
    }
  }

  if (lastVal === 0 && hundreds > 0) {
    if (rem100 === 0) {
      lastVal = hundreds * 100;
    } else {
      prefixParts.push(HUNDREDS[hundreds]);
    }
  }

  if (lastVal === 0 && rem100 > 0) {
    if (rem100 < 20 || rem100 % 10 === 0) {
      lastVal = rem100;
    } else {
      const t = Math.floor(rem100 / 10);
      prefixParts.push(TENS[t]);
      lastVal = rem100 % 10;
    }
  }

  if (lastVal === 0 && num > 0) {
    lastVal = num;
  }

  let ordinalBase = "";
  if (lastVal >= 1 && lastVal <= 19) {
    ordinalBase = ORDINAL_ONES[lastVal] || "";
  } else if (lastVal >= 20 && lastVal <= 90 && lastVal % 10 === 0) {
    ordinalBase = ORDINAL_TENS[lastVal / 10] || "";
  } else if (lastVal >= 100 && lastVal <= 900 && lastVal % 100 === 0) {
    ordinalBase = ORDINAL_HUNDREDS[lastVal / 100] || "";
  } else if (lastVal === 1000) {
    ordinalBase = "тысячны";
  } else if (lastVal === 2000) {
    ordinalBase = "двухтысячны";
  } else if (lastVal === 3000) {
    ordinalBase = "трохтысячны";
  }

  if (!ordinalBase) {
    return integerToCardinalBelarusian(num);
  }

  let finalOrdinal = ordinalBase;
  const stem = ordinalBase.replace(/(ы|і|ой)$/, "");

  switch (grammaticalCase) {
    case "gen": // першага, другога, трэцяга, дваццаць чацвёртага
      finalOrdinal = ordinalBase === "трэці" ? "трэцяга" : (ordinalBase === "другі" ? "другога" : stem + "ага");
      break;
    case "dat": // першаму, трэцяму
      finalOrdinal = ordinalBase === "трэці" ? "трэцяму" : (ordinalBase === "другі" ? "другому" : stem + "аму");
      break;
    case "acc":
      finalOrdinal = ordinalBase;
      break;
    case "ins":
    case "loc": // у першым, у дваццаць чацвёртым годзе, у тысяча дзевяцьсот дзевяноста першым
      finalOrdinal = ordinalBase === "трэці" ? "трэцім" : (ordinalBase === "другі" ? "другім" : stem + "ым");
      break;
    case "plural_nom": // першыя, дзевяностыя
      finalOrdinal = ordinalBase === "трэці" ? "трэція" : stem + "ыя";
      break;
    case "plural_gen": // першых, дзевяностых, васьмідзесятых
      finalOrdinal = ordinalBase === "трэці" ? "трэціх" : stem + "ых";
      break;
    case "nom":
    default:
      finalOrdinal = ordinalBase;
      break;
  }

  return [...prefixParts, finalOrdinal].join(" ");
}

/**
 * Асноўны нармалізатар тэксту для сінтэзу: знаходзіць усе лічбы ў тэксце
 * і замяняе іх на адпаведныя беларускія словы ў правільнай граматычнай форме.
 */
export function normalizeBelarusianNumbersInText(text: string): string {
  if (!text || typeof text !== "string") return "";

  let res = text;

  // 1. Дзесяцігоддзі і множныя лікі: 80-я, 90-я, 80-х, 90-х, 1990-я, 1990-х
  res = res.replace(/(?<!\p{L}\p{N})(\d{1,4})-(я|ія)(?!\p{L}\p{N})/giu, (match, nStr) => {
    const num = parseInt(nStr, 10);
    return integerToOrdinalBelarusian(num, "plural_nom");
  });
  res = res.replace(/(?<!\p{L}\p{N})(\d{1,4})-(х|іх|ых)(?!\p{L}\p{N})/giu, (match, nStr) => {
    const num = parseInt(nStr, 10);
    return integerToOrdinalBelarusian(num, "plural_gen");
  });

  // 2. Лічбы з дэфіснымі канчаткамі: 1-ы, 1-га, 2-гі, 2-га, 3-ці, 3-га, 4-ты, 5-ы, 20-м, 21-му
  res = res.replace(/(?<!\p{L}\p{N})(\d{1,4})-(ы|і|ой|ты|ці|гі|шы)(?!\p{L}\p{N})/giu, (match, nStr) => {
    const num = parseInt(nStr, 10);
    return integerToOrdinalBelarusian(num, "nom");
  });
  res = res.replace(/(?<!\p{L}\p{N})(\d{1,4})-(га|ага|яга)(?!\p{L}\p{N})/giu, (match, nStr) => {
    const num = parseInt(nStr, 10);
    return integerToOrdinalBelarusian(num, "gen");
  });
  res = res.replace(/(?<!\p{L}\p{N})(\d{1,4})-(му|аму|яму)(?!\p{L}\p{N})/giu, (match, nStr) => {
    const num = parseInt(nStr, 10);
    return integerToOrdinalBelarusian(num, "dat");
  });
  res = res.replace(/(?<!\p{L}\p{N})(\d{1,4})-(м|ым|ім)(?!\p{L}\p{N})/giu, (match, nStr) => {
    const num = parseInt(nStr, 10);
    return integerToOrdinalBelarusian(num, "loc");
  });

  // 3. Календарныя даты: "1 верасня", "15 ліпеня", "25 сакавіка" -> "першага верасня", "пятнаццатага ліпеня"
  const monthsPattern = MONTHS_GENITIVE.join("|");
  const dateRegex = new RegExp(`(?<!\\p{L}\\p{N})([1-9]|[12][0-9]|3[01])\\s+(${monthsPattern})(?!\\p{L}\\p{N})`, "giu");
  res = res.replace(dateRegex, (match, dayStr, monthName) => {
    const day = parseInt(dayStr, 10);
    const dayWord = integerToOrdinalBelarusian(day, "gen");
    return `${dayWord} ${monthName}`;
  });

  // 4. Гады ў спалучэннях:
  // а) З прыназоўнікамі "у / ў / пры / пасля / каля / з / да" + годзе/гадах/г./гг.:
  res = res.replace(/(?<!\p{L}\p{N})([уўУЎ]|пры|пасля|каля|з|да)\s+(\d{3,4})\s*(годзе|г\.|гадах|гг\.)(?!\p{L}\p{N})/giu, (match, prep, yearStr, yearWord) => {
    const year = parseInt(yearStr, 10);
    const isPlural = /гадах|гг/i.test(yearWord);
    const isGenitive = /да|пасля|каля|з/i.test(prep);
    const ord = isPlural 
      ? integerToOrdinalBelarusian(year, "plural_gen") 
      : (isGenitive ? integerToOrdinalBelarusian(year, "gen") : integerToOrdinalBelarusian(year, "loc"));
    const fullYearWord = /г\./i.test(yearWord) 
      ? (isGenitive ? "года" : "годзе") 
      : (/гг\./i.test(yearWord) ? "гадах" : yearWord);
    return `${prep} ${ord} ${fullYearWord}`;
  });

  // б) "у 2024" (без слова "годзе", але пасля "у/ў")
  res = res.replace(/(?<!\p{L}\p{N})([уўУЎ])\s+(\d{4})(?!\p{L}\p{N})/giu, (match, prep, yearStr) => {
    const year = parseInt(yearStr, 10);
    if (year >= 1000 && year <= 2099) {
      const ord = integerToOrdinalBelarusian(year, "loc");
      return `${prep} ${ord} годзе`;
    }
    return match;
  });

  // в) "2024 года" / "1991 года" / "1986 г."
  res = res.replace(/(?<!\p{L}\p{N})(\d{3,4})\s*(года|г\.)(?!\p{L}\p{N})/giu, (match, yearStr) => {
    const year = parseInt(yearStr, 10);
    const ord = integerToOrdinalBelarusian(year, "gen");
    return `${ord} года`;
  });

  // г) "2024 год"
  res = res.replace(/(?<!\p{L}\p{N})(\d{3,4})\s*(год)(?!\p{L}\p{N})/giu, (match, yearStr) => {
    const year = parseInt(yearStr, 10);
    const ord = integerToOrdinalBelarusian(year, "nom");
    return `${ord} год`;
  });

  // 5. Адсоткі: "50%" -> "пяцьдзясят працэнтаў"
  res = res.replace(/(?<!\p{L}\p{N})(\d+)%/gu, (match, nStr) => {
    const num = parseInt(nStr, 10);
    const words = integerToCardinalBelarusian(num);
    const lastTwo = num % 100;
    const lastOne = num % 10;
    let unit = "працэнтаў";
    if (lastTwo < 11 || lastTwo > 19) {
      if (lastOne === 1) unit = "працэнт";
      else if (lastOne >= 2 && lastOne <= 4) unit = "працэнты";
    }
    return `${words} ${unit}`;
  });

  // 6. Дзесятковыя дробы: "3,5" / "3.5"
  res = res.replace(/(?<!\p{L}\p{N})(\d+)[.,](\d+)(?!\p{L}\p{N})/gu, (match, wholeStr, fracStr) => {
    const whole = parseInt(wholeStr, 10);
    const wholeWord = integerToCardinalBelarusian(whole);
    const frac = parseInt(fracStr, 10);
    const fracWord = integerToCardinalBelarusian(frac);
    return `${wholeWord} і ${fracWord}`;
  });

  // 7. Звычайныя асобныя лічбы (любыя лічбы, што засталіся):
  res = res.replace(/(?<!\p{L}\p{N})\d+(?!\p{L}\p{N})/gu, (match) => {
    const num = parseInt(match, 10);
    if (isNaN(num)) return match;
    return integerToCardinalBelarusian(num);
  });

  return res;
}
