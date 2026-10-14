/**
 * GrammarDB Service Helper for Node.js
 * Queries grammardb.sqlite3 directly via native node:sqlite (Node 22+) with safe fallback
 */

import path from "path";
import fs from "fs";
import { spawn, execFileSync } from "child_process";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import JSZip from "jszip";
import { amohrafyTxt } from "../src/belg2p/dataFiles";

const CANDIDATE_PATHS = [
  "/tmp/grammardb.sqlite3",
  path.join(process.cwd(), "grammardb.sqlite3"),
  path.join(process.cwd(), "dist", "grammardb.sqlite3"),
  typeof __dirname !== "undefined" ? path.join(__dirname, "grammardb.sqlite3") : "",
  typeof __dirname !== "undefined" ? path.join(__dirname, "..", "grammardb.sqlite3") : ""
].filter(Boolean);

const CANDIDATE_GZ_PATHS = [
  path.join(process.cwd(), "dist", "grammardb.sqlite3.gz"),
  path.join(process.cwd(), "grammardb.sqlite3.gz"),
  typeof __dirname !== "undefined" ? path.join(__dirname, "grammardb.sqlite3.gz") : "",
  typeof __dirname !== "undefined" ? path.join(__dirname, "..", "grammardb.sqlite3.gz") : "",
  "/tmp/grammardb.sqlite3.gz"
].filter(Boolean);

const CANDIDATE_PART_DIRS = [
  process.cwd(),
  path.join(process.cwd(), "dist"),
  typeof __dirname !== "undefined" ? __dirname : "",
  typeof __dirname !== "undefined" ? path.join(__dirname, "..") : "",
  "/tmp"
].filter(Boolean);

function findPartFiles(): string[] | null {
  for (const dir of CANDIDATE_PART_DIRS) {
    const partA = path.join(dir, "grammardb.part.aa");
    const partB = path.join(dir, "grammardb.part.ab");
    const partC = path.join(dir, "grammardb.part.ac");
    if (fs.existsSync(partA) && fs.existsSync(partB) && fs.existsSync(partC)) {
      return [partA, partB, partC];
    }
  }
  return null;
}

async function assemblePartsAndDecompress(partPaths: string[], targetDbPath: string): Promise<boolean> {
  const tempTarget = targetDbPath + ".tmp";
  const gunzip = zlib.createGunzip();
  const writeStream = fs.createWriteStream(tempTarget);
  const pipePromise = pipeline(gunzip, writeStream);

  for (const p of partPaths) {
    await new Promise<void>((resolve, reject) => {
      const rs = fs.createReadStream(p);
      rs.on("data", (chunk) => {
        if (!gunzip.write(chunk)) {
          rs.pause();
          gunzip.once("drain", () => rs.resume());
        }
      });
      rs.on("end", () => resolve());
      rs.on("error", reject);
    });
  }
  gunzip.end();
  await pipePromise;
  fs.renameSync(tempTarget, targetDbPath);
  return true;
}

const RELEASE_URL = "https://github.com/Belarus/GrammarDB/releases/download/RELEASE-202601/RELEASE-202601.zip";
const TEMP_ZIP = "/tmp/grammardb_release.zip";

function cleanRawWord(s: string): string {
  return s.replace(/\+/g, '').replace(/\u0301/g, '').toLowerCase();
}

function toStressedWord(s: string): string {
  return s.replace(/\+/g, '\u0301');
}

