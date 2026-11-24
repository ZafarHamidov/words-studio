import argparse
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
PDF_PATH = ROOT / 'MUST KNOW 650 SAT real exam words @DSATuz (2).pdf'
OUTPUT_PATH = ROOT / 'data' / 'sat_words.json'
DEFAULT_TESSERACT = Path(r'C:\Program Files\Tesseract-OCR\tesseract.exe')


def normalize_text(text):
    replacements = {
        '\u2019': "'",
        '\u2018': "'",
        '\u201c': '"',
        '\u201d': '"',
        '\u2013': '-',
        '\u2014': '-',
        '\xa0': ' ',
    }
    for src, dst in replacements.items():
        text = text.replace(src, dst)
    return ' '.join(text.split()).strip()


def resolve_tesseract(user_value):
    if user_value:
        return Path(user_value)
    if DEFAULT_TESSERACT.exists():
        return DEFAULT_TESSERACT
    return Path('tesseract')


def ocr_page(tesseract_cmd, page, scale):
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        pix.save(tmp_path)
        result = subprocess.run(
            [str(tesseract_cmd), str(tmp_path), 'stdout', '--psm', '6'],
            capture_output=True,
            text=True,
            encoding='utf-8',
            errors='ignore',
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or 'tesseract OCR failed')
        return result.stdout
    finally:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass


def extract_entries(pdf_path, tesseract_cmd, scale):
    doc = fitz.open(pdf_path)
    entries = []
    for page_index in range(1, doc.page_count):
        text = ocr_page(tesseract_cmd, doc.load_page(page_index), scale)
        current = None
        for raw_line in text.splitlines():
            line = normalize_text(raw_line)
            if not line:
                continue
            if '650 MUST-KNOW SAT WORDS' in line or line.startswith('https://t.me/'):
                continue
            if re.fullmatch(r'\d+', line):
                continue
            match = re.match(r'^(\d+)\.\s+(.*)$', line)
            if match:
                if current:
                    entries.append(current)
                current = {'num': int(match.group(1)), 'body': match.group(2).strip()}
            elif current:
                current['body'] += ' ' + line
        if current:
            entries.append(current)
    return entries


def split_entry(entry):
    body = normalize_text(entry['body'])
    parts = re.split(r'\s+-\s+', body, maxsplit=1)
    if len(parts) != 2:
        raise ValueError(f"Could not split entry {entry['num']}: {body}")
    word, hint = parts
    return {
        'num': entry['num'],
        'word': normalize_text(word).lower(),
        'pos': '',
        'hint': normalize_text(hint),
    }


def build_payload(entries, dedupe):
    parsed = [split_entry(entry) for entry in entries]
    parsed.sort(key=lambda item: (item['word'], item['num']))
    if not dedupe:
        return [{k: v for k, v in item.items() if k != 'num'} for item in parsed]

    seen = set()
    unique = []
    for item in parsed:
        if item['word'] in seen:
            continue
        seen.add(item['word'])
        unique.append(item)
    return [{k: v for k, v in item.items() if k != 'num'} for item in unique]


def main():
    parser = argparse.ArgumentParser(description='Extract D7SAT SAT words from the bundled PDF via OCR.')
    parser.add_argument('--pdf', default=str(PDF_PATH))
    parser.add_argument('--output', default=str(OUTPUT_PATH))
    parser.add_argument('--tesseract', default='')
    parser.add_argument('--scale', type=float, default=2.0)
    parser.add_argument('--dedupe', action='store_true', help='Drop duplicate words after OCR.')
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    output_path = Path(args.output)
    tesseract_cmd = resolve_tesseract(args.tesseract)
    if not pdf_path.exists():
        raise SystemExit(f'PDF not found: {pdf_path}')

    entries = extract_entries(pdf_path, tesseract_cmd, args.scale)
    payload = build_payload(entries, args.dedupe)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open('w', encoding='utf-8') as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)

    unique_words = len({item['word'] for item in payload})
    print(f'Wrote {len(payload)} rows to {output_path}')
    print(f'Unique words: {unique_words}')
    if unique_words != len(payload):
        print('Warning: the OCR source contains duplicate words.')


if __name__ == '__main__':
    main()
