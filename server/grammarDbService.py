#!/usr/bin/env python3
"""
GrammarDB Lookup Service for BelG2P & Subtitles
Connects to grammardb.sqlite3 (2.38M unique forms from GrammarDB)
"""

import sys
import os
import json
import sqlite3
import unicodedata
import re

DB_PATHS = [
    '/tmp/grammardb.sqlite3',
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'grammardb.sqlite3')
]

GZ_PATHS = [
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'grammardb.sqlite3.gz'),
    '/tmp/grammardb.sqlite3.gz'
]

def decompress_gz_if_needed():
    for gz_path in GZ_PATHS:
        if os.path.exists(gz_path) and os.path.getsize(gz_path) > 10 * 1024 * 1024:
            target = '/tmp/grammardb.sqlite3'
            tmp_target = '/tmp/grammardb.sqlite3.tmp'
            try:
                import gzip, shutil
                with gzip.open(gz_path, 'rb') as f_in:
                    with open(tmp_target, 'wb') as f_out:
                        shutil.copyfileobj(f_in, f_out, length=1024*1024)
                os.replace(tmp_target, target)
                return target
            except Exception:
                if os.path.exists(tmp_target):
                    try: os.remove(tmp_target)
                    except: pass
    return None

# Non-stressed words (clitics / prepositions / particles) from BelG2P nienacisknyja.txt
NIENACISKNYJA = {
    'а', 'аж', 'бо', 'бы', 'быў', 'во', 'вось', 'вот', 'вунь', 'га',
    'дзе', 'ды', 'дык', 'ж', 'жа', 'і', 'каб', 'мо', 'на', 'нат', 'не', 'ні', 'ну', 'ня',
    'ось', 'от', 'так', 'там', 'тут', 'унь', 'хай', 'хоць', 'ці', 'чым', 'што', 'як',
    'аб', 'ад', 'без', 'бяз', 'бліз', 'ва', 'да', 'для', 'за', 'збок', 'зверх', 'звыш',
    'з-за', 'з-над', 'з-пад', 'з-прад', 'ка', 'край', 'кром', 'круг', 'ла', 'ля', 'між',
    'над', 'па', 'пад', 'паўз', 'пра', 'прад', 'праз', 'проць', 'проч', 'пры', 'са',
    'скрай', 'скрозь', 'скруг', 'срэдзь', 'у', 'ў', 'з', 'к'
}

OVERRIDE_DICT = {
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
}

VOWELS_RE = re.compile(r'[аеёіоуыэюяАЕІОУЫЭЮЯ]')

def has_stress_mark(s):
    return bool(s and ('\u0301' in s or '+' in s or '´' in s))

def fallback_stress(word):
    if not word or has_stress_mark(word):
        return word
    w_lower = word.lower()
    if w_lower in NIENACISKNYJA:
        return word
    if w_lower in OVERRIDE_DICT:
        target = OVERRIDE_DICT[w_lower]
        if word[0].isupper():
            return target[0].upper() + target[1:]
        return target

    # 1. 'ё' is ALWAYS stressed in Belarusian
    if 'ё' in w_lower or 'Ё' in word:
        res = []
        for ch in word:
            res.append(ch)
            if ch.lower() == 'ё':
                res.append('\u0301')
        return ''.join(res)

    vowel_matches = list(VOWELS_RE.finditer(word))
    if not vowel_matches:
        return word

    # 2. Infinitives -сці, -зці, -гчы, -кчы -> stress on last vowel
    if re.search(r'([сз]ці|[гк]чы)$', word, re.I):
        idx = vowel_matches[-1].start()
        return word[:idx+1] + '\u0301' + word[idx+1:]

    # 3. Past verbs -шлі, -шла, -шло -> stress on last vowel
    if re.search(r'ш(лі|ла|ло)$', word, re.I):
        idx = vowel_matches[-1].start()
        return word[:idx+1] + '\u0301' + word[idx+1:]

    # 4. 'о' is ALWAYS stressed in Belarusian orthography
    o_matches = [m for m in vowel_matches if m.group(0).lower() == 'о']
    if len(o_matches) == 1:
        idx = o_matches[0].start()
        return word[:idx+1] + '\u0301' + word[idx+1:]

    # 5. Common suffixes (-чык, -шчык)
    m = re.search(r'[аеіоуыэюя][тдзс]?[чш]ык[а-яеіў]*$', word, re.I)
    if m:
        idx = m.start()
        return word[:idx+1] + '\u0301' + word[idx+1:]

    # DO NOT place blind penultimate stress for remaining unknown words
    return word

