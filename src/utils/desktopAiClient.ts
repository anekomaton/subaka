/**
 * Subaka Desktop AI Client (Google Gemini API via Google Generative Language API)
 * Directly calls Google Gemini REST API in standalone Desktop mode
 * without requiring a local Node.js Express server.
 */

import { isTauriDesktop, postJsonNative, fetchVerbumOnlineNative } from './tauriBridge';

export interface DesktopProofreadIssue {
  word: string;
  suggestion: string;
  explanation: string;
}

export interface DesktopProofreadResult {
  id: string;
  issues: DesktopProofreadIssue[];
}

export interface DesktopTranslationResult {
  id: string;
  translatedText: string;
}

/**
 * Retrieves the stored Gemini API key across all supported localStorage keys
 */
export function getDesktopGeminiApiKey(): string {
  try {
    const raw =
      localStorage.getItem('subaka_gemini_api_key') ||
      localStorage.getItem('gemini_api_key') ||
      localStorage.getItem('GOOGLE_GENAI_API_KEY') ||
      '';
    return raw.replace(/[^\x00-\x7F]/g, '').trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

export interface GeminiModelInfo {
  id: string;
  name: string;
  description: string;
  badge?: string;
  isRecommended?: boolean;
}

export const ACTIVE_GEMINI_MODELS: readonly GeminiModelInfo[] = [
  {
    id: 'gemini-3.8-flash',
    name: 'Gemini 3.8 Flash',
    description: 'Найноўшая флагманская Flash-мадэль з максімальнай дакладнасцю перакладу',
    badge: 'Найноўшая',
    isRecommended: true,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    description: 'Хуткая і правераная Flash-мадэль',
    badge: 'Хуткая',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    description: 'Звышхуткая, эканамічная па квотах, высокая надзейнасць',
    badge: 'Звышхуткая',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash Latest',
    description: 'Аўтаматычны псеўданім актуальнай стабільнай Flash-мадэлі',
    badge: 'Аўта',
  },
] as const;

export const DEFAULT_FALLBACK_MODELS: string[] = [
  'gemini-3.8-flash',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];

/**
 * Retrieves the user-selected Gemini model from localStorage.
 * Automatically migrates away from deprecated models (1.5, 2.0, 2.5, 3.7, etc.)
 */
export function getDesktopGeminiModel(): string {
  try {
    const raw = localStorage.getItem('subaka_gemini_model') || '';
    if (raw && DEFAULT_FALLBACK_MODELS.includes(raw)) {
      return raw;
    }
    // Auto-migrate away from deprecated models
    if (raw && (raw.includes('1.5') || raw.includes('2.0') || raw.includes('2.5') || raw.includes('3.7') || raw.includes('pro'))) {
      localStorage.setItem('subaka_gemini_model', 'gemini-3.8-flash');
    }
  } catch {}
  return 'gemini-3.8-flash';
}

export function setDesktopGeminiModel(modelId: string): void {
  try {
    if (DEFAULT_FALLBACK_MODELS.includes(modelId)) {
      localStorage.setItem('subaka_gemini_model', modelId);
    }
  } catch {}
}

let cachedDesktopModels: string[] | null = null;
let lastModelFetchTime = 0;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL
const quotaExhaustedModels = new Map<string, number>();
const QUOTA_EXHAUSTED_TTL_MS = 15 * 60 * 1000; // 15 minutes cooldown

export function markDesktopModelTemporaryUnavailable(modelName: string, reason = 'overload/quota') {
  console.log(`[Desktop AI] Deprioritizing model '${modelName}' for 15m due to ${reason}`);
  quotaExhaustedModels.set(modelName, Date.now());
}

function getModelScore(id: string): number {
  // Score ordered strictly from newest to older active models
  if (id === 'gemini-3.8-flash') return 200;
  if (id.includes('3.8')) return 195;
  if (id === 'gemini-3.5-flash') return 170;
  if (id.includes('3.5')) return 165;
  if (id === 'gemini-3.1-flash-lite') return 160;
  if (id.includes('3.1')) return 155;
  if (id === 'gemini-flash-latest') return 150;
  if (id.includes('flash-lite')) return 145;
  return 10;
}

function isModelDeprecated(name: string): boolean {
  return (
    name.includes('1.5') ||
    name.includes('2.0') ||
    name.includes('2.5') ||
    name.includes('3.7') ||
    name.includes('pro') ||
    name.includes('embedding') ||
    name.includes('imagen') ||
    name.includes('image') ||
    name.includes('tts') ||
    name.includes('live') ||
    name.includes('aqa') ||
    name.includes('bison') ||
    name.includes('robotics')
  );
}

function filterAndPrioritizeModels(modelsList: string[]): string[] {
  const now = Date.now();
  const active: string[] = [];
  const deprioritized: string[] = [];

  for (const m of modelsList) {
    if (isModelDeprecated(m)) continue;
    const time = quotaExhaustedModels.get(m);
    if (time && now - time < QUOTA_EXHAUSTED_TTL_MS) {
      deprioritized.push(m);
    } else {
      if (time) quotaExhaustedModels.delete(m);
      active.push(m);
    }
  }

  if (active.length === 0) {
    return modelsList.filter((m) => !isModelDeprecated(m));
  }
  return [...active, ...deprioritized];
}

async function getDesktopDynamicModels(apiKey: string): Promise<string[]> {
  const now = Date.now();
  if (!cachedDesktopModels || cachedDesktopModels.length === 0) {
    cachedDesktopModels = [...DEFAULT_FALLBACK_MODELS];
  }

  // If cache is fresh, return immediately
  if (now - lastModelFetchTime < MODEL_CACHE_TTL_MS) {
    return filterAndPrioritizeModels(cachedDesktopModels);
  }

  // Trigger non-blocking background fetch so user's translation or proofreading starts with 0ms pre-flight delay
  lastModelFetchTime = now;
  (async () => {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
      let data: any = null;

      if (isTauriDesktop()) {
        const res = await fetchVerbumOnlineNative(url);
        if (typeof res === 'string') {
          try { data = JSON.parse(res); } catch { data = null; }
        } else if (res && typeof res === 'object') {
          data = res;
        }
      } else {
        const res = await fetch(url);
        if (res.ok) {
          data = await res.json();
        }
      }

      if (data && Array.isArray(data.models)) {
        const rawList = data.models;
        const modelsList: string[] = [];

        for (const m of rawList) {
          const name = (m.name || '').replace(/^models\//, '');
          const methods = m.supportedGenerationMethods || [];
          if (methods.includes('generateContent') || methods.length === 0) {
            if (name.includes('gemini') && !isModelDeprecated(name)) {
              modelsList.push(name);
            }
          }
        }

        const pool = Array.from(new Set([...DEFAULT_FALLBACK_MODELS, ...modelsList])).filter((m) => !isModelDeprecated(m));
        if (pool.length > 0) {
          cachedDesktopModels = pool.sort((a, b) => getModelScore(b) - getModelScore(a));
        }
      }
    } catch (err) {
      console.warn('[Desktop AI] Background models update error:', err);
    }
  })();

  return filterAndPrioritizeModels(cachedDesktopModels);
}

async function callGenerativeLanguageApi(
  apiKey: string,
  bodyObj: any,
  preferredModel?: string,
  returnRawText?: boolean,
  options?: { signal?: AbortSignal; cancelRef?: { current: boolean } }
): Promise<any> {
  if (options?.signal?.aborted || options?.cancelRef?.current) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, '');
  if (!cleanKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }

  const chosenModel = preferredModel || getDesktopGeminiModel();
  const dynamicModels = await getDesktopDynamicModels(cleanKey);
  const now = Date.now();

  // Filter models that are currently marked exhausted or overloaded
  const isModelExhausted = (m: string) => {
    const time = quotaExhaustedModels.get(m);
    return time ? now - time < QUOTA_EXHAUSTED_TTL_MS : false;
  };

  const isChosenExhausted = isModelExhausted(chosenModel);

  // If chosenModel is currently exhausted, prioritize available active models first
  let rawModelsToTry: string[];
  if (!isChosenExhausted) {
    rawModelsToTry = [chosenModel, ...dynamicModels];
  } else {
    // Put non-exhausted models first, push chosenModel to the back
    const activeModels = dynamicModels.filter((m) => !isModelExhausted(m));
    rawModelsToTry = activeModels.length > 0 ? [...activeModels, chosenModel] : [...dynamicModels, chosenModel];
  }
  const modelsToTry = Array.from(new Set(rawModelsToTry)).filter((m) => !isModelDeprecated(m));

  let lastError = '';

  for (const model of modelsToTry) {
    if (options?.signal?.aborted || options?.cancelRef?.current) {
      throw new DOMException('Aborted', 'AbortError');
    }

    // Skip models marked exhausted if we have non-exhausted options
    if (isModelExhausted(model) && modelsToTry.some((m) => !isModelExhausted(m))) {
      continue;
    }

    let attempts = isModelExhausted(model) ? 1 : 2;
    while (attempts > 0) {
      if (options?.signal?.aborted || options?.cancelRef?.current) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
      try {
        let isSuccess = false;
        let statusCode = 200;
        let responseJson: any = null;
        let rawText: string | undefined = undefined;

        // In Desktop mode: execute directly through native subaka.exe process (postJsonNative).
        // This ensures VPN Split Tunneling routes ALL AI traffic with just subaka.exe (no msedgewebview2.exe needed)!
        if (isTauriDesktop()) {
          try {
            const nativeResp = await postJsonNative(url, JSON.stringify(bodyObj));
            if (options?.signal?.aborted || options?.cancelRef?.current) {
              throw new DOMException('Aborted', 'AbortError');
            }
            if (nativeResp) {
              responseJson = JSON.parse(nativeResp);
              if (responseJson?.error) {
                isSuccess = false;
                statusCode = responseJson.error.code || 400;
              } else {
                isSuccess = true;
                statusCode = 200;
                rawText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
              }
            }
          } catch (nativeErr: any) {
            if (nativeErr?.name === 'AbortError' || nativeErr instanceof DOMException) {
              throw nativeErr;
            }
            console.warn(`[Desktop AI] Native subaka.exe call failed, trying webview fallback:`, nativeErr);
          }
        }

        // Browser or webview fallback
        if (!responseJson) {
          if (options?.signal?.aborted || options?.cancelRef?.current) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bodyObj),
            signal: options?.signal,
          });
          statusCode = response.status;
          isSuccess = response.ok;
          responseJson = await response.json().catch(() => ({}));
          rawText = responseJson?.candidates?.[0]?.content?.parts?.[0]?.text;
        }

        if (options?.signal?.aborted || options?.cancelRef?.current) {
          throw new DOMException('Aborted', 'AbortError');
        }

        if (isSuccess && rawText) {
          if (returnRawText) {
            const clean = rawText.trim().replace(/^```(?:srt|txt)?\s*/i, '').replace(/```\s*$/i, '').trim();
            return clean;
          }
          const clean = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
          return JSON.parse(clean);
        }

        const errMsg = responseJson?.error?.message || `HTTP ${statusCode}`;
        lastError = errMsg;

        const isAuthError =
          errMsg.includes('401') ||
          errMsg.includes('UNAUTHENTICATED') ||
          errMsg.includes('ACCESS_TOKEN_TYPE_UNSUPPORTED') ||
          errMsg.includes('API_KEY_INVALID') ||
          errMsg.includes('API key not valid') ||
          errMsg.includes('API_KEY_SERVICE_BLOCKED');

        if (isAuthError) {
          throw new Error(`Няправільны Gemini API Key: ${errMsg}`);
        }

        const isOverloaded =
          statusCode === 503 ||
          errMsg.includes('503') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('high demand') ||
          errMsg.includes('temporary');

        const isRateLimited =
          statusCode === 429 ||
          errMsg.includes('429') ||
          errMsg.includes('RESOURCE_EXHAUSTED') ||
          errMsg.includes('Quota exceeded') ||
          errMsg.includes('quota');

        if (isOverloaded || isRateLimited) {
          const reason = isOverloaded ? '503 перагрузка' : '429 ліміт запытаў';
          console.warn(`[Desktop AI] Model ${model} is busy (${reason}), switching immediately to next model...`);
          markDesktopModelTemporaryUnavailable(model, reason);
          // Instant switch without wasting retry loops or long delays on an overloaded model
          break;
        }

        if (statusCode === 404 || errMsg.includes('not found') || errMsg.includes('NOT_FOUND') || errMsg.includes('no longer available')) {
          console.warn(`[Desktop AI] Model ${model} not available (404/not found), skipping to next model...`);
          break;
        }

        console.warn(`[Desktop AI] Model ${model} returned error, retrying:`, errMsg);
        attempts--;
        if (attempts > 0) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        break;
      } catch (netErr: any) {
        if (netErr?.name === 'AbortError' || netErr instanceof DOMException) {
          throw netErr;
        }
        lastError = netErr?.message || String(netErr);
        console.warn(`[Desktop AI] Network error calling ${model}:`, lastError);
        break;
      }
    }
  }

  // Provide user-friendly Belarusian error message
  if (lastError.includes('User location is not supported') || lastError.includes('location is not supported')) {
    throw new Error('Google Gemini недаступны з гэтага IP-адраса (User location is not supported). Праверце падключэнне да VPN.');
  }
  if (lastError.includes('503') || lastError.includes('high demand') || lastError.includes('UNAVAILABLE')) {
    throw new Error('Мадэлі Gemini часова перагружаны (503 High Demand). Пачакайце некалькі секунд і паўтарыце спробу.');
  }
  if (lastError.includes('429') || lastError.includes('RESOURCE_EXHAUSTED') || lastError.includes('quota')) {
    throw new Error('Перавышаны ліміт запытаў Gemini API (429 Quota Exceeded). Калі ласка, пачакайце хвіліну.');
  }

  throw new Error(lastError || 'Не ўдалося атрымаць адказ ад Google Generative Language API');
}

