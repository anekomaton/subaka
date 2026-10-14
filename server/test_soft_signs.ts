import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testWithSoftSigns(text: string, label: string) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=uk&total=1&idx=0&textlen=${text.length}&client=tw-ob&prev=input`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = Buffer.from(await res.arrayBuffer());

  const evalRes = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: [
      { inlineData: { mimeType: "audio/mp3", data: buf.toString("base64") } },
      `You are a native Belarusian listener. Audio generated from: "${text}" (${label}).
1. Is "дзе" completely soft [d͡zʲe] (дзь) without any hard "дзэ"?
2. Is "не" completely soft [nʲe] (нь) without any hard "нэ"?
3. Is "полі/поле", "ведае", "дзеці" naturally articulated?
4. How natural and authentic does this sound to a Belarusian ear?`
    ]
  });

  console.log(`=== ${label} ("${text}") ===`);
  console.log(evalRes.text?.trim());
}

async function run() {
  await testWithSoftSigns("Дзье́?", "Дзе? with soft sign");
  await testWithSoftSigns("Нье́!", "Не! with soft sign");
  await testWithSoftSigns("Йо́н нье вє́дає, дзье яны́.", "Full sentence with soft signs");
  await testWithSoftSigns("Дзье́ці гуля́юць на зялё́ным по́льі.", "Sentence 2");
}
run();
