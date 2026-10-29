/**
 * Verbum Offline Dictionary Database Helper for Node.js
 * Enables autonomous offline fallback for Verbum.by dictionaries using native node:sqlite (Node 22+)
 * Downloads and indexes dictionaries on-demand on production/dev servers, avoiding repository bloat.
 */

import path from "path";
import fs from "fs";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

export interface VerbumDbStatus {
  ready: boolean;
  path: string | null;
  sizeMb?: number;
  building: boolean;
  articleCount?: number;
  dictsLoaded?: string[];
  lastLog?: string;
  fallbackActive: boolean;
}

export interface OfflineVerbumArticle {
  ID: string;
  DictionaryID: string;
  Content: string;
  Headword?: string;
  IsOffline: boolean;
}

const CANDIDATE_PATHS = [
  "/tmp/verbum_offline.sqlite3",
  path.join(process.cwd(), "verbum_offline.sqlite3"),
  path.join(process.cwd(), "dist", "verbum_offline.sqlite3"),
  typeof __dirname !== "undefined" ? path.join(__dirname, "verbum_offline.sqlite3") : "",
  typeof __dirname !== "undefined" ? path.join(__dirname, "..", "verbum_offline.sqlite3") : ""
].filter(Boolean);

const CANDIDATE_GZ_PATHS = [
  path.join(process.cwd(), "dist", "verbum_offline.sqlite3.gz"),
  path.join(process.cwd(), "verbum_offline.sqlite3.gz"),
  typeof __dirname !== "undefined" ? path.join(__dirname, "verbum_offline.sqlite3.gz") : "",
  typeof __dirname !== "undefined" ? path.join(__dirname, "..", "verbum_offline.sqlite3.gz") : "",
  "/tmp/verbum_offline.sqlite3.gz"
].filter(Boolean);

// Core dictionaries ordered by linguistic priority and relevance
const DICTIONARY_SOURCES = [
  {
    id: "tsblm2022",
    name: "Тлумачальны слоўнік беларускай літаратурнай мовы (І. Л. Капылоў, 2022)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/tsblm2022/tsblm2022.html",
    format: "html",
    approxArticles: 43000,
  },
  {
    id: "brs",
    name: "Беларуска-рускі слоўнік, 4-е выданне (2012)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/brs/brs.dsl",
    format: "dsl",
    approxArticles: 108000,
  },
  {
    id: "klyshka",
    name: "Слоўнік сінонімаў і блізказначных слоў (М. Клышка)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/klyshka/klyshka.html",
    format: "html",
    approxArticles: 1950,
  },
  {
    id: "esbm",
    name: "Этымалагічны слоўнік беларускай мовы (1978—2017)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/esbm/esbm.html",
    format: "html",
    approxArticles: 35000,
  },
  {
    id: "rbs10",
    name: "Руска-беларускі слоўнік НАН Беларусі, 10-е выданне (2012)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/rbs10/rbs10.html",
    format: "html",
    approxArticles: 109000,
  },
  {
    id: "susha",
    name: "Англійска-беларускі слоўнік (Т. Суша, 2013, актуальны правапіс)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/susha/susha.html",
    format: "html",
    approxArticles: 26700,
  }
];

let dbInstance: any = null;
let isBuildingVerbumDb = false;
let buildPromise: Promise<boolean> | null = null;
let lastInitLog = "";
let cachedArticleCount = 0;
let cachedDictsLoaded: string[] = [];

let DatabaseSyncClass: any = null;

function getDatabaseSyncClass(): any {
  if (DatabaseSyncClass) return DatabaseSyncClass;

  // 1. Try modern Node.js safe synchronous built-in resolver (Node 20.16.0+, 22.3.0+)
  try {
    if (typeof (process as any).getBuiltinModule === "function") {
      const mod = (process as any).getBuiltinModule("node:sqlite");
      if (mod && mod.DatabaseSync) {
        DatabaseSyncClass = mod.DatabaseSync;
        return DatabaseSyncClass;
      }
    }
  } catch (_) {}

  // 2. Try global require if running in CommonJS (bundled dist/server.cjs)
  try {
    if (typeof require === "function") {
      const mod = require("node:sqlite");
      if (mod && mod.DatabaseSync) {
        DatabaseSyncClass = mod.DatabaseSync;
        return DatabaseSyncClass;
      }
    }
  } catch (_) {}

  return null;
}