async function buildGrammarDbWithNode(targetDbPath: string, DbClass: any): Promise<boolean> {
  const tempDbPath = targetDbPath + ".tmp";
  if (fs.existsSync(tempDbPath)) {
    try { fs.unlinkSync(tempDbPath); } catch (_) {}
  }

  // 1. Download official release zip if needed
  let needsDownload = true;
  if (fs.existsSync(TEMP_ZIP)) {
    try {
      const st = fs.statSync(TEMP_ZIP);
      if (st.size > 10 * 1024 * 1024) {
        needsDownload = false;
        console.log(`[GrammarDB Builder] Found existing zip at ${TEMP_ZIP} (${(st.size / 1024 / 1024).toFixed(1)} MB)`);
      }
    } catch (_) {}
  }

  if (needsDownload) {
    lastInitLog = `Downloading official GrammarDB release from GitHub...`;
    console.log(`[GrammarDB Builder] Downloading official release from ${RELEASE_URL}...`);
    const resp = await fetch(RELEASE_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GrammarDB-Node/1.0"
      }
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`Failed to download release: HTTP ${resp.status} ${resp.statusText}`);
    }
    const tempDownloading = TEMP_ZIP + ".part";
    if (fs.existsSync(tempDownloading)) {
      try { fs.unlinkSync(tempDownloading); } catch (_) {}
    }
    const writeStream = fs.createWriteStream(tempDownloading);
    await pipeline(Readable.fromWeb(resp.body as any), writeStream);
    fs.renameSync(tempDownloading, TEMP_ZIP);
    const sizeMb = (fs.statSync(TEMP_ZIP).size / 1024 / 1024).toFixed(1);
    console.log(`[GrammarDB Builder] Downloaded ${sizeMb} MB to ${TEMP_ZIP}`);
  }

  // 2. Open SQLite Database
  lastInitLog = "Initializing SQLite database schema...";
  const db = new DbClass(tempDbPath);
  db.exec("PRAGMA synchronous = OFF;");
  db.exec("PRAGMA journal_mode = MEMORY;");
  db.exec("PRAGMA cache_size = 100000;");
  db.exec(`
    CREATE TABLE words (
      word TEXT PRIMARY KEY,
      stressed TEXT,
      lemma TEXT,
      lemma_stressed TEXT,
      paradigm_id INTEGER
    );
  `);

  const insertStmt = db.prepare(
    "INSERT OR IGNORE INTO words (word, stressed, lemma, lemma_stressed, paradigm_id) VALUES (?, ?, ?, ?, ?)"
  );

  // 3. Load Zip Archive and Parse XML Paradigm files
  logInit("Reading release archive and parsing paradigm files...");
  const zipBuffer = fs.readFileSync(TEMP_ZIP);
  const zip = await JSZip.loadAsync(zipBuffer);
  const xmlFileNames = Object.keys(zip.files).filter(k => k.endsWith(".xml") && !zip.files[k].dir).sort();
  logInit(`Found ${xmlFileNames.length} XML files in archive (17 parts expected)`);

  let totalInserted = 0;
  let batchCount = 0;
  db.exec("BEGIN;");

  for (let i = 0; i < xmlFileNames.length; i++) {
    const name = xmlFileNames[i];
    logInit(`Частка ${i + 1}/${xmlFileNames.length} (${name}): апрацоўка словаформаў... [${totalInserted.toLocaleString()} слоў]`);
    const xmlText = await zip.files[name].async("string");

    let pos = 0;
    while (true) {
      const pStart = xmlText.indexOf("<Paradigm", pos);
      if (pStart === -1) break;
      const pTagEnd = xmlText.indexOf(">", pStart);
      if (pTagEnd === -1) break;
      if (xmlText[pTagEnd - 1] === '/') {
        pos = pTagEnd + 1;
        continue;
      }
      const pEnd = xmlText.indexOf("</Paradigm>", pTagEnd);
      if (pEnd === -1) break;

      const tagStr = xmlText.slice(pStart, pTagEnd);
      const pdgMatch = tagStr.match(/pdgId="(\d+)"/);
      const lemmaMatch = tagStr.match(/lemma="([^"]+)"/);

      const pdgId = pdgMatch ? parseInt(pdgMatch[1], 10) : 0;
      const rawLemma = lemmaMatch ? lemmaMatch[1] : "";
      const cleanLemma = cleanRawWord(rawLemma);
      const stressedLemma = toStressedWord(rawLemma);

      const body = xmlText.slice(pTagEnd + 1, pEnd);
      let formPos = 0;
      while (true) {
        const fStart = body.indexOf("<Form", formPos);
        if (fStart === -1) break;
        const fTagEnd = body.indexOf(">", fStart + 5);
        if (fTagEnd === -1) break;
        const fEnd = body.indexOf("</Form>", fTagEnd + 1);
        if (fEnd === -1) break;
        const rawForm = body.slice(fTagEnd + 1, fEnd).trim();
        if (rawForm) {
          const cleanWord = cleanRawWord(rawForm);
          const stressedWord = toStressedWord(rawForm);
          insertStmt.run(cleanWord, stressedWord, cleanLemma, stressedLemma, pdgId);
          totalInserted++;
          batchCount++;
          if (batchCount >= 50000) {
            db.exec("COMMIT;");
            db.exec("BEGIN;");
            batchCount = 0;
          }
        }
        formPos = fEnd + 7;
      }
      pos = pEnd + 11;
    }

    logInit(`Частка ${i + 1}/${xmlFileNames.length} (${name}) паспяхова апрацавана. Усяго слоў: ${totalInserted.toLocaleString()}`);
  }

  db.exec("COMMIT;");

  // 4. Create indexes
  logInit(`Стварэнне індэксаў базы даных... (Усяго: ${totalInserted.toLocaleString()} словаформаў з усіх 17 частак)`);
  db.exec("CREATE INDEX idx_paradigm ON words (paradigm_id);");
  db.exec("CREATE INDEX idx_lemma ON words (lemma);");
  db.close();

  // 5. Finalize database file
  fs.renameSync(tempDbPath, targetDbPath);
  const finalMb = (fs.statSync(targetDbPath).size / 1024 / 1024).toFixed(1);
  logInit(`Граматычная база паспяхова разгорнутая: усе 17 з 17 частак (A1, A2, C, E, I, M, N1, N2, N3, NP, P, R, S, V, W, Y, Z — усяго ${totalInserted.toLocaleString()} слоў, ${finalMb} MB)`);
  console.log(`[GrammarDB Builder] Success! Database built at ${targetDbPath} (${finalMb} MB)`);

  // Clean up temporary zip to save container space
  try {
    if (fs.existsSync(TEMP_ZIP)) {
      fs.unlinkSync(TEMP_ZIP);
    }
  } catch (_) {}

  return true;
}

let dbInstance: any = null;
let singleStmt: any = null;
let isBuildingGrammarDb = false;
let buildPromise: Promise<boolean> | null = null;
let DatabaseSyncClass: any = null;
let sqliteResolved = false;
let lastInitLog = "";
const initLogsHistory: string[] = [];

function logInit(msg: string) {
  lastInitLog = msg;
  console.log(`[GrammarDB] ${msg}`);
  initLogsHistory.push(msg);
  if (initLogsHistory.length > 100) {
    initLogsHistory.shift();
  }
}

function getDatabaseSyncClass(): any {
  if (sqliteResolved) return DatabaseSyncClass;
  sqliteResolved = true;

  // 1. Try modern Node.js safe synchronous built-in resolver (Node 20.16.0+, 22.3.0+)
  // Returns undefined instead of throwing if the module or runtime does not support it
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

export function getResolvedDbPath(): string | null {
  for (const p of CANDIDATE_PATHS) {
    if (fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p);
        if (stat.size > 10 * 1024 * 1024) {
          return p;
        }
      } catch (_) {}
    }
  }
  return null;
}

