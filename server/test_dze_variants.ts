import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function checkSoftness(text: string, tl: string) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${tl}&total=1&idx=0&textlen=${text.length}&client=tw-ob&prev=input`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = Buffer.from(await res.arrayBuffer());

  try {
    const evalRes = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite",
      contents: [
        { inlineData: { mimeType: "audio/mp3", data: buf.toString("base64") } },
        `Listen to this short audio (Text: "${text}", Engine: ${tl}).
Question: Is the sound at the beginning:
A) Hard affricate [dz] (like in Ukrainian "дзвін" or "дзэ")?
B) Soft affricate [dzʲ] (like in Belarusian "дзеці", "дзе")?
C) Soft stop [dʲ] (like in Russian "где" / "день")?
State which one (A, B, or C) and describe why.`
      ]
    });
    console.log(`[${tl}] "${text}":`, evalRes.text?.trim().split("\n")[0]);
  } catch (e: any) {
    console.log(`[${tl}] "${text}": error`, e?.message);
  }
}

async function run() {
  await checkSoftness("Дзе", "uk");
  await checkSoftness("Дзє", "uk");
  await checkSoftness("Дзьє", "uk");
  await checkSoftness("Дзье", "uk");
  await checkSoftness("Дзіе", "uk");
  await checkSoftness("Дзе", "ru");
  await checkSoftness("Дзье", "ru");
  await checkSoftness("Дзие", "uk");
}
run();