/**
 * Direct Gemini API call for translating subtitles in Desktop mode
 */
export async function desktopTranslateBatch(
  entries: { id: string | number; text: string }[],
  targetLanguageOrApiKey?: string,
  explicitApiKey?: string,
  preferredModel?: string,
  options?: { signal?: AbortSignal; cancelRef?: { current: boolean } }
): Promise<DesktopTranslationResult[]> {
  // Support flexible argument positions (whether targetLanguage or apiKey is passed first)
  let targetLanguage = 'Belarusian';
  let apiKey = explicitApiKey || '';
  let modelName = preferredModel;

  if (targetLanguageOrApiKey) {
    if (targetLanguageOrApiKey.startsWith('AIza') || targetLanguageOrApiKey.length > 25) {
      apiKey = targetLanguageOrApiKey;
    } else {
      targetLanguage = targetLanguageOrApiKey;
    }
  }

  if (!apiKey) {
    apiKey = getDesktopGeminiApiKey();
  }

  if (!apiKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }

  const targetLangName =
    targetLanguage === 'English'
      ? 'English'
      : 'standard literary Belarusian ("беларуская мова", Narkamawka spelling)';

  const prompt = `You are an expert subtitle translator. Translate the following subtitles into high-quality, natural ${targetLangName}.
CRITICAL LANGUAGE CONSTRAINTS:
1. Target language MUST be strictly ${targetLangName}.
2. ABSOLUTELY DO NOT output Ukrainian ("українська мова"), Russian ("русский язык"), or any mixed Surzhyk / Trasianka / Ukrainian words (such as "що", "це", "зробленій", "або", "такі", "дуже", "якщо").
3. For Belarusian, use pure standard literary Belarusian vocabulary (e.g. "што", "гэта", "зроблены", "ці", "такія", "вельмі", "калі").
4. Preserve semantic tone, context, formalness, and short placeholders.
Return the results ONLY as a JSON array matching the exact IDs of the input. Do not alter any subtitle IDs.

Subtitles to translate:
${JSON.stringify(entries)}`;

  const bodyObj = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            translatedText: { type: 'STRING' },
          },
          required: ['id', 'translatedText'],
        },
      },
    },
  };

  const parsed = await callGenerativeLanguageApi(apiKey, bodyObj, modelName, false, options);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Direct Gemini API call for proofreading subtitles in Desktop mode
 */
