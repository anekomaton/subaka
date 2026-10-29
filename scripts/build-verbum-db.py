#!/usr/bin/env python3
"""
Build Verbum Offline SQLite Database from GitHub Sources
Source: https://github.com/verbumby/slouniki
Supports HTML dictionaries and DSL dictionaries (BRS) with full headword indexing.
"""

import sys
import os
import re
import time
import urllib.request
import sqlite3

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

DICTIONARIES = [
    {
        "id": "tsblm2022",
        "name": "Тлумачальны слоўнік беларускай літаратурнай мовы (І. Л. Капылоў, 2022)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/tsblm2022/tsblm2022.html",
        "format": "html"
    },
    {
        "id": "brs",
        "name": "Беларуска-рускі слоўнік, 4-е выданне (2012)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/brs/brs.dsl",
        "format": "dsl"
    },
    {
        "id": "klyshka",
        "name": "Слоўнік сінонімаў і блізказначных слоў (М. Клышка)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/klyshka/klyshka.html",
        "format": "html"
    },
    {
        "id": "esbm",
        "name": "Этымалагічны слоўнік беларускай мовы (1978—2017)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/esbm/esbm.html",
        "format": "html"
    },
    {
        "id": "rbs10",
        "name": "Руска-беларускі слоўнік НАН Беларусі, 10-е выданне (2012)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/rbs10/rbs10.html",
        "format": "html"
    },
    {
        "id": "susha",
        "name": "Англійска-беларускі слоўнік (Т. Суша, 2013, актуальны правапіс)",
        "url": "https://raw.githubusercontent.com/verbumby/slouniki/master/susha/susha.html",
        "format": "html"
    }
]

def clean_headword(s: str) -> str:
    s = re.sub(r'<[^>]*>', '', s)
    s = re.sub(r'[¹²³⁴⁵⁶⁷⁸⁹⁰]', '', s)
    s = s.replace('\u0301', '').replace('\u0300', '').replace('+', '').replace('´', '').strip().lower()
    return s

def extract_headwords_from_html(html: str):
    results = []
    seen = set()

    # 1. Elements with class hw, e.g. <strong class="hw">...</strong> or <b class="hw">...</b>
    hw_matches = re.findall(
        r'<(?:strong|b|span|p|a)[^>]*\bclass=[\'"][^\'"]*\bhw\b[^\'"]*[\'"][^>]*>(.*?)</(?:strong|b|span|p|a)>',
        html,
        re.IGNORECASE | re.DOTALL
    )
    for m in hw_matches:
        clean_text = re.sub(r'<[^>]+>', '', m)
        clean_text = re.sub(r'[¹²³⁴⁵⁶⁷⁸⁹⁰]', '', clean_text).strip()
        if clean_text:
            norm = clean_headword(clean_text)
            if norm and norm not in seen:
                seen.add(norm)
                results.append((clean_text, norm))
            # Also handle words with parentheses e.g. "(в)обшыўка" -> "вобшыўка" & "обшыўка"
            if '(' in norm and ')' in norm:
                exp1 = re.sub(r'[\(\)]', '', norm).strip()
                exp2 = re.sub(r'\(.*?\)', '', norm).strip()
                for exp in [exp1, exp2]:
                    if exp and exp not in seen:
                        seen.add(exp)
                        results.append((clean_text, exp))

    # 2. Fallback: <strong id="..."> or <b id="...">
    if not results:
        id_matches = re.findall(
            r'<(?:strong|b)[^>]*\bid=[\'"]([^\'"]+)[\'"][^>]*>(.*?)</(?:strong|b)>',
            html,
            re.IGNORECASE | re.DOTALL
        )
        for mid, mtext in id_matches:
            raw = re.sub(r'<[^>]+>', '', mtext or mid).strip()
            if raw:
                norm = clean_headword(raw)
                if norm and norm not in seen:
                    seen.add(norm)
                    results.append((raw, norm))

    # 3. Fallback: <p class="headword">
    if not results:
        p_matches = re.findall(r'<p[^>]*class=[\'"]headword[\'"][^>]*>(.*?)</p>', html, re.IGNORECASE | re.DOTALL)
        for m in p_matches:
            raw = re.sub(r'<[^>]+>', '', m).strip()
            if raw:
                norm = clean_headword(raw)
                if norm and norm not in seen:
                    seen.add(norm)
                    results.append((raw, norm))

    # 4. Fallback: check <b> in first 120 chars
    if not results:
        first_b = re.search(r'<b>(.*?)</b>', html[:150], re.DOTALL)
        if first_b:
            raw = re.sub(r'<[^>]+>', '', first_b.group(1)).strip()
            if raw and len(raw) < 40 and not raw.startswith(('1.', '2.', 'I', 'II', 'III')):
                norm = clean_headword(raw)
                if norm and norm not in seen:
                    seen.add(norm)
                    results.append((raw, norm))

    return results

