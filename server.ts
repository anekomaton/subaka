/**
 * @license
 * SPDX-License-Identifier: GPL-3.0 license
 */

import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { spawn } from "child_process";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type, FileState } from "@google/genai";
import dotenv from "dotenv";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import {
  extractAudioWithFfmpeg,
  getMediaDurationInSeconds,
  segmentAudioFile,
  segmentAudioBySilence,
  parseSrtString,
  mergeAndShiftSrtSegments,
  secondsToSrtTime,
  sanitizeAndFixSrtTimings,
  execFilePromise
} from "./server/transcribeHelper";
import { convertTextBelG2P } from "./src/utils/belG2P";
import {
  stressTextWithGrammarDb,
  stressSrtWithGrammarDb,
  stressWordsBatchWithGrammarDb,
  searchWordInGrammarDb,
  getGrammarDbStatus,
  ensureGrammarDbReady,
  spellCheckBelarusianText,
  checkWordSpellingInGrammarDb
} from "./server/grammarDbHelper";
import {
  getVerbumDbStatus,
  ensureVerbumDbReady,
  searchOfflineVerbum,
  suggestOfflineVerbum
} from "./server/verbumDbHelper";
import { normalizeBelarusianNumbersInText } from "./src/utils/belarusianNumberToWords";
import {
  belarusianToUkrainianTTS,
  belarusianToPhoneticTTS,
  splitTextIntoTTSChunks,
  addStressToSingleVowelWords
} from "./src/utils/phoneticUkrToBel";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Set up JSON parsers
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// Health check endpoint for Cloud Run container lifecycle checks
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Initialize the Gemini API client safely using direct API key according to AI Studio guidelines
function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function getAiClientForRequest(req?: express.Request): GoogleGenAI {
  const rawKey = (req?.headers?.["x-gemini-api-key"] as string) || 
                 (req?.headers?.["x-goog-api-key"] as string) || 
                 (req?.query?.gemini_key as string);
  const customKey = typeof rawKey === "string" ? rawKey.trim().replace(/^["']|["']$/g, "") : "";
  if (customKey && customKey.length > 5) {
    return new GoogleGenAI({
      apiKey: customKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  // Калі ключ карыстальнікам не ўведзены, выкарыстоўваецца серверны API-ключ з process.env.GEMINI_API_KEY
  return getAiClient();
}

/**
 * Helper to wrap raw 24000Hz 16-bit Mono PCM buffer in a standard wav header
 */
function addWavHeader(pcmBuffer: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  const dataLength = pcmBuffer.length;
  const fileLength = dataLength + 36;

  header.write("RIFF", 0);
  header.writeUInt32LE(fileLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // 1 = Raw PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byteRate: sampleRate * numChannels * bitsPerSample / 8
  header.writeUInt16LE(2, 32); // blockAlign: numChannels * bitsPerSample / 8
  header.writeUInt16LE(16, 34); // bitsPerSample
  header.write("data", 36);
  header.writeUInt32LE(dataLength, 40);

  return Buffer.concat([header, pcmBuffer]);
}

/**
 * Simple parser to extract first file content from raw multipart/form-data body
 */
function parseMultipartBuffer(buffer: Buffer, boundary: string): { data: Buffer; filename?: string; contentType?: string } | null {
  const boundaryBytes = Buffer.from(`--${boundary}`);
  const startIdx = buffer.indexOf(boundaryBytes);
  if (startIdx === -1) return null;

  const headerEndSeq = Buffer.from("\r\n\r\n");
  const headersStartIdx = startIdx + boundaryBytes.length + 2; // skip \r\n after boundary
  const bodyStartIdx = buffer.indexOf(headerEndSeq, headersStartIdx);
  if (bodyStartIdx === -1) return null;

  const headersStr = buffer.slice(headersStartIdx, bodyStartIdx).toString("utf-8");
  
  const contentTypeMatch = headersStr.match(/Content-Type:\s*([^\s;\r\n]+)/i);
  const contentType = contentTypeMatch ? contentTypeMatch[1] : undefined;
  
  const filenameMatch = headersStr.match(/filename="([^"]+)"/i);
  const filename = filenameMatch ? filenameMatch[1] : undefined;

  const fileDataStart = bodyStartIdx + 4;
  let fileDataEnd = buffer.indexOf(boundaryBytes, fileDataStart);
  if (fileDataEnd === -1) {
    const endBoundaryBytes = Buffer.from(`--${boundary}--`);
    fileDataEnd = buffer.indexOf(endBoundaryBytes, fileDataStart);
  }
  
  if (fileDataEnd === -1) {
    fileDataEnd = buffer.length;
  } else {
    fileDataEnd -= 2; // strip trailing \r\n before boundary
  }

  const fileData = buffer.slice(fileDataStart, fileDataEnd);
  return { data: fileData, filename, contentType };
}

// ==========================================
// API ROUTES & ROBUST AI HELPERS WITH RETRY/FALLBACK
// ==========================================

function getFriendlyErrorMessage(err: any): string {
  if (!err) return "Невядомая памылка";
  
  let msg = err.message || String(err);
  
  // Try to parse if it is a JSON string
  if (typeof msg === "string" && msg.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(msg);
      if (parsed.error && parsed.error.message) {
        msg = parsed.error.message;
      }
    } catch (_) {
      // Ignore parse error
    }
  }
  
  // Provide clear Belarusian explanations for common issues
  if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("Service Unavailable") || msg.includes("ServiceUnavailable") || msg.includes("high demand") || msg.includes("overloaded") || msg.includes("temporary")) {
    return "Сервер мадэлі Gemini часова перагружаны альбо недаступны (Service Unavailable / 503). Калі ласка, пачакайце 10-15 секунд і паспрабуйце зноў.";
  }
  if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("Quota exceeded") || msg.includes("quota")) {
    return "Перавышаны ліміт запытаў да API (429). Калі ласка, пачакайце хвіліну і паспрабуйце зноў.";
  }
  if (
    msg.includes("has not been used in project") ||
    msg.includes("it is disabled") ||
    msg.includes("Enable it by visiting") ||
    msg.includes("generativelanguage.googleapis.com") ||
    msg.includes("API_KEY_INVALID") || 
    msg.includes("API key not valid") || 
    msg.includes("API_KEY_MISSING") || 
    msg.includes("GEMINI_API_KEY не знойдзены") ||
    msg.includes("Expected OAuth 2") ||
    msg.includes("OAuth 2") ||
    msg.includes("UNAUTHENTICATED") ||
    msg.includes("invalid authentication credentials") ||
    msg.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED") ||
    msg.includes("API_KEY_SERVICE_BLOCKED") ||
    msg.includes("401")
  ) {
    return "API-ключ Gemini не знойдзены, несапраўдны альбо API адключаны ў Google Cloud праекце. Калі ласка, пазначце ваш уласны API-ключ праз кнопку «Gemini API Key» у верхнім меню.";
  }
  
  return msg;
}

// Dynamic Gemini model discovery & caching
let cachedModels: string[] | null = null;
let lastModelFetchTime = 0;
const MODEL_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL

const DEFAULT_FALLBACK_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

const quotaExhaustedModels = new Map<string, number>();
const QUOTA_EXHAUSTED_TTL_MS = 15 * 60 * 1000; // 15 minutes cooldown

export function markModelAsUnavailable(modelName: string) {
  if (cachedModels) {
    const idx = cachedModels.indexOf(modelName);
    if (idx !== -1) {
      console.log(`[Gemini Models] Removing unavailable/outdated model '${modelName}' from dynamic list`);
      cachedModels.splice(idx, 1);
    }
  }
}

export function markModelTemporaryUnavailable(modelName: string, reason = "overload/quota") {
  console.log(`[Gemini Models] Deprioritizing model '${modelName}' for 15m due to ${reason}`);
  quotaExhaustedModels.set(modelName, Date.now());
}

export function markModelQuotaExhausted(modelName: string) {
  markModelTemporaryUnavailable(modelName, "quota exhausted");
}

function isModelDeprecated(name: string): boolean {
  return (
    name.includes("1.5") ||
    name.includes("2.0") ||
    name.includes("2.5") ||
    name.includes("pro") ||
    name.includes("embedding") ||
    name.includes("imagen") ||
    name.includes("image") ||
    name.includes("tts") ||
    name.includes("live") ||
    name.includes("aqa") ||
    name.includes("bison") ||
    name.includes("robotics")
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

  // If all models are deprioritized, return full active list so we still have fallbacks
  if (active.length === 0) {
    return modelsList.filter((m) => !isModelDeprecated(m));
  }
  return [...active, ...deprioritized];
}

async function getDynamicModels(client: GoogleGenAI): Promise<string[]> {
  const now = Date.now();
  if (cachedModels && cachedModels.length > 0 && (now - lastModelFetchTime < MODEL_CACHE_TTL_MS)) {
    return filterAndPrioritizeModels(cachedModels);
  }

  try {
    console.log("[Gemini Models] Automatically fetching active models list from Gemini API...");
    const modelsList: string[] = [];
    const response = await client.models.list();
    if (response) {
      for await (const m of response) {
        if (m && m.name) {
          const supported = (m as any).supportedGenerationMethods || (m as any).supportedActions || [];
          if (supported.includes("generateContent") || supported.length === 0) {
            const cleanName = m.name.replace(/^models\//, "");
            if (cleanName.includes("gemini") && !isModelDeprecated(cleanName)) {
              modelsList.push(cleanName);
            }
          }
        }
      }
    }

    const pool = Array.from(new Set([...DEFAULT_FALLBACK_MODELS, ...modelsList])).filter((m) => !isModelDeprecated(m));
    if (pool.length > 0) {
      const sorted = pool.sort((a, b) => {
        const getScore = (id: string) => {
          // Ordered strictly from newest to older active models
          if (id === "gemini-3.8-flash") return 200;
          if (id.includes("3.8")) return 195;
          if (id === "gemini-3.7-flash") return 180;
          if (id.includes("3.7")) return 175;
          if (id === "gemini-3.5-flash") return 170;
          if (id.includes("3.5")) return 165;
          if (id === "gemini-3.1-flash-lite") return 160;
          if (id.includes("3.1")) return 155;
          if (id === "gemini-flash-latest") return 150;
          return 10;
        };
        return getScore(b) - getScore(a);
      });

      console.log("[Gemini Models] Discovered available active models from API:", sorted);
      cachedModels = sorted;
      lastModelFetchTime = now;
      return filterAndPrioritizeModels(cachedModels);
    }
  } catch (err: any) {
    console.warn("[Gemini Models] Could not query models list, using default fallback models:", err?.message || err);
    lastModelFetchTime = now;
  }

  if (!cachedModels || cachedModels.length === 0) {
    cachedModels = [...DEFAULT_FALLBACK_MODELS];
  }
  return filterAndPrioritizeModels(cachedModels);
}

async function generateContentWithRetryAndFallback(client: GoogleGenAI, prompt: string, schema: any, preferredModel?: string) {
  const dynamicModels = await getDynamicModels(client);
  const modelsToTry = preferredModel
    ? Array.from(new Set([preferredModel, ...dynamicModels])).filter((m) => !isModelDeprecated(m))
    : dynamicModels;
  let lastError: any = null;

  for (const model of modelsToTry) {
    let attempts = 2;
    while (attempts > 0) {
      try {
        console.log(`[Translate] Attempting generation with model ${model}, remaining attempts: ${attempts}`);
        const response = await client.models.generateContent({
          model: model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        });
        if (response && response.text) {
          return response;
        }
        throw new Error("No text returned from the model");
      } catch (err: any) {
        lastError = err;
        const errMsg = typeof err === "object" ? (err.message || JSON.stringify(err)) : String(err);

        const isAuthError =
          errMsg.includes("401") ||
          errMsg.includes("UNAUTHENTICATED") ||
          errMsg.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED") ||
          errMsg.includes("API_KEY_INVALID") ||
          errMsg.includes("API key not valid") ||
          errMsg.includes("API_KEY_SERVICE_BLOCKED") ||
          errMsg.includes("Expected OAuth 2") ||
          errMsg.includes("has not been used in project") ||
          errMsg.includes("it is disabled");

        if (isAuthError) {
          throw err;
        }

        if (errMsg.includes("404") || errMsg.includes("NOT_FOUND") || errMsg.includes("no longer available") || errMsg.includes("not found")) {
          console.log(`[Translate] Model ${model} is not available (404/Not Found). Removing from dynamic models list.`);
          markModelAsUnavailable(model);
          break;
        }

        // Check if error is quota exceeded or overloaded/unavailable -> fallback immediately
        const isOverloaded =
          errMsg.includes("503") ||
          errMsg.includes("UNAVAILABLE") ||
          errMsg.includes("high demand") ||
          errMsg.includes("temporary") ||
          err.status === "UNAVAILABLE" ||
          err.statusCode === 503;

        const isRateLimited =
          errMsg.includes("429") ||
          errMsg.includes("RESOURCE_EXHAUSTED") ||
          errMsg.includes("Quota exceeded") ||
          errMsg.includes("quota") ||
          err.statusCode === 429;

        if (isOverloaded || isRateLimited) {
          const reason = isOverloaded ? "503 high demand (overload)" : "429 rate limit";
          console.log(`[Translate] Model ${model} is temporarily busy (${reason}). Switching to next fallback model.`);
          markModelTemporaryUnavailable(model, reason);
          break; // Immediately try next model
        }

        console.log(`[Translate] Model ${model} returned non-critical error, retrying:`, errMsg);
        attempts--;
        if (attempts > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          continue;
        }
        break;
      }
    }
  }
  throw lastError || new Error("Failed to generate translation with fallback models");
}

// Translate subtitle batch
app.post("/api/translate", async (req, res) => {
  try {
    const { entries, targetLanguage = "Belarusian", autoSpellCheck = false, model } = req.body;
    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({ error: "Missing or invalid entries array" });
    }

    if (entries.length === 0) {
      return res.json({ translations: [] });
    }

    const requestedModel = (model || req.headers["x-gemini-model"]) as string | undefined;

    // Limit the batch to prevent extreme payload sizes
    const targetLangName = targetLanguage === "English" ? "English" : "standard literary Belarusian (\"беларуская мова\", Narkamawka spelling)";
    const prompt = `You are an expert subtitle translator. Translate the following subtitles into high-quality, natural ${targetLangName}.
CRITICAL LANGUAGE CONSTRAINTS:
1. Target language MUST be strictly ${targetLangName}.
2. ABSOLUTELY DO NOT output Ukrainian ("українська мова"), Russian ("русский язык"), or any mixed Surzhyk / Trasianka / Ukrainian words (such as "що", "це", "зробленій", "або", "такі", "дуже", "якщо").
3. For Belarusian, use pure standard literary Belarusian vocabulary (e.g. "што", "гэта", "зроблены", "ці", "такія", "вельмі", "калі").
4. Preserve semantic tone, context, formalness, and short placeholders.
Return the results ONLY as a JSON array matching the exact IDs of the input. Do not alter any subtitle IDs.

Subtitles to translate:
${JSON.stringify(entries, null, 2)}`;

    const schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          translatedText: { type: Type.STRING },
        },
        required: ["id", "translatedText"],
      },
    };

    const client = getAiClientForRequest(req);
    const response = await generateContentWithRetryAndFallback(client, prompt, schema, requestedModel);
    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty translation returned from model");
    }

    const rawTranslations = JSON.parse(resultText.trim());
    
    // Apply automatic spellchecking with GrammarDB if enabled and target is Belarusian
    const translations = rawTranslations.map((item: { id: string; translatedText: string }) => {
      if (autoSpellCheck && (!targetLanguage || targetLanguage === "Belarusian")) {
        const spellResult = spellCheckBelarusianText(item.translatedText);
        return {
          id: item.id,
          translatedText: spellResult.correctedText,
          spellChecked: true,
          correctionsCount: spellResult.errors.length
        };
      }
      return item;
    });

    res.json({ translations });
  } catch (err: any) {
    console.error("Translation api error:", err);
    res.status(500).json({ error: getFriendlyErrorMessage(err) });
  }
});