export async function desktopProofreadBatch(
  entries: { id: string | number; text: string }[],
  explicitApiKey?: string,
  preferredModel?: string,
  options?: { signal?: AbortSignal; cancelRef?: { current: boolean } }
): Promise<DesktopProofreadResult[]> {
  const apiKey = explicitApiKey || getDesktopGeminiApiKey();
  if (!apiKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }

  const prompt = `Правер субцітры на наяўнасць арфаграфічных, пунктуацыйных, граматычных, стылістычных ці лексічных памылак паводле правілаў сучаснай беларускай літаратурнай мовы (афіцыйны правапіс).
СТРОГІЯ ПРАВІЛЫ І ІГНАРАВАННЕ НАЦІСКАЎ:
1. КРЫТЫЧНА: Ігнаруй любыя пастаўленыя націскі ў тэксце! Знакі націску (а́, е́, і́, о́, у́, ы́, э́, ю́, я́ ці юнікод \\u0301) НІ Ў ЯКІМ ВЫПАДКУ НЕ ЛІЧЫ ПАМЫЛКАЙ!
2. КАЛІ ВЫПРАЎЛЕННЕ (suggestion) АДРОЗНІВАЕЦЦА АД ЗНОЙДЗЕНАГА СЛОВА (word) ТОЛЬКІ НАЯЎНАСЦЮ АБО АДСУТНАСЦЮ НАЦІСКУ (або калі яны тоесныя), ТАКАЕ ВЫПРАЎЛЕННЕ ВЕРТАЦЬ ЗАБАРОНЕНА! Вярні EMPTY issues array [].
3. Для кожнай сапраўднай памылкі вярні:
   - "word": дакладнае слова ці фраза з памылкай.
   - "suggestion": рэкамендаванае выпраўленне.
   - "explanation": кароткае тлумачэнне па-беларуску.
4. Калі запіс субцітра не мае памылак, вярні пусты масіў issues [].

Субцітры для праверкі:
${JSON.stringify(entries)}`;

  const bodyObj = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            id: { type: 'STRING' },
            issues: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  word: { type: 'STRING' },
                  suggestion: { type: 'STRING' },
                  explanation: { type: 'STRING' },
                },
                required: ['word', 'suggestion', 'explanation'],
              },
            },
          },
          required: ['id', 'issues'],
        },
      },
    },
  };

  const parsed = await callGenerativeLanguageApi(apiKey, bodyObj, preferredModel, false, options);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Helper: Encode Float32Array PCM samples to 16kHz 16-bit mono WAV Uint8Array
 */