_conn = None

def get_connection():
    global _conn
    if _conn is None:
        db_path = None
        for p in DB_PATHS:
            if os.path.exists(p) and os.path.getsize(p) > 1000:
                db_path = p
                break
        if not db_path:
            db_path = decompress_gz_if_needed()
        if not db_path:
            return None
        _conn = sqlite3.connect(db_path, check_same_thread=False)
        _conn.execute("PRAGMA query_only = ON;")
        _conn.execute("PRAGMA cache_size = 50000;")
    return _conn

def clean_word(w):
    if not w:
        return ""
    w = unicodedata.normalize('NFC', w)
    w = w.replace('\u0301', '').replace('+', '').replace('´', '')
    return w.lower().replace('и', 'й').strip()

def apply_stress_to_original(original, stressed):
    if not original or not stressed:
        return original
    orig_nfc = unicodedata.normalize('NFC', original)
    if '\u0301' in orig_nfc or '+' in orig_nfc or '´' in orig_nfc:
        return orig_nfc

    stressed_nfc = unicodedata.normalize('NFC', stressed)
    stresses_after_base_index = set()
    base_count = 0
    for ch in stressed_nfc:
        if ch in ['\u0301', '+', '\u00B4']:
            if base_count > 0:
                stresses_after_base_index.add(base_count - 1)
        else:
            base_count += 1

    if not stresses_after_base_index:
        return orig_nfc

    res = []
    curr_base_index = 0
    for ch in orig_nfc:
        res.append(ch)
        if unicodedata.category(ch) != 'Mn':
            if curr_base_index in stresses_after_base_index:
                res.append('\u0301')
            curr_base_index += 1

    return ''.join(res)

def lookup_word(word):
    c = clean_word(word)
    if not c or c in NIENACISKNYJA:
        return word
    
    conn = get_connection()
    if conn:
        cur = conn.cursor()
        row = cur.execute("SELECT stressed FROM words WHERE word = ?", (c,)).fetchone()
        if row and row[0] and has_stress_mark(row[0]):
            res = apply_stress_to_original(word, row[0])
            if has_stress_mark(res):
                return res
    return fallback_stress(word)

def lookup_batch(words):
    conn = get_connection()
    results = {}
    cleaned_map = {}
    for w in words:
        c = clean_word(w)
        if c and c not in NIENACISKNYJA:
            if c not in cleaned_map:
                cleaned_map[c] = []
            cleaned_map[c].append(w)
        elif c in NIENACISKNYJA:
            results[w] = w

    if conn and cleaned_map:
        cur = conn.cursor()
        keys = list(cleaned_map.keys())
        chunk_size = 500
        for i in range(0, len(keys), chunk_size):
            chunk = keys[i:i + chunk_size]
            placeholders = ','.join('?' for _ in chunk)
            rows = cur.execute(f"SELECT word, stressed FROM words WHERE word IN ({placeholders})", chunk).fetchall()
            for w_clean, stressed in rows:
                if stressed and has_stress_mark(stressed):
                    for original_w in cleaned_map.get(w_clean, []):
                        res = apply_stress_to_original(original_w, stressed)
                        if has_stress_mark(res):
                            results[original_w] = res

    for w in words:
        if w not in results or not has_stress_mark(results[w]):
            results[w] = fallback_stress(w)

    return results

