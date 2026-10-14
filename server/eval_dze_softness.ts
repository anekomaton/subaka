import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function evaluateOption(text: string, tl: string, label: string) {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${tl}&total=1&idx=0&textlen=${text.length}&client=tw-ob&prev=input`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = Buffer.from(await res.arrayBuffer());

  const evalRes = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite",
    contents: [
      { inlineData: { mimeType: "audio/mp3", data: buf.toString("base64") } },
      `You are an expert Belarusian phonetician.
Input audio generated from: text="${text}", engine="${tl}" (${label}).

Evaluate precisely:
1. Is the "dz" consonant in "дзе" soft (palatalized soft affricate [d͡zʲ] / [d͡ʑ], дзеканне) or hard ([d͡z] as in "дзэ")?
2. Does it sound like native Belarusian "дзе" (soft) or does it sound hard like "дзэ"?
3. Score from 1 to 10 for Belarusian softness accuracy.`
    ]
  });

  console.log(`=== [${tl}] "${text}" (${label}) ===`);
  console.log(evalRes.text?.trim());
}

async function run() {
  const variants = [
    { text: "Дзе?", tl: "uk", label: "UK original" },
    { text: "Дзє?", tl: "uk", label: "UK with є" },
    { text: "Дзьє?", tl: "uk", label: "UK with ьє" },
    { text: "Дзье?", tl: "uk", label: "UK with ье" },
    { text: "Дзіе?", tl: "uk", label: "UK with іе" },
    { text: "Дзе?", tl: "ru", label: "RU original" },
    { text: "Дзье?", tl: "ru", label: "RU with ье" },
    { text: "Де?", tl: "ru", label: "RU soft de" }
  ];

  for (const v of variants) {
    await evaluateOption(v.text, v.tl, v.label);
  }
}
run();