function writeWavHeaderString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWav16BitMono(samples: Float32Array, sampleRate: number): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  // RIFF identifier
  writeWavHeaderString(view, 0, 'RIFF');
  // file length
  view.setUint32(4, 36 + samples.length * 2, true);
  // RIFF type
  writeWavHeaderString(view, 8, 'WAVE');
  // format chunk identifier
  writeWavHeaderString(view, 12, 'fmt ');
  // format chunk length
  view.setUint32(16, 16, true);
  // sample format (1 = PCM)
  view.setUint16(20, 1, true);
  // channel count (1 = mono)
  view.setUint16(22, 1, true);
  // sample rate
  view.setUint32(24, sampleRate, true);
  // byte rate (sampleRate * 1 * 2)
  view.setUint32(28, sampleRate * 2, true);
  // block align (1 * 2)
  view.setUint16(32, 2, true);
  // bits per sample
  view.setUint16(34, 16, true);
  // data chunk identifier
  writeWavHeaderString(view, 36, 'data');
  // data chunk length
  view.setUint32(40, samples.length * 2, true);

  // Write PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Uint8Array(buffer);
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function decodeAudioToMono16k(blob: Blob): Promise<{ samples: Float32Array; sampleRate: number; duration: number } | null> {
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) return null;
    const ctx = new AudioCtxClass({ sampleRate: 16000 });
    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    } catch {
      await ctx.close().catch(() => {});
      return null;
    }
    const sampleRate = audioBuffer.sampleRate;
    const duration = audioBuffer.duration;
    const numChannels = audioBuffer.numberOfChannels;
    const length = audioBuffer.length;

    const monoSamples = new Float32Array(length);
    for (let c = 0; c < numChannels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        monoSamples[i] += channelData[i] / numChannels;
      }
    }
    await ctx.close().catch(() => {});
    return { samples: monoSamples, sampleRate, duration };
  } catch (err) {
    console.warn('[Desktop AI] Audio decode error:', err);
    return null;
  }
}

