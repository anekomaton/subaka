/**
 * Subaka Desktop AI Client (Google Gemini API)
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

export function getDesktopGeminiApiKey(): string {
  try {
    return localStorage.getItem('gemini_api_key') || '';
  } catch {
    return '';
  }
}

/**
 * Direct Gemini API call for translating subtitles in Desktop mode
 */
export async function desktopTranslateBatch(
  entries: { id: string | number; text: string }[],
  targetLanguage: string = 'Belarusian'
): Promise<DesktopTranslationResult[]> {
  const apiKey = getDesktopGeminiApiKey();
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
    }),
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    const message = errJson?.error?.message || `Gemini API error (код ${response.status})`;
    throw new Error(message);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Пусты адказ ад Gemini API');
  }

  const parsed = JSON.parse(rawText);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Direct Gemini API call for proofreading subtitles in Desktop mode
 */
export async function desktopProofreadBatch(
  entries: { id: string | number; text: string }[]
): Promise<DesktopProofreadResult[]> {
  const apiKey = getDesktopGeminiApiKey();
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
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
                  required: ['word', 'explanation'],
                },
              },
            },
            required: ['id', 'issues'],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => ({}));
    const message = errJson?.error?.message || `Gemini API error (код ${response.status})`;
    throw new Error(message);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error('Пусты адказ ад Gemini API');
  }

  const parsed = JSON.parse(rawText);
  return Array.isArray(parsed) ? parsed : [];
}
