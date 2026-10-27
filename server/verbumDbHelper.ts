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

// Core dictionaries ordered by download speed and relevance
const DICTIONARY_SOURCES = [
  {
    id: "klyshka",
    name: "Слоўнік сінонімаў і блізказначных слоў (М. Клышка)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/klyshka/klyshka.html",
    approxArticles: 1950,
  },
  {
    id: "susha",
    name: "Англійска-беларускі слоўнік (Т. Суша, 2013, актуальны правапіс)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/susha/susha.html",
    approxArticles: 26700,
  },
  {
    id: "tsblm2022",
    name: "Тлумачальны слоўнік беларускай літаратурнай мовы (І. Л. Капылоў, 2022)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/tsblm2022/tsblm2022.html",
    approxArticles: 42000,
  },
  {
    id: "rbs10",
    name: "Руска-беларускі слоўнік НАН Беларусі, 10-е выданне",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/rbs10/rbs10.html",
    approxArticles: 50000,
  },
  {
    id: "esbm",
    name: "Этымалагічны слоўнік беларускай мовы (1978—2017)",
    url: "https://raw.githubusercontent.com/verbumby/slouniki/master/esbm/esbm.html",
    approxArticles: 35000,
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
  const regex = /<(?:strong|b)[^>]*class=["']hw["'][^>]*>(.*?)<\/(?:strong|b)>/gi;
  let m;
  const seen = new Set<string>();
  while ((m = regex.exec(rawHtml)) !== null) {
    const rawText = (m[1] || "").replace(/<[^>]+>/g, "").replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "").trim();
    if (rawText) {
      const norm = rawText.replace(/[\u0301\u0300\+]/g, "").toLowerCase().trim();
      if (norm && !seen.has(norm)) {
        seen.add(norm);
        results.push({ headword: rawText, norm });
      }
    }
  }
  if (results.length > 0) return results;

  const match = rawHtml.match(/<(?:strong|b)[^>]*id=["']([^"']+)["'][^>]*>(.*?)<\/(?:strong|b)>/i) ||
                rawHtml.match(/id=["']([^"']+)["'][^>]*><(?:strong|b)>(.*?)<\/(?:strong|b)>/i);
  if (match) {
    const rawText = (match[2] || match[1] || "").replace(/<[^>]+>/g, "").replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "").trim();
    if (rawText) {
      const norm = rawText.replace(/[\u0301\u0300\+]/g, "").toLowerCase().trim();
      if (norm) {
        results.push({ headword: rawText, norm });
      }
    }
  }
  return results;
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

          const rawHtml = await resp.text();
          const rawArticles = rawHtml.split("<hr/>");
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

export function searchOfflineVerbum(query: string, dictId?: string): OfflineVerbumArticle[] {
  const db = getDb();
  if (!db) return [];

  const cleanQuery = query.replace(/[\u0301\u0300\+]/g, "").toLowerCase().trim();
  if (!cleanQuery) return [];

  try {
    let rows: any[] = [];
    if (dictId && dictId !== "all") {
      const stmtExact = db.prepare("SELECT id, dict_id, headword, html FROM articles WHERE dict_id = ? AND norm_hw = ?");
      rows = stmtExact.all(dictId, cleanQuery);

      if (rows.length === 0) {
        const stmtLike = db.prepare("SELECT id, dict_id, headword, html FROM articles WHERE dict_id = ? AND norm_hw LIKE ? LIMIT 15");
        rows = stmtLike.all(dictId, `${cleanQuery}%`);
      }
    } else {
      const stmtExact = db.prepare("SELECT id, dict_id, headword, html FROM articles WHERE norm_hw = ?");
      rows = stmtExact.all(cleanQuery);

      if (rows.length === 0) {
        const stmtLike = db.prepare("SELECT id, dict_id, headword, html FROM articles WHERE norm_hw LIKE ? LIMIT 15");
        rows = stmtLike.all(`${cleanQuery}%`);
      }
    }

    return rows.map((r: any) => ({
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

  const cleanPrefix = prefix.replace(/[\u0301\u0300\+]/g, "").toLowerCase().trim();
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