function srtTimeToSec(t: string): number {
  const parts = t.trim().split(':');
  if (parts.length !== 3) return 0;
  const [h, m, rest] = parts;
  const [s, ms] = rest.split(',');
  return (
    parseInt(h, 10) * 3600 +
    parseInt(m, 10) * 60 +
    parseInt(s, 10) +
    (parseInt(ms, 10) || 0) / 1000
  );
}

function secToSrtTime(totalSec: number): string {
  const totalMs = Math.round(Math.max(0, totalSec) * 1000);
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  const pad = (n: number, z = 2) => String(n).padStart(z, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function shiftSrtTimestamps(srtText: string, offsetSec: number, startingIndex: number = 1): { srt: string; count: number } {
  const blocks = srtText.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 0);
  let currentIndex = startingIndex;
  const resultBlocks: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx === -1) continue;

    const timeLine = lines[timeLineIdx];
    const [startStr, endStr] = timeLine.split('-->').map((s) => s.trim());
    if (!startStr || !endStr) continue;

    const startSec = Math.max(0, srtTimeToSec(startStr) + offsetSec);
    const endSec = Math.max(startSec + 0.1, srtTimeToSec(endStr) + offsetSec);
    const textLines = lines.slice(timeLineIdx + 1).join('\n');
    if (!textLines.trim()) continue;

    resultBlocks.push(`${currentIndex}\n${secToSrtTime(startSec)} --> ${secToSrtTime(endSec)}\n${textLines}`);
    currentIndex++;
  }

  return { srt: resultBlocks.join('\n\n'), count: resultBlocks.length };
}

