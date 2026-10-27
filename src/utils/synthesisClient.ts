/**
 * Universal Subtitle Audio Synthesis Client
 * Supports both Browser mode (calls /api/synthesize Express endpoint)
 * and Desktop mode (native direct synthesis without Express server).
 */

import { isTauriDesktop, fetchAudioBufferNative, postJsonNative } from './tauriBridge';
import { getDesktopGeminiApiKey } from './desktopAiClient';
import { normalizeBelarusianNumbersInText } from './belarusianNumberToWords';
import { belarusianToPhoneticTTS, addStressToSingleVowelWords } from './phoneticUkrToBel';

export interface SynthesisOptions {
  headers?: Record<string, string>;
  apiKey?: string;
}

/**
 * Converts a base64 string to a Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

/**
 * Splits text into TTS chunks for phonetics engine
 */
function splitTextIntoTTSChunks(text: string, maxLen = 150): string[] {
  if (text.length <= maxLen) return [text];
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let cur = '';

  for (const w of words) {
    if (!w) continue;
    if ((cur + ' ' + w).trim().length <= maxLen) {
      cur = (cur + ' ' + w).trim();
    } else {
      if (cur) chunks.push(cur);
      cur = w;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/**
 * Synthesizes voice using Corpus.by Ales API
 */
async function synthesizeAlesDesktop(cleanText: string): Promise<Blob> {
  const reqBody = JSON.stringify({
    text: cleanText,
    voice_type: 'ales',
    language: 'be',
  });

  let rawJson = '';
  try {
    rawJson = await postJsonNative('https://ml1.ssrlab.by/api/tts', reqBody);
  } catch {
    // Fallback to fetch
    const resp = await fetch('https://ml1.ssrlab.by/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: reqBody,
    });
    if (!resp.ok) throw new Error(`Ales API error: HTTP ${resp.status}`);
    rawJson = await resp.text();
  }

  const data = JSON.parse(rawJson);
  let audioUrl = typeof data === 'string' ? data : (data?.audio || data?.url);
  if (!audioUrl || typeof audioUrl !== 'string') {
    throw new Error('Не атрыманы адрас аўдыёфайла ад TTS Алесь');
  }

  if (audioUrl.startsWith('/')) {
    audioUrl = `https://ml1.ssrlab.by${audioUrl}`;
  } else if (!audioUrl.startsWith('http://') && !audioUrl.startsWith('https://')) {
    audioUrl = `https://ml1.ssrlab.by/${audioUrl}`;
  }
  if (audioUrl.startsWith('http://')) {
    audioUrl = audioUrl.replace('http://', 'https://');
  }

  // Fetch audio file
  try {
    const base64Audio = await fetchAudioBufferNative(audioUrl);
    return base64ToBlob(base64Audio, 'audio/mpeg');
  } catch {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw new Error(`Памылка спампоўвання аўдыё TTS Алесь: ${audioRes.status}`);
    return await audioRes.blob();
  }
}

/**
 * Synthesizes voice using BelG2P phonetics
 */
async function synthesizeBelG2PDesktop(rawText: string): Promise<Blob> {
  const normalized = normalizeBelarusianNumbersInText(rawText);
  const stressed = addStressToSingleVowelWords(normalized);
  const phoneticText = belarusianToPhoneticTTS(stressed);
  const chunks = splitTextIntoTTSChunks(phoneticText, 150);
  const arrayBuffers: ArrayBuffer[] = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    let chunkBuffer: ArrayBuffer | null = null;
    const langsToTry = /сфер|сфєр|атмасфер/i.test(trimmed) ? ['ru', 'uk'] : ['uk', 'ru'];

    for (const lang of langsToTry) {
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(trimmed)}&tl=${lang}&total=1&idx=0&textlen=${trimmed.length}&client=tw-ob&prev=input`;
      try {
        const base64 = await fetchAudioBufferNative(url);
        const blob = base64ToBlob(base64, 'audio/mpeg');
        chunkBuffer = await blob.arrayBuffer();
        break;
      } catch {
        try {
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://translate.google.com/',
            },
          });
          if (res.ok) {
            chunkBuffer = await res.arrayBuffer();
            break;
          }
        } catch (_) {}
      }
    }

    if (!chunkBuffer) {
      throw new Error('Не ўдалося сфарміраваць аўдыё сінтэзу');
    }
    arrayBuffers.push(chunkBuffer);
  }

  return new Blob(arrayBuffers, { type: 'audio/mpeg' });
}

/**
 * Universal synthesis entry point
 */
export async function synthesizeSubtitleAudioUniversal(
  text: string,
  voiceName: string,
  options?: SynthesisOptions
): Promise<Blob> {
  // 1. Browser mode: forward to Express backend (server.ts)
  if (!isTauriDesktop()) {
    const headers = options?.headers || { 'Content-Type': 'application/json' };
    const response = await fetch('/api/synthesize', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text,
        voiceName,
      }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || 'Памылка сервера пры сінтэзе');
    }

    return await response.blob();
  }

  // 2. Desktop mode: autonomous client-side / native synthesis
  const cleanText = normalizeBelarusianNumbersInText(
    text.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim()
  );
  if (!cleanText) {
    throw new Error('Пусты тэкст для агучвання');
  }

  const requestedVoice = (voiceName || 'Ales').trim();

  // Ales
  if (requestedVoice === 'Ales') {
    try {
      return await synthesizeAlesDesktop(cleanText);
    } catch (alesErr) {
      console.warn('[Desktop Ales Fallback] Falling back to BelG2P:', alesErr);
      return await synthesizeBelG2PDesktop(cleanText);
    }
  }

  // BelG2P (TTS Маруся)
  if (requestedVoice === 'BelG2P') {
    return await synthesizeBelG2PDesktop(cleanText);
  }

  // Gemini AI voices (Zephyr, Kore, Puck, Charon, Fenrir)
  const isGeminiVoice = ['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'].includes(requestedVoice);
  if (isGeminiVoice) {
    const apiKey = (options?.apiKey || getDesktopGeminiApiKey() || localStorage.getItem('gemini_api_key') || '').trim();
    if (!apiKey) {
      throw new Error(
        `Для сінтэзу AI голасу «${requestedVoice}» у дэсктопнай версіі неабходна ўвесці бясплатны Gemini API ключ.`
      );
    }

    try {
      const promptText = `Speak naturally in Belarusian: ${cleanText}`;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-lite-tts:generateContent?key=${apiKey}`;
      const reqBody = JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: requestedVoice,
              },
            },
          },
        },
      });

      let rawResponse = '';
      // In Desktop mode: execute via subaka.exe native process memory space (postJsonNative).
      // This ensures Split Tunneling VPN routes the traffic through subaka.exe without needing msedgewebview2.exe!
      if (isTauriDesktop()) {
        try {
          rawResponse = await postJsonNative(url, reqBody);
        } catch (nativeErr: any) {
          console.warn('[Gemini Voice Desktop] Native post failed:', nativeErr);
          throw nativeErr;
        }
      } else {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: reqBody,
        });
        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson?.error?.message || `Gemini TTS error (${resp.status})`);
        }
        rawResponse = await resp.text();
      }

      const result = JSON.parse(rawResponse);
      if (result?.error) {
        throw new Error(result.error.message || `Gemini API error: ${result.error.code}`);
      }

      const base64Data = result?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Data) {
        return base64ToBlob(base64Data, 'audio/wav');
      }
      throw new Error('Gemini TTS не вярнуў аўдыёзвесткі');
    } catch (err: any) {
      console.warn('[Gemini Voice Desktop error]:', err);
      if (err?.message?.includes('User location is not supported')) {
        throw new Error(`Памылка рэгіёну Google API: User location is not supported. Калі ласка, пераканайцеся, што VPN уключаны для subaka.exe альбо выкарыстоўвайце галасы «Алесь» / «Маруся».`);
      }
      throw new Error(`Памылка сінтэзу AI голасу «${requestedVoice}»: ${err?.message || err}`);
    }
  }

  // Fallback to Ales
  return await synthesizeAlesDesktop(cleanText);
}