def dsl_article_to_html(headwords, body_lines) -> str:
    hw_display = ", ".join(headwords)
    parts = [f'<p class="ms-0"><strong class="hw">{hw_display}</strong></p>']
    for raw_line in body_lines:
        line = raw_line.strip()
        if not line:
            continue
        line = re.sub(r'\[b\](.*?)\[/b\]', r'<b>\1</b>', line)
        line = re.sub(r'\[i\](.*?)\[/i\]', r'<i>\1</i>', line)
        line = re.sub(r'\[u\](.*?)\[/u\]', r'<u>\1</u>', line)
        line = re.sub(r'\[p\](.*?)\[/p\]', r'<v-abbr>\1</v-abbr>', line)
        line = re.sub(r'\[ex\](.*?)\[/ex\]', r'<v-ex>\1</v-ex>', line)
        line = re.sub(r'\[c\s*([^\]]*)\](.*?)\[/c\]', r'<span style="color: \1">\2</span>', line)
        line = re.sub(r'\[c\](.*?)\[/c\]', r'<span style="color: darkgreen">\1</span>', line)
        line = re.sub(r'\[\'\]([аеёіоуыэюяАЕЁІОУЫЭЮЯ\w])\[/\'\]', lambda m: m.group(1) + '\u0301', line)
        line = re.sub(r'\[m\d\]', '<p class="ms-2">', line)
        line = re.sub(r'\[/m\]', '</p>', line)
        line = re.sub(r'\[[^\]]+\]', '', line)
        if not line.startswith('<p'):
            line = f'<p class="ms-2">{line}</p>'
        parts.append(line)
    return '\n'.join(parts)

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
        dict_format = dict_info.get("format", "html")
        url = dict_info["url"]
        print(f"[VerbumDB Builder] [{idx}/{len(DICTIONARIES)}] Downloading {dict_id} ({dict_info['name']})...")
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SUBaka-Offline-Builder/1.0"}
            )
            with urllib.request.urlopen(req, timeout=120) as resp:
                content = resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            print(f"[VerbumDB Builder] Warning: failed to download {dict_id}: {e}")
            continue

        batch = []

        if dict_format == "dsl":
            lines = content.splitlines()
            cur_hws = []
            cur_body = []
            art_num = 0

            for line in lines:
                if line.startswith('#') or not line.strip():
                    continue
                if not line.startswith('\t') and not line.startswith(' '):
                    if cur_hws and cur_body:
                        art_num += 1
                        html = dsl_article_to_html(cur_hws, cur_body)
                        primary_hw = cur_hws[0]
                        for h_idx, hw in enumerate(cur_hws):
                            norm = clean_headword(hw)
                            if not norm:
                                continue
                            art_id = f"{dict_id}_{art_num}" if h_idx == 0 else f"{dict_id}_{art_num}_{h_idx}"
                            batch.append((art_id, dict_id, hw, norm, html))
                        cur_hws = []
                        cur_body = []
                    cur_hws.append(line.strip())
                else:
                    cur_body.append(line)

                if len(batch) >= 5000:
                    cur.executemany(
                        "INSERT OR REPLACE INTO articles (id, dict_id, headword, norm_hw, html) VALUES (?, ?, ?, ?, ?)",
                        batch
                    )
                    total_inserted += len(batch)
                    batch = []

            if cur_hws and cur_body:
                art_num += 1
                html = dsl_article_to_html(cur_hws, cur_body)
                for h_idx, hw in enumerate(cur_hws):
                    norm = clean_headword(hw)
                    if norm:
                        art_id = f"{dict_id}_{art_num}" if h_idx == 0 else f"{dict_id}_{art_num}_{h_idx}"
                        batch.append((art_id, dict_id, hw, norm, html))

        else: # HTML format
            raw_articles = content.split("<hr/>")
            print(f"[VerbumDB Builder] Indexing {dict_id} ({len(raw_articles):,} articles)...")
            
            for a_idx, raw_html in enumerate(raw_articles):
                raw_html = raw_html.strip()
                if not raw_html:
                    continue
                
                extracted_list = extract_headwords_from_html(raw_html)
                if not extracted_list:
                    continue

                for k, (hw, norm) in enumerate(extracted_list):
                    art_id = f"{dict_id}_{a_idx + 1}" if k == 0 else f"{dict_id}_{a_idx + 1}_{k}"
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
        print(f"[VerbumDB Builder] Finished {dict_id}. Total articles in database: {total_inserted:,}")

    print("[VerbumDB Builder] Creating indexes for fast headword lookups...")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_norm_hw ON articles(norm_hw)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_dict_norm ON articles(dict_id, norm_hw)")
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
