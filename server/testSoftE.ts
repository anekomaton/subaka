import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const alwaysHard = "жшчрджЖШЧРДЖ";

function convertToTTS(text: string): string {
  let t = String(text).replace(/<[^>]*>/g, "").trim();
  t = t.replace(/\u0300/g, "\u0301").replace(/\u00B4/g, "\u0301");
  t = t.replace(/([аеёіоуыэюяАЕЁІОУЫЭЮЯ])['’](?=[а-яёіўА-ЯЁІЎ])/g, "$1\u0301");

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
      if (isPrevHard) {
        res += (ch === "Е" ? "Е" : "е");
      } else {
        res += (ch === "Е" ? "Є" : "є");
      }
    } else if (ch === "ё" || ch === "Ё") {
      const isStartOrVowel = !prev || "аеёіоуыэюяАЕЁІОУЫЭЮЯєїи".includes(prev) || /[\s.,!?;:—\-]/.test(prev);
      if (isStartOrVowel) {
        res += (ch === "Ё" ? "Йо́" : "йо́");
      } else {
        res += (ch === "Ё" ? "Ьо́" : "ьо́");
      }
    } else {
      res += ch;
    }
  }
  return res;
}

async function testPhrase(orig: string) {
  const ttsText = convertToTTS(orig);
  console.log("Original:", orig, "-> TTS:", ttsText);

  const url = "https://translate.google.com/translate_tts?ie=UTF-8&q=" + encodeURIComponent(ttsText) + "&tl=uk&total=1&idx=0&textlen=" + ttsText.length + "&client=tw-ob&prev=input";
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = Buffer.from(await res.arrayBuffer());

  const evalRes = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: [
      { inlineData: { mimeType: "audio/mp3", data: buf.toString("base64") } },
      "Input phrase: " + orig + "\n1. Is 'не' pronounced soft ([nʲe]) or hard ([nɛ] = 'нэ')?\n2. Is 'дзе' pronounced soft ([d͡zʲe]) or hard ([d͡zɛ] = 'дзэ')?\n3. Is 'е' at the end of words (e.g. 'ведае', 'дзе') soft ([je]) or hard ([ɛ] = 'э')?\n4. Overall evaluation for Belarusian."
    ]
  });
  console.log("=== " + orig + " ===");
  console.log(evalRes.text?.trim());
}

async function run() {
  await testPhrase("Не, ён не ведае, дзе гэта.");
  await testPhrase("Дзеці гуляюць на зялёным полі.");
  await testPhrase("Гэта не так, я ведаю ўсё.");
}
run();
