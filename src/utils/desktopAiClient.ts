/**
 * Subaka Desktop AI Client (Google Gemini API via Google Generative Language API)
 * Directly calls Google Gemini REST API in standalone Desktop mode
 * without requiring a local Node.js Express server.
 */

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
    id: 'gemini-3.7-flash',
    name: 'Gemini 3.7 Flash',
    description: 'Магутная стабільная мадэль папярэдняга пакалення',
    badge: 'Стабільная',
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
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
];

/**
 * Retrieves the user-selected Gemini model from localStorage.
 * Automatically migrates away from deprecated models (1.5, 2.0, 2.5, etc.)
 */
export function getDesktopGeminiModel(): string {
  try {
    const raw = localStorage.getItem('subaka_gemini_model') || '';
    if (raw && DEFAULT_FALLBACK_MODELS.includes(raw)) {
      return raw;
    }
    // Auto-migrate away from deprecated models
    if (raw && (raw.includes('1.5') || raw.includes('2.0') || raw.includes('2.5') || raw.includes('pro'))) {
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
  // Score ordered strictly from newest to older
  if (id === 'gemini-3.8-flash') return 200;
  if (id.includes('3.8')) return 195;
  if (id === 'gemini-3.7-flash') return 180;
  if (id.includes('3.7')) return 175;
  if (id === 'gemini-3.6-flash') return 172;
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
  if (cachedDesktopModels && cachedDesktopModels.length > 0 && now - lastModelFetchTime < MODEL_CACHE_TTL_MS) {
    return filterAndPrioritizeModels(cachedDesktopModels);
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      const rawList = Array.isArray(data?.models) ? data.models : [];
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
        const sorted = pool.sort((a, b) => getModelScore(b) - getModelScore(a));
        cachedDesktopModels = sorted;
        lastModelFetchTime = now;
        return filterAndPrioritizeModels(cachedDesktopModels);
      }
    }
  } catch (err) {
    console.warn('[Desktop AI] Could not query models list, using default fallback models:', err);
  }

  if (!cachedDesktopModels || cachedDesktopModels.length === 0) {
    cachedDesktopModels = [...DEFAULT_FALLBACK_MODELS];
  }
  return filterAndPrioritizeModels(cachedDesktopModels);
}

async function callGenerativeLanguageApi(
  apiKey: string,
  bodyObj: any,
  preferredModel?: string
): Promise<any> {
  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, '');
  if (!cleanKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }

  const chosenModel = preferredModel || getDesktopGeminiModel();
  const dynamicModels = await getDesktopDynamicModels(cleanKey);
  const now = Date.now();
  const isChosenExhausted = !preferredModel && quotaExhaustedModels.has(chosenModel) && (now - (quotaExhaustedModels.get(chosenModel) || 0) < QUOTA_EXHAUSTED_TTL_MS);

  // If chosenModel is currently exhausted, prioritize other active models first
  let rawModelsToTry: string[];
  if (!isChosenExhausted) {
    rawModelsToTry = [chosenModel, ...dynamicModels];
  } else {
    rawModelsToTry = [...dynamicModels, chosenModel];
  }
  const modelsToTry = Array.from(new Set(rawModelsToTry)).filter((m) => !isModelDeprecated(m));

  let lastError = '';

  for (const model of modelsToTry) {
    let attempts = 2;
    while (attempts > 0) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${cleanKey}`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj),
        });

        if (response.ok) {
          const data = await response.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawText) {
            const clean = rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
            return JSON.parse(clean);
          }
        } else {
          const errJson = await response.json().catch(() => ({}));
          const errMsg = errJson?.error?.message || `HTTP ${response.status}`;
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
            response.status === 503 ||
            errMsg.includes('503') ||
            errMsg.includes('UNAVAILABLE') ||
            errMsg.includes('high demand') ||
            errMsg.includes('temporary');

          const isRateLimited =
            response.status === 429 ||
            errMsg.includes('429') ||
            errMsg.includes('RESOURCE_EXHAUSTED') ||
            errMsg.includes('Quota exceeded') ||
            errMsg.includes('quota');

          if (isOverloaded || isRateLimited) {
            const reason = isOverloaded ? '503 перагрузка' : '429 ліміт запытаў';
            console.warn(`[Desktop AI] Model ${model} is busy (${reason}), switching to next model...`);
            markDesktopModelTemporaryUnavailable(model, reason);
            // Wait 1.2s before attempting next model to avoid rapid burst rate limits
            await new Promise((r) => setTimeout(r, 1200));
            break;
          }

          if (response.status === 404 || errMsg.includes('not found') || errMsg.includes('NOT_FOUND') || errMsg.includes('no longer available')) {
            console.warn(`[Desktop AI] Model ${model} not available (404/not found), skipping to next model...`);
            break;
          }

          console.warn(`[Desktop AI] Model ${model} returned error, retrying:`, errMsg);
          attempts--;
          if (attempts > 0) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          break;
        }
      } catch (netErr: any) {
        lastError = netErr?.message || String(netErr);
        console.warn(`[Desktop AI] Network error calling ${model}:`, lastError);
        break;
      }
    }
  }

  // Provide user-friendly Belarusian error message
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
  preferredModel?: string
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
${JSON.stringify(entries, null, 2)}`;

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

  const parsed = await callGenerativeLanguageApi(apiKey, bodyObj, modelName);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Direct Gemini API call for proofreading subtitles in Desktop mode
 */
export async function desktopProofreadBatch(
  entries: { id: string | number; text: string }[],
  explicitApiKey?: string,
  preferredModel?: string
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
${JSON.stringify(entries, null, 2)}`;

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

  const parsed = await callGenerativeLanguageApi(apiKey, bodyObj, preferredModel);
  return Array.isArray(parsed) ? parsed : [];
}