export function getResolvedVerbumDbPath(): string | null {
  if (isBuildingVerbumDb) {
    return null;
  }
  for (const candidate of CANDIDATE_PATHS) {
    if (fs.existsSync(candidate)) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.size > 2 * 1024 * 1024) {
          return candidate;
        }
      } catch (_) {}
    }
  }
  return null;
}

function extractHeadwordsFromArticle(rawHtml: string): Array<{ headword: string; norm: string }> {
  const results: Array<{ headword: string; norm: string }> = [];
  const seen = new Set<string>();

  // 1. Elements with class hw (strong, b, span, p, a)
  const regex = /<(?:strong|b|span|p|a)[^>]*\bclass=["'][^"']*\bhw\b[^"']*["'][^>]*>(.*?)<\/(?:strong|b|span|p|a)>/gi;
  let m;
  while ((m = regex.exec(rawHtml)) !== null) {
    const rawText = (m[1] || "").replace(/<[^>]+>/g, "").replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "").trim();
    if (rawText) {
      const norm = rawText.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        results.push({ headword: rawText, norm });
      }
      if (norm.includes("(") && norm.includes(")")) {
        const exp1 = norm.replace(/[\(\)]/g, "").trim();
        const exp2 = norm.replace(/\(.*?\)/g, "").trim();
        for (const exp of [exp1, exp2]) {
          if (exp && !seen.has(exp)) {
            seen.add(exp);
            results.push({ headword: rawText, norm: exp });
          }
        }
      }
    }
  }
  if (results.length > 0) return results;

  // 2. Fallback to id="word"
  const idRegex = /<(?:strong|b)[^>]*\bid=["']([^"']+)["'][^>]*>(.*?)<\/(?:strong|b)>/gi;
  while ((m = idRegex.exec(rawHtml)) !== null) {
    const rawText = (m[2] || m[1] || "").replace(/<[^>]+>/g, "").replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "").trim();
    if (rawText) {
      const norm = rawText.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        results.push({ headword: rawText, norm });
      }
    }
  }
  if (results.length > 0) return results;

  // 3. Fallback: <p class="headword">
  const pRegex = /<p[^>]*class=["']headword["'][^>]*>(.*?)<\/p>/gi;
  while ((m = pRegex.exec(rawHtml)) !== null) {
    const rawText = (m[1] || "").replace(/<[^>]+>/g, "").trim();
    if (rawText) {
      const norm = rawText.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        results.push({ headword: rawText, norm });
      }
    }
  }

  // 4. Fallback: first <b> in top 150 chars
  if (results.length === 0) {
    const bMatch = rawHtml.slice(0, 150).match(/<b>(.*?)<\/b>/i);
    if (bMatch) {
      const rawText = (bMatch[1] || "").replace(/<[^>]+>/g, "").trim();
      if (rawText && rawText.length < 40 && !rawText.startsWith("1.") && !rawText.startsWith("I")) {
        const norm = rawText.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          results.push({ headword: rawText, norm });
        }
      }
    }
  }

  return results;
}

function dslArticleToHtml(headwords: string[], bodyLines: string[]): string {
  const hwDisplay = headwords.join(", ");
  const parts: string[] = [`<p class="ms-0"><strong class="hw">${hwDisplay}</strong></p>`];
  for (const rawLine of bodyLines) {
    let line = rawLine.trim();
    if (!line) continue;
    line = line.replace(/\[b\](.*?)\[\/b\]/g, "<b>$1</b>");
    line = line.replace(/\[i\](.*?)\[\/i\]/g, "<i>$1</i>");
    line = line.replace(/\[u\](.*?)\[\/u\]/g, "<u>$1</u>");
    line = line.replace(/\[p\](.*?)\[\/p\]/g, "<v-abbr>$1</v-abbr>");
    line = line.replace(/\[ex\](.*?)\[\/ex\]/g, "<v-ex>$1</v-ex>");
    line = line.replace(/\[c\s*([^\]]*)\](.*?)\[\/c\]/g, '<span style="color: $1">$2</span>');
    line = line.replace(/\[c\](.*?)\[\/c\]/g, '<span style="color: darkgreen">$1</span>');
    line = line.replace(/\['\]([аеёіоуыэюяАЕЁІОУЫЭЮЯ\w])\[\/'\]/g, "$1\u0301");
    line = line.replace(/\[m\d\]/g, '<p class="ms-2">');
    line = line.replace(/\[\/m\]/g, "</p>");
    line = line.replace(/\[[^\]]+\]/g, "");
    if (!line.startsWith("<p")) {
      line = `<p class="ms-2">${line}</p>`;
    }
    parts.push(line);
  }
  return parts.join("\n");
}