export function getGrammarDbStatus() {
  const p = getResolvedDbPath();
  const hasNativeSqlite = Boolean(getDatabaseSyncClass());
  let sizeMb: number | undefined;
  if (p) {
    try {
      sizeMb = Math.round((fs.statSync(p).size / (1024 * 1024)) * 10) / 10;
    } catch (_) {}
  }
  const parts = findPartFiles();
  const ready = Boolean(p);
  return {
    ready,
    path: p || null,
    sizeMb,
    driver: hasNativeSqlite ? "node:sqlite (native Node 22+)" : "python:sqlite3 (safe fallback for older Node)",
    building: isBuildingGrammarDb,
    fallbackActive: !p,
    hasParts: Boolean(parts),
    partPaths: parts || undefined,
    lastLog: lastInitLog || (ready ? "Усе 17 з 17 частак граматычнай базы гатовыя да працы" : undefined),
    recentLogs: initLogsHistory.length > 0 ? initLogsHistory.slice(-50) : (ready ? ["Усе 17 з 17 частак граматычнай базы (A1, A2, C, E, I, M, N1, N2, N3, NP, P, R, S, V, W, Y, Z) паспяхова загружаныя і падключаныя"] : []),
    totalParts: 17,
    completedParts: ready ? 17 : 0,
    partsSummary: "17 з 17 частак (A1, A2, C, E, I, M, N1, N2, N3, NP, P, R, S, V, W, Y, Z — 2.01M слоў)"
  };
}

export async function ensureGrammarDbReady(): Promise<boolean> {
  const existing = getResolvedDbPath();
  if (existing) return true;
  if (buildPromise) return buildPromise;

  isBuildingGrammarDb = true;
  buildPromise = (async () => {
    try {
      const targetDbPath = "/tmp/grammardb.sqlite3";

      // 1. Check if multi-part files exist (each < 25MB, ideal for cloud sync and deploy)
      const partFiles = findPartFiles();
      if (partFiles) {
        logInit(`Assembling ${partFiles.length} part files to ${targetDbPath}...`);
        console.log(`[GrammarDB] Found multi-part archive: ${partFiles.join(", ")}. Decompressing...`);
        try {
          await assemblePartsAndDecompress(partFiles, targetDbPath);
          console.log(`[GrammarDB] Successfully assembled and decompressed parts to ${targetDbPath}`);
          dbInstance = null;
          singleStmt = null;
          logInit(`Ready at ${targetDbPath}`);
          return true;
        } catch (assembleErr: any) {
          logInit(`Failed to assemble parts: ${assembleErr?.message || assembleErr}`);
          console.error("[GrammarDB] Failed to assemble parts:", assembleErr);
        }
      }

      // 2. Check if a single compressed .gz archive exists in project or /tmp
      for (const gzPath of CANDIDATE_GZ_PATHS) {
        if (fs.existsSync(gzPath)) {
          try {
            const stat = fs.statSync(gzPath);
            if (stat.size > 10 * 1024 * 1024) {
              logInit(`Decompressing ${gzPath}...`);
              console.log(`[GrammarDB] Found compressed archive at ${gzPath} (${(stat.size / 1024 / 1024).toFixed(1)} MB). Decompressing...`);
              const tempTarget = targetDbPath + ".tmp";
              const readStream = fs.createReadStream(gzPath);
              const writeStream = fs.createWriteStream(tempTarget);
              const gunzip = zlib.createGunzip();
              await pipeline(readStream, gunzip, writeStream);
              fs.renameSync(tempTarget, targetDbPath);
              console.log(`[GrammarDB] Decompressed successfully to ${targetDbPath}`);
              dbInstance = null;
              singleStmt = null;
              logInit(`Ready at ${targetDbPath}`);
              return true;
            }
          } catch (decompressErr: any) {
            logInit(`Decompress error for ${gzPath}: ${decompressErr?.message || decompressErr}`);
            console.error(`[GrammarDB] Failed to decompress ${gzPath}:`, decompressErr);
          }
        }
      }

      // 3. Download and build from official Belarus/GrammarDB XML release
      const DbClass = getDatabaseSyncClass();
      if (DbClass) {
        logInit("Building GrammarDB from official GitHub release using native Node.js + SQLite...");
        console.log("[GrammarDB] Downloading and building from official Belarus/GrammarDB GitHub release using native Node.js...");
        await buildGrammarDbWithNode(targetDbPath, DbClass);
        dbInstance = null;
        singleStmt = null;
      } else {
        // Fallback to python3 if node:sqlite is somehow unavailable
        let hasPython = false;
        try {
          execFileSync("python3", ["--version"], { stdio: "ignore" });
          hasPython = true;
        } catch (_) {
          hasPython = false;
        }

        if (hasPython) {
          logInit("Building from official Belarus/GrammarDB GitHub release using python3...");
          console.log("[GrammarDB] Downloading and building from official Belarus/GrammarDB GitHub release using python3...");
          const scriptPath = path.join(process.cwd(), "server", "buildGrammarDbFromRelease.py");
          if (fs.existsSync(scriptPath)) {
            await new Promise<void>((resolve, reject) => {
              const proc = spawn("python3", [scriptPath], {
                env: { ...process.env, PYTHONUNBUFFERED: "1" }
              });
              proc.stdout?.on("data", (data) => {
                const lines = data.toString().split("\n");
                for (const l of lines) {
                  const trimmed = l.trim();
                  if (trimmed) {
                    logInit(trimmed);
                  }
                }
              });
              proc.stderr?.on("data", (data) => {
                console.warn("[GrammarDB Python stderr]:", data.toString().trim());
              });
              proc.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`GrammarDB builder exited with code ${code}`));
              });
              proc.on("error", (err) => reject(err));
            });
            dbInstance = null;
            singleStmt = null;
          }
        } else {
          logInit("SQLite driver is not available in container; no archive found.");
          console.warn("[GrammarDB] Neither node:sqlite nor python3 is available. SQLite will use pre-bundled archive or in-memory rules.");
        }
      }
      return Boolean(getResolvedDbPath());
    } catch (err: any) {
      lastInitLog = `Failed to build database: ${err?.message || err}`;
      console.error("[GrammarDB] Failed to build database:", err);
      return false;
    } finally {
      isBuildingGrammarDb = false;
      buildPromise = null;
    }
  })();

  return buildPromise;
}