// Direct spellcheck endpoint for text or words
app.post("/api/spellcheck", async (req, res) => {
  try {
    const { text, word } = req.body || {};
    if (word) {
      const result = checkWordSpellingInGrammarDb(String(word));
      return res.json(result);
    }
    if (text !== undefined) {
      const result = spellCheckBelarusianText(String(text));
      return res.json(result);
    }
    return res.status(400).json({ error: "Missing text or word to check" });
  } catch (err: any) {
    console.error("Spellcheck error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Proofread subtitle batch (returns issues/errors per subtitle entry without changing text)
app.post("/api/proofread", async (req, res) => {
  try {
    const { entries, model } = req.body;
    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({ error: "Missing or invalid entries array" });
    }

    if (entries.length === 0) {
      return res.json({ results: [] });
    }

    const requestedModel = (model || req.headers["x-gemini-model"]) as string | undefined;

    // Load leading prompt directly from shired.md file
    let shiredInstructions = "";
    try {
      const shiredPath = path.join(process.cwd(), "shired.md");
      shiredInstructions = fs.readFileSync(shiredPath, "utf-8");
    } catch (err) {
      console.warn("[Proofread API] Failed to read shired.md, falling back to default rules:", err);
    }

    const prompt = `${shiredInstructions}

СТРОГІЯ ДАДАТКОВЫЯ ПРАВІЛЫ І ІГНАРАВАННЕ НАЦІСКАЎ:
1. КРЫТЫЧНА: Ігнаруй любыя пастаўленыя націскі ў тэксце!
   - Знакі націску (напрыклад а́, е́, і́, о́, у́, ы́, э́, ю́, я́ або юнікод комбінаваны знак \\u0301, акцынат і іншыя рэгулярныя ці вучэбныя націскі) НІ Ў ЯКІМ ВЫПАДКУ НЕ ЛІЧЫ ПАМЫЛКАЙ!
   - Не прапаноўвай выдаляць знакі націску або змяняць літары з-за наяўнасці націску. Словы з націскамі цалкам карэктныя.
   - КАЛІ ВЫПРАЎЛЕННЕ (suggestion) АДРОЗНІВАЕЦЦА АД ЗНОЙДЗЕНАГА СЛОВА (word) ТОЛЬКІ НАЯЎНАСЦЮ АБО АДСУТНАСЦЮ НАЦІСКУ (або калі яны тоесныя), ТАКАЕ ВЫПРАЎЛЕННЕ ВЕРТАЦЬ ЗАБАРОНЕНА! Вярні EMPTY issues array [].
2. ЗАБАРОНА НА ВЫПРАЎЛЕННЕ ТОЕСНЫХ СЛОВАЎ (NO-OP SUGGESTIONS):
   - Калі прапанаванае выпраўленне 'suggestion' супадае з тым, што ўжо напісана ў тэксце ('word') або адрозніваецца толькі знакамі націску / рэгістрам, НЕ стварай заўвагу. Вярні пусты масіў issues [].
3. ПАРАДАК АПРАЦОЎКІ:
   - Прааналізуй прадастаўленыя тэксты субцітраў на наяўнасць сапраўдных арфаграфічных, пунктуацыйных, граматычных, стылістычных ці лексічных памылак (паводле інструкцыі shired.md).
   - НЕ перапісвай тэкст цалкам. Замест гэтага вызначы канкрэтныя словы або кароткія фразы, якія ўтрымліваюць сапраўдную памылку.
   - Для кожнай знойдзенай памылкі ў тэксце вярні:
     1. "word": дакладнае слова ці фраза, як яно прапісана ў тэксце субцітра.
     2. "suggestion": рэкамендаванае выпраўленне (якое МУСІЦЬ рэальна адрознівацца ад word і не быць проста даданнем/выдаленнем націску).
     3. "explanation": зразумелае і лаканічнае тлумачэнне па-беларуску, чаму гэта памылка або якое правіла/норма парушана.
   - Калі запіс субцітра не мае памылак, вярні пусты масіў issues [].

Subtitles to proofread:
${JSON.stringify(entries, null, 2)}`;

    const schema = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: { type: Type.STRING },
          issues: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING },
                suggestion: { type: Type.STRING },
                explanation: { type: Type.STRING },
              },
              required: ["word", "explanation"],
            },
          },
        },
        required: ["id", "issues"],
      },
    };

    const client = getAiClientForRequest(req);
    const response = await generateContentWithRetryAndFallback(client, prompt, schema, requestedModel);
    const resultText = response.text;
    if (!resultText) {
      throw new Error("Empty proofread result returned from model");
    }

    const results = JSON.parse(resultText.trim());

    // Programmatic safety filter: exclude suggestions that match what is already written
    // or differ only by combining accent marks (\u0301, etc.), whitespace, case, or u/ў variants.
    const normalizeForComparison = (str: string) =>
      (str || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // strip diacritics/accents
        .replace(/[уўУЎ]/g, "у")         // normalize u/ў
        .toLowerCase()
        .trim();

    const filteredResults = Array.isArray(results)
      ? results.map((item: any) => {
          if (!item || !Array.isArray(item.issues)) return item;
          const filteredIssues = item.issues.filter((issue: any) => {
            if (!issue) return false;
            const wordRaw = (issue.word || "").trim();
            const suggestionRaw = (issue.suggestion || "").trim();

            if (!suggestionRaw) return false; // invalid suggestion

            // If suggestion is identical to word
            if (wordRaw === suggestionRaw) return false;

            // If suggestion matches word after normalization (accents, case, u/ў)
            if (normalizeForComparison(wordRaw) === normalizeForComparison(suggestionRaw)) return false;

            return true;
          });
          return { ...item, issues: filteredIssues };
        })
      : results;

    res.json({ results: filteredResults });
  } catch (err: any) {
    console.error("Proofread api error:", err);
    res.status(500).json({ error: getFriendlyErrorMessage(err) });
  }
});

