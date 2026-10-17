"""Import a downloaded review JSON; reject evidence from different source bytes."""
import base64, hashlib, json, sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
record = json.loads(Path(sys.argv[1]).read_text())
assert record['baseline'] == 'd0f4bd2866cfdee625bbdcffa62138b557f696a9'
assert len(record['captures']) == 20 and len(record['benchmarks']) == 4
for name, expected in record['sourceSha256'].items():
    path = (root / name).resolve()
    assert path.is_relative_to(root), 'Source path outside worktree'
    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, f'Stale evidence: {name}'
out = root / 'docs/visual-upgrade/evidence'
out.mkdir(parents=True, exist_ok=True)
for capture in record['captures']:
    assert capture['version'] in ['before', 'after']
    assert capture['shot'] in ['wide', 'echo', 'nova', 'atlas', 'two']
    name = f"{capture['version']}-{'portrait' if capture['portrait'] else 'landscape'}-{capture['shot']}.png"
    prefix, data = capture.pop('png').split(',', 1)
    assert prefix == 'data:image/png;base64'
    png = base64.b64decode(data, validate=True)
    assert png[:8] == b'\x89PNG\r\n\x1a\n'
    (out / name).write_bytes(png)
    capture['file'] = name
    capture['sha256'] = hashlib.sha256(png).hexdigest()
(out / 'measurements.json').write_text(json.dumps(record, indent=2) + '\n')
print('Imported 20 WebGL screenshots and four timing samples; source hashes match.')
print(json.dumps(record['benchmarks'], indent=2))
# Optional contact sheet; the full-size PNGs above remain the primary evidence.
try:
    from PIL import Image, ImageDraw
    sheet = Image.new('RGB', (1600, 1100), '#10241f')
    draw = ImageDraw.Draw(sheet)
    for row, (version, aspect) in enumerate([('before', 'landscape'), ('after', 'landscape'), ('before', 'portrait'), ('after', 'portrait')]):
        for col, shot in enumerate(['wide', 'echo', 'nova', 'atlas', 'two']):
            with Image.open(out / f'{version}-{aspect}-{shot}.png') as original:
                thumbnail = original.convert('RGB')
                thumbnail.thumbnail((314, 245))
                sheet.paste(thumbnail, (col * 320 + (320 - thumbnail.width) // 2, row * 275 + 25))
            draw.text((col * 320 + 8, row * 275 + 6), f'{version} / {aspect} / {shot}', fill='#e5e9d5')
    sheet.save(out / 'comparison-contact-sheet.jpg', quality=90)
except ImportError:
    print('Pillow unavailable; full-size evidence saved without the optional contact sheet.')