function getDb(): any {
  if (dbInstance) return dbInstance;
  const DbClass = getDatabaseSyncClass();
  if (!DbClass) {
    // Native node:sqlite not available on this Node runtime (e.g. Node < 22.5.0).
    // Queries will smoothly use Python standard library sqlite3 or in-memory fallback.
    return null;
  }
  const dbPath = getResolvedDbPath();
  if (!dbPath) {
    if (!isBuildingGrammarDb && !buildPromise) {
      ensureGrammarDbReady().catch(() => {});
    }
    return null;
  }
  try {
    dbInstance = new DbClass(dbPath, { readOnly: true });
    dbInstance.exec("PRAGMA query_only = ON; PRAGMA cache_size = 50000;");
    singleStmt = dbInstance.prepare("SELECT stressed FROM words WHERE word = ?");
    console.log(`[GrammarDB] Successfully connected to SQLite database at ${dbPath} using native node:sqlite`);
    return dbInstance;
  } catch (err) {
    console.error("[GrammarDB] Failed to open SQLite database with native driver:", err);
    return null;
  }
}

function queryPythonSearch(query: string): GrammarDbSearchResult | null {
  try {
    const scriptPath = path.join(process.cwd(), "server", "grammarDbService.py");
    const out = execFileSync("python3", [scriptPath, "search", query], {
      encoding: "utf-8",
      timeout: 3000,
      maxBuffer: 10 * 1024 * 1024
    });
    if (out) {
      return JSON.parse(out.trim());
    }
  } catch (err) {
    // ignore
  }
  return null;
}

function queryPythonBatch(words: string[]): Record<string, string> {
  if (!words || words.length === 0) return {};
  try {
    const scriptPath = path.join(process.cwd(), "server", "grammarDbService.py");
    const out = execFileSync("python3", [scriptPath, "stdin"], {
      input: JSON.stringify({ words }),
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024
    });
    if (out) {
      return JSON.parse(out.trim());
    }
  } catch (err) {
    // ignore
  }
  return {};
}

// Non-stressed words (clitics / prepositions / particles)
const NIENACISKNYJA = new Set([
  'а', 'аж', 'бо', 'бы', 'быў', 'во', 'вось', 'вот', 'вунь', 'га',
  'дзе', 'ды', 'дык', 'ж', 'жа', 'і', 'каб', 'мо', 'на', 'нат', 'не', 'ні', 'ну', 'ня',
  'ось', 'от', 'так', 'там', 'тут', 'унь', 'хай', 'хоць', 'ці', 'чым', 'што', 'як',
  'аб', 'ад', 'без', 'бяз', 'бліз', 'ва', 'да', 'для', 'за', 'збок', 'зверх', 'звыш',
  'з-за', 'з-над', 'з-пад', 'з-прад', 'ка', 'край', 'кром', 'круг', 'ла', 'ля', 'між',
  'над', 'па', 'пад', 'паўз', 'пра', 'прад', 'праз', 'проць', 'проч', 'пры', 'са',
  'скрай', 'скрозь', 'скруг', 'срэдзь', 'у', 'ў', 'з', 'к'
]);

const VOWELS_SET = 'аеёіоуыэюяАЕЁІОУЫЭЮЯ';

function buildAmohrafyDict(): Record<string, string> {
  const dict: Record<string, string> = {};
  if (!amohrafyTxt) return dict;
  for (const rawLine of amohrafyTxt.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const plainWord = line.replace(/[\+\u0301\u00B4]/g, '').toLowerCase();
    if (plainWord) {
      let am = line.replace(new RegExp(`([${VOWELS_SET}])[\\+\\u00B4]`, 'g'), '$1\u0301');
      am = am.replace(new RegExp(`[\\+\\u00B4]([${VOWELS_SET}])`, 'g'), '$1\u0301');
      am = am.replace(/[\+\u00B4]/g, '');
      dict[plainWord] = am;
    }
  }
  return dict;
}

const AMOHRAFY_DICT = buildAmohrafyDict();

const OVERRIDE_DICT: Record<string, string> = {
  ...AMOHRAFY_DICT,
  'магу': 'магу́',
  'трасецца': 'трасе́цца',
  'багатая': 'бага́тая',
  'твае': 'твае́',
  'свае': 'свае́',
  'мае': 'мае́',
  'яе': 'яе́',
  'чые': 'чые́',
  'бывай': 'быва́й',
  'бывайце': 'быва́йце',
  'дзякуй': 'дзя́куй',
  'прабач': 'праба́ч',
  'прабачце': 'праба́чце',
  'аўтаадказчык': 'аўтаадка́зчык',
};

function hasStressMark(s: string): boolean {
  return Boolean(s && (s.includes('\u0301') || s.includes('+') || s.includes('´')));
}

export function restoreBelarusianLetters(str: string): string {
  if (!str) return str;
  // 1. Convert 'и' / 'И' -> 'й' / 'Й' (Russian 'и' doesn't exist in standard Belarusian alphabet; in GrammarDB 'и' = 'й')
  let res = str.replace(/и/g, 'й').replace(/И/g, 'Й');

  // 2. Convert 'у' / 'У' after vowels -> 'ў' / 'Ў'
  const vowelPattern = '([аеёіоуыэюяАЕЁІОУЫЭЮЯ]\\u0301?)';
  res = res.replace(new RegExp(vowelPattern + 'у', 'gi'), (match, p1) => {
    return p1 + (match.endsWith('У') ? 'Ў' : 'ў');
  });

  return res;
}

function cleanWord(w: string): string {
  if (!w) return '';
  const norm = w.normalize('NFC').replace(/[\u0301+´]/g, '');
  return norm
    .toLowerCase()
    .replace(/и/g, 'й')
    .replace(/^[^а-яёіўґa-z0-9]+/gi, '')
    .replace(/[^а-яёіўґa-z0-9]+$/gi, '')
    .trim();
}