// Stress single text endpoint using GrammarDB (2.38M forms)
app.post("/api/stress-text", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }
    const status = getGrammarDbStatus();
    if (!status.ready) {
      await ensureGrammarDbReady();
    }
    const stressed = await stressTextWithGrammarDb(String(text));
    res.json({ text: stressed });
  } catch (err: any) {
    console.error("Stress text error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Get GrammarDB status
app.get("/api/grammardb/status", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.json(getGrammarDbStatus());
});

// Trigger background download and build of GrammarDB from official Belarus/GrammarDB XML release
app.post("/api/grammardb/init", async (req, res) => {
  try {
    const status = getGrammarDbStatus();
    if (status.ready) {
      return res.json({ message: "GrammarDB is already ready", status });
    }
    // Launch build asynchronously if not already running
    ensureGrammarDbReady().then((success) => {
      console.log(`[GrammarDB Init] Completed with success = ${success}`);
    }).catch((err) => {
      console.error("[GrammarDB Init] Error:", err);
    });
    res.json({ message: "GrammarDB build initiated", status: getGrammarDbStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Search GrammarDB (2.38M forms) endpoint for highlighted words
app.post("/api/grammardb/search", async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query) {
      return res.status(400).json({ error: "Missing query" });
    }
    const status = getGrammarDbStatus();
    if (!status.ready) {
      await ensureGrammarDbReady();
    }
    const result = searchWordInGrammarDb(String(query));
    const phonetic = (result.found && result.stressed) ? convertTextBelG2P(result.stressed, { wrapBrackets: false }) : '';
    res.json({ ...result, phonetic });
  } catch (err: any) {
    console.error("GrammarDB search error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Check word spelling in GrammarDB (2.38M forms fallback when Hunspell flags a word)
app.post("/api/grammardb/spellcheck-word", async (req, res) => {
  try {
    const { word, words } = req.body || {};
    const status = getGrammarDbStatus();
    if (!status.ready) {
      await ensureGrammarDbReady();
    }
    if (Array.isArray(words)) {
      const results = words.map((w: string) => checkWordSpellingInGrammarDb(String(w)));
      return res.json({ results });
    }
    if (word) {
      const result = checkWordSpellingInGrammarDb(String(word));
      return res.json(result);
    }
    return res.status(400).json({ error: "Missing word or words" });
  } catch (err: any) {
    console.error("GrammarDB spellcheck error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Stress entire SRT subtitle file using GrammarDB
app.post("/api/stress-srt", async (req, res) => {
  try {
    const { srt } = req.body;
    if (!srt) {
      return res.status(400).json({ error: "Missing srt" });
    }
    const status = getGrammarDbStatus();
    if (!status.ready) {
      await ensureGrammarDbReady();
    }
    const stressedSrt = await stressSrtWithGrammarDb(String(srt));
    res.json({ srt: stressedSrt });
  } catch (err: any) {
    console.error("Stress srt error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// BelG2P full endpoint (GrammarDB stress + BelG2P phonetic rules)
app.post("/api/belg2p", async (req, res) => {
  try {
    const { text, format = "skolny", wrapBrackets = false } = req.body;
    if (!text) {
      return res.status(400).json({ error: "Missing text" });
    }
    const status = getGrammarDbStatus();
    if (!status.ready) {
      await ensureGrammarDbReady();
    }
    const stressed = await stressTextWithGrammarDb(String(text));
    const phonetic = convertTextBelG2P(stressed, { wrapBrackets, format });
    res.json({ text, stressed, phonetic });
  } catch (err: any) {
    console.error("BelG2P endpoint error:", err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// Phonetics conversion endpoint (BelG2P School transcription for Belarusian with GrammarDB stress, Google Translate IPA for English)
app.post("/api/phonetics", async (req, res) => {
  try {
    const { entries, format = "skolny" } = req.body;
    if (!entries || !Array.isArray(entries)) {
      return res.status(400).json({ error: "Missing or invalid entries array" });
    }

    if (entries.length === 0) {
      return res.json({ results: [] });
    }

    const cleanedResults: { id: any; phonetic: string; stressed?: string }[] = [];
    const nonCyrillicEntries: any[] = [];

    // Для беларускай мовы (кірыліцы) спачатку аўтаматычна расстаўляем націскі з GrammarDB, потым BelG2P
    for (const e of entries) {
      const text = String(e.text || "").trim();
      if (/[а-яёіўґ]/i.test(text)) {
        const stressedText = await stressTextWithGrammarDb(text);
        cleanedResults.push({
          id: e.id,
          stressed: stressedText,
          phonetic: convertTextBelG2P(stressedText, { wrapBrackets: false, format: format as any }),
        });
      } else {
        nonCyrillicEntries.push({ id: String(e.id), text });
      }
    }

    if (nonCyrillicEntries.length > 0) {
      try {
        const client = getAiClientForRequest(req);
        const prompt = `You are an expert phonetic transcriber for English subtitles.
Convert each provided subtitle text into its exact phonetic transcription:
CRITICAL RULE: DO NOT WRAP TRANSCRIPTION IN SQUARE BRACKETS OR ANY BRACKETS. Return ONLY the plain transcription text without [ or ].
Provide exact Google Translate style phonetic transcription WITHOUT square brackets (clean English IPA pronunciation, e.g. həˈloʊ wɜːrld, with stress marks ˈ and ˌ).

Input items:
${JSON.stringify(nonCyrillicEntries)}

Return a JSON array of objects with 'id' and 'phonetic' properties.`;

        const schema = {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              phonetic: { type: Type.STRING },
            },
            required: ["id", "phonetic"],
          },
        };

        const response = await generateContentWithRetryAndFallback(client, prompt, schema);
        const resultText = response.text;
        if (resultText) {
          const results = JSON.parse(resultText.trim());
          if (Array.isArray(results)) {
            for (const r of results) {
              cleanedResults.push({
                id: r.id,
                phonetic: String(r.phonetic || "").replace(/^\[+|\]+$/g, "").trim(),
              });
            }
          }
        }
      } catch (aiErr) {
        console.warn("AI phonetics error for non-Cyrillic, falling back:", aiErr);
        for (const e of nonCyrillicEntries) {
          cleanedResults.push({ id: e.id, phonetic: e.text });
        }
      }
    }

    res.json({ results: cleanedResults });
  } catch (err: any) {
    console.error("Phonetics api error:", err);
    res.status(500).json({ error: getFriendlyErrorMessage(err) });
  }
});

/**
 * Adapt phonetic school transcription (BelG2P) and IPA into speech-friendly text for neural TTS.
 */
function phoneticToSpeechPronunciation(phoneticText: string): string {
  let s = phoneticText.replace(/[\[\]]/g, "").trim();

  // 1. Compound affricates with any tie bars, underties, combining marks
  s = s.replace(/d[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*z[ʲ\u02B2'’]?/gi, "дз")
       .replace(/d[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ʒ/gi, "дж")
       .replace(/d[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ʐ/gi, "дж")
       .replace(/d[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*з[ʲ\u02B2'’]?/gi, "дз")
       .replace(/d[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ж/gi, "дж")
       .replace(/д[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*з[ʲ\u02B2'’]?/gi, "дз")
       .replace(/д[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ж/gi, "дж")
       .replace(/t[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*s[ʲ\u02B2'’]?/gi, "ц")
       .replace(/t[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ʃ/gi, "ч")
       .replace(/t[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ʂ/gi, "ч")
       .replace(/t[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ц[ʲ\u02B2'’]?/gi, "ц")
       .replace(/t[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ч/gi, "ч")
       .replace(/т[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*с[ʲ\u02B2'’]?/gi, "ц")
       .replace(/т[͡\u0361\u035F\u035C\u0331\u0332_‿⁀⁔-]*ч/gi, "ч");

  // 2. IPA phonetic alphabet conversion
  const ipaMap: Record<string, string> = {
    "ɣ": "г", "ɦ": "г", "ɡ": "ґ", "g": "ґ",
    "ʐ": "ж", "ʒ": "ж", "ʂ": "ш", "ʃ": "ш",
    "ʋ": "в", "β": "в", "w": "ў", "u̯": "ў",
    "ɫ": "л", "l": "л", "ɱ": "м", "m": "м",
    "n": "н", "r": "р", "p": "п", "b": "б",
    "t": "т", "d": "д", "k": "к", "x": "х",
    "s": "с", "z": "з", "j": "й", "c": "ц",
    "ɔ": "о", "ɛ": "э", "ɨ": "ы", "ɪ": "ы",
    "ə": "а", "ɐ": "а", "a": "а", "e": "е",
    "i": "і", "o": "о", "u": "у"
  };
  for (const [k, v] of Object.entries(ipaMap)) {
    s = s.split(k).join(v);
  }

  // 3. Double consonants with colon or IPA length (г: -> гг, ц': -> цьць, ː, ˑ)
  s = s.replace(/([а-яёіўґ])['’ʹʼʻʲ]?[ːˑ:]/gi, (_, c) => `${c}ь${c}ь`);
  s = s.replace(/([а-яёіўґ])[ːˑ:]/gi, (_, c) => `${c}${c}`);
  s = s.replace(/ь+/g, "ь");

  // 4. Soft consonant + vowel: C'V -> C + iotated vowel (preserving combining accents on vowel!)
  s = s.replace(/(дз|дж|ц|[а-яёіўґ])[ь'’ʹʼʻʲ`]+([аАaA])([\u0301\u0300]?)/gi, "$1я$3");
  s = s.replace(/(дз|дж|ц|[а-яёіўґ])[ь'’ʹʼʻʲ`]+([уУuU])([\u0301\u0300]?)/gi, "$1ю$3");
  s = s.replace(/(дз|дж|ц|[а-яёіўґ])[ь'’ʹʼʻʲ`]+([оОoO])([\u0301\u0300]?)/gi, "$1ё$3");
  s = s.replace(/(дз|дж|ц|[а-яёіўґ])[ь'’ʹʼʻʲ`]+([эЭeE])([\u0301\u0300]?)/gi, "$1е$3");
  s = s.replace(/(дз|дж|ц|[а-яёіўґ])[ь'’ʹʼʻʲ`]+([іІiI])([\u0301\u0300]?)/gi, "$1і$3");
  s = s.replace(/(дз|дж|ц|[а-яёіўґ])[ь'’ʹʼʻʲ`]+([ыЫyY])([\u0301\u0300]?)/gi, "$1і$3");

  // Soft consonant before consonant or at word boundary / end of word -> use ь
  s = s.replace(/([а-яёіўґ])['’ʹʼʻʲ`]+(?=[^аеёіоуыэюя]|$)/gi, (_, c) => `${c}ь`);

  // Iotated initials/after vowels/ў: йа -> я, йэ -> е, йо -> ё, йу -> ю (preserving accent!)
  s = s.replace(/й([аеёоу])([\u0301\u0300]?)/gi, (match, vowel, accent) => {
    const mapV: Record<string, string> = { "а": "я", "э": "е", "о": "ё", "у": "ю" };
    const vLow = vowel.toLowerCase();
    let newV = mapV[vLow] || vowel;
    if (match[0] === "Й") newV = newV.toUpperCase();
    return newV + (accent || "");
  });

  // Strip remaining combining underties, bridges, low lines, macrons below
  s = s.replace(/[\u035F\u0331\u0332\u0333\u032A\u033A\u031E\u031F\u0320\u032F\u035C\u0361\u0306\u0304ˈˌ]/g, "");

  return s;
}

function prepareTextForSpeech(rawText: string, isPhonetic = false): string {
  if (!rawText) return "";

  // 1. Strip HTML tags (e.g. <font color="...">, <b>, <i>, <br>)
  let text = rawText.replace(/<[^>]*>/g, "").trim();

  // If text is phonetic or contains school transcription markers / IPA
  if (isPhonetic || /\[.*\]/.test(text) || text.includes("͡") || text.includes("':") || /([а-яёіўґ]):/.test(text) || /[\u035F\u0331\u0332\u032Aːˑˈ]/.test(text)) {
    text = phoneticToSpeechPronunciation(text);
  }

  // 2. Normalize pre-composed accented characters to combining character (NFD) so \u0301 is explicit
  try {
    text = text.normalize("NFD");
  } catch (e) {
    // Ignore normalization error if unsupported
  }

  // 3. Convert vowel + \u0301 (or \u0301 + vowel) to UPPERCASE VOWEL + \u0301
  // Belarusian vowels: а, е, ё, і, о, у, ы, э, ю, я
  const vowelAccentRegexAfter = /([аеёіоуыэюяАЕЁІОУЫЭЮЯ])[\u0301\u0300]/g;
  const vowelAccentRegexBefore = /[\u0301\u0300]([аеёіоуыэюяАЕЁІОУЫЭЮЯ])/g;

  text = text.replace(vowelAccentRegexAfter, (_, vowel) => vowel.toUpperCase() + "\u0301");
  text = text.replace(vowelAccentRegexBefore, (_, vowel) => vowel.toUpperCase() + "\u0301");

  // 4. Normalize back to NFC
  try {
    text = text.normalize("NFC");
  } catch (e) {
    // Ignore
  }

  // 5. Clean any underscores and technical symbols
  text = text.replace(/[\u035F\u0331\u0332\u0333\u032A\u033A\u031E\u031F\u0320\u032F\u035C\u0361\u0306\u0304ˈˌ]/g, "");
  text = text.replace(/[_＿‿⁀⁔\[\]\(\)\{\}\<\>\\\/|#^~*+=§\u200B\uFEFF]+/g, " ");
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

function getVoiceSpeakerRole(voiceName: string): string {
  const femaleVoices = ["Zephyr", "Kore", "Aoede"];
  const isFemale = femaleVoices.includes(voiceName);
  return isFemale ? "прафесійная беларуская дыктарка" : "прафесійны беларускі дыктар";
}

// Synthesize with retry
async function generateSpeechWithRetry(client: GoogleGenAI, prompt: string, voiceName: string, isBelG2P = false) {
  let attempts = 3;
  let lastError: any = null;

  while (attempts > 0) {
    try {
      console.log(`[TTS] Attempting speech synthesis for voice '${voiceName}', remaining attempts: ${attempts}`);
      const speakerRole = getVoiceSpeakerRole(voiceName);
      const ttsPrompt = isBelG2P
        ? `Ты — ${voiceName}, ${speakerRole}. Агучвай гэтую беларускую фанетычную транскрыпцыю чыстай літаратурнай беларускай мовай з натуральнай фанетыкай без украінскага ці рускага вымаўлення:
${prompt}`
        : `Ты — ${voiceName}, ${speakerRole}. Агучвай гэты тэкст чыстай літаратурнай беларускай мовай з натуральнай фанетыкай без украінскага ці рускага вымаўлення:
${prompt}`;
      const response = await client.models.generateContent({
        model: "gemini-3.8-flash-lite-tts",
        contents: [{ parts: [{ text: ttsPrompt }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: voiceName,
              },
            },
          },
        },
      });
      const part = response.candidates?.[0]?.content?.parts?.[0];
      const base64Audio = part?.inlineData?.data;
      if (base64Audio) {
        return base64Audio;
      }
      throw new Error("No audio payload returned from Gemini TTS model");
    } catch (err: any) {
      lastError = err;
      const errMsg = err.message || "";
      console.warn(`[TTS Warning] Error during synthesis:`, errMsg);

      // If voice name is invalid (e.g. unknown speaker), do not retry
      if (
        errMsg.includes("No matching speaker voice") || 
        errMsg.includes("INVALID_ARGUMENT") || 
        errMsg.includes("speaker voice")
      ) {
        throw err;
      }

      // If it is a quota or rate limit error, do not retry
      if (
        errMsg.includes("Quota exceeded") || 
        errMsg.includes("quota") || 
        errMsg.includes("RESOURCE_EXHAUSTED") || 
        errMsg.includes("limit") ||
        errMsg.includes("429")
      ) {
        throw new Error("Дасягнуты ліміт карыстання (Quota Exceeded) для мадэлі TTS. Тэкст будзе агучвацца з дапамогай лакальнага браўзернага сінтэзу.");
      }

      const isTransient = errMsg.includes("503") || 
                          errMsg.includes("UNAVAILABLE") || 
                          errMsg.includes("temporary") ||
                          errMsg.includes("high demand") ||
                          err.status === "UNAVAILABLE" || 
                          err.statusCode === 503;

      if (isTransient) {
        attempts--;
        if (attempts > 0) {
          const delay = (4 - attempts) * 1000;
          console.log(`[TTS] Transient error. Waiting ${delay}ms before retrying...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      break;
    }
  }
  throw lastError || new Error("Failed to synthesize speech");
}

/**
 * Map header voice selections to Microsoft Edge Belarusian Neural voices
 * - котка (Zephyr, Kore) -> be-BY-SviatlanaNeural
 * - мастацкі (Puck) -> be-BY-SviatlanaNeural
 * - сабака (Charon, Fenrir) -> be-BY-MikalaiNeural
 */
function getEdgeVoiceForGeminiVoice(voiceName: string): string {
  switch (voiceName) {
    case "Charon":
    case "Fenrir":
      return "be-BY-MikalaiNeural"; // сабака -> Мікалай
    case "BelG2P":
      return "be-BY-SviatlanaNeural"; // BelG2P фанетычны канвертар -> Святлана
    case "Zephyr":
    case "Kore":
    case "Puck":
    default:
      return "be-BY-SviatlanaNeural"; // котка, мастацкі -> Святлана
  }
}

async function generateSpeechWithEdgeTTS(prompt: string, edgeVoiceName: string): Promise<Buffer> {
  console.log(`[Edge TTS] Synthesizing speech via Microsoft Edge Neural Voice '${edgeVoiceName}'...`);
  const tts = new MsEdgeTTS();
  await tts.setMetadata(edgeVoiceName, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(prompt);

  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { tts.close(); } catch (_) {}
      reject(new Error("Edge TTS timeout after 15 seconds"));
    }, 15000);

    audioStream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    audioStream.on("end", () => {
      clearTimeout(timeout);
      try { tts.close(); } catch (_) {}
      const audioBuffer = Buffer.concat(chunks);
      if (audioBuffer.length === 0) {
        reject(new Error("Edge TTS returned empty audio payload"));
      } else {
        console.log(`[Edge TTS] Successfully synthesized ${audioBuffer.length} bytes of MP3 audio`);
        resolve(audioBuffer);
      }
    });
    audioStream.on("error", (err) => {
      clearTimeout(timeout);
      try { tts.close(); } catch (_) {}
      if (chunks.length > 0) {
        const audioBuffer = Buffer.concat(chunks);
        console.log(`[Edge TTS] Recovered ${audioBuffer.length} bytes of audio despite notice: ${err?.message}`);
        resolve(audioBuffer);
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Сінтэз голасу Алесь праз афіцыйны API лабараторыі распазнавання і сінтэзу маўлення АІПІ НАН Беларусі (Corpus.by / SSRLab)
 * https://corpus.by/TextToSpeechBelarusianPy/
 */
async function synthesizeAlesVoice(rawText: string): Promise<Buffer> {
  const normalizedText = normalizeBelarusianNumbersInText(rawText);
  const cleanText = normalizedText.replace(/<[^>]*>/g, "").replace(/\{[^}]*\}/g, "").trim();
  if (!cleanText) {
    throw new Error("Пусты тэкст для сінтэзу");
  }

  const response = await fetch("https://ml1.ssrlab.by/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: cleanText,
      voice_type: "ales",
      language: "be",
    }),
  });

  if (!response.ok) {
    throw new Error(`Памылка сэрвісу сінтэзу TTS Алесь (HTTP ${response.status})`);
  }

  const data = await response.json();
  let audioUrl = typeof data === "string" ? data : (data?.audio || data?.url);
  if (!audioUrl || typeof audioUrl !== "string") {
    throw new Error("Не атрыманы адрас аўдыёфайла ад TTS Алесь");
  }

  if (audioUrl.startsWith("http://")) {
    audioUrl = audioUrl.replace("http://", "https://");
  }

  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) {
    throw new Error(`Памылка спампоўвання аўдыё TTS Алесь (${audioRes.status})`);
  }

  const arrayBuf = await audioRes.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function synthesizeBelG2PVoice(rawText: string): Promise<Buffer> {
  // Нармалізуем усе лічбы і лічэбнікі (напр. 2024 годзе, 1 верасня, 5, 100) у беларускія словы
  const normalizedText = normalizeBelarusianNumbersInText(rawText);

  // Перадаем беларускія націскі ў TTS:
  // Калі тэкст ужо мае націскі або з'яўляецца фанетычнай транскрыпцыяй, захоўваем іх.
  // Калі націскаў яшчэ няма, аўтаматычна прастаўляем аўтэнтычныя беларускія націскі праз GrammarDB (2.38M слоў).
  let textWithStress = normalizedText;
  const isPhoneticInput = /\[.*\]/.test(normalizedText) || 
                         /[\u0361\u035F\u035C\u0331\u0332_‿ːˑ]/.test(normalizedText) || 
                         /([а-яёіўґ])['’]:/.test(normalizedText) || 
                         /[ɣɦɡʐʒʂʃʋβwɫɱɔɛɨɪəɐ]/.test(normalizedText) ||
                         /['’ʹʼʻʲ`][аеёіоуыэюяАЕЁІОУЫЭЮЯ]/i.test(normalizedText);

  if (!isPhoneticInput) {
    try {
      const hasStress = /[\u0300\u0301]/.test(normalizedText);
      if (!hasStress && /[а-яёіўґ]/i.test(normalizedText)) {
        const status = getGrammarDbStatus();
        if (!status.ready) {
          await ensureGrammarDbReady();
        }
        textWithStress = await stressTextWithGrammarDb(normalizedText);
      }
      // Забяспечваем націск для аднаскладовых слоў (Дзе?, Не!, ты, хто),
      // якія ў слоўніках часта ідуць без знака націску
      textWithStress = addStressToSingleVowelWords(textWithStress);
    } catch (stressErr) {
      console.warn("[BelG2P TTS] Auto-stress via GrammarDB fallback:", stressErr);
      textWithStress = addStressToSingleVowelWords(normalizedText);
    }
  }

  const phoneticText = belarusianToPhoneticTTS(textWithStress);
  const chunks = splitTextIntoTTSChunks(phoneticText, 150);
  const audioBuffers: Buffer[] = [];

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    let success = false;
    // uk provides native fricative [ɦ/ɣ], hard [ч], [ш], [ж], bilabial [w] for 'ў', and affricates [дз]/[ць]
    // Для слоў з коранем сфер- (сферы, сфера, атмасфера) ru мадэль гарантуе мяккі [fʲe] і цвёрды [rɨ] без паўз і спаўзанняў
    const langsToTry = /сфер|сфєр|атмасфер/i.test(trimmed) ? ["ru", "uk"] : ["uk", "ru"];
    for (const lang of langsToTry) {
      try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(trimmed)}&tl=${lang}&total=1&idx=0&textlen=${trimmed.length}&client=tw-ob&prev=input`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://translate.google.com/"
          }
        });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          audioBuffers.push(Buffer.from(buf));
          success = true;
          break;
        }
      } catch (e) {
        // Retry next lang
      }
    }
    if (!success) {
      throw new Error("Не ўдалося сфарміраваць аўдыё сінтэзу");
    }
  }

  return Buffer.concat(audioBuffers);
}

// Synthesize single line voiceover (Primary: TTS Алесь, BelG2P TTS Маруся, or Gemini Studio TTS)
app.post("/api/synthesize", async (req, res) => {
  try {
    let { text, voiceName = "Ales" } = req.body;
    if (!text) {
      return res.status(400).json({ error: "No text specified for synthesis." });
    }

    // Supported Gemini TTS voices; any unknown/obsolete voices safely fallback to Ales
    const VALID_GEMINI_VOICES = ["Zephyr", "Kore", "Puck", "Charon", "Fenrir"];
    const requestedVoice = typeof voiceName === "string" ? voiceName.trim() : "Ales";
    const rawText = String(text || "").replace(/<[^>]*>/g, "").trim();

    // 1. TTS Алесь (Corpus.by / SSRLab API - https://corpus.by/TextToSpeechBelarusianPy/)
    if (requestedVoice === "Ales") {
      try {
        const mp3Buffer = await synthesizeAlesVoice(rawText);
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(mp3Buffer);
      } catch (alesErr: any) {
        console.error("[TTS Алесь error]:", alesErr);
        console.warn("[TTS Ales Fallback] Falling back to TTS Маруся (BelG2P)");
        try {
          const mp3Buffer = await synthesizeBelG2PVoice(rawText);
          res.setHeader("Content-Type", "audio/mpeg");
          return res.send(mp3Buffer);
        } catch (fbErr) {
          throw alesErr;
        }
      }
    }

    // 2. BelG2P (TTS Маруся)
    if (requestedVoice === "BelG2P") {
      try {
        const mp3Buffer = await synthesizeBelG2PVoice(rawText);
        res.setHeader("Content-Type", "audio/mpeg");
        return res.send(mp3Buffer);
      } catch (synthErr: any) {
        console.error("[BelG2P TTS error]:", synthErr);
        throw synthErr;
      }
    }

    // 3. Gemini AI voices (Zephyr, Kore, Puck, Charon, Fenrir)
    const isGeminiVoice = VALID_GEMINI_VOICES.includes(requestedVoice);
    const effectiveVoice = isGeminiVoice ? requestedVoice : "Ales";
    const isPhonetic = /\[.*\]/.test(rawText) || rawText.includes("͡") || rawText.includes("':");
    const textToSpeech = prepareTextForSpeech(rawText, isPhonetic);

    try {
      const client = getAiClientForRequest(req);
      const base64Audio = await generateSpeechWithRetry(client, textToSpeech, effectiveVoice, false);
      const pcmBuffer = Buffer.from(base64Audio, "base64");
      const wavBuffer = addWavHeader(pcmBuffer, 24000);

      res.setHeader("Content-Type", "audio/wav");
      return res.send(wavBuffer);
    } catch (geminiErr: any) {
      const errMsg = geminiErr.message || "";
      const isQuota = errMsg.includes("Quota") || errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED") || errMsg.includes("ліміт");

      if (isQuota) {
        console.warn(`[Gemini TTS Quota] ${effectiveVoice} exceeded quota limit.`);
        return res.status(429).json({
          error: "Дасягнуты ліміт квоты для мадэлі Gemini AI (429 Quota Exceeded). Выберыце 'TTS Алесь' або 'TTS Маруся' у верхнім меню для неабмежаванага агучвання.",
          isGeminiQuota: true
        });
      }

      // If invalid voice or missing speaker voice error happens, smoothly fallback to Ales or BelG2P
      if (
        errMsg.includes("No matching speaker voice") || 
        errMsg.includes("INVALID_ARGUMENT") || 
        errMsg.includes("speaker voice")
      ) {
        console.warn(`[TTS Warning] Gemini speaker error (${errMsg}), seamlessly falling back to Ales`);
        try {
          const mp3Buffer = await synthesizeAlesVoice(rawText);
          res.setHeader("Content-Type", "audio/mpeg");
          return res.send(mp3Buffer);
        } catch (fallbackErr) {
          console.error("[Ales fallback error]:", fallbackErr);
          try {
            const mp3Buffer = await synthesizeBelG2PVoice(rawText);
            res.setHeader("Content-Type", "audio/mpeg");
            return res.send(mp3Buffer);
          } catch (belFallbackErr) {
            console.error("[BelG2P fallback error]:", belFallbackErr);
          }
        }
      }

      throw geminiErr;
    }
  } catch (err: any) {
    console.error("TTS Synthesis error:", err);
    res.status(500).json({ error: getFriendlyErrorMessage(err) });
  }
});

// Chunked Upload Endpoint for transcription (direct offset writing to eliminate reassembly overhead & double disk usage)
app.post("/api/transcribe/chunk", express.raw({ type: "*/*", limit: "20mb" }), async (req, res) => {
  try {
    const uploadId = req.headers["x-upload-id"] as string;
    const chunkIndexStr = req.headers["x-chunk-index"] as string;
    const totalChunksStr = req.headers["x-total-chunks"] as string;
    const encodedFileName = req.headers["x-file-name"] as string;
    const chunkOffsetStr = req.headers["x-chunk-offset"] as string;

    if (!uploadId || !chunkIndexStr || !totalChunksStr) {
      return res.status(400).json({ error: "Missing chunk metadata headers" });
    }

    const chunkIndex = parseInt(chunkIndexStr, 10);
    const totalChunks = parseInt(totalChunksStr, 10);
    const fileName = decodeURIComponent(encodedFileName || "file");

    const uploadDir = path.join("/tmp", "uploads", uploadId);
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    if (!Buffer.isBuffer(req.body)) {
      return res.status(400).json({ error: "Invalid chunk data format" });
    }

    const finalFilePath = path.join(uploadDir, fileName);
    const offset = chunkOffsetStr ? parseInt(chunkOffsetStr, 10) : chunkIndex * (10 * 1024 * 1024);

    // Write chunk directly into finalFilePath at its offset
    const fd = fs.openSync(finalFilePath, fs.existsSync(finalFilePath) ? "r+" : "w");
    fs.writeSync(fd, req.body, 0, req.body.length, offset);
    fs.closeSync(fd);

    console.log(`[Transcribe Chunk] Direct written chunk ${chunkIndex + 1}/${totalChunks} (${req.body.length} bytes at offset ${offset}) for ${uploadId}`);

    res.json({ success: true, chunk: chunkIndex });
  } catch (err: any) {
    console.error("[Transcribe Chunk] Error processing chunk:", err);
    res.status(500).json({ error: err.message || "Failed to process chunk" });
  }
});

function getProperMimeType(filePath: string, reqMimeType?: string): string {
  if (reqMimeType && reqMimeType !== "application/octet-stream" && reqMimeType !== "binary/octet-stream" && reqMimeType.includes("/") && !reqMimeType.toLowerCase().includes("aac")) {
    return reqMimeType;
  }
  const ext = path.extname(filePath).toLowerCase().replace('.', '');
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'mkv': return 'video/x-matroska';
    case 'webm': return 'video/webm';
    case 'mov': return 'video/quicktime';
    case 'avi': return 'video/x-msvideo';
    case '3gp': return 'video/3gpp';
    case 'm4v': return 'video/mp4';
    case 'flv': return 'video/x-flv';
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'm4a': return 'audio/mp4';
    case 'aac': return 'audio/aac';
    case 'ogg': return 'audio/ogg';
    case 'flac': return 'audio/flac';
    default: return 'video/mp4';
  }
}

// Helper function to upload and transcribe a single file or segment with Gemini API
async function transcribeSingleFileWithGemini(
  client: GoogleGenAI,
  filePath: string,
  mimeType: string,
  isSegment: boolean,
  startPercent: number = 20,
  endPercent: number = 90,
  onProgress?: (msg: string, pct: number) => void,
  targetLang?: string,
  segDurationSec?: number
): Promise<string> {
  let uploadPath = filePath;
  let uploadMime = "audio/wav";
  let tempCleanWavPath: string | null = null;

  // Always pre-convert non-WAV files or AAC streams to clean 16kHz mono PCM WAV to guarantee 100% Gemini API compatibility
  const isWavFile = filePath.toLowerCase().endsWith(".wav") && fs.existsSync(filePath) && fs.statSync(filePath).size > 1000;
  if (!isWavFile) {
    tempCleanWavPath = path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}_gemini_clean.wav`);
    console.log(`[Transcribe Gemini] Pre-converting input file (${path.basename(filePath)}) to clean 16kHz WAV for Gemini API...`);
    try {
      await execFilePromise("ffmpeg", [
        "-analyzeduration", "50000000",
        "-probesize", "50000000",
        "-i", filePath,
        "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
        tempCleanWavPath, "-y"
      ], { maxBuffer: 1024 * 1024 * 50 });

      if (fs.existsSync(tempCleanWavPath) && fs.statSync(tempCleanWavPath).size > 100) {
        uploadPath = tempCleanWavPath;
        uploadMime = "audio/wav";
        console.log(`[Transcribe Gemini] Clean WAV created for upload: ${tempCleanWavPath} (${fs.statSync(tempCleanWavPath).size} bytes)`);
      }
    } catch (convErr: any) {
      console.warn(`[Transcribe Gemini] Pre-conversion to WAV failed:`, convErr?.message || convErr);
      // Fallback rescue pass with max_error_rate
      try {
        await execFilePromise("ffmpeg", [
          "-analyzeduration", "50000000",
          "-probesize", "50000000",
          "-err_detect", "ignore_err",
          "-fflags", "+discardcorrupt",
          "-max_error_rate", "1.0",
          "-i", filePath,
          "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
          tempCleanWavPath, "-y"
        ], { maxBuffer: 1024 * 1024 * 50 });
        if (fs.existsSync(tempCleanWavPath) && fs.statSync(tempCleanWavPath).size > 100) {
          uploadPath = tempCleanWavPath;
          uploadMime = "audio/wav";
          console.log(`[Transcribe Gemini] Raw AAC rescue pass created clean WAV: ${tempCleanWavPath}`);
        }
      } catch (rescueErr: any) {
        console.warn(`[Transcribe Gemini] Raw AAC rescue pass failed:`, rescueErr?.message || rescueErr);
      }
    }
  } else {
    uploadMime = "audio/wav";
  }

  const fileName = path.basename(uploadPath);
  const fileSize = fs.existsSync(uploadPath) ? fs.statSync(uploadPath).size : 0;
  console.log(`[Transcribe Gemini] Uploading file to Gemini Files API: ${fileName} (${fileSize} bytes, mime: ${uploadMime})`);

  onProgress?.("Загрузка аўдыя ў Gemini Files API...", startPercent + 2);

  let uploadRes: any = null;
  for (let uploadAttempt = 1; uploadAttempt <= 5; uploadAttempt++) {
    try {
      uploadRes = await client.files.upload({
        file: uploadPath,
        config: {
          mimeType: uploadMime,
          displayName: fileName
        }
      });
      break;
    } catch (uploadErr: any) {
      console.warn(`[Transcribe Gemini] Upload attempt ${uploadAttempt}/5 failed for ${fileName}:`, uploadErr?.message || uploadErr);
      if (uploadAttempt === 5) throw uploadErr;
      const waitTime = uploadAttempt * 3;
      onProgress?.(`Перагрузка сервера пры загрузцы (503), паўтор праз ${waitTime}с (${uploadAttempt}/5)...`, startPercent + 2);
      await new Promise(r => setTimeout(r, waitTime * 1000));
    }
  }

  let activeFile = uploadRes;
  let fileState = activeFile.state;
  let attempts = 0;

  try {
    while (fileState === FileState.PROCESSING && attempts < 120) {
      attempts++;
      const currentWaitPct = Math.min(startPercent + 15, startPercent + 5 + Math.floor(attempts / 2));
      onProgress?.(`Апрацоўка аўдыя Gemini API (${attempts * 2}с)...`, currentWaitPct);
      console.log(`[Transcribe Gemini] ${fileName} is PROCESSING, waiting 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        activeFile = await client.files.get({ name: uploadRes.name! });
        fileState = activeFile.state;
      } catch (pollErr: any) {
        console.warn(`[Transcribe Gemini] File polling attempt failed for ${fileName}:`, pollErr?.message || pollErr);
        // Continue loop to retry polling
      }
    }

    if (fileState === FileState.FAILED) {
      throw new Error(`Файл ${fileName} не прайшоў апрацоўку Gemini API.`);
    }

    const langInstruction = targetLang && targetLang !== "auto"
      ? `The audio spoken language is expected to be: "${targetLang}". Transcribe the spoken text verbatim in "${targetLang}" without any translation.`
      : `Detect the spoken audio language automatically and transcribe the spoken text verbatim in its ORIGINAL spoken language (e.g. Belarusian, Russian, English, Polish, etc.). ABSOLUTELY DO NOT TRANSLATE into any other language.`;

    const systemInstruction = `You are an ultra-precise speech transcriber and audio timeline aligner.
Your sole job is to transcribe human speech from the provided audio file into standard SubRip (.srt) subtitle format with frame-accurate timestamp alignment.

CRITICAL COMPREHENSIVE TRANSCRIBING MANDATE:
- Transcribe EVERY SINGLE WORD spoken by all speakers/actors.
- Do NOT summarize, compress, skip, or condense dialogue under any circumstances.
- Create dense subtitle blocks for every short phrase spoken (every 2 to 5 seconds). A 2-hour movie must contain hundreds or thousands of complete subtitle blocks.

STRICT TIMING & TIMESTAMP ACCURACY RULES:
1. AUDIO CLOCK ALIGNMENT:
   - Timestamps MUST strictly reflect the exact elapsed timeline clock of the audio file starting from 00:00:00,000.
   - Do NOT shift or predict timestamps earlier!
   - If there is initial silence, intro music, sound effects, or video logo before the first spoken sentence (e.g. 3, 5, or 10 seconds of intro silence/music), DO NOT start subtitle block 1 at 00:00:00 or 00:00:01!
   - Subtitle block 1 MUST start at the exact second (HH:MM:SS,mmm) when the speaker utters the very first word. For example, if speech starts at 00:00:05.400, block 1 start timestamp MUST be 00:00:05,400.

2. SEGMENTATION & SYNCHRONIZATION:
   - Break subtitles into short natural spoken phrases (3 to 8 words per block).
   - End timestamp (HH:MM:SS,mmm) for each block must be the exact moment the speaker finishes speaking that phrase.
   - Leave clean timing gaps during periods of silence, pause, or background music.

3. ORIGINAL SPOKEN LANGUAGE MANDATE (CRITICAL - NO TRANSLATION):
   - ${langInstruction}
   - If the speech in the audio is in Russian, output Russian text in Cyrillic.
   - If the speech in the audio is in Belarusian, output Belarusian text in Cyrillic.
   - If the speech in the audio is in English, output English text.
   - DO NOT translate Russian, English, or any other language into Belarusian during transcription. Translation is a separate step performed only when requested by the user.

4. OUTPUT FORMAT & STRUCTURE:
   - Output ONLY raw valid SubRip (.srt) text starting with sequential block 1.
   - ALWAYS separate every subtitle block with a BLANK LINE (double newline).
   - Format each block strictly as:
1
00:00:00,000 --> 00:00:02,500
[Subtitle text]

2
00:00:02,500 --> 00:00:05,000
[Next subtitle text]

   - DO NOT place text or lyrics before the first timestamp block.
   - Do NOT wrap in markdown code blocks (\`\`\`srt). Do NOT add extra conversational commentary.${(segDurationSec && segDurationSec > 0) ? `\n\nCRITICAL DURATION BOUNDS FOR THIS AUDIO CHUNK:
- This audio file has an EXACT duration of ${segDurationSec.toFixed(3)} seconds (${secondsToSrtTime(segDurationSec)}).
- ALL start and end timestamps in your generated SubRip output MUST fall strictly between 00:00:00,000 and ${secondsToSrtTime(segDurationSec)}.
- Under ABSOLUTELY NO CIRCUMSTANCES may any start or end timestamp exceed ${secondsToSrtTime(segDurationSec)}!
- IMMEDIATELY terminate each subtitle card when speech stops (within 0.2 to 0.4 seconds of the final spoken word).
- NEVER stretch or keep a subtitle block open across silence, instrumental music, or background pauses. If speech ends at 00:00:23,837, the card end timestamp MUST be 00:00:23,837, NOT stretched to 00:01:00 or beyond!
- Transcribe ONLY the audible speech present in this specific audio segment. Do NOT hallucinate, guess, or copy timestamps from any external or uncut version.` : ''}`;

    let transcribeResponse: any = null;
    const allModels = await getDynamicModels(client);

    // Filter models to valid supported Gemini models ordered newest to oldest
    let transcribeModels = allModels.filter(m =>
      !m.includes("image") && !m.includes("tts") && !m.includes("live") && !m.includes("pro")
    );
    if (transcribeModels.length === 0) {
      transcribeModels = [...DEFAULT_FALLBACK_MODELS];
    }

    let currentPercent = Math.max(startPercent + 15, Math.floor((startPercent + endPercent) / 2));

    const maxTimeStr = (segDurationSec && segDurationSec > 0) ? secondsToSrtTime(segDurationSec) : null;
    const userPromptText = (segDurationSec && segDurationSec > 0 && maxTimeStr)
      ? `Transcribe all audible speech from this ${segDurationSec.toFixed(1)}s audio file into SubRip (.srt) format. Ensure timestamps strictly reflect when words are spoken, closing each card as soon as speech stops, and never exceeding ${maxTimeStr}.`
      : "Transcribe speech into SubRip (.srt) format. Ensure exact timestamp alignment with the audio playback clock as instructed.";

    for (const model of transcribeModels) {
      let tries = 5;
      while (tries > 0) {
        try {
          console.log(`[Transcribe Gemini] Attempting ${fileName} with model ${model}, remaining tries: ${tries}`);
          onProgress?.(`Аналіз аўдыя і генерацыя субцітраў з ${model} (${currentPercent}%)...`, currentPercent);

          const callPromise = client.models.generateContent({
            model: model,
            contents: [
              {
                fileData: {
                  fileUri: activeFile.uri!,
                  mimeType: activeFile.mimeType!
                }
              },
              userPromptText
            ],
            config: {
              systemInstruction: systemInstruction,
              temperature: 0.0,
              maxOutputTokens: 16384
            }
          });

          // 240s timeout per call so long generations complete reliably
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Час чакання адказу ад мадэлі ${model} выйшаў (240с)`)), 240000)
          );

          // Progress ticker to incrementally advance percent while model is processing
          const tickInterval = setInterval(() => {
            if (currentPercent < endPercent - 2) {
              currentPercent += 2;
              onProgress?.(`Генерацыя субцітраў і таймкодаў з Gemini (${currentPercent}%)...`, currentPercent);
            }
          }, 3000);

          let response: any = null;
          try {
            response = await Promise.race([callPromise, timeoutPromise]);
          } finally {
            clearInterval(tickInterval);
          }

          if (response && response.text) {
            transcribeResponse = response;
            break;
          }
          throw new Error("Empty transcription returned from model");
        } catch (err: any) {
          const errMsg = typeof err === 'object' ? (err.message || JSON.stringify(err)) : String(err);

          if (errMsg.includes("404") || errMsg.includes("NOT_FOUND")) {
            console.warn(`[Transcribe Gemini] Model ${model} not found on ${fileName}`);
            markModelAsUnavailable(model);
            break;
          }

          const isRateLimit =
            errMsg.includes("429") ||
            errMsg.includes("RESOURCE_EXHAUSTED") ||
            errMsg.includes("Quota exceeded") ||
            errMsg.includes("quota") ||
            errMsg.includes("generate_content_free_tier_requests") ||
            err.statusCode === 429;

          if (isRateLimit) {
            markModelQuotaExhausted(model);

            // Parse exact retry delay from Google API error message if available
            let waitSec = 12;
            const retryMatch = errMsg.match(/retry in ([0-9.]+)\s*s/i) || errMsg.match(/retryDelay"?:\s*"?([0-9.]+)\s*s?/i);
            if (retryMatch && retryMatch[1]) {
              waitSec = Math.ceil(parseFloat(retryMatch[1])) + 2;
            }

            const isHardQuotaExceeded =
              errMsg.includes("Quota exceeded") ||
              errMsg.includes("RESOURCE_EXHAUSTED") ||
              errMsg.includes("generate_content_free_tier_requests") ||
              errMsg.includes("limit:") ||
              waitSec > 15;

            if (isHardQuotaExceeded) {
              console.log(`[Transcribe Gemini] Model ${model} exceeded quota. Switching immediately to next fallback model...`);
              onProgress?.(`Абмежаванне квоты для ${model}, пераключэнне на наступную мадэль...`, currentPercent);
              break; // Break out of tries loop immediately to use next model
            }

            // Short rate limit wait
            waitSec = Math.min(10, Math.max(3, waitSec));
            console.log(`[Transcribe Gemini] Rate limit hit on ${model}. Waiting ${waitSec}s...`);
            onProgress?.(`Абмежаванне квоты API, чаканне ${waitSec}с...`, currentPercent);
            await new Promise((r) => setTimeout(r, waitSec * 1000));

            tries = Math.min(tries - 1, 2);
            if (tries <= 0) break;
            continue;
          }

          const isTransient =
            errMsg.includes("503") ||
            errMsg.includes("UNAVAILABLE") ||
            errMsg.includes("Service Unavailable") ||
            errMsg.includes("ServiceUnavailable") ||
            errMsg.includes("high demand") ||
            errMsg.includes("timed out") ||
            errMsg.includes("выйшаў") ||
            err.statusCode === 503;

          if (isTransient) {
            markModelTemporaryUnavailable(model, "503 high demand (overload)");
            const retryWait = Math.min(12, 3 + (5 - tries) * 3);
            console.log(`[Transcribe Gemini] Model ${model} busy/unavailable (503). Retrying in ${retryWait}s... (tries left: ${tries - 1})`);
            onProgress?.(`Перагрузка сервера (503). Паўторны запыт праз ${retryWait}с...`, currentPercent);
            await new Promise((r) => setTimeout(r, retryWait * 1000));
            tries--;
            
            // If model is repeatedly busy (tries <= 2), switch to fallback model
            if (tries <= 2 && transcribeModels.length > 1 && transcribeModels[transcribeModels.length - 1] !== model) {
              console.log(`[Transcribe Gemini] Model ${model} repeatedly busy (503). Trying alternative fallback model...`);
              break;
            }
            if (tries <= 0) break;
            continue;
          }

          console.log(`[Transcribe Gemini] Model ${model} failed on ${fileName}, trying next fallback:`, errMsg);
          // For other unrecoverable errors, try next model
          break;
        }
      }
      if (transcribeResponse) break;
    }

    if (!transcribeResponse || !transcribeResponse.text) {
      console.warn(`[Transcribe Gemini] Empty response for ${fileName}`);
      return "";
    }

    onProgress?.("Апрацоўка і фарматаванне субцітраў...", endPercent);

    let srtText = transcribeResponse.text.trim();
    if (srtText.startsWith("```")) {
      srtText = srtText.replace(/^```[a-zA-Z]*\n?/, "");
      srtText = srtText.replace(/```$/, "");
      srtText = srtText.trim();
    }

    if (segDurationSec && segDurationSec > 0 && srtText) {
      const parsedItems = parseSrtString(srtText);
      if (parsedItems.length > 0) {
        const bounded = parsedItems
          .filter(item => item.startTimeSec < segDurationSec - 0.1)
          .map(item => ({
            ...item,
            endTimeSec: Math.min(item.endTimeSec, segDurationSec)
          }));
        if (bounded.length > 0) {
          const sanitized = sanitizeAndFixSrtTimings(bounded);
          srtText = sanitized
            .map((item, idx) => `${idx + 1}\n${secondsToSrtTime(item.startTimeSec)} --> ${secondsToSrtTime(item.endTimeSec)}\n${item.text}`)
            .join("\n\n");
        }
      }
    }

    return srtText;
  } finally {
    if (tempCleanWavPath && fs.existsSync(tempCleanWavPath)) {
      try {
        fs.unlinkSync(tempCleanWavPath);
      } catch (e) {
        console.error("[Transcribe Gemini] Error cleaning up temporary WAV file:", e);
      }
    }
    // Guaranteed deletion of remote file from Gemini API
    if (activeFile && activeFile.name) {
      try {
        await client.files.delete({ name: activeFile.name });
      } catch (e) {
        console.error("[Transcribe Gemini] Error deleting remote file:", e);
      }
    }
  }
}

async function transcribeInlineChunkWithGemini(
  client: any,
  chunkFilePath: string
): Promise<string> {
  if (!fs.existsSync(chunkFilePath)) return "";
  const fileBuffer = fs.readFileSync(chunkFilePath);
  const base64Audio = fileBuffer.toString("base64");

  const systemInstruction = `You are an expert speech transcriber and audio timeline aligner.
Your sole job is to transcribe all spoken dialogue from the provided audio segment into standard SubRip (.srt) subtitle format with precise frame-accurate timestamp alignment.

CRITICAL MANDATES:
1. ORIGINAL SPOKEN LANGUAGE MANDATE (CRITICAL - NO TRANSLATION):
   - Output language MUST be strictly the ORIGINAL language spoken in the audio segment (e.g. Belarusian, Russian, English, Polish, etc.).
   - ABSOLUTELY DO NOT TRANSLATE into Belarusian or any other language during transcription!
   - If the audio contains Russian speech, write Russian. If Belarusian, write Belarusian. If English, write English.
   - Preserve exact words and grammar spoken by the audio speakers.

2. EXTREME DENSITY & FULL COVERAGE:
   - Transcribe EVERY SINGLE SPOKEN PHRASE. Never skip, condense, or summarize lines.
   - Create short, readable subtitle blocks (3 to 6 words per block, 2 to 4 seconds long).
   - A 50-second audio chunk with continuous speech must produce 10 to 20 detailed subtitle blocks.

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

  const allModels = await getDynamicModels(client);
  let transcribeModels = allModels.filter(m =>
    (m === "gemini-3.8-flash" || m === "gemini-3.1-flash-lite" || m === "gemini-flash-latest" || m === "gemini-3.7-flash" || m === "gemini-3.6-flash" || m.includes("3.8") || m.includes("3.1-flash-lite") || m.includes("flash-latest") || m.includes("3.7") || m.includes("3.6")) &&
    !m.includes("image") && !m.includes("tts") && !m.includes("live") && !m.includes("pro")
  );
  if (transcribeModels.length === 0) {
    transcribeModels = ["gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.7-flash", "gemini-3.6-flash"];
  }

  for (const model of transcribeModels) {
    try {
      const response = await client.models.generateContent({
        model: model,
        contents: [
          {
            inlineData: {
              mimeType: "audio/wav",
              data: base64Audio
            }
          },
          "Транскрыбуй усе сказаныя фразы з гэтага аўдыясегменту ў фармат субцітраў SubRip (.srt) НА МОВЕ АРЫГІНАЛУ (без перакладу)."
        ],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.0,
          maxOutputTokens: 8192
        }
      });

      let srtText = response.text ? response.text.trim() : "";
      if (srtText.startsWith("```")) {
        srtText = srtText.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
      }
      if (srtText) return srtText;
    } catch (err: any) {
      console.warn(`[Transcribe Inline Chunk] Model ${model} chunk transcription warning:`, err?.message || err);
    }
  }

  return "";
}

// In-memory & disk-backed transcription jobs queue
interface TranscribeJob {
  id: string;
  status: "processing" | "completed" | "error";
  progressMessage: string;
  percent: number;
  srt?: string;
  error?: string;
  createdAt: number;
  uploadDir?: string;
  fileName?: string;
  mimeType?: string;
  engine?: string;
  language?: string;
  trackNumber?: number;
  trackLanguage?: string;
  trackTitle?: string;
  mkvTrackNumber?: number;
  apiKey?: string;
}

const transcribeJobs = new Map<string, TranscribeJob>();

const JOBS_DB_DIR = path.join("/tmp", "transcribe_jobs_db");
if (!fs.existsSync(JOBS_DB_DIR)) {
  try { fs.mkdirSync(JOBS_DB_DIR, { recursive: true }); } catch (_) {}
}

function saveJobToDisk(job: TranscribeJob) {
  try {
    const jobFile = path.join(JOBS_DB_DIR, `${job.id}.json`);
    fs.writeFileSync(jobFile, JSON.stringify(job), "utf-8");
  } catch (e) {
    console.warn(`[Job Disk Sync Warning ${job.id}] Failed to save job state to disk:`, e);
  }
}

function getJobState(jobId: string): TranscribeJob | undefined {
  let job = transcribeJobs.get(jobId);
  if (!job) {
    try {
      const jobFile = path.join(JOBS_DB_DIR, `${jobId}.json`);
      if (fs.existsSync(jobFile)) {
        const data = fs.readFileSync(jobFile, "utf-8");
        const parsed = JSON.parse(data);
        if (parsed && parsed.id) {
          job = parsed;
          transcribeJobs.set(jobId, parsed);
        }
      }
    } catch (e) {
      console.warn(`[Job Disk Load Warning ${jobId}] Failed to load job state:`, e);
    }
  }
  return job;
}

function initJobsDb() {
  if (!fs.existsSync(JOBS_DB_DIR)) {
    try { fs.mkdirSync(JOBS_DB_DIR, { recursive: true }); } catch (_) {}
    return;
  }
  try {
    const files = fs.readdirSync(JOBS_DB_DIR);
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(JOBS_DB_DIR, file);
        const data = fs.readFileSync(filePath, "utf-8");
        const job: TranscribeJob = JSON.parse(data);
        if (job && job.id) {
          if (job.status === "processing") {
            const hasUploadDir = job.uploadDir && fs.existsSync(job.uploadDir);
            if (hasUploadDir) {
              console.log(`[Jobs DB Init] Auto-resuming interrupted job ${job.id}...`);
              job.progressMessage = "Аднаўленне апрацоўкі пасля перазапуску сервера...";
              transcribeJobs.set(job.id, job);
              saveJobToDisk(job);

              setTimeout(() => {
                const client = job.apiKey 
                  ? getAiClientForRequest({ headers: { "x-gemini-api-key": job.apiKey } } as any) 
                  : getAiClient();
                runTranscribeTask(
                  job.id,
                  job.uploadDir!,
                  job.fileName || "media",
                  job.mimeType || "audio/wav",
                  client,
                  job.engine || "gemini",
                  job.language
                ).catch((err) => {
                  console.error(`[Resumed Job ${job.id}] Error:`, err);
                });
              }, 1500);
            } else {
              job.status = "error";
              job.error = "Працэс сервера быў перазапушчаны падчас апрацоўкі. Калі ласка, пачніце генерацыю субцітраў зноў.";
              saveJobToDisk(job);
              transcribeJobs.set(job.id, job);
            }
          } else {
            transcribeJobs.set(job.id, job);
          }
        }
      }
    }
  } catch (e) {
    console.warn("[Jobs DB Init Warning]", e);
  }
}
initJobsDb();

// Cleanup stale jobs older than 6 hours every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of transcribeJobs.entries()) {
    if (now - job.createdAt > 21600000) {
      transcribeJobs.delete(id);
      try {
        const jobFile = path.join(JOBS_DB_DIR, `${id}.json`);
        if (fs.existsSync(jobFile)) fs.unlinkSync(jobFile);
      } catch (_) {}
    }
  }
}, 1800000);

async function runTranscribeTask(
  jobId: string,
  uploadDir: string,
  fileName: string,
  mimeType: string,
  client: GoogleGenAI,
  engine: string = "gemini",
  language?: string,
  trackNumber?: number,
  trackLanguage?: string,
  trackTitle?: string,
  mkvTrackNumber?: number
) {
  const job = getJobState(jobId);
  if (!job) return;

  const updateProgress = (msg: string, pct: number) => {
    if (job.status === "processing") {
      job.progressMessage = msg;
      job.percent = Math.min(98, Math.max(job.percent, pct));
      saveJobToDisk(job);
    }
  };

  try {
    const finalFilePath = path.join(uploadDir, fileName);

    // If separate chunk files were uploaded (legacy/fallback), reassemble them
    if (!fs.existsSync(finalFilePath)) {
      updateProgress("Зборка загружаных частак файла...", 5);
      const files = fs.readdirSync(uploadDir);
      const chunkFiles = files
        .filter((f) => f.startsWith("chunk-"))
        .sort((a, b) => {
          const idxA = parseInt(a.split("-")[1], 10);
          const idxB = parseInt(b.split("-")[1], 10);
          return idxA - idxB;
        });

      if (chunkFiles.length === 0) {
        throw new Error("Не знойдзена файла для апрацоўкі");
      }

      const writeStream = fs.createWriteStream(finalFilePath);
      for (const chunkFile of chunkFiles) {
        const chunkPath = path.join(uploadDir, chunkFile);
        const chunkBuffer = fs.readFileSync(chunkPath);
        writeStream.write(chunkBuffer);
        fs.unlinkSync(chunkPath);
      }
      writeStream.end();

      await new Promise<void>((resolve, reject) => {
        writeStream.on("finish", () => resolve());
        writeStream.on("error", (err) => reject(err));
      });
    }

    const fileSizeMb = (fs.statSync(finalFilePath).size / (1024 * 1024)).toFixed(1);
    console.log(`[Transcribe Job ${jobId}] File size: ${fileSizeMb} MB, engine: ${engine}, trackNumber: ${trackNumber || 1}${trackLanguage ? ` (lang: ${trackLanguage})` : ''}`);

    if (job.status === "error") return;

    updateProgress("Вымярэнне працягласці медыя...", 10);
    const durationSec = await getMediaDurationInSeconds(finalFilePath);
    console.log(`[Transcribe Job ${jobId}] Total media duration: ${durationSec.toFixed(1)}s (${(durationSec / 60).toFixed(1)} min)`);

    let finalSrtText = "";

    const trackTag = trackNumber && trackNumber > 1 ? ` (дарожка #${trackNumber}${trackLanguage ? `, ${trackLanguage.toUpperCase()}` : ''})` : "";
    updateProgress(`Пераўтварэнне аўдыя ў чысты 16kHz WAV${trackTag}...`, 15);
    const extractedAudioPath = path.join(uploadDir, "extracted_audio.wav");
    let audioExtracted = await extractAudioWithFfmpeg(
      finalFilePath,
      extractedAudioPath,
      trackNumber,
      { language: trackLanguage, title: trackTitle, mkvTrackNumber }
    );

    if (!audioExtracted || !fs.existsSync(extractedAudioPath) || fs.statSync(extractedAudioPath).size < 100) {
      if (trackNumber && trackNumber > 1) {
        console.log(`[Transcribe Job ${jobId}] Initial audio extraction failed for track #${trackNumber}. Attempting strict raw audio re-encode...`);
        try {
          await execFilePromise("ffmpeg", [
            "-analyzeduration", "100000000",
            "-probesize", "100000000",
            "-err_detect", "ignore_err",
            "-fflags", "+discardcorrupt",
            "-max_error_rate", "1.0",
            "-i", finalFilePath,
            "-map", `0:a:${trackNumber - 1}`,
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
            extractedAudioPath, "-y"
          ], { maxBuffer: 1024 * 1024 * 50 });
          if (fs.existsSync(extractedAudioPath) && fs.statSync(extractedAudioPath).size > 100) {
            audioExtracted = true;
          }
        } catch (reErr: any) {
          console.warn(`[Transcribe Job ${jobId}] Strict track re-encode pass failed:`, reErr?.message || reErr);
        }
      } else {
        console.log(`[Transcribe Job ${jobId}] Initial audio extraction failed. Attempting fallback re-encode...`);
        try {
          await execFilePromise("ffmpeg", [
            "-analyzeduration", "50000000",
            "-probesize", "50000000",
            "-err_detect", "ignore_err",
            "-fflags", "+discardcorrupt",
            "-i", finalFilePath,
            "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
            extractedAudioPath, "-y"
          ], { maxBuffer: 1024 * 1024 * 50 });
          if (fs.existsSync(extractedAudioPath) && fs.statSync(extractedAudioPath).size > 100) {
            audioExtracted = true;
          }
        } catch (reErr: any) {
          console.warn(`[Transcribe Job ${jobId}] Fallback re-encode failed:`, reErr?.message || reErr);
        }
      }
    }

    if ((!audioExtracted || !fs.existsSync(extractedAudioPath) || fs.statSync(extractedAudioPath).size < 100) && trackNumber && trackNumber > 1) {
      throw new Error(`Не ўдалося выцягнуць аўдыядарожку #${trackNumber}${trackLanguage ? ` (${trackLanguage.toUpperCase()})` : ''} з медыяфайла. Праверце файл або загрузіце дарожку асобна.`);
    }

    const sourceAudioPath = audioExtracted && fs.existsSync(extractedAudioPath) && fs.statSync(extractedAudioPath).size > 100
      ? extractedAudioPath
      : finalFilePath;

    // Measure exact audio duration directly from the extracted WAV/source audio
    const extractedDurationSec = await getMediaDurationInSeconds(sourceAudioPath);
    const totalAudioDurationSec = extractedDurationSec > 0 ? extractedDurationSec : durationSec;
    console.log(`[Transcribe Job ${jobId}] Extracted audio exact duration: ${totalAudioDurationSec.toFixed(1)}s (${(totalAudioDurationSec / 60).toFixed(1)} min)`);

    // Intelligent silence chunking target: 45-55 seconds for frame-accurate subtitle synchronization.
    // Audio files <= 45s are processed in 1 chunk; longer files are split at natural silence points.
    const chunksDir = path.join(uploadDir, "audio_chunks");
    const targetChunkSec = totalAudioDurationSec <= 45 ? Math.ceil(totalAudioDurationSec) : 50;
    
    updateProgress("Аналіз аўдыя і нарэзка па цішыні на кавалкі...", 18);
    const segments = await segmentAudioBySilence(sourceAudioPath, chunksDir, totalAudioDurationSec, targetChunkSec, trackNumber);
    console.log(`[Transcribe Job ${jobId}] Created ${segments.length} segment(s) for transcription.`);

    const segmentResults: { srt: string; offsetSec: number; durationSec?: number }[] = [];

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const currentJobState = getJobState(jobId);
      if (currentJobState && currentJobState.status !== "processing") break;

      const segDur = seg.endSec - seg.startSec;
      const startPct = Math.min(92, 20 + Math.floor((i / segments.length) * 72));
      const endPct = Math.min(95, 20 + Math.floor(((i + 1) / segments.length) * 72));
      const minStart = Math.floor(seg.startSec / 60);
      const minEnd = Math.ceil(seg.endSec / 60);

      const segmentMsg = segments.length > 1
        ? `Апрацоўка кавалка ${i + 1} з ${segments.length} (${minStart}хв–${minEnd}хв)...`
        : "Аналіз аўдыя і генерацыя субцітраў...";

      updateProgress(segmentMsg, startPct);

      let segSrt = "";
      segSrt = await transcribeSingleFileWithGemini(client, seg.filePath, "audio/wav", segments.length > 1, startPct, endPct, updateProgress, language, segDur);
      if (!segSrt || !segSrt.trim()) {
        console.warn(`[Transcribe Job ${jobId}] Segment ${i + 1} returned empty result. Retrying segment in 3s...`);
        updateProgress(`Паўторная апрацоўка кавалка ${i + 1}...`, startPct);
        await new Promise((r) => setTimeout(r, 3000));
        segSrt = await transcribeSingleFileWithGemini(client, seg.filePath, "audio/wav", segments.length > 1, startPct, endPct, updateProgress, language, segDur);
      }

      if (segSrt && segSrt.trim()) {
        segmentResults.push({ srt: segSrt, offsetSec: seg.startSec, durationSec: segDur });
      }

      // Clean up segment WAV file immediately to save disk/RAM
      try {
        if (fs.existsSync(seg.filePath)) {
          fs.unlinkSync(seg.filePath);
        }
      } catch (_) {}
    }

    // Clean up temporary extracted WAV and chunks directory
    try {
      if (fs.existsSync(extractedAudioPath)) fs.unlinkSync(extractedAudioPath);
      if (fs.existsSync(chunksDir)) fs.rmSync(chunksDir, { recursive: true, force: true });
    } catch (_) {}

    if (segmentResults.length === 0) {
      throw new Error("Не ўдалося згенераваць субцітры з медыяфайла.");
    }

    // Combine all segment SRTs, automatically shifting timecodes by each segment's exact start offset, capped strictly by total audio duration
    finalSrtText = mergeAndShiftSrtSegments(segmentResults, totalAudioDurationSec);

    job.percent = 100;
    job.progressMessage = "Завяршэнне распазнавання!";
    job.srt = finalSrtText;
    job.status = "completed";
    saveJobToDisk(job);
    console.log(`[Transcribe Job ${jobId}] Successfully completed with exact timing alignment.`);
  } catch (err: any) {
    console.error(`[Transcribe Job ${jobId}] Error:`, err);
    job.status = "error";
    job.error = getFriendlyErrorMessage(err);
    saveJobToDisk(job);
  } finally {
    if (fs.existsSync(uploadDir)) {
      try {
        fs.rmSync(uploadDir, { recursive: true, force: true });
      } catch (e) {
        console.error(`[Transcribe Job ${jobId}] Cleanup error:`, e);
      }
    }
  }
}

// Return available transcription models (Gemini Flash API)
app.get("/api/transcribe/models", async (_req, res) => {
  try {
    const models = [
      { id: "gemini", label: "Gemini 2.5 Flash API (ШІ ад Google)" }
    ];
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: String(err) });
  }
});

// Finalize chunked upload, start async transcription job
app.post("/api/transcribe/finish", async (req, res) => {
  try {
    const { uploadId, fileName, mimeType, language, engine, trackNumber, trackLanguage, trackTitle, mkvTrackNumber } = req.body;
    if (!uploadId || !fileName) {
      return res.status(400).json({ error: "Missing uploadId or fileName" });
    }

    const uploadDir = path.join("/tmp", "uploads", uploadId);
    if (!fs.existsSync(uploadDir)) {
      return res.status(404).json({ error: "Upload directory not found" });
    }

    const jobId = uploadId;
    const jobTrackNum = trackNumber ? Number(trackNumber) : undefined;
    const job: TranscribeJob = {
      id: jobId,
      status: "processing",
      progressMessage: "Падрыхтоўка файла...",
      percent: 5,
      createdAt: Date.now(),
      uploadDir,
      fileName,
      mimeType,
      engine: engine || "gemini",
      language,
      trackNumber: jobTrackNum,
      trackLanguage: trackLanguage ? String(trackLanguage) : undefined,
      trackTitle: trackTitle ? String(trackTitle) : undefined,
      mkvTrackNumber: mkvTrackNumber ? Number(mkvTrackNumber) : undefined,
      apiKey: ((req?.headers?.["x-gemini-api-key"] as string) || (req?.headers?.["x-goog-api-key"] as string) || (req?.query?.gemini_key as string) || "").trim() || undefined
    };
    transcribeJobs.set(jobId, job);
    saveJobToDisk(job);

    const client = getAiClientForRequest(req);

    runTranscribeTask(
      jobId,
      uploadDir,
      fileName,
      mimeType,
      client,
      engine || "gemini",
      language,
      jobTrackNum,
      job.trackLanguage,
      job.trackTitle,
      job.mkvTrackNumber
    ).catch((err) => {
      console.error(`[Transcribe Job ${jobId}] Unhandled error:`, err);
      const existing = getJobState(jobId);
      if (existing) {
        existing.status = "error";
        existing.error = getFriendlyErrorMessage(err);
        saveJobToDisk(existing);
      }
    });

    res.json({ jobId, status: "processing" });
  } catch (err: any) {
    console.error("[Transcribe Finish] Error starting job:", err);
    res.status(500).json({ error: getFriendlyErrorMessage(err) });
  }
});

// Check transcription status
app.get("/api/transcribe/status/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = getJobState(jobId);
  if (!job) {
    return res.status(404).setHeader('Content-Type', 'application/json').json({ error: "Задача не знойдзена" });
  }
  res.setHeader('Content-Type', 'application/json');
  res.json({
    status: job.status,
    progressMessage: job.progressMessage,
    percent: job.percent,
    srt: job.srt,
    error: job.error
  });
});

// Cancel transcription job
app.post("/api/transcribe/cancel/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = getJobState(jobId);
  if (job) {
    job.status = "error";
    job.error = "Скасавана карыстальнікам";
    saveJobToDisk(job);
  }
  const uploadDir = path.join("/tmp", "uploads", jobId);
  if (fs.existsSync(uploadDir)) {
    try {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    } catch (e) {}
  }
  res.json({ success: true });
});



// High-performance server-side audio extraction & transcoding using native FFmpeg
const transcodeSessions = new Map<string, {
  filename: string;
  totalSize: number;
  codec: string;
  filePath: string;
  created: number;
  trackNumber?: number;
}>();

// Cleanup stale sessions (> 10 mins)
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of transcodeSessions.entries()) {
    if (now - session.created > 10 * 60 * 1000) {
      if (fs.existsSync(session.filePath)) {
        fs.unlink(session.filePath, () => {});
      }
      transcodeSessions.delete(id);
    }
  }
}, 60 * 1000);

// Chunked Upload Endpoints
app.post("/api/transcode-audio/start", (req, res) => {
  const { filename, totalSize, codec, trackNumber } = req.body || {};
  const codecHint = (codec || "").toString().toUpperCase();
  let ext = "bin";
  if (filename && typeof filename === "string" && filename.includes(".")) {
    const parsedExt = filename.split(".").pop()?.toLowerCase();
    if (parsedExt && parsedExt.length <= 5) ext = parsedExt;
  } else if (codecHint.includes("EAC3") || codecHint.includes("E-AC3")) ext = "eac3";
  else if (codecHint.includes("AC3") || codecHint.includes("AC-3")) ext = "ac3";
  else if (codecHint.includes("DTS")) ext = "dts";
  else if (codecHint.includes("AAC")) ext = "aac";
  else if (codecHint.includes("MP3")) ext = "mp3";

  const uploadId = "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `${uploadId}.${ext}`);

  fs.writeFileSync(filePath, Buffer.alloc(0));

  transcodeSessions.set(uploadId, {
    filename: filename || `audio.${ext}`,
    totalSize: Number(totalSize) || 0,
    codec: codec || "",
    trackNumber: Number(trackNumber) || undefined,
    filePath,
    created: Date.now()
  });

  res.json({ uploadId });
});

app.post("/api/transcode-audio/chunk", (req, res) => {
  const uploadId = (req.query.uploadId || "").toString();
  const session = transcodeSessions.get(uploadId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const writeStream = fs.createWriteStream(session.filePath, { flags: "a" });
  req.pipe(writeStream);

  writeStream.on("finish", () => {
    const currentSize = fs.existsSync(session.filePath) ? fs.statSync(session.filePath).size : 0;
    res.json({ received: currentSize });
  });

  writeStream.on("error", (err) => {
    console.error("[Transcode API] Chunk write error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to write chunk" });
  });
});

app.post("/api/transcode-audio/finish", async (req, res) => {
  req.setTimeout(0);
  res.setTimeout(0);

  const { uploadId, codec, trackNumber } = req.body || {};
  const session = transcodeSessions.get(uploadId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const inputPath = session.filePath;
  const outputPath = path.join(os.tmpdir(), `${uploadId}_out.m4a`);
  const codecHint = (codec || session.codec || "").toString().toUpperCase();
  const reqTrackNum = Number(trackNumber) || Number(session.trackNumber) || 1;
  const targetTrackIdx = Math.max(0, reqTrackNum - 1);

  const inputSize = fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0;
  console.log(`[Transcode API] Finishing chunked session ${uploadId}, file size: ${inputSize} bytes, codecHint: "${codecHint}", trackIdx: ${targetTrackIdx}`);

  if (inputSize === 0) {
    fs.unlink(inputPath, () => {});
    transcodeSessions.delete(uploadId);
    return res.status(400).json({ error: "Empty file" });
  }

  const tryFfmpeg = (inputFlags: string[] = [], filterArg?: string): Promise<boolean> => {
    return new Promise((resolve) => {
      const runFFmpeg = (stage: number) => {
        const downmixFilter = filterArg !== undefined ? filterArg : "";
        let mapSpec = `0:a:${targetTrackIdx}?`;
        if (stage === 1) mapSpec = `0:${targetTrackIdx + 1}?`;
        else if (stage === 2) mapSpec = "0:a?";

        const args = [
          "-y",
          "-fflags", "+genpts+igndts+discardcorrupt",
          "-avoid_negative_ts", "make_zero",
          "-err_detect", "ignore_err",
          ...inputFlags,
          "-i", inputPath,
          "-map", mapSpec,
          "-threads", "0",
          "-vn",
          "-sn",
          "-dn",
          ...(downmixFilter ? ["-af", downmixFilter] : []),
          "-c:a", "aac",
          "-b:a", "192k",
          "-ar", "44100",
          "-ac", "2",
          outputPath
        ];

        const ffmpegProc = spawn("ffmpeg", args);
        let completed = false;

        const timer = setTimeout(() => {
          if (!completed) {
            completed = true;
            console.warn(`[Transcode API] FFmpeg timed out, killing process...`);
            ffmpegProc.kill("SIGKILL");
            resolve(false);
          }
        }, 300000);

        let stderr = "";
        ffmpegProc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

        ffmpegProc.on("close", (code) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);

          if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 512) {
            resolve(true);
          } else if (stage < 2) {
            runFFmpeg(stage + 1);
          } else {
            console.warn(`[Transcode API] FFmpeg attempt failed with flags [${inputFlags.join(" ")}], filter [${filterArg}], code ${code}, stderr: ${stderr.slice(-300)}`);
            resolve(false);
          }
        });

        ffmpegProc.on("error", (err) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          console.warn("[Transcode API] FFmpeg spawn error:", err);
          resolve(false);
        });
      };

      runFFmpeg(0);
    });
  };

  const attemptConfigs: { flags: string[]; filter?: string }[] = [];

  // Attempt 1: Auto-detect format without forced input flags or complex filters
  attemptConfigs.push({ flags: [], filter: "" });
  // Attempt 2: Auto-detect with explicit stereo channel layout filter
  attemptConfigs.push({ flags: [], filter: "aformat=channel_layouts=stereo" });

  // Fallbacks for raw bitstream demuxing if container demuxing fails
  if (codecHint.includes("EAC3") || codecHint.includes("E-AC3") || codecHint.includes("EAC-3")) {
    attemptConfigs.push({ flags: ["-f", "eac3"], filter: "" });
    attemptConfigs.push({ flags: ["-f", "ac3"], filter: "" });
  } else if (codecHint.includes("AC3") || codecHint.includes("AC-3")) {
    attemptConfigs.push({ flags: ["-f", "ac3"], filter: "" });
    attemptConfigs.push({ flags: ["-f", "eac3"], filter: "" });
  } else if (codecHint.includes("DTS")) {
    attemptConfigs.push({ flags: ["-f", "dts"], filter: "" });
  } else if (codecHint.includes("AAC")) {
    attemptConfigs.push({ flags: ["-f", "aac"], filter: "" });
  }

  let success = false;
  for (const cfg of attemptConfigs) {
    success = await tryFfmpeg(cfg.flags, cfg.filter);
    if (success) break;
  }

  fs.unlink(inputPath, () => {});
  transcodeSessions.delete(uploadId);

  if (success && fs.existsSync(outputPath)) {
    res.setHeader("Content-Type", "audio/mp4");
    res.setHeader("Content-Disposition", 'attachment; filename="audio.m4a"');
    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);
    readStream.on("end", () => {
      fs.unlink(outputPath, () => {});
    });
    readStream.on("error", () => {
      fs.unlink(outputPath, () => {});
    });
  } else {
    if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: "FFmpeg audio transcode failed" });
    }
  }
});

// Single Direct POST (for small files)
app.post("/api/transcode-audio", (req, res) => {
  req.setTimeout(0);
  res.setTimeout(0);

  const tmpDir = os.tmpdir();
  const id = Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  const codecHint = (req.headers["x-audio-codec"] || req.query.codec || "").toString().toUpperCase();
  
  let ext = "bin";
  if (codecHint.includes("EAC3") || codecHint.includes("E-AC3")) ext = "eac3";
  else if (codecHint.includes("AC3") || codecHint.includes("AC-3")) ext = "ac3";
  else if (codecHint.includes("DTS")) ext = "dts";
  else if (codecHint.includes("AAC")) ext = "aac";
  else if (codecHint.includes("MP3")) ext = "mp3";

  const inputPath = path.join(tmpDir, `input_${id}.${ext}`);
  const outputPath = path.join(tmpDir, `output_${id}.m4a`);

  const writeStream = fs.createWriteStream(inputPath);

  req.on("error", (err) => {
    console.error("[Transcode API] Request stream error:", err);
    writeStream.destroy();
    if (!res.headersSent) {
      res.status(500).json({ error: "Upload failed" });
    }
  });

  req.pipe(writeStream);

  writeStream.on("finish", async () => {
    const inputSize = fs.existsSync(inputPath) ? fs.statSync(inputPath).size : 0;
    console.log(`[Transcode API] File received (${inputSize} bytes, codecHint: "${codecHint}"). Executing native FFmpeg...`);

    if (inputSize === 0) {
      fs.unlink(inputPath, () => {});
      if (!res.headersSent) {
        res.status(400).json({ error: "Empty request body" });
      }
      return;
    }

    const tryFfmpeg = (inputFlags: string[] = [], filterArg?: string): Promise<boolean> => {
      return new Promise((resolve) => {
        const downmixFilter = filterArg !== undefined ? filterArg : "aformat=channel_layouts=stereo";
        const args = [
          "-y",
          "-fflags", "+genpts+igndts+discardcorrupt",
          "-avoid_negative_ts", "make_zero",
          "-err_detect", "ignore_err",
          ...inputFlags,
          "-i", inputPath,
          "-map", "0:a?",
          "-threads", "0",
          "-vn",
          "-sn",
          "-dn",
          ...(downmixFilter ? ["-af", downmixFilter] : []),
          "-c:a", "aac",
          "-b:a", "192k",
          "-ar", "44100",
          "-ac", "2",
          outputPath
        ];
        
        const ffmpegProc = spawn("ffmpeg", args);
        let completed = false;

        const timer = setTimeout(() => {
          if (!completed) {
            completed = true;
            console.warn(`[Transcode API] FFmpeg timed out with flags [${inputFlags.join(" ")}], killing process...`);
            ffmpegProc.kill("SIGKILL");
            resolve(false);
          }
        }, 300000);

        let stderr = "";
        ffmpegProc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

        ffmpegProc.on("close", (code) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);

          if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 512) {
            resolve(true);
          } else {
            console.warn(`[Transcode API] FFmpeg attempt failed with flags [${inputFlags.join(" ")}], filter [${filterArg}], code ${code}, stderr: ${stderr.slice(-300)}`);
            resolve(false);
          }
        });

        ffmpegProc.on("error", (err) => {
          if (completed) return;
          completed = true;
          clearTimeout(timer);
          console.warn("[Transcode API] FFmpeg spawn error:", err);
          resolve(false);
        });
      });
    };

    const attemptConfigs: { flags: string[]; filter?: string }[] = [];

    // Attempt 1: Auto-detect format without forced input flags or complex filters
    attemptConfigs.push({ flags: [], filter: "" });
    // Attempt 2: Auto-detect with explicit stereo channel layout filter
    attemptConfigs.push({ flags: [], filter: "aformat=channel_layouts=stereo" });

    // Fallbacks for raw bitstream demuxing if container demuxing fails
    if (codecHint.includes("EAC3") || codecHint.includes("E-AC3") || codecHint.includes("EAC-3")) {
      attemptConfigs.push({ flags: ["-f", "eac3"], filter: "" });
      attemptConfigs.push({ flags: ["-f", "ac3"], filter: "" });
    } else if (codecHint.includes("AC3") || codecHint.includes("AC-3")) {
      attemptConfigs.push({ flags: ["-f", "ac3"], filter: "" });
      attemptConfigs.push({ flags: ["-f", "eac3"], filter: "" });
    } else if (codecHint.includes("DTS")) {
      attemptConfigs.push({ flags: ["-f", "dts"], filter: "" });
    } else if (codecHint.includes("AAC")) {
      attemptConfigs.push({ flags: ["-f", "aac"], filter: "" });
    }

    let success = false;
    for (const cfg of attemptConfigs) {
      success = await tryFfmpeg(cfg.flags, cfg.filter);
      if (success) break;
    }

    fs.unlink(inputPath, () => {});

    if (success && fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      console.log(`[Transcode API] FFmpeg successfully produced AAC audio track (${stats.size} bytes)`);
      res.setHeader("Content-Type", "audio/mp4");
      res.setHeader("Content-Disposition", 'attachment; filename="audio.m4a"');
      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);
      readStream.on("close", () => {
        fs.unlink(outputPath, () => {});
      });
      return;
    }

    console.error("[Transcode API] All FFmpeg transcode attempts failed.");
    if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
    if (!res.headersSent) {
      res.status(500).json({ error: "FFmpeg audio transcode failed" });
    }
  });

  writeStream.on("error", (err) => {
    console.error("[Transcode API] WriteStream error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  });
});

// Verbum.by Dictionary Search & Suggest API Proxy with Autonomous Offline Fallback
app.get("/api/verbum/db-status", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.json(getVerbumDbStatus());
});

app.post("/api/verbum/db-init", async (req, res) => {
  try {
    const status = getVerbumDbStatus();
    if (status.ready) {
      return res.json({ message: "Verbum offline database is already ready", status });
    }
    ensureVerbumDbReady().then((success) => {
      console.log(`[VerbumDB Init] Completed with success = ${success}`);
    }).catch((err) => {
      console.error("[VerbumDB Init] Error:", err);
    });
    res.json({ message: "Verbum offline database deployment initiated", status: getVerbumDbStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get("/api/verbum/search", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    const dictId = req.query.dict as string || "";
    if (!q) {
      return res.json({ Articles: [], Q: "" });
    }

    let liveArticles: any[] = [];
    let liveSuccess = false;

    // 1. Primary: Try online Verbum.by (with generous 6.0s timeout)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      const verbumUrl = `https://verbum.by/api/search?q=${encodeURIComponent(q)}`;
      const response = await fetch(verbumUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data: any = await response.json();
        if (data && Array.isArray(data.Articles)) {
          // Filter out grammardb from Verbum results because GrammarDB is handled separately
          liveArticles = data.Articles.filter((art: any) => art.DictionaryID !== 'grammardb');
          liveSuccess = true;
        }
      } else {
        console.warn(`[Verbum Proxy] verbum.by returned HTTP status ${response.status}`);
      }
    } catch (fetchErr) {
      console.warn("[Verbum Proxy] Online verbum.by unreachable/failed, switching to offline fallback:", (fetchErr as any)?.message);
    }

    // If online verbum.by succeeded, ALWAYS return live results (never fall back to offline)
    if (liveSuccess) {
      return res.json({
        Articles: liveArticles,
        Q: q,
        fromOfflineFallback: false
      });
    }

    // 2. Autonomous Offline Fallback — ONLY when verbum.by is unreachable!
    console.warn(`[Verbum Proxy] verbum.by is unreachable! Using offline fallback database for query: "${q}"`);
    const offlineArticles = searchOfflineVerbum(q, dictId);

    const dbStatus = getVerbumDbStatus();
    if (!dbStatus.ready && !dbStatus.building) {
      // Auto-initiate background deployment if needed
      ensureVerbumDbReady().catch(() => {});
    }

    return res.json({
      Articles: offlineArticles,
      Q: q,
      fromOfflineFallback: true,
      offlineNotice: "Сэрвіс verbum.by недасяжны. Вынікі атрыманы з аўтаномнай базы слоўнікаў (рэзервовы рэжым).",
      status: dbStatus
    });
  } catch (err: any) {
    console.error("[Verbum Proxy] Error searching word:", err);
    res.status(500).json({ error: "Памылка пошуку ў слоўніках", Articles: [] });
  }
});

app.get("/api/verbum/suggest", async (req, res) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (!q) {
      return res.json([]);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const verbumUrl = `https://verbum.by/api/suggest?q=${encodeURIComponent(q)}`;
      const response = await fetch(verbumUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "application/json"
        }
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          return res.json(data);
        }
      }
    } catch (_) {}

    // Offline suggest fallback ONLY when online verbum.by is unreachable
    const offlineSuggests = suggestOfflineVerbum(q);
    res.json(offlineSuggests);
  } catch (err: any) {
    console.warn("[Verbum Proxy] Error fetching suggests:", err);
    res.json([]);
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", geminiConfigured: !!process.env.GEMINI_API_KEY });
});

// Dynamic models list endpoint
app.get("/api/models", async (req, res) => {
  try {
    const client = getAiClientForRequest(req);
    const models = await getDynamicModels(client);
    res.json({ models });
  } catch (err: any) {
    res.status(500).json({ error: getFriendlyErrorMessage(err) });
  }
});

// Global error handler to ensure we NEVER return HTML error pages for API errors
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("[Global Error Handler] Caught error:", err);
  res.status(err.status || err.statusCode || 500).json({
    error: err.message || "Унутраная памылка сервера",
    details: process.env.NODE_ENV !== "production" ? err.stack : undefined
  });
});

// ==========================================
// VITE OR STATIC MIDDLEWARE
// ==========================================
async function startServer() {
  const distPath = path.join(process.cwd(), "dist");
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(path.join(distPath, "index.html"));

  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite dev middleware attached.");
  } else {
    app.use(express.static(distPath, {
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));
    app.get("*", (req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(distPath, "index.html"));
    });
    console.log("Serving static production built folders.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running at http://0.0.0.0:${PORT}`);

    // Pre-initialize GrammarDB (2.38M forms) on boot so search is instantly ready
    ensureGrammarDbReady().then((ready) => {
      console.log(`[Server Startup] GrammarDB initialized on boot (ready = ${ready})`);
    }).catch((err) => {
      console.warn("[Server Startup] GrammarDB initialization on boot warning:", err?.message || err);
    });

    // Pre-initialize Verbum offline dictionaries on boot (TSBLM, Klyshka, RBS, ESBM)
    ensureVerbumDbReady().then((ready) => {
      console.log(`[Server Startup] Verbum offline dictionaries initialized on boot (ready = ${ready})`);
    }).catch((err) => {
      console.warn("[Server Startup] Verbum offline dictionaries boot warning:", err?.message || err);
    });
    
    try {
      console.log("[Server Startup] Initializing dynamic Gemini model discovery...");
      const client = getAiClient();
      getDynamicModels(client).then((models) => {
        console.log("[Server Startup] Dynamic Gemini models ready:", models);
      }).catch((err) => {
        console.warn("[Server Startup] Failed to fetch dynamic models on boot:", err?.message || err);
      });
    } catch (err) {
      console.warn("[Server Startup] Could not initialize Gemini client on startup:", err);
    }
  });
}

startServer();
