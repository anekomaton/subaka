use rusqlite::{Connection, OpenFlags, params};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarWordRecord {
    pub word: String,
    pub stressed: String,
    pub lemma: Option<String>,
    pub lemma_stressed: Option<String>,
    pub paradigm_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarSearchResult {
    pub query: String,
    pub clean: String,
    pub found: bool,
    pub stressed: String,
    pub lemma: Option<String>,
    pub forms: Vec<GrammarWordRecord>,
    pub db_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrammarDbStatus {
    pub ready: bool,
    pub path: Option<String>,
    pub size_mb: Option<f64>,
    pub total_forms: Option<i64>,
    pub driver: String,
    pub message: String,
}

pub struct GrammarDbManager {
    db_path: Mutex<Option<PathBuf>>,
    conn: Mutex<Option<Connection>>,
}

impl GrammarDbManager {
    pub fn new() -> Self {
        Self {
            db_path: Mutex::new(None),
            conn: Mutex::new(None),
        }
    }

    pub fn initialize(&self, app: &AppHandle) -> GrammarDbStatus {
        let mut db_path_lock = self.db_path.lock().unwrap();
        let mut conn_lock = self.conn.lock().unwrap();

        // Potential paths to locate grammardb.sqlite3
        let mut candidate_paths: Vec<PathBuf> = Vec::new();

        // 1. Program resources directory: <exe_dir>/resources/grammardb.sqlite3
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                candidate_paths.push(exe_dir.join("resources").join("grammardb.sqlite3"));
                candidate_paths.push(exe_dir.join("grammardb.sqlite3"));
            }
        }

        // 2. Resource dir bundled with desktop application
        if let Ok(res_dir) = app.path().resource_dir() {
            candidate_paths.push(res_dir.join("resources").join("grammardb.sqlite3"));
            candidate_paths.push(res_dir.join("grammardb.sqlite3"));
        }

        // 3. App local data directory (e.g. %LOCALAPPDATA%/SUBaka)
        if let Ok(app_dir) = app.path().app_local_data_dir() {
            candidate_paths.push(app_dir.join("resources").join("grammardb.sqlite3"));
            candidate_paths.push(app_dir.join("grammardb.sqlite3"));
        }

        // 4. Current working directory
        if let Ok(cwd) = std::env::current_dir() {
            candidate_paths.push(cwd.join("resources").join("grammardb.sqlite3"));
            candidate_paths.push(cwd.join("grammardb.sqlite3"));
            candidate_paths.push(cwd.join("dist").join("grammardb.sqlite3"));
        }

        // 5. System temp directory
        candidate_paths.push(PathBuf::from("/tmp/grammardb.sqlite3"));
        candidate_paths.push(std::env::temp_dir().join("grammardb.sqlite3"));

        // Check candidate paths, including auto-recovery for grammardb.sqlite3.tmp
        let mut final_paths: Vec<PathBuf> = Vec::new();
        for p in candidate_paths {
            if !p.exists() {
                let tmp_p = p.with_file_name("grammardb.sqlite3.tmp");
                if tmp_p.exists() {
                    // Try to rename .tmp to .sqlite3, or use .tmp directly if folder is read-only
                    if std::fs::rename(&tmp_p, &p).is_ok() {
                        final_paths.push(p);
                    } else {
                        final_paths.push(tmp_p);
                    }
                    continue;
                }
            }
            final_paths.push(p);
        }

        for p in final_paths {
            if p.exists() {
                if let Ok(conn) = Connection::open_with_flags(
                    &p,
                    OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
                ) {
                    // Optimize read performance
                    let _ = conn.execute_batch(
                        "PRAGMA query_only = 1;
                         PRAGMA mmap_size = 268435456;
                         PRAGMA cache_size = -64000;",
                    );

                    let size_bytes = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    let size_mb = (size_bytes as f64) / (1024.0 * 1024.0);

                    // Count forms if fast
                    let total_forms: Option<i64> = conn
                        .query_row("SELECT count(*) FROM words", [], |row| row.get(0))
                        .ok();

                    let path_str = p.to_string_lossy().to_string();
                    *db_path_lock = Some(p);
                    *conn_lock = Some(conn);

                    return GrammarDbStatus {
                        ready: true,
                        path: Some(path_str),
                        size_mb: Some(size_mb),
                        total_forms,
                        driver: "rusqlite-native".into(),
                        message: "GrammarDB ready (native Rust SQLite)".into(),
                    };
                }
            }
        }

        GrammarDbStatus {
            ready: false,
            path: None,
            size_mb: None,
            total_forms: None,
            driver: "rusqlite-native".into(),
            message: "GrammarDB database file not found in search paths".into(),
        }
    }

    pub fn get_status(&self) -> GrammarDbStatus {
        let db_path_lock = self.db_path.lock().unwrap();
        let conn_lock = self.conn.lock().unwrap();

        if let (Some(path), Some(conn)) = (db_path_lock.as_ref(), conn_lock.as_ref()) {
            let size_bytes = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            let size_mb = (size_bytes as f64) / (1024.0 * 1024.0);
            let total_forms: Option<i64> = conn
                .query_row("SELECT count(*) FROM words", [], |row| row.get(0))
                .ok();

            GrammarDbStatus {
                ready: true,
                path: Some(path.to_string_lossy().to_string()),
                size_mb: Some(size_mb),
                total_forms,
                driver: "rusqlite-native".into(),
                message: "GrammarDB ready (native Rust SQLite)".into(),
            }
        } else {
            GrammarDbStatus {
                ready: false,
                path: None,
                size_mb: None,
                total_forms: None,
                driver: "rusqlite-native".into(),
                message: "GrammarDB is not currently opened".into(),
            }
        }
    }

    pub fn clean_word(word: &str) -> String {
        word.trim()
            .to_lowercase()
            .replace(['+', '\u{0301}', '\u{0300}'], "")
            .chars()
            .filter(|c| c.is_alphabetic() || *c == '\'' || *c == '’' || *c == '-')
            .collect()
    }

    pub fn get_u_variants(word: &str) -> Vec<String> {
        let mut variants = vec![word.to_string()];
        if word.starts_with('ў') {
            variants.push(format!("у{}", &word['ў'.len_utf8()..]));
        } else if word.starts_with('у') {
            variants.push(format!("ў{}", &word['у'.len_utf8()..]));
        }
        variants
    }

    pub fn lookup(&self, query: &str) -> GrammarSearchResult {
        let clean = Self::clean_word(query);
        let conn_lock = self.conn.lock().unwrap();

        if conn_lock.is_none() || clean.is_empty() {
            return GrammarSearchResult {
                query: query.to_string(),
                clean: clean.clone(),
                found: false,
                stressed: String::new(),
                lemma: None,
                forms: Vec::new(),
                db_ready: conn_lock.is_some(),
            };
        }

        let conn = conn_lock.as_ref().unwrap();
        let variants = Self::get_u_variants(&clean);

        // Try exact match in variants
        for variant in &variants {
            let mut stmt = match conn.prepare(
                "SELECT word, stressed, lemma, lemma_stressed, paradigm_id FROM words WHERE word = ? LIMIT 1",
            ) {
                Ok(s) => s,
                Err(_) => continue,
            };

            let row = stmt.query_row(params![variant], |r| {
                Ok(GrammarWordRecord {
                    word: r.get(0)?,
                    stressed: r.get(1)?,
                    lemma: r.get(2).ok(),
                    lemma_stressed: r.get(3).ok(),
                    paradigm_id: r.get(4).ok(),
                })
            });

            if let Ok(matched) = row {
                let mut related_forms = Vec::new();
                if let Some(pid) = matched.paradigm_id {
                    if let Ok(mut stmt_forms) = conn.prepare(
                        "SELECT word, stressed, lemma, lemma_stressed, paradigm_id FROM words WHERE paradigm_id = ? LIMIT 50",
                    ) {
                        if let Ok(rows) = stmt_forms.query_map(params![pid], |r| {
                            Ok(GrammarWordRecord {
                                word: r.get(0)?,
                                stressed: r.get(1)?,
                                lemma: r.get(2).ok(),
                                lemma_stressed: r.get(3).ok(),
                                paradigm_id: r.get(4).ok(),
                            })
                        }) {
                            for f in rows.flatten() {
                                related_forms.push(f);
                            }
                        }
                    }
                }

                return GrammarSearchResult {
                    query: query.to_string(),
                    clean: clean.clone(),
                    found: true,
                    stressed: matched.stressed.clone(),
                    lemma: matched.lemma.clone(),
                    forms: related_forms,
                    db_ready: true,
                };
            }
        }

        GrammarSearchResult {
            query: query.to_string(),
            clean,
            found: false,
            stressed: String::new(),
            lemma: None,
            forms: Vec::new(),
            db_ready: true,
        }
    }

    pub fn batch_check(&self, words: Vec<String>) -> HashMap<String, bool> {
        let mut results = HashMap::new();
        let conn_lock = self.conn.lock().unwrap();

        if let Some(conn) = conn_lock.as_ref() {
            let mut stmt = match conn.prepare("SELECT 1 FROM words WHERE word = ? LIMIT 1") {
                Ok(s) => s,
                Err(_) => {
                    for w in words {
                        results.insert(w, false);
                    }
                    return results;
                }
            };

            for w in words {
                let clean = Self::clean_word(&w);
                if clean.is_empty() {
                    results.insert(w, false);
                    continue;
                }
                let variants = Self::get_u_variants(&clean);
                let mut found = false;
                for v in variants {
                    if stmt.exists(params![v]).unwrap_or(false) {
                        found = true;
                        break;
                    }
                }
                results.insert(w, found);
            }
        } else {
            for w in words {
                results.insert(w, false);
            }
        }

        results
    }

    pub fn stress_text(&self, text: &str) -> String {
        let conn_lock = self.conn.lock().unwrap();
        if conn_lock.is_none() || text.trim().is_empty() {
            return text.to_string();
        }
        let conn = conn_lock.as_ref().unwrap();

        let mut stmt = match conn.prepare("SELECT stressed FROM words WHERE word = ? LIMIT 1") {
            Ok(s) => s,
            Err(_) => return text.to_string(),
        };

        let mut result = String::with_capacity(text.len());
        let chars: Vec<char> = text.chars().collect();
        let mut i = 0;

        while i < chars.len() {
            let c = chars[i];
            if c.is_alphabetic() || c == '\'' || c == '’' || c == '\u{0301}' || c == '+' {
                let start = i;
                while i < chars.len() && (chars[i].is_alphabetic() || chars[i] == '\'' || chars[i] == '’' || chars[i] == '\u{0301}' || chars[i] == '+') {
                    i += 1;
                }
                let raw_word: String = chars[start..i].iter().collect();
                if raw_word.contains('\u{0301}') || raw_word.contains('+') {
                    result.push_str(&raw_word);
                } else {
                    let clean = Self::clean_word(&raw_word);
                    let mut replaced: Option<String> = None;
                    for v in Self::get_u_variants(&clean) {
                        if let Ok(st) = stmt.query_row(params![v], |r| r.get::<_, String>(0)) {
                            let is_first_upper = raw_word.chars().next().map(|c| c.is_uppercase()).unwrap_or(false);
                            let final_st = if is_first_upper {
                                let mut c_iter = st.chars();
                                match c_iter.next() {
                                    Some(first) => first.to_uppercase().collect::<String>() + c_iter.as_str(),
                                    None => st,
                                }
                            } else {
                                st
                            };
                            replaced = Some(final_st);
                            break;
                        }
                    }
                    result.push_str(&replaced.unwrap_or(raw_word));
                }
            } else {
                result.push(c);
                i += 1;
            }
        }

        result
    }

    pub fn batch_lookup_stressed(&self, words: Vec<String>) -> HashMap<String, String> {
        let mut results = HashMap::new();
        let conn_lock = self.conn.lock().unwrap();
        if let Some(conn) = conn_lock.as_ref() {
            if let Ok(mut stmt) = conn.prepare("SELECT stressed FROM words WHERE word = ? LIMIT 1") {
                for w in words {
                    let clean = Self::clean_word(&w);
                    if clean.is_empty() {
                        continue;
                    }
                    for v in Self::get_u_variants(&clean) {
                        if let Ok(st) = stmt.query_row(params![v], |r| r.get::<_, String>(0)) {
                            results.insert(w.clone(), st);
                            break;
                        }
                    }
                }
            }
        }
        results
    }
}