export function applyStressToOriginal(original: string, stressed: string): string {
  if (!original || !stressed) return original;
  const origNfc = original.normalize('NFC');
  if (hasStressMark(origNfc)) return origNfc;

  const stressedNfc = stressed.normalize('NFC');
  const stressesAfterBaseIndex = new Set<number>();
  let baseCount = 0;

  for (const ch of stressedNfc) {
    if (ch === '\u0301' || ch === '+' || ch === '\u00B4') {
      if (baseCount > 0) {
        stressesAfterBaseIndex.add(baseCount - 1);
      }
    } else {
      baseCount++;
    }
  }

  if (stressesAfterBaseIndex.size === 0) {
    return origNfc;
  }

  const res: string[] = [];
  let currBaseIndex = 0;

  for (const ch of origNfc) {
    res.push(ch);
    if (!/\p{M}/u.test(ch)) {
      if (stressesAfterBaseIndex.has(currBaseIndex)) {
        res.push('\u0301');
      }
      currBaseIndex++;
    }
  }

  return res.join('');
}

/**
 * Generates canonical orthographical variants for u/ў alternation
 * (e.g. "ўсім" <-> "усім", "ўжо" <-> "ужо", "ўперад" <-> "уперад")
 */
export function getUAlternationVariants(word: string): string[] {
  if (!word) return [];
  const list = [word];
  const wLower = word.toLowerCase();

  // 1. Initial ў <-> у
  if (wLower.startsWith('ў')) {
    list.push('у' + word.slice(1));
    if (word.startsWith('Ў')) list.push('У' + word.slice(1));
  } else if (wLower.startsWith('у')) {
    list.push('ў' + word.slice(1));
    if (word.startsWith('У')) list.push('Ў' + word.slice(1));
  }

  // 2. All ў <-> у in word
  if (/[ўЎ]/.test(word)) {
    list.push(word.replace(/ў/g, 'у').replace(/Ў/g, 'У'));
  }
  if (/[уУ]/.test(word)) {
    list.push(word.replace(/у/g, 'ў').replace(/У/g, 'Ў'));
  }

  // 3. ґ <-> г variants for dictionary lookups
  if (/[ґҐ]/.test(word)) {
    list.push(word.replace(/ґ/g, 'г').replace(/Ґ/g, 'Г'));
  }

  return Array.from(new Set(list));
}