def stress_text(text):
    """Stress all words in a Belarusian text using GrammarDB"""
    words = re.findall(r"[а-яёіўА-ЯЁІЎ'’\u0301\+]+", text)
    if not words:
        return text
    
    batch_map = lookup_batch(words)
    
    def repl(match):
        w = match.group(0)
        # If user already placed stress mark, keep it
        if '\u0301' in w or '+' in w or '´' in w:
            return w
        return batch_map.get(w, w)
    
    return re.sub(r"[а-яёіўА-ЯЁІЎ'’\u0301\+]+", repl, text)

def stress_srt(srt_content):
    """Process an entire SRT subtitle file, stressing only subtitle dialog text lines"""
    lines = srt_content.splitlines()
    out = []
    is_time = re.compile(r'^\d{2}:\d{2}:\d{2}[,\.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,\.]\d{3}')
    is_num = re.compile(r'^\d+$')
    
    for line in lines:
        stripped = line.strip()
        if not stripped or is_num.match(stripped) or is_time.match(stripped):
            out.append(line)
        else:
            out.append(stress_text(line))
    return '\n'.join(out)

def search_word(query):
    q = (query or '').strip()
    if not q:
        return {'query': '', 'clean': '', 'found': False, 'stressed': '', 'forms': []}
    c = clean_word(q)
    conn = get_connection()
    found = False
    exact_stressed = ''
    forms = []
    if conn:
        cur = conn.cursor()
        row = cur.execute("SELECT word, stressed, lemma, lemma_stressed, paradigm_id FROM words WHERE word = ? LIMIT 1", (c,)).fetchone()
        if not row and 'е' in c:
            row = cur.execute("SELECT word, stressed, lemma, lemma_stressed, paradigm_id FROM words WHERE word = ? LIMIT 1", (c.replace('е', 'ё'),)).fetchone()
        if row:
            found = True
            exact_stressed = apply_stress_to_original(q, row[1])
        
        pdg_rows = cur.execute("SELECT DISTINCT word, stressed FROM words WHERE paradigm_id IN (SELECT DISTINCT paradigm_id FROM words WHERE word = ?) LIMIT 40", (c,)).fetchall()
        additional = []
        if len(pdg_rows) < 20:
            additional = cur.execute("SELECT DISTINCT word, stressed FROM words WHERE word LIKE ? OR lemma LIKE ? LIMIT 35", (c + '%', c + '%')).fetchall()
        
        seen = set()
        for w, st in pdg_rows + additional:
            if not w or not st:
                continue
            nw = w.lower()
            if nw in seen:
                continue
            seen.add(nw)
            forms.append({'word': w, 'stressed': apply_stress_to_original(w, st)})

    return {'query': q, 'clean': c, 'found': found, 'stressed': exact_stressed, 'forms': forms}

if __name__ == '__main__':
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == 'word' and len(sys.argv) > 2:
            print(json.dumps({'stressed': lookup_word(sys.argv[2])}, ensure_ascii=False))
        elif cmd == 'search' and len(sys.argv) > 2:
            print(json.dumps(search_word(sys.argv[2]), ensure_ascii=False))
        elif cmd == 'text' and len(sys.argv) > 2:
            print(json.dumps({'text': stress_text(sys.argv[2])}, ensure_ascii=False))
        elif cmd == 'srt' and len(sys.argv) > 2:
            print(stress_srt(sys.argv[2]))
        elif cmd == 'stdin':
            data = json.loads(sys.stdin.read())
            if 'search' in data:
                print(json.dumps(search_word(data['search']), ensure_ascii=False))
            elif 'words' in data:
                print(json.dumps(lookup_batch(data['words']), ensure_ascii=False))
            elif 'text' in data:
                print(json.dumps({'text': stress_text(data['text'])}, ensure_ascii=False))
            elif 'srt' in data:
                print(json.dumps({'srt': stress_srt(data['srt'])}, ensure_ascii=False))
