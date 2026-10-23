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

const DEFAULT_FALLBACK_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
];

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
  // 3.8 (newest)
  if (id === 'gemini-3.8-flash') return 200;
  if (id.includes('3.8-flash')) return 195;
  if (id.includes('3.8')) return 190;

  // 3.7
  if (id === 'gemini-3.7-flash') return 180;
  if (id.includes('3.7')) return 175;

  // 3.1
  if (id === 'gemini-3.1-flash-lite') return 170;
  if (id.includes('3.1-flash')) return 165;
  if (id.includes('3.1')) return 160;

  // Latest alias
  if (id === 'gemini-flash-latest') return 155;

  // 2.5
  if (id === 'gemini-2.5-flash') return 150;
  if (id === 'gemini-2.5-flash-lite') return 145;
  if (id.includes('2.5')) return 140;

  // 2.0
  if (id === 'gemini-2.0-flash') return 130;
  if (id === 'gemini-2.0-flash-lite') return 125;
  if (id.includes('2.0')) return 120;

  // Flash general
  if (id.includes('flash') && !id.includes('lite') && !id.includes('1.5')) return 110;

  // 1.5
  if (id === 'gemini-1.5-flash') return 100;
  if (id.includes('1.5-flash')) return 95;
  if (id.includes('1.5')) return 90;

  // Pro models as last resort
  if (id.includes('pro')) return 50;

  return 10;
}

function filterAndPrioritizeModels(modelsList: string[]): string[] {
  const now = Date.now();
  const active: string[] = [];
  const deprioritized: string[] = [];

  for (const m of modelsList) {
    const time = quotaExhaustedModels.get(m);
    if (time && now - time < QUOTA_EXHAUSTED_TTL_MS) {
      deprioritized.push(m);
    } else {
      if (time) quotaExhaustedModels.delete(m);
      active.push(m);
    }
  }

  if (active.length === 0) {
    return modelsList;
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
          if (
            name.includes('gemini') &&
            !name.includes('embedding') &&
            !name.includes('imagen') &&
            !name.includes('image') &&
            !name.includes('tts') &&
            !name.includes('live') &&
            !name.includes('pro') &&
            !name.includes('aqa') &&
            !name.includes('bison') &&
            !name.includes('robotics')
          ) {
            modelsList.push(name);
          }
        }
      }

      const pool = Array.from(new Set([...DEFAULT_FALLBACK_MODELS, ...modelsList]));
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
  bodyObj: any
): Promise<any> {
  const cleanKey = apiKey.trim().replace(/^["']|["']$/g, '');
  if (!cleanKey) {
    throw new Error('MISSING_GEMINI_API_KEY');
  }

  const modelsToTry = await getDesktopDynamicModels(cleanKey);
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
            break;
          }

          if (response.status === 404 || errMsg.includes('not found') || errMsg.includes('NOT_FOUND')) {
            console.warn(`[Desktop AI] Model ${model} not found (404), skipping...`);
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

  throw new Error(lastError || 'Не ўдалося атрымаць адказ ад Google Generative Language API');
}

/**
 * Direct Gemini API call for translating subtitles in Desktop mode
 */
export async function desktopTranslateBatch(
  entries: { id: string | number; text: string }[],
  targetLanguage: string = 'Belarusian',
  explicitApiKey?: string
): Promise<DesktopTranslationResult[]> {
  const apiKey = explicitApiKey || getDesktopGeminiApiKey();
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

  const parsed = await callGenerativeLanguageApi(apiKey, bodyObj);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Direct Gemini API call for proofreading subtitles in Desktop mode
 */
export async function desktopProofreadBatch(
  entries: { id: string | number; text: string }[],
  explicitApiKey?: string
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

  const parsed = await callGenerativeLanguageApi(apiKey, bodyObj);
  return Array.isArray(parsed) ? parsed : [];
}