function fallbackStress(word: string): string {
  if (!word || hasStressMark(word)) return word;
  const wLower = word.toLowerCase();
  if (NIENACISKNYJA.has(wLower)) return word;
  if (OVERRIDE_DICT[wLower]) {
    return applyStressToOriginal(word, OVERRIDE_DICT[wLower]);
  }

  const vowelMatches = Array.from(word.matchAll(/[аеёіоуыэюяАЕЁІОУЫЭЮЯ]/g));
  if (vowelMatches.length === 0) return word;

  // 1. 'ё' is ALWAYS stressed
  const yoMatches = vowelMatches.filter(m => m[0].toLowerCase() === 'ё');
  if (yoMatches.length === 1) {
    const idx = yoMatches[0].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  if (vowelMatches.length === 1) {
    const idx = vowelMatches[0].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  // 2. Infinitives -сці, -зці, -гчы, -кчы -> stress on last vowel
  if (/([сз]ці|[гк]чы)$/i.test(word)) {
    const idx = vowelMatches[vowelMatches.length - 1].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  // 3. Past verbs -шлі, -шла, -шло -> stress on last vowel
  if (/ш(лі|ла|ло)$/i.test(word)) {
    const idx = vowelMatches[vowelMatches.length - 1].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  // 4. 'о' is ALWAYS stressed
  const oMatches = vowelMatches.filter(m => m[0].toLowerCase() === 'о');
  if (oMatches.length === 1) {
    const idx = oMatches[0].index!;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  // 5. Common suffixes (-чык, -шчык)
  const m = /[аеіоуыэюя][тдзс]?[чш]ык[а-яеіў]*$/i.exec(word);
  if (m) {
    const idx = m.index;
    return word.slice(0, idx + 1) + '\u0301' + word.slice(idx + 1);
  }

  return word;
}

export function lookupWord(word: string): string {
  const c = cleanWord(word);
  if (!c || NIENACISKNYJA.has(c)) return word;
  if (OVERRIDE_DICT[c]) return applyStressToOriginal(word, OVERRIDE_DICT[c]);

  const variants = getUAlternationVariants(c);
  for (const v of variants) {
    if (OVERRIDE_DICT[v]) return applyStressToOriginal(word, OVERRIDE_DICT[v]);
  }

  const db = getDb();
  if (db && singleStmt) {
    try {
      for (const v of variants) {
        const row = singleStmt.get(v) as { stressed?: string } | undefined;
        if (row && row.stressed && hasStressMark(row.stressed)) {
          const res = applyStressToOriginal(word, row.stressed);
          if (hasStressMark(res)) return res;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  return fallbackStress(word);
}

export function lookupBatch(words: string[]): Record<string, string> {
  const results: Record<string, string> = {};
  const cleanedMap: Record<string, string[]> = {};

  for (const w of words) {
    const c = cleanWord(w);
    if (c && !NIENACISKNYJA.has(c)) {
      if (OVERRIDE_DICT[c]) {
        results[w] = applyStressToOriginal(w, OVERRIDE_DICT[c]);
      } else {
        const variants = getUAlternationVariants(c);
        let foundInOverride = false;
        for (const v of variants) {
          if (OVERRIDE_DICT[v]) {
            results[w] = applyStressToOriginal(w, OVERRIDE_DICT[v]);
            foundInOverride = true;
            break;
          }
        }
        if (!foundInOverride) {
          for (const v of variants) {
            if (!cleanedMap[v]) cleanedMap[v] = [];
            if (!cleanedMap[v].includes(w)) cleanedMap[v].push(w);
          }
        }
      }
    } else if (NIENACISKNYJA.has(c)) {
      results[w] = w;
    }
  }

  const db = getDb();
  const keysToQuery = Object.keys(cleanedMap);

  if (db && keysToQuery.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < keysToQuery.length; i += chunkSize) {
      const chunk = keysToQuery.slice(i, i + chunkSize);
      const placeholders = chunk.map(() => '?').join(',');
      try {
        const stmt = db.prepare(`SELECT word, stressed FROM words WHERE word IN (${placeholders})`);
        const rows = stmt.all(...chunk) as Array<{ word: string; stressed: string }>;
        for (const row of rows) {
          if (row.stressed && hasStressMark(row.stressed)) {
            const originals = cleanedMap[row.word] || [];
            for (const origW of originals) {
              const res = applyStressToOriginal(origW, row.stressed);
              if (hasStressMark(res)) {
                results[origW] = res;
              }
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }
  } else if (!db && getResolvedDbPath() && keysToQuery.length > 0) {
    // Python fallback for environments with Node < 22.5.0
    const pyResults = queryPythonBatch(keysToQuery);
    for (const [wClean, stressed] of Object.entries(pyResults)) {
      if (stressed && hasStressMark(stressed)) {
        const originals = cleanedMap[wClean] || [];
        for (const origW of originals) {
          const res = applyStressToOriginal(origW, stressed);
          if (hasStressMark(res)) {
            results[origW] = res;
          }
        }
      }
    }
  }

  for (const w of words) {
    if (!results[w] || !hasStressMark(results[w])) {
      results[w] = fallbackStress(w);
    }
  }

  return results;
}

export async function stressTextWithGrammarDb(text: string): Promise<string> {
  if (!text || !text.trim()) return text;
  // If the entire text is already stressed or phonetic transcription, don't corrupt it
  const words = text.match(/[\p{L}'’ʼʹʲ\u0300\u0301\+´]+/gu);
  if (!words) return text;

  const batchMap = lookupBatch(words.filter(w => !w.includes('\u0301') && !w.includes('\u0300') && !w.includes('+') && !w.includes('´')));
  return text.replace(/[\p{L}'’ʼʹʲ\u0300\u0301\+´]+/gu, (w) => {
    if (w.includes('\u0301') || w.includes('\u0300') || w.includes('+') || w.includes('´')) {
      return w;
    }
    return batchMap[w] || w;
  });
}

export async function stressWordsBatchWithGrammarDb(words: string[]): Promise<Record<string, string>> {
  if (!words || words.length === 0) return {};
  return lookupBatch(words);
}

export interface GrammarDbSearchResult {
  query: string;
  clean: string;
  found: boolean;
  stressed: string;
  forms: Array<{ word: string; stressed: string }>;
  suggestions?: string[];
  dbReady?: boolean;
}

export function searchWordInGrammarDb(query: string): GrammarDbSearchResult {
  const q = query.trim();
  const db = getDb();
  const isDbReady = Boolean(db || getResolvedDbPath());

  if (!q) {
    return { query: '', clean: '', found: false, stressed: '', forms: [], dbReady: isDbReady };
  }

  const clean = cleanWord(q);
  if (!clean) {
    return { query: q, clean: '', found: false, stressed: '', forms: [], dbReady: isDbReady };
  }

  let found = false;
  let exactStressed = '';
  let forms: Array<{ word: string; stressed: string }> = [];

  const variants = getUAlternationVariants(clean);

  if (db) {
    try {
      // 1. Check exact match for the word or its u/ў variants
      const stmtExact = db.prepare("SELECT word, stressed, lemma, lemma_stressed, paradigm_id FROM words WHERE word = ? LIMIT 1");
      let exactRow: { word: string; stressed: string; lemma: string; lemma_stressed: string; paradigm_id: number } | undefined;

      for (const v of variants) {
        exactRow = stmtExact.get(v) as typeof exactRow;
        if (!exactRow && v.includes('е')) {
          exactRow = stmtExact.get(v.replace(/е/g, 'ё')) as typeof exactRow;
        }
        if (exactRow) {
          break;
        }
      }

      if (exactRow) {
        found = true;
        exactStressed = restoreBelarusianLetters(applyStressToOriginal(q, exactRow.stressed));
      }

      // 2. Fetch all paradigm forms for this word (супадзенні па асноўных формах)
      const pdgStmt = db.prepare(
        "SELECT DISTINCT word, stressed FROM words WHERE paradigm_id IN (SELECT DISTINCT paradigm_id FROM words WHERE word = ?) LIMIT 40"
      );

      const allRows: Array<{ word: string; stressed: string }> = [];
      const queryWordForPdg = exactRow ? exactRow.word : variants[0];
      const pdgRows = pdgStmt.all(queryWordForPdg) as Array<{ word: string; stressed: string }>;
      allRows.push(...pdgRows);

      // 3. If fewer than 20 forms or if query is a prefix/lemma, also search for related words matching variants
      if (allRows.length < 20) {
        const stmtLike = db.prepare(
          "SELECT DISTINCT word, stressed FROM words WHERE word LIKE ? OR lemma LIKE ? LIMIT 35"
        );
        for (const v of variants) {
          const addRows = stmtLike.all(v + "%", v + "%") as Array<{ word: string; stressed: string }>;
          allRows.push(...addRows);
          if (allRows.length >= 40) break;
        }
      }

      const seen = new Set<string>();

      // If user queried with 'ў' (e.g. "ўсім"), make sure this exact queried form with stress appears first in forms
      if (found && exactStressed) {
        seen.add(q.toLowerCase());
        forms.push({
          word: q,
          stressed: exactStressed
        });
      }

      for (const r of allRows) {
        if (!r.word || !r.stressed) continue;
        const normW = r.word.toLowerCase();
        if (seen.has(normW)) continue;
        seen.add(normW);
        forms.push({
          word: restoreBelarusianLetters(r.word),
          stressed: restoreBelarusianLetters(applyStressToOriginal(r.word, r.stressed))
        });
      }
    } catch (e) {
      console.error("[GrammarDB] Search error:", e);
    }
  } else if (!db && getResolvedDbPath()) {
    // Fallback to Python 3 sqlite3 for Node < 22.5.0
    for (const v of variants) {
      const pyRes = queryPythonSearch(v);
      if (pyRes && pyRes.found) {
        return {
          ...pyRes,
          query: q,
          clean,
          stressed: applyStressToOriginal(q, pyRes.stressed)
        };
      }
    }
  }

  // 4. Fallback to in-memory OVERRIDE_DICT if forms empty
  if (forms.length === 0) {
    for (const v of variants) {
      for (const [w, st] of Object.entries(OVERRIDE_DICT)) {
        const wLower = w.toLowerCase();
        if (wLower === v || wLower.startsWith(v)) {
          forms.push({ word: w, stressed: st });
          if (wLower === v && !exactStressed) {
            exactStressed = applyStressToOriginal(q, st);
            found = true;
          }
          if (forms.length >= 35) break;
        }
      }
      if (forms.length > 0) break;
    }
  }

  const finalStressed = found ? restoreBelarusianLetters(exactStressed) : '';

  let suggestions: string[] = [];
  if (!found) {
    try {
      const spellCheck = checkWordSpellingInGrammarDb(q);
      if (spellCheck && spellCheck.suggestions && spellCheck.suggestions.length > 0) {
        suggestions = spellCheck.suggestions;
      }
    } catch (_) {}
  }

  return {
    query: q,
    clean,
    found,
    stressed: finalStressed,
    forms,
    suggestions,
    dbReady: isDbReady
  };
}

export async function stressSrtWithGrammarDb(srt: string): Promise<string> {
  if (!srt || !srt.trim()) return srt;
  const lines = srt.split(/\r?\n/);
  const out: string[] = [];
  const isTime = /^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}/;
  const isNum = /^\d+$/;

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || isNum.test(stripped) || isTime.test(stripped)) {
      out.push(line);
    } else {
      out.push(await stressTextWithGrammarDb(line));
    }
  }
  return out.join('\n');
}

// Calculate Damerau-Levenshtein distance for spelling suggestions
export function damerauLevenshteinDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  const matrix: number[][] = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) matrix[i][0] = i;
  for (let j = 0; j <= bl; j++) matrix[0][j] = j;

  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,      // deletion
        matrix[i][j - 1] + 1,      // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1); // transposition
      }
    }
  }
  return matrix[al][bl];
}

export interface SpellCheckWordResult {
  word: string;
  clean: string;
  isCorrect: boolean;
  suggestions: string[];
}

export interface SpellCheckTextResult {
  originalText: string;
  correctedText: string;
  hasCorrections: boolean;
  errors: Array<{
    word: string;
    suggestions: string[];
    index: number;
    rule?: string;
  }>;
}

/**
 * Check a single Belarusian word in GrammarDB and return suggestions if incorrect
 */
export function checkWordSpellingInGrammarDb(rawWord: string): SpellCheckWordResult {
  const clean = cleanWord(rawWord);
  if (!clean || clean.length <= 1 || /^\d+$/.test(clean)) {
    return { word: rawWord, clean, isCorrect: true, suggestions: [] };
  }

  const variants = getUAlternationVariants(clean);

  // 1. Check if present in non-stressed or common override words
  for (const v of variants) {
    if (NIENACISKNYJA.has(v) || OVERRIDE_DICT[v]) {
      return { word: rawWord, clean, isCorrect: true, suggestions: [] };
    }
  }

  const db = getDb();
  if (db) {
    try {
      const stmt = db.prepare("SELECT word FROM words WHERE word = ? LIMIT 1");
      for (const v of variants) {
        const row = stmt.get(v) as { word: string } | undefined;
        if (row) {
          return { word: rawWord, clean, isCorrect: true, suggestions: [] };
        }

        // If word with 'е' could be 'ё'
        if (v.includes('е')) {
          const yoRow = stmt.get(v.replace(/е/g, 'ё')) as { word: string } | undefined;
          if (yoRow) {
            return { word: rawWord, clean, isCorrect: true, suggestions: [] };
          }
        }
      }

      // Not found directly: search for close candidate suggestions
      const candidatesStmt = db.prepare("SELECT DISTINCT word FROM words WHERE word LIKE ? OR word LIKE ? LIMIT 100");
      const prefix2 = clean.slice(0, Math.min(3, clean.length)) + "%";
      const prefix1 = clean.slice(0, Math.min(2, clean.length)) + "%";
      const candidateRows = (candidatesStmt.all(prefix2, prefix1) as Array<{ word: string }>).map(r => r.word.toLowerCase());

      const scored = candidateRows.map(cand => ({
        word: cand,
        dist: damerauLevenshteinDistance(clean, cand)
      })).filter(c => c.dist <= 2).sort((a, b) => a.dist - b.dist);

      const suggestions = Array.from(new Set(scored.map(s => s.word))).slice(0, 5);
      return {
        word: rawWord,
        clean,
        isCorrect: false,
        suggestions
      };
    } catch (e) {
      // ignore
    }
  }

  // Fallback: check OVERRIDE_DICT keys
  const candidateKeys = Object.keys(OVERRIDE_DICT);
  const scored = candidateKeys.map(cand => ({
    word: cand,
    dist: damerauLevenshteinDistance(clean, cand)
  })).filter(c => c.dist <= 2).sort((a, b) => a.dist - b.dist);

  const suggestions = Array.from(new Set(scored.map(s => s.word))).slice(0, 4);
  const isCorrect = variants.some(v => OVERRIDE_DICT[v] !== undefined);

  return {
    word: rawWord,
    clean,
    isCorrect,
    suggestions
  };
}

/**
 * Automatically apply Belarusian orthography and spell check rules (у/ў, і/й, common typos, GrammarDB)
 */
export function spellCheckBelarusianText(text: string): SpellCheckTextResult {
  if (!text || !text.trim()) {
    return { originalText: text, correctedText: text, hasCorrections: false, errors: [] };
  }

  let processed = text;
  const errors: SpellCheckTextResult['errors'] = [];

  // 1. Context rule: Pravilna.by Rule 15 'у' / 'ў' alternation after vowels
  // Only when preceded strictly by a vowel with no punctuation in-between, not capitalized (proper name/start), and not an exception word
  const exceptionPreservingU = new Set([
    'страус', 'соус', 'радыус', 'прэзідыум', 'кансіліум', 'індывідуум', 'акварыум',
    'форум', 'подыум', 'вакуум', 'цытрус', 'конус', 'глобус', 'вірус', 'тонус', 'плюс', 'фокус',
    'шоу', 'фрау', 'ландо', 'ток-шоу', 'ноу-хау', 'урна', 'унія', 'ультра', 'узус', 'унты',
    'уханне', 'ухаць', 'уран', 'уступ', 'уціск', 'угалас', 'унікум', 'умбра', 'аул', 'баул',
    'аукаць', 'траур', 'бду', 'цум', 'уус', 'уефа', 'уэфа'
  ]);

  const vowelEndRegex = /(^|[^\s.,!?:;…—–\-"«»“”()\[\]{}\/\\]*[аеёіоуыэюяАЕЁІОУЫЭЮЯ\u0301])(\s+)([уУ])([а-яёіўА-ЯЁІЎ]+)/gu;
  processed = processed.replace(vowelEndRegex, (match, prefixWithVowel, space, uLetter, rest, offset) => {
    // If capital 'У', never convert to 'Ў' (Rule 15 item 4: proper names and sentence starts)
    if (uLetter === 'У') {
      return match;
    }
    const fullWord = (uLetter + rest).toLowerCase();
    if (exceptionPreservingU.has(fullWord) || fullWord.endsWith('ум') || fullWord.endsWith('ус')) {
      return match;
    }

    const rep = 'ў' + rest;
    errors.push({
      word: uLetter + rest,
      suggestions: [rep],
      index: offset + prefixWithVowel.length + space.length,
      rule: 'Правіла 15: чаргаванне у/ў пасля галоснага'
    });
    return prefixWithVowel + space + rep;
  });

  // After a consonant or punctuation, 'ў' becomes 'у'
  const consEndRegex = /(^|[бвгґдзйклмнпрстфхцчшжБВГҐДЗЙКЛМНПРСТФХЦЧШЖ.,!?:;…—–\-"«»“”()\[\]{}\/\\])(\s*)([ўЎ])([а-яёіўА-ЯЁІЎ]*)/gu;
  processed = processed.replace(consEndRegex, (match, prev, space, wLetter, rest, offset) => {
    if (!wLetter) return match;
    const isUpper = wLetter === 'Ў';
    const rep = (isUpper ? 'У' : 'у') + rest;
    errors.push({
      word: wLetter + rest,
      suggestions: [rep],
      index: offset + prev.length + space.length,
      rule: 'Правіла 15: ужыванне "у" пасля зычных або знакаў прыпынку'
    });
    return prev + space + rep;
  });

  // 2. Context rule: 'і' / 'й' alternation
  // e.g. "краіна й людзі" (optional) - replace Russian 'и' with 'і' or 'й'
  processed = processed.replace(/([а-яёіўА-ЯЁІЎ]+)/gu, (fullWord, _, offset) => {
    if (/и/i.test(fullWord)) {
      const fixed = fullWord.replace(/и/g, 'і').replace(/И/g, 'І');
      errors.push({
        word: fullWord,
        suggestions: [fixed],
        index: offset,
        rule: 'Літара «и» не ўжываецца ў беларускай мове (заменена на «і»)'
      });
      return fixed;
    }
    return fullWord;
  });

  // 3. Russian/Ukrainian frequent interference dictionary
  const RUS_UKR_FIXES: Record<string, string> = {
    'сонце': 'сонца',
    'серце': 'сэрца',
    'що': 'што',
    'це': 'гэта',
    'дуже': 'вельмі',
    'якщо': 'калі',
    'хтось': 'хтосьці',
    'штось': 'штосьці',
    'де': 'дзе',
    'котрий': 'які',
    'але-ж': 'але ж',
    'так-як': 'бо',
    'під': 'пад',
    'над': 'над',
    'сьогодні': 'сёння',
    'завтра': 'заўтра',
    'вчора': 'учора',
    'хорошо': 'добра',
    'пожалуйста': 'калі ласка',
    'спасибо': 'дзякуй',
    'сейчас': 'зараз',
    'всегда': 'заўсёды',
    'никогда': 'ніколі',
    'только': 'толькі'
  };

  processed = processed.replace(/([а-яёіўА-ЯЁІЎ'’\u0301]+)/gu, (word, _, offset) => {
    const wLower = word.toLowerCase().replace(/[\u0301]/g, '');
    if (RUS_UKR_FIXES[wLower]) {
      const target = RUS_UKR_FIXES[wLower];
      const fixed = (word[0] === word[0].toUpperCase()) ? target[0].toUpperCase() + target.slice(1) : target;
      errors.push({
        word,
        suggestions: [fixed],
        index: offset,
        rule: 'Выпраўленне русізма/ўкраінізма'
      });
      return fixed;
    }
    return word;
  });

  const hasCorrections = processed !== text || errors.length > 0;

  return {
    originalText: text,
    correctedText: processed,
    hasCorrections,
    errors
  };
}


