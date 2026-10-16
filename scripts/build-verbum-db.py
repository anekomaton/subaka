#!/usr/bin/env python3
"""
Build Verbum Offline SQLite Database from GitHub Sources
Source: https://github.com/verbumby/slouniki
"""

import sys
import os
import re
import time
import urllib.request
import sqlite3

DICTIONARIES = [
    {
        "id": "klyshka",
        "name": "Слоўнік сінонімаў і блізказначных слоў (М. Клышка)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/klyshka/klyshka.html"
    },
    {
        "id": "tsblm2022",
        "name": "Тлумачальны слоўнік беларускай літаратурнай мовы (І. Л. Капылоў, 2022)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/tsblm2022/tsblm2022.html"
    },
    {
        "id": "rbs10",
        "name": "Руска-беларускі слоўнік НАН Беларусі, 10-е выданне",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/rbs10/rbs10.html"
    },
    {
        "id": "esbm",
        "name": "Этымалагічны слоўнік беларускай мовы (1978—2017)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/esbm/esbm.html"
    }
]

def clean_headword(s: str) -> str:
    s = re.sub(r'<[^>]*>', '', s)
    s = s.replace('\u0301', '').replace('\u0300', '').replace('+', '').strip().lower()
    return s

def extract_headword(html: str) -> str:
    m = re.search(r'<p[^>]*class=["\']headword["\'][^>]*>(.*?)</p>', html, re.IGNORECASE | re.DOTALL)
    if m:
        return re.sub(r'<[^>]*>', '', m.group(1)).strip()
    m2 = re.search(r'<b>(.*?)</b>', html, re.DOTALL)
    if m2:
        return re.sub(r'<[^>]*>', '', m2.group(1)).strip()
    return ""

def build_verbum_db(target_path: str):
    target_path = os.path.abspath(target_path)
    os.makedirs(os.path.dirname(target_path), exist_ok=True)
    
    tmp_path = target_path + ".tmp"
    if os.path.exists(tmp_path):
        try: os.remove(tmp_path)
        except Exception: pass

    print(f"[VerbumDB Builder] Creating SQLite database at {tmp_path}...")
    conn = sqlite3.connect(tmp_path)
    cur = conn.cursor()
    cur.execute("PRAGMA synchronous = OFF")
    cur.execute("PRAGMA journal_mode = MEMORY")
    
    cur.execute("""
        CREATE TABLE IF NOT EXISTS articles (
            id TEXT PRIMARY KEY,
            dict_id TEXT,
            headword TEXT,
            norm_hw TEXT,
            html TEXT
        )
    """)

    total_inserted = 0
    t0 = time.time()

    for idx, dict_info in enumerate(DICTIONARIES, 1):
        dict_id = dict_info["id"]
        url = dict_info["url"]
        print(f"[VerbumDB Builder] [{idx}/{len(DICTIONARIES)}] Downloading {dict_id} from {url}...")
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SUBaka-Offline-Builder/1.0"}
            )
            with urllib.request.urlopen(req, timeout=90) as resp:
                content = resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            print(f"[VerbumDB Builder] Warning: failed to download {dict_id}: {e}")
            continue

        raw_articles = content.split("<hr/>")
        print(f"[VerbumDB Builder] Indexing {dict_id} ({len(raw_articles):,} articles)...")
        
        batch = []
        for a_idx, raw_html in enumerate(raw_articles):
            raw_html = raw_html.strip()
            if not raw_html:
                continue
            hw = extract_headword(raw_html)
            norm = clean_headword(hw) if hw else ""
            art_id = f"{dict_id}_{a_idx + 1}"
            batch.append((art_id, dict_id, hw, norm, raw_html))

            if len(batch) >= 5000:
                cur.executemany(
                    "INSERT OR REPLACE INTO articles (id, dict_id, headword, norm_hw, html) VALUES (?, ?, ?, ?, ?)",
                    batch
                )
                total_inserted += len(batch)
                batch = []

        if batch:
            cur.executemany(
                "INSERT OR REPLACE INTO articles (id, dict_id, headword, norm_hw, html) VALUES (?, ?, ?, ?, ?)",
                batch
            )
            total_inserted += len(batch)

        conn.commit()
        print(f"[VerbumDB Builder] Finished {dict_id}. Total articles: {total_inserted:,}")

    print("[VerbumDB Builder] Creating indexes for fast headword lookups...")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_headword ON articles(headword)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_norm_hw ON articles(norm_hw)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dict_id ON articles(dict_id)")
    conn.commit()
    conn.close()

    if os.path.exists(target_path):
        try: os.remove(target_path)
        except Exception: pass
    os.rename(tmp_path, target_path)

    duration = time.time() - t0
    size_mb = os.path.getsize(target_path) / (1024 * 1024)
    print(f"[VerbumDB Builder] Successfully generated {target_path} ({size_mb:.1f} MB, {total_inserted:,} articles in {duration:.1f}s)")

if __name__ == "__main__":
    out_file = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] else "src-tauri/resources/verbum_offline.sqlite3"
    build_verbum_db(out_file)