export interface DesktopTranscribeOptions {
  apiKey?: string;
  preferredModel?: string;
  onProgress?: (msg: string) => void;
  signal?: AbortSignal;
  mediaDurationSec?: number;
}

/**
 * Direct Gemini API call for generating subtitles (.srt) from audio in Desktop mode.
 * Routes 100% of network traffic through subaka.exe via postJsonNative for VPN Split Tunneling.
 */
export async function desktopTranscribeAudio(
  audioInput: Blob | File,
  options?: DesktopTranscribeOptions
): Promise<string> {
  const apiKey = options?.apiKey || getDesktopGeminiApiKey();
  if (!apiKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }

  if (options?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  options?.onProgress?.('Падрыхтоўка аўдыя для распазнавання...');

  const systemInstruction = `You are an expert speech transcriber and audio timeline aligner.
Your sole job is to transcribe all spoken dialogue from the provided audio segment into standard SubRip (.srt) subtitle format with precise frame-accurate timestamp alignment.

CRITICAL MANDATES:
1. ORIGINAL SPOKEN LANGUAGE MANDATE (CRITICAL - NO TRANSLATION):
   - Output language MUST be strictly the ORIGINAL language spoken in the audio (e.g. Belarusian, Russian, English, Polish, etc.).
   - ABSOLUTELY DO NOT TRANSLATE into Belarusian or any other language during transcription!
   - If the audio contains Russian speech, write Russian. If Belarusian, write Belarusian. If English, write English.
   - Preserve exact words and grammar spoken by the audio speakers.

2. EXTREME DENSITY & FULL COVERAGE:
   - Transcribe EVERY SINGLE SPOKEN PHRASE. Never skip, condense, or summarize lines.
   - Create short, readable subtitle blocks (3 to 6 words per block, 2 to 4 seconds long).

3. STRICT SRT FORMAT:
   - Output ONLY raw valid SubRip (.srt) format starting with block 1 at 00:00:00,000.
   - ALWAYS separate every subtitle block with a BLANK LINE (double newline).
   - Format each block strictly as:
1
00:00:00,000 --> 00:00:02,500
[Subtitle text]

2
00:00:02,500 --> 00:00:05,000
[Next subtitle text]

   - DO NOT place text or lyrics before the first timestamp block.
   - Do NOT wrap in markdown code blocks (\`\`\`srt). Do NOT add extra conversational commentary.`;

  const prompt = 'Транскрыбуй усе сказаныя фразы з гэтага аўдыя ў фармат субцітраў SubRip (.srt) НА МОВЕ АРЫГІНАЛУ (без перакладу).';

  // Attempt decoding to 16kHz mono WAV for high-speed transcription and clean chunking
  let decoded: { samples: Float32Array; sampleRate: number; duration: number } | null = null;
  try {
    options?.onProgress?.('Аналіз і дэкадаванне аўдыядарожкі...');
    decoded = await decodeAudioToMono16k(audioInput);
  } catch (decErr) {
    console.warn('[Desktop AI] decodeAudioToMono16k failed:', decErr);
  }

  if (options?.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  // Path 1: Audio decoded successfully into PCM samples
  if (decoded && decoded.duration > 0) {
    const { samples, sampleRate, duration } = decoded;
    const CHUNK_DURATION_SEC = 240; // 4-minute chunks (~7.6MB WAV per chunk)
    const totalChunks = Math.ceil(duration / CHUNK_DURATION_SEC);
    const allSrtParts: string[] = [];
    let currentSubtitleIndex = 1;

    for (let c = 0; c < totalChunks; c++) {
      if (options?.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const startSec = c * CHUNK_DURATION_SEC;
      const endSec = Math.min(duration, (c + 1) * CHUNK_DURATION_SEC);
      const startSample = Math.floor(startSec * sampleRate);
      const endSample = Math.min(samples.length, Math.floor(endSec * sampleRate));
      const chunkSamples = samples.subarray(startSample, endSample);

      const chunkPct = Math.round(((c + 1) / totalChunks) * 100);
      options?.onProgress?.(
        totalChunks > 1
          ? `Генерацыя субцітраў з Gemini: частка ${c + 1}/${totalChunks} (${chunkPct}%)...`
          : 'Генерацыя субцітраў і таймкодаў з Gemini...'
      );

      const wavBytes = encodeWav16BitMono(chunkSamples, sampleRate);
      const base64Audio = uint8ArrayToBase64(wavBytes);

      const bodyObj = {
        contents: [
          {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/wav',
                  data: base64Audio,
                },
              },
              {
                text: prompt,
              },
            ],
          },
        ],
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        generationConfig: {
          temperature: 0.0,
          maxOutputTokens: 16384,
        },
      };

      const rawChunkSrt = await callGenerativeLanguageApi(apiKey, bodyObj, options?.preferredModel, true, { signal: options?.signal });

      if (rawChunkSrt && typeof rawChunkSrt === 'string') {
        const { srt: shiftedSrt, count } = shiftSrtTimestamps(rawChunkSrt, startSec, currentSubtitleIndex);
        if (shiftedSrt) {
          allSrtParts.push(shiftedSrt);
          currentSubtitleIndex += count;
        }
      }
    }

    const finalSrt = allSrtParts.join('\n\n').trim();
    if (!finalSrt) {
      throw new Error('Мадэль Gemini не выявіла разборлівага маўлення ў аўдыяфайле.');
    }
    return finalSrt;
  }

  // Path 2: Fallback for direct small audio files (<= 14MB) without AudioContext decode
  if (audioInput.size <= 14 * 1024 * 1024) {
    options?.onProgress?.('Кадзіраванне аўдыя і адпраўка ў Gemini...');
    const base64Audio = await blobToBase64(audioInput);
    let mimeType = audioInput.type || 'audio/mp3';
    if (!mimeType || mimeType === 'application/octet-stream') {
      mimeType = 'audio/mp3';
    }

    const bodyObj = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Audio,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: 16384,
      },
    };

    options?.onProgress?.('Генерацыя субцітраў і таймкодаў з Gemini...');
    const rawSrt = await callGenerativeLanguageApi(apiKey, bodyObj, options?.preferredModel, true, { signal: options?.signal });

    if (rawSrt && typeof rawSrt === 'string' && rawSrt.trim()) {
      return rawSrt.trim();
    }
    throw new Error('Мадэль Gemini не выявіла разборлівага маўлення ў аўдыяфайле.');
  }

  throw new Error('Не ўдалося дэкадаваць аўдыяфайл для генерацыі субцітраў. Калі ласка, папярэдне выцягніце аўдыядарожку праз меню плэера альбо канвертуйце ў .mp3 ці .wav.');
}

