import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const alwaysHard = "жшчрджЖШЧРДЖ";

function belarusianToPhoneticTTS(text: string): string {
  let t = String(text).replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "").trim();
  t = t.replace(/\u0300/g, "\u0301").replace(/\u00B4/g, "\u0301");
  t = t.replace(/([аеёіоуыэюяАЕЁІОУЫЭЮЯ])['’](?=[а-яёіўА-ЯЁІЎ])/g, "$1\u0301");

  const SEP = "__APOS_SEP__";
  t = t.replace(/([бпвмфздтргкх])['’ʹʼʻ`'']([яеёюіэЯЕЁЮІЭ])/gi, `$1${SEP}$2`);
  t = t.replace(/[’ʹʼʻʲ`'']/g, "'");

  // Беларускія мяккія зычныя перад "е" (дзе -> дзье, це -> цье, не -> нье, ле -> лье і г.д.)
  // для безумоўна мяккага вымаўлення ва ўкраінскім акустычным рухавіку Google TTS
  t = t.replace(/дз([еЕ])([\u0300\u0301]?)/g, "дзь$1$2");
  t = t.replace(/Дз([еЕ])([\u0300\u0301]?)/g, "Дзь$1$2");
  t = t.replace(/ДЗ([еЕ])([\u0300\u0301]?)/g, "ДЗЬ$1$2");

  t = t.replace(/ц([еЕ])([\u0300\u0301]?)/g, "ць$1$2");
  t = t.replace(/Ц([еЕ])([\u0300\u0301]?)/g, "Ць$1$2");

  t = t.replace(/н([еЕ])([\u0300\u0301]?)/g, "нь$1$2");
  t = t.replace(/Н([еЕ])([\u0300\u0301]?)/g, "Нь$1$2");

  t = t.replace(/с([еЕ])([\u0300\u0301]?)/g, "сь$1$2");
  t = t.replace(/С([еЕ])([\u0300\u0301]?)/g, "Сь$1$2");

  t = t.replace(/з([еЕ])([\u0300\u0301]?)/g, "зь$1$2");
  t = t.replace(/З([еЕ])([\u0300\u0301]?)/g, "Зь$1$2");

  t = t.replace(/л([еЕ])([\u0300\u0301]?)/g, "ль$1$2");
  t = t.replace(/Л([еЕ])([\u0300\u0301]?)/g, "Ль$1$2");

  t = t.replace(/в([еЕ])([\u0300\u0301]?)/g, "вь$1$2");
  t = t.replace(/В([еЕ])([\u0300\u0301]?)/g, "Вь$1$2");

  t = t.replace(/м([еЕ])([\u0300\u0301]?)/g, "мь$1$2");
  t = t.replace(/М([еЕ])([\u0300\u0301]?)/g, "Мь$1$2");

  t = t.replace(/б([еЕ])([\u0300\u0301]?)/g, "бь$1$2");
  t = t.replace(/Б([еЕ])([\u0300\u0301]?)/g, "Бь$1$2");

  t = t.replace(/п([еЕ])([\u0300\u0301]?)/g, "пь$1$2");
  t = t.replace(/П([еЕ])([\u0300\u0301]?)/g, "Пь$1$2");

  let res = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    const prev = i > 0 ? t[i - 1] : "";
    const isPrevHard = alwaysHard.includes(prev);

    if (ch === "ў" || ch === "Ў") {
      res += (ch === "Ў" ? "У" : "у");
    } else if (ch === "ы" || ch === "Ы") {
      res += (ch === "Ы" ? "И" : "и");
    } else if (ch === "э" || ch === "Э") {
      res += (ch === "Э" ? "Е" : "е");
    } else if (ch === "е" || ch === "Е") {
      const isStartOrVowel = !prev || "аеёіоуыэюяАЕЁІОУЫЭЮЯєїи".includes(prev) || /[\s\p{P}]/u.test(prev);
      if (isStartOrVowel) {
        // Пасля галосных ці на пачатку слова (ведае, есці) — ётаванае [je] (укр. "є")
        res += (ch === "Е" ? "Є" : "є");
      } else {
        // Пасля зычных (у тым ліку зь, дзь, нь, ць)
        res += ch;
      }
    } else if (ch === "ё" || ch === "Ё") {
      const isStartOrVowel = !prev || "аеёіоуыэюяАЕЁІОУЫЭЮЯєїи".includes(prev) || /[\s\p{P}]/u.test(prev);
      if (isStartOrVowel) {
        res += (ch === "Ё" ? "Йо́" : "йо́");
      } else {
        res += (ch === "Ё" ? "Ьо́" : "ьо́");
      }
    } else {
      res += ch;
    }
  }

  res = res.replace(new RegExp(`${SEP}([яЯ])`, 'g'), "'я");
  res = res.replace(new RegExp(`${SEP}([еЕ])`, 'g'), "'є");
  res = res.replace(new RegExp(`${SEP}([ёЁ])`, 'g'), "'йо́");
  res = res.replace(new RegExp(`${SEP}([юЮ])`, 'g'), "'ю");
  res = res.replace(new RegExp(`${SEP}([іІ])`, 'g'), "'ї");
  res = res.replace(new RegExp(`${SEP}`, 'g'), "'");

  return res;
}

async function testSentence(raw: string) {
  const ttsText = belarusianToPhoneticTTS(raw);
  console.log("Raw: " + raw + " -> Transformed: " + ttsText);

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(ttsText)}&tl=uk&total=1&idx=0&textlen=${ttsText.length}&client=tw-ob&prev=input`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = Buffer.from(await res.arrayBuffer());

  const evalRes = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: [
      { inlineData: { mimeType: "audio/mp3", data: buf.toString("base64") } },
      `Original text: "${raw}".
Evaluate audio:
1. Is "дзе" soft [d͡zʲe] without any hard "дзэ"?
2. Is "не" soft [nʲe] without any hard "нэ"?
3. Rate the authentic Belarusian naturalness from 1 to 5 stars.`
    ]
  });

  console.log("=== Evaluation for: " + raw + " ===");
  console.log(evalRes.text?.trim());
}

async function run() {
  await testSentence("Дзе?");
  await testSentence("Дзе ты быў?");
  await testSentence("Не, ён не ведае, дзе гэта.");
  await testSentence("Дзеці гуляюць у полі.");
}
run();
