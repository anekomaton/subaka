#!/usr/bin/env python3
"""
Build GrammarDB SQLite Database from Official Belarus/GrammarDB XML Release
Source: https://github.com/Belarus/GrammarDB
"""

import sys
import os
import time
import zipfile
import urllib.request
import sqlite3
import xml.etree.cElementTree as ET
import tempfile

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

RELEASE_URL = "https://github.com/Belarus/GrammarDB/releases/download/RELEASE-202601/RELEASE-202601.zip"
TARGET_DB = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else os.path.join(tempfile.gettempdir(), "grammardb.sqlite3")
TEMP_ZIP = os.path.join(tempfile.gettempdir(), "grammardb_release.zip")

def clean(s: str) -> str:
    return s.replace('+', '').replace('\u0301', '').lower()

def to_stressed(s: str) -> str:
    return s.replace('+', '\u0301')

def ensure_release_zip():
    if os.path.exists(TEMP_ZIP) and os.path.getsize(TEMP_ZIP) > 10 * 1024 * 1024:
        print(f"[GrammarDB Builder] Found existing zip at {TEMP_ZIP} ({os.path.getsize(TEMP_ZIP)/(1024*1024):.1f} MB)")
        return TEMP_ZIP
    print(f"[GrammarDB Builder] Downloading official release from {RELEASE_URL}...")
    t0 = time.time()
    req = urllib.request.Request(
        RELEASE_URL,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GrammarDB-Client/1.0"}
    )
    temp_downloading = TEMP_ZIP + ".part"
    if os.path.exists(temp_downloading):
        os.remove(temp_downloading)
    with urllib.request.urlopen(req, timeout=60) as resp, open(temp_downloading, "wb") as f_out:
        total_downloaded = 0
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            f_out.write(chunk)
            total_downloaded += len(chunk)
    os.rename(temp_downloading, TEMP_ZIP)
    print(f"[GrammarDB Builder] Downloaded {os.path.getsize(TEMP_ZIP)/(1024*1024):.1f} MB in {time.time()-t0:.1f}s")
    return TEMP_ZIP

def build_database():
    os.makedirs(os.path.dirname(os.path.abspath(TARGET_DB)), exist_ok=True)
    if os.path.exists(TARGET_DB) and os.path.getsize(TARGET_DB) > 100 * 1024 * 1024:
        print(f"[GrammarDB Builder] Database already exists at {TARGET_DB} ({os.path.getsize(TARGET_DB)/(1024*1024):.1f} MB)")
        return TARGET_DB

    zip_path = ensure_release_zip()
    temp_db_path = TARGET_DB + ".tmp"
    if os.path.exists(temp_db_path):
        os.remove(temp_db_path)

    print(f"[GrammarDB Builder] Building SQLite database from XML paradigms at {temp_db_path}...")
    t0 = time.time()

    conn = sqlite3.connect(temp_db_path)
    conn.execute("PRAGMA synchronous = OFF")
    conn.execute("PRAGMA journal_mode = MEMORY")
    conn.execute("PRAGMA cache_size = 100000")
    conn.execute("""
        CREATE TABLE words (
            word TEXT PRIMARY KEY,
            stressed TEXT,
            lemma TEXT,
            lemma_stressed TEXT,
            paradigm_id INTEGER
        )
    """)

    batch = []
    seen = set()
    total_inserted = 0

    with zipfile.ZipFile(zip_path, 'r') as z:
        xml_files = sorted([n for n in z.namelist() if n.endswith('.xml')])
        print(f"[GrammarDB Builder] Processing {len(xml_files)} XML paradigm files...")
        sys.stdout.flush()
        for idx, name in enumerate(xml_files, 1):
            print(f"[GrammarDB Builder] Частка {idx}/{len(xml_files)} ({name}): апрацоўка словаформаў... [усяго: {total_inserted:,}]")
            sys.stdout.flush()
            with z.open(name) as f:
                for event, elem in ET.iterparse(f, events=('end',)):
                    if elem.tag == 'Paradigm':
                        pdg_id = int(elem.attrib.get('pdgId', 0))
                        lemma_raw = elem.attrib.get('lemma', '')
                        lemma_clean = clean(lemma_raw)
                        lemma_stressed = to_stressed(lemma_raw)

                        for form in elem.iter('Form'):
                            raw = form.text
                            if not raw:
                                continue
                            w_clean = clean(raw)
                            if w_clean not in seen:
                                seen.add(w_clean)
                                batch.append((w_clean, to_stressed(raw), lemma_clean, lemma_stressed, pdg_id))
                                if len(batch) >= 50000:
                                    conn.executemany(
                                        "INSERT OR IGNORE INTO words (word, stressed, lemma, lemma_stressed, paradigm_id) VALUES (?, ?, ?, ?, ?)",
                                        batch
                                    )
                                    total_inserted += len(batch)
                                    batch = []
                        elem.clear()
            print(f"[GrammarDB Builder] Частка {idx}/{len(xml_files)} ({name}) паспяхова апрацавана. Усяго слоў: {total_inserted:,}")
            sys.stdout.flush()

    if batch:
        conn.executemany(
            "INSERT OR IGNORE INTO words (word, stressed, lemma, lemma_stressed, paradigm_id) VALUES (?, ?, ?, ?, ?)",
            batch
        )
        total_inserted += len(batch)

    print(f"[GrammarDB Builder] Creating indexes for paradigm_id and lemma...")
    conn.execute("CREATE INDEX idx_paradigm ON words (paradigm_id)")
    conn.execute("CREATE INDEX idx_lemma ON words (lemma)")
    conn.commit()
    conn.close()
    del conn
    import gc
    gc.collect()
    time.sleep(1.0)

    try:
        if os.path.exists(TARGET_DB):
            os.remove(TARGET_DB)
    except Exception:
        pass

    try:
        os.replace(temp_db_path, TARGET_DB)
    except Exception as e:
        print(f"[GrammarDB Builder] os.replace failed ({e}), attempting copy...")
        import shutil
        shutil.copy2(temp_db_path, TARGET_DB)
        try: os.remove(temp_db_path)
        except Exception: pass

    duration = time.time() - t0
    size_mb = os.path.getsize(TARGET_DB) / (1024 * 1024)
    print(f"[GrammarDB Builder] Success! Inserted {total_inserted:,} words into {TARGET_DB} in {duration:.1f}s ({size_mb:.1f} MB)")

    # Clean up zip file to conserve disk space
    try:
        if os.path.exists(TEMP_ZIP):
            os.remove(TEMP_ZIP)
    except Exception:
        pass

    return TARGET_DB

if __name__ == "__main__":
    build_database()
