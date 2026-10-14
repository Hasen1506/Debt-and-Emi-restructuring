"""Audit 80+ B5: move inline font sizes onto the type scale (one-off codemod).

For every numeric `fontSize: N` (N <= 14) in web/src/**/*.tsx|ts, look at
the style object it sits in:

* a label (uppercase or letter-spaced >= 0.06em): N <= 12 -> 'var(--fs-label)'
  (12px), 13-14 kept; and it is set in the mono face if the object names no
  font, since body text around it is now IBM Plex Sans;
* anything else is reading text: N <= 11 -> 'var(--fs-small)' (14px),
  12 -> 'var(--fs-dense)' (15px), 13-14 -> 'var(--fs-body)' (16px).

Larger sizes (headings, figures) are left alone. Run from web/:
    python3 scripts/w7-type-scale.py [--dry]
"""
import pathlib
import re
import sys

DRY = '--dry' in sys.argv
NUM = re.compile(r"fontSize:\s*(\d+(?:\.\d+)?)(?=\s*[,}\n])")
LABEL = re.compile(r"textTransform:\s*'uppercase'|letterSpacing:\s*'0?\.(0[6-9]|[1-9]\d?)\d*em'")
FONT = re.compile(r"\bfont(Family)?:")


def enclosing(src: str, at: int) -> tuple[int, int]:
    depth = 0
    i = at
    while i > 0:
        i -= 1
        c = src[i]
        if c == '}':
            depth += 1
        elif c == '{':
            if depth == 0:
                break
            depth -= 1
    start = i
    depth = 0
    j = at
    while j < len(src):
        c = src[j]
        if c == '{':
            depth += 1
        elif c == '}':
            if depth == 0:
                break
            depth -= 1
        j += 1
    return start, j


def convert(src: str) -> tuple[str, int]:
    out = []
    last = 0
    n = 0
    for m in NUM.finditer(src):
        size = float(m.group(1))
        if size > 14:
            continue
        s, e = enclosing(src, m.start())
        obj = src[s:e + 1]
        label = bool(LABEL.search(obj))
        if label:
            rep = "fontSize: 'var(--fs-label)'" if size <= 12 else m.group(0)
            if not FONT.search(obj):
                rep += ", fontFamily: 'var(--font-mono)'"
        elif size <= 11:
            rep = "fontSize: 'var(--fs-small)'"
        elif size <= 12:
            rep = "fontSize: 'var(--fs-dense)'"
        else:
            rep = "fontSize: 'var(--fs-body)'"
        out.append(src[last:m.start()])
        out.append(rep)
        last = m.end()
        n += rep != m.group(0)  # a kept 13-14px label is not a change (rerun-safe count)
    out.append(src[last:])
    return ''.join(out), n


def main() -> None:
    total = 0
    for p in sorted(pathlib.Path('src').rglob('*.ts*')):
        src = p.read_text()
        new, n = convert(src)
        if n:
            total += n
            print(f'{n:4d}  {p}')
            if not DRY:
                p.write_text(new)
    print('total', total)


if __name__ == '__main__':
    main()