function openDb(targetPath: string): any {
  const DbClass = getDatabaseSyncClass();
  if (!DbClass) return null;
  const db = new DbClass(targetPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT,
      dict_id TEXT,
      headword TEXT,
      norm_hw TEXT,
      html TEXT,
      PRIMARY KEY (dict_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_norm_hw ON articles(norm_hw);
    CREATE INDEX IF NOT EXISTS idx_dict_norm ON articles(dict_id, norm_hw);
    CREATE INDEX IF NOT EXISTS idx_dict_id ON articles(dict_id);
  `);
  return db;
}

function updateStatsFromDb(db: any) {
  try {
    const countRow = db.prepare("SELECT COUNT(*) as c FROM articles").get();
    cachedArticleCount = countRow?.c || 0;
    const dictsRows = db.prepare("SELECT DISTINCT dict_id FROM articles").all();
    cachedDictsLoaded = dictsRows.map((r: any) => r.dict_id);
  } catch (_) {}
}

export function getVerbumDbStatus(): VerbumDbStatus {
  const resolved = getResolvedVerbumDbPath();
  let sizeMb: number | undefined;
  if (resolved) {
    try {
      const stat = fs.statSync(resolved);
      sizeMb = Math.round((stat.size / 1024 / 1024) * 10) / 10;
    } catch (_) {}
  }

  if (resolved && (!cachedArticleCount || cachedDictsLoaded.length === 0)) {
    try {
      const db = getDb();
      if (db) updateStatsFromDb(db);
    } catch (_) {}
  }

  return {
    ready: Boolean(resolved),
    path: resolved || null,
    sizeMb,
    building: isBuildingVerbumDb,
    articleCount: cachedArticleCount,
    dictsLoaded: cachedDictsLoaded,
    lastLog: lastInitLog || undefined,
    fallbackActive: !resolved
  };
}

export async function ensureVerbumDbReady(): Promise<boolean> {
  const existing = getResolvedVerbumDbPath();
  if (existing) {
    const db = getDb();
    if (db) updateStatsFromDb(db);
    return true;
  }
  if (buildPromise) return buildPromise;

  isBuildingVerbumDb = true;
  buildPromise = (async () => {
    try {
      const targetDbPath = "/tmp/verbum_offline.sqlite3";
      const tempBuildingPath = "/tmp/verbum_offline.building.sqlite3";

      if (fs.existsSync(tempBuildingPath)) {
        try { fs.unlinkSync(tempBuildingPath); } catch (_) {}
      }

      // 1. Check if a compressed .gz archive exists
      for (const gzPath of CANDIDATE_GZ_PATHS) {
        if (fs.existsSync(gzPath)) {
          try {
            const stat = fs.statSync(gzPath);
            if (stat.size > 500 * 1024) {
              lastInitLog = `Decompressing ${gzPath}...`;
              console.log(`[VerbumDB] Decompressing archive at ${gzPath}...`);
              const tempTarget = targetDbPath + ".tmp";
              const readStream = fs.createReadStream(gzPath);
              const writeStream = fs.createWriteStream(tempTarget);
              const gunzip = zlib.createGunzip();
              await pipeline(readStream, gunzip, writeStream);
              fs.renameSync(tempTarget, targetDbPath);
              console.log(`[VerbumDB] Decompressed successfully to ${targetDbPath}`);
              dbInstance = null;
              lastInitLog = `Ready at ${targetDbPath}`;
              return true;
            }
          } catch (decompressErr: any) {
            console.error(`[VerbumDB] Decompress error for ${gzPath}:`, decompressErr);
          }
        }
      }

      // 2. Download and index dictionaries from verbumby/slouniki
      const DbClass = getDatabaseSyncClass();
      if (!DbClass) {
        lastInitLog = "Native node:sqlite is not available.";
        return false;
      }

      console.log(`[VerbumDB] Initializing database at ${tempBuildingPath}...`);
      lastInitLog = "Ініцыялізацыя аўтаномнай базы слоўнікаў...";
      const db = openDb(tempBuildingPath);
      const insertStmt = db.prepare("INSERT OR REPLACE INTO articles (id, dict_id, headword, norm_hw, html) VALUES (?, ?, ?, ?, ?)");

      for (let i = 0; i < DICTIONARY_SOURCES.length; i++) {
        const dict = DICTIONARY_SOURCES[i];
        lastInitLog = `Спампоўка слоўніка [${i + 1}/${DICTIONARY_SOURCES.length}]: ${dict.name}...`;
        console.log(`[VerbumDB] [${i + 1}/${DICTIONARY_SOURCES.length}] Downloading ${dict.id} from ${dict.url}...`);

        try {
          const resp = await fetch(dict.url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VerbumOfflineBuilder/1.0",
              "Accept": "text/html,text/plain"
            }
          });

          if (!resp.ok) {
            console.warn(`[VerbumDB] Skip ${dict.id}: HTTP ${resp.status} ${resp.statusText}`);
            continue;
          }

          const rawContent = await resp.text();

          if (dict.format === "dsl") {
            const lines = rawContent.split(/\r?\n/);
            let curHws: string[] = [];
            let curBody: string[] = [];
            let artNum = 0;
            let inserted = 0;

            db.exec("BEGIN TRANSACTION;");
            for (const line of lines) {
              if (line.startsWith("#") || !line.trim()) continue;
              if (!line.startsWith("\t") && !line.startsWith(" ")) {
                if (curHws.length > 0 && curBody.length > 0) {
                  artNum++;
                  const articleHtml = dslArticleToHtml(curHws, curBody);
                  for (let hIdx = 0; hIdx < curHws.length; hIdx++) {
                    const hw = curHws[hIdx];
                    const norm = hw.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
                    if (!norm) continue;
                    const articleId = hIdx === 0 ? `${dict.id}-${artNum}` : `${dict.id}-${artNum}-${hIdx}`;
                    try {
                      insertStmt.run(articleId, dict.id, hw, norm, articleHtml);
                      inserted++;
                    } catch (_) {}
                  }
                  curHws = [];
                  curBody = [];
                }
                curHws.push(line.trim());
              } else {
                curBody.push(line);
              }
            }

            if (curHws.length > 0 && curBody.length > 0) {
              artNum++;
              const articleHtml = dslArticleToHtml(curHws, curBody);
              for (let hIdx = 0; hIdx < curHws.length; hIdx++) {
                const hw = curHws[hIdx];
                const norm = hw.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
                if (!norm) continue;
                const articleId = hIdx === 0 ? `${dict.id}-${artNum}` : `${dict.id}-${artNum}-${hIdx}`;
                try {
                  insertStmt.run(articleId, dict.id, hw, norm, articleHtml);
                  inserted++;
                } catch (_) {}
              }
            }
            db.exec("COMMIT;");
            console.log(`[VerbumDB] Successfully indexed ${inserted} articles for DSL ${dict.id}`);
          } else {
            const rawArticles = rawContent.split("<hr/>");
            lastInitLog = `Індэксацыя [${i + 1}/${DICTIONARY_SOURCES.length}]: ${dict.id} (${rawArticles.length} арт.)...`;
            console.log(`[VerbumDB] Indexing ${dict.id} (${rawArticles.length} raw articles)...`);

            db.exec("BEGIN TRANSACTION;");
            let inserted = 0;
            for (let artIdx = 0; artIdx < rawArticles.length; artIdx++) {
              const articleText = rawArticles[artIdx].trim();
              if (!articleText) continue;

              const extractedList = extractHeadwordsFromArticle(articleText);
              if (extractedList.length === 0) continue;

              for (let k = 0; k < extractedList.length; k++) {
                const item = extractedList[k];
                const articleId = k === 0 ? `${dict.id}-${artIdx}` : `${dict.id}-${artIdx}-${k}`;
                try {
                  insertStmt.run(articleId, dict.id, item.headword, item.norm, articleText);
                  inserted++;
                } catch (_) {}
              }
            }
            db.exec("COMMIT;");
            console.log(`[VerbumDB] Successfully indexed ${inserted} articles for ${dict.id}`);
          }
        } catch (dictErr: any) {
          console.error(`[VerbumDB] Error downloading/indexing ${dict.id}:`, dictErr);
        }
      }

      // Close building DB and atomically rename to target
      try {
        db.close();
      } catch (_) {}

      if (fs.existsSync(targetDbPath)) {
        try { fs.unlinkSync(targetDbPath); } catch (_) {}
      }
      fs.renameSync(tempBuildingPath, targetDbPath);

      dbInstance = null;
      const finalDb = getDb();
      if (finalDb) {
        updateStatsFromDb(finalDb);
      }
      lastInitLog = `Гатова (${cachedArticleCount} арт., ${cachedDictsLoaded.join(", ")})`;
      console.log(`[VerbumDB] Deployment completed: ${cachedArticleCount} articles in SQLite.`);
      return true;
    } catch (err: any) {
      lastInitLog = `Памылка разгортвання: ${err?.message || err}`;
      console.error("[VerbumDB] Deployment failed:", err);
      return false;
    } finally {
      isBuildingVerbumDb = false;
      buildPromise = null;
    }
  })();

  return buildPromise;
}

function getDb(): any {
  if (dbInstance) return dbInstance;
  const resolved = getResolvedVerbumDbPath();
  if (!resolved) return null;
  const DbClass = getDatabaseSyncClass();
  if (!DbClass) return null;
  try {
    dbInstance = new DbClass(resolved, { readOnly: true });
    return dbInstance;
  } catch (err) {
    console.error("[VerbumDB] Failed to open DB:", err);
    return null;
  }
}

const DICT_PRIORITY: Record<string, number> = {
  tsblm2022: 1,
  tsbm: 2,
  tsblm: 3,
  brs: 4,
  klyshka: 5,
  esbm: 6,
  sis1999: 7,
  sis2005: 8,
  rbs10: 9,
  rbs: 10,
  susha: 11,
};

function getLemmaFromGrammarDb(word: string): string[] {
  try {
    const candidatePaths = [
      "/tmp/grammardb.sqlite3",
      path.join(process.cwd(), "grammardb.sqlite3"),
      path.join(process.cwd(), "dist", "grammardb.sqlite3")
    ];
    for (const gp of candidatePaths) {
      if (fs.existsSync(gp)) {
        const DbClass = getDatabaseSyncClass();
        if (DbClass) {
          const gdb = new DbClass(gp, { readOnly: true });
          const rows = gdb.prepare("SELECT DISTINCT lemma FROM words WHERE word = ? LIMIT 5").all(word);
          gdb.close();
          return rows.map((r: any) => r.lemma).filter(Boolean);
        }
      }
    }
  } catch (_) {}
  return [];
}

export function searchOfflineVerbum(query: string, dictId?: string): OfflineVerbumArticle[] {
  const db = getDb();
  if (!db) return [];

  const cleanQuery = query.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
  if (!cleanQuery) return [];

  // Build spelling variants
  const variants = [cleanQuery];
  if (cleanQuery.includes("ё")) variants.push(cleanQuery.replace(/ё/g, "е"));
  else if (cleanQuery.includes("е")) variants.push(cleanQuery.replace(/е/g, "ё"));
  if (cleanQuery.startsWith("ў")) variants.push("у" + cleanQuery.slice(1));
  else if (cleanQuery.startsWith("у")) variants.push("ў" + cleanQuery.slice(1));

  // Query GrammarDB for lemmas (e.g. "краіне" -> "краіна", "чытаюць" -> "чытаць")
  const lemmas = getLemmaFromGrammarDb(cleanQuery);
  for (const lem of lemmas) {
    const cleanLem = lem.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
    if (cleanLem && !variants.includes(cleanLem)) {
      variants.push(cleanLem);
    }
  }

  // Common Belarusian inflection stems
  for (const v of [cleanQuery]) {
    for (const suffix of ["ай", "аю", "ая", "ыя", "ія", "ага", "яго", "аму", "яму", "ам", "ем", "ём", "ям", "амі", "ямі", "ах", "ях", "цы", "ку", "ка", "кі", "кам", "лі", "ла", "ць", "юць", "яць", "еце", "іце"]) {
      if (v.length > suffix.length + 2 && v.endsWith(suffix)) {
        const stem = v.slice(0, -suffix.length);
        const candidates = [`${stem}а`, `${stem}ь`, `${stem}ць`, `${stem}ы`, `${stem}і`, stem];
        for (const c of candidates) {
          if (!variants.includes(c)) variants.push(c);
        }
      }
    }
  }

  try {
    const isSingleDict = dictId && dictId !== "all";
    const stmtExact = isSingleDict
      ? db.prepare("SELECT id, dict_id, headword, html, norm_hw FROM articles WHERE dict_id = ? AND norm_hw = ?")
      : db.prepare("SELECT id, dict_id, headword, html, norm_hw FROM articles WHERE norm_hw = ?");

    const seenIds = new Set<string>();
    const matchedArticles: Array<{ id: string; dict_id: string; headword: string; html: string; norm_hw: string; isExact: boolean }> = [];

    // 1. Exact match across variants (clean, spelling variants, lemmas)
    for (let vIdx = 0; vIdx < variants.length; vIdx++) {
      const varWord = variants[vIdx];
      const rows = isSingleDict ? stmtExact.all(dictId, varWord) : stmtExact.all(varWord);
      for (const r of rows) {
        const key = `${r.dict_id}:${r.id}`;
        if (!seenIds.has(key)) {
          seenIds.add(key);
          matchedArticles.push({
            id: r.id,
            dict_id: r.dict_id,
            headword: r.headword,
            html: r.html,
            norm_hw: r.norm_hw,
            isExact: r.norm_hw === cleanQuery
          });
        }
      }
      // If primary query matches directly in dictionaries, don't overwhelm with loose stem candidates
      if (vIdx === 0 && matchedArticles.length >= 3) {
        // Collect exact spelling variants but stop before loose suffixes
        break;
      }
    }

    // 2. If no exact/lemma results, perform prefix search
    if (matchedArticles.length === 0) {
      const stmtLike = isSingleDict
        ? db.prepare("SELECT id, dict_id, headword, html, norm_hw FROM articles WHERE dict_id = ? AND norm_hw LIKE ? LIMIT 30")
        : db.prepare("SELECT id, dict_id, headword, html, norm_hw FROM articles WHERE norm_hw LIKE ? LIMIT 30");

      const rows = isSingleDict ? stmtLike.all(dictId, `${cleanQuery}%`) : stmtLike.all(`${cleanQuery}%`);
      for (const r of rows) {
        const key = `${r.dict_id}:${r.id}`;
        if (!seenIds.has(key)) {
          seenIds.add(key);
          matchedArticles.push({
            id: r.id,
            dict_id: r.dict_id,
            headword: r.headword,
            html: r.html,
            norm_hw: r.norm_hw,
            isExact: r.norm_hw === cleanQuery
          });
        }
      }
    }

    // Sort matched articles:
    // 1. Direct exact matches first
    // 2. Dictionary priority: Explanatory (TSBLM) > By-Ru (BRS) > Synonyms (Klyshka) > Etymological (ESBM) > Ru-By (RBS10) > Eng-By (Susha)
    // 3. Shorter headwords first
    matchedArticles.sort((a, b) => {
      if (a.isExact !== b.isExact) {
        return a.isExact ? -1 : 1;
      }
      const prioA = DICT_PRIORITY[a.dict_id] || 99;
      const prioB = DICT_PRIORITY[b.dict_id] || 99;
      if (prioA !== prioB) {
        return prioA - prioB;
      }
      return (a.norm_hw?.length || 0) - (b.norm_hw?.length || 0);
    });

    return matchedArticles.map((r) => ({
      ID: r.id,
      DictionaryID: r.dict_id,
      Content: r.html,
      Headword: r.headword,
      IsOffline: true
    }));
  } catch (err) {
    console.error("[VerbumDB] Search error:", err);
    return [];
  }
}

export function suggestOfflineVerbum(prefix: string): string[] {
  const db = getDb();
  if (!db) return [];

  const cleanPrefix = prefix.replace(/[\u0301\u0300\+´]/g, "").toLowerCase().trim();
  if (!cleanPrefix) return [];

  try {
    const stmt = db.prepare("SELECT DISTINCT norm_hw FROM articles WHERE norm_hw LIKE ? ORDER BY length(norm_hw) ASC LIMIT 10");
    const rows = stmt.all(`${cleanPrefix}%`);
    return rows.map((r: any) => r.norm_hw).filter(Boolean);
  } catch (err) {
    console.error("[VerbumDB] Suggest error:", err);
    return [];
  }
}
