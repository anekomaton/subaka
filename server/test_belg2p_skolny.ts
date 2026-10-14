import { convertTextBelG2P } from "../src/utils/belG2P";
import { normalizeBelarusianNumbersInText } from "../src/utils/belarusianNumberToWords";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export function belarusianOrthoepyToTTS(text: string): string {
  if (!text) return "";
  const numNormalized = normalizeBelarusianNumbersInText(text);

  let t = numNormalized;
  try {
    if (!/[d͡zɣɦʃʒjː:']/i.test(t)) {
      t = convertTextBelG2P(t, { format: "skolny" });
    }
  } catch (err) {
    console.warn("BelG2P format fallback:", err);
  }

  // 1. Ачыстка любых лацінскіх і камбінаваных сімвалаў
  t = t.replace(/d[͡\u0361]?z/gi, "дз")
       .replace(/d[͡\u0361]?ʒ/gi, "дж")
       .replace(/t[͡\u0361]?s/gi, "ц")
       .replace(/t[͡\u0361]?ʃ/gi, "ч")
       .replace(/ɣ|ɦ/g, "г")
       .replace(/ʃ/g, "ш")
       .replace(/ʒ/g, "ж")
       .replace(/x/g, "х")
       .replace(/j/g, "й")
       .replace(/w|u̯/g, "ў")
       .replace(/\u0361/g, "");

  // 2. Падоўжаныя зычныя
  t = t.replace(/ц['’ʹʼʻʲ]?:/gi, "цьц");
  t = t.replace(/с['’ʹʼʻʲ]?:/gi, "сьс");
  t = t.replace(/з['’ʹʼʻʲ]?:/gi, "зьз");
  t = t.replace(/н['’ʹʼʻʲ]?:/gi, "ньн");
  t = t.replace(/дз['’ʹʼʻʲ]?:/gi, "дзьдз");
  t = t.replace(/([бвгґдзйклмнпрстўфхцчшж]):/gi, "$1$1");

  // 3. Апострафы мяккасці перад галоснымі
  t = t.replace(/([бвгдзклмнпрстфхц])'э/gi, "$1е");
  t = t.replace(/([бвгдзклмнпрстфхц])'а/gi, "$1я");
  t = t.replace(/([бвгдзклмнпрстфхц])'у/gi, "$1ю");
  t = t.replace(/([бвгдзклмнпрстфхц])'о/gi, "$1ьо");
  t = t.replace(/([бвгдзклмнпрстфхц])'і/gi, "$1і");
  t = t.replace(/([бвгдзклмнпрстфхц])'ы/gi, "$1і");
  t = t.replace(/'/g, "ь");

  t = t.replace(/ьь/g, "ь");
  t = t.replace(/йэ/gi, "е");
  t = t.replace(/йа/gi, "я");
  t = t.replace(/йу/gi, "ю");
  t = t.replace(/йо/gi, "ё");

  // Выдаляем любыя пакінутыя лацінскія сімвалы
  t = t.replace(/[a-zA-Z]/g, "");

  // 4. Перавод літар для ўкраінскага TTS (ў -> у, ы -> и, э -> е)
  let res = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "ў" || ch === "Ў") {
      res += (ch === "Ў" ? "У" : "у");
    } else if (ch === "ы" || ch === "Ы") {
      res += (ch === "Ы" ? "И" : "и");
    } else if (ch === "э" || ch === "Э") {
      res += (ch === "Э" ? "Е" : "е");
    } else {
      res += ch;
    }
  }

  return res;
}

async function testAudio(raw: string) {
  const ttsText = belarusianOrthoepyToTTS(raw);
  console.log("Raw :", raw);
  console.log("TTS :", ttsText);

  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(ttsText)}&tl=uk&total=1&idx=0&textlen=${ttsText.length}&client=tw-ob&prev=input`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = Buffer.from(await res.arrayBuffer());

  const evalRes = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: [
      { inlineData: { mimeType: "audio/mp3", data: buf.toString("base64") } },
      `Evaluate audio for: "${raw}".
Phonetic string: "${ttsText}".
1. Is it spelling out letters or reading whole words fluently?
2. Does it sound like natural fluent Belarusian?`
    ]
  });

  console.log("=== Evaluation ===");
  console.log(evalRes.text);
}

async function run() {
  await testAudio("Свята на снезе і светлы дзень.");
  await testAudio("Песня льецца, і лёгкі снег падае на сцяну.");
  await testAudio("Дзе ты быў?");
}
run();
