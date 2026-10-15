"""Offline, reproducible import. Requires openpyxl; see third_party/morpholex/README.md."""
import json, re, hashlib, pathlib, warnings
import openpyxl

root = pathlib.Path(__file__).resolve().parents[1]
def read(path):
    return json.loads((root / path).read_text(encoding='utf-8-sig'))
words = {}
for row in read('third_party/morpholex/project-words.json'):
    definitions = row['definitions']
    if isinstance(definitions, str): definitions = json.loads(definitions)
    word = row['spelling'].lower()
    if re.fullmatch('[a-z]+', word) and definitions:
        words.setdefault(word, definitions[0])
raw = read('third_party/morphemes/morphemes.json')
groups, by_form, glossary = [], {}, {}
types = {'prefix': 'prefix', 'suffix': 'suffix', 'embedded': 'root'}
for key, item in raw.items():
    forms = [f for f in item.get('forms', []) if re.fullmatch('[a-zA-Z]+', f.get('form', '')) and f.get('loc') in types]
    meanings = [m.strip() for m in item.get('meaning', []) if isinstance(m, str) and m.strip()]
    if not forms or not meanings: continue
    gid = 'open-' + str(len(groups))
    kind = 'root' if any(f['loc'] == 'embedded' for f in forms) else types[forms[0]['loc']]
    examples = list(dict.fromkeys(w.lower() for w in item.get('examples', []) if w.lower() in words))
    group = {'id': gid, 'label': key, 'type': kind, 'meaning': ' / '.join(meanings),
        'tip': '开源库英文原释义；例词来自上游关联，不代表已确认完整拆解。', 'source': 'morphemes',
        'examples': [{'word': w, 'meaning': words[w]} for w in examples[:12]]}
    groups.append(group)
    for f in forms:
        token, loc = f['form'].lower(), types[f['loc']]
        by_form.setdefault((token, loc), []).append(group)
        glossary.setdefault(token, []).append(group)

warnings.filterwarnings('ignore', category=UserWarning)
book = openpyxl.load_workbook(root / 'third_party/morpholex/MorphoLEX_en.xlsx', read_only=True, data_only=True)
entries, ambiguous, rejected = {}, set(), 0
for sheet in book:
    if not re.fullmatch(r'\d-\d-\d', sheet.title): continue
    rows = iter(sheet.values)
    header = list(next(rows))
    if 'Word' not in header or 'MorphoLexSegm' not in header: continue
    wi, si = header.index('Word'), header.index('MorphoLexSegm')
    for row in rows:
        word, pattern = str(row[wi] or '').lower(), str(row[si] or '')
        if word not in words: continue
        tokens = []
        for m in re.finditer(r'<([^<>]+)<|\(([^()]+)\)|>([^<>]+)>', pattern):
            text = m.group(1) or m.group(2) or m.group(3)
            kind = 'prefix' if m.group(1) else 'root' if m.group(2) else 'suffix'
            tokens.append((text.lower(), kind))
        # MorphoLex records normalized stems and omits some inflections. Never
        # present a normalized sequence as an exact surface decomposition.
        if len(tokens) < 2 or ''.join(t for t, _ in tokens) != word:
            rejected += 1
            continue
        roots = [t for t, k in tokens if k == 'root']
        if not roots: continue
        root_token = roots[0]
        candidates = by_form.get((root_token, 'root'), [])
        candidates = [g for g in candidates if any(e['word'] == word for e in g['examples'])] or candidates
        if len(candidates) == 1:
            gid = candidates[0]['id']
        else:
            gid = 'stem-' + root_token
            if gid not in {g['id'] for g in groups}:
                groups.append({'id': gid, 'label': root_token, 'type': 'root', 'meaning': words.get(root_token, '词干，结合整词释义理解'), 'tip': 'MorphoLex 词干家族；不将词干与历史词源混为一谈。', 'source': 'MorphoLex', 'examples': []})
        parts = []
        for text, kind in tokens:
            matches = by_form.get((text, kind), [])
            meaning = matches[0]['meaning'] if len(matches) == 1 else words.get(text, '含义依语境而定，暂不作唯一解释')
            parts.append({'text': text, 'type': kind, 'meaning': meaning})
        entry = {'word': word, 'meaning': words[word], 'group': gid, 'parts': parts,
            'hint': '按组成部分联想，再用整词释义核对；来源：MorphoLex（非商业教学数据）。', 'source': 'MorphoLex', 'pattern': pattern}
        if word in entries and entries[word]['parts'] != parts:
            ambiguous.add(word)
        entries[word] = entry
for word in ambiguous: entries.pop(word, None)
book.close()
data = {'groups': groups, 'entries': list(entries.values())}
(root / 'src/data/morphologyImported.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
report = {'uniqueProjectWords': len(words), 'morphemeGroups': len(raw), 'importedGroups': len(groups), 'exactDecompositions': len(entries), 'skippedNormalizedOrSinglePart': rejected, 'ambiguousWordsExcluded': len(ambiguous), 'sources': {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in ['third_party/morphemes/morphemes.json', 'third_party/morpholex/MorphoLEX_en.xlsx']}}
(root / 'third_party/morpholex/import-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report, ensure_ascii=False, indent=2))
