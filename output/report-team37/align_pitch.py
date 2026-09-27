"""Apply naming and evidence-label corrections to a copy of the supplied deck."""
import io
from pathlib import Path

import pypdfium2 as pdfium
from pypdf import PdfReader, PdfWriter
from pypdf._text_extraction import mult
from pypdf.generic import ContentStream
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

OUT = Path(__file__).resolve().parent
SOURCE = Path(r'C:\Users\premi\Downloads\Telegram Desktop\AirDnD-pitch.pdf')
DEST = OUT / 'AirDnD-pitch-aligned.pdf'
writer = PdfWriter(clone_from=SOURCE)

# Rectangles are in PDF coordinates. Remove the affected text blocks from
# the original content stream, preserving the source font resources.
regions = {
    0: [(51, 378, 103, 394)],
    1: [(290, 338, 348, 348)],
    4: [(219, 165, 742, 180), (278, 45, 682, 56)],
}
for index, boxes in regions.items():
    page = writer.pages[index]
    removed = 0
    matrix = [1, 0, 0, 1, 0, 0]
    stack, output, block = [], [], None
    drop = False
    for args, op in page.get_contents().operations:
        if op == b'q':
            stack.append(matrix[:])
        elif op == b'Q':
            matrix = stack.pop()
        elif op == b'cm':
            matrix = mult([float(v) for v in args], matrix)
        if op == b'BT':
            block, drop = [], False
        if op == b'Tm' and block is not None:
            location = mult([float(v) for v in args], matrix)
            x, y = location[4:]
            drop = drop or any(x0 <= x <= x1 and y0 <= y <= y1 for x0, y0, x1, y1 in boxes)
        if block is None:
            output.append((args, op))
        else:
            block.append((args, op))
        if op == b'ET':
            if drop:
                removed += 1
            else:
                output.extend(block)
            block = None
    assert removed, f'No text removed on slide {index + 1}'
    stream = ContentStream(None, writer)
    stream.operations = output
    page.replace_contents(stream)

for index, page in enumerate(writer.pages):
    if index in regions:
        overlay = io.BytesIO()
        c = canvas.Canvas(overlay, pagesize=(960, 540))
        c.setFillColor(HexColor('#18272b'))
        if index == 0:
            c.setFillColor(HexColor('#1484ae'))
            c.setFont('Helvetica-Bold', 12)
            c.drawString(52.5, 380, 'HUSH / AirDnD')
            c.setFont('Helvetica', 8)
            c.setFillColor(HexColor('#7d8b90'))
            c.drawString(52.5, 365, 'HUSH concept / AirDnD simulation')
        elif index == 1:
            c.setFont('Helvetica', 6.6)
            c.drawCentredString(319.7, 340, 'JEV-INSPIRED')
        elif index == 4:
            c.setFont('Helvetica', 9)
            c.drawString(182, 169, '0 friendly collisions')
            c.drawString(305, 169, '0 entity drops')
            c.setFont('Helvetica-Bold', 9)
            c.drawString(405, 169, '19.04 ms')
            c.setFont('Helvetica', 9)
            c.drawString(451, 169, 'p95 normalised per interceptor')
            c.drawString(647, 169, '20 KB INT8 model')
            c.setFillColor(HexColor('#7d8b90'))
            c.setFont('Helvetica', 7)
            c.drawCentredString(480, 152, 'Timing = total scenario elapsed time / 125 interceptors')
            c.drawCentredString(480, 57, 'Apple M3 simulation evidence / fixed configuration / archived seeds and raw logs')
            c.drawCentredString(480, 44, 'Roadmap stages are proposed; integration is subject to validation and partner agreement.')
        c.save()
        overlay.seek(0)
        page.merge_page(PdfReader(overlay).pages[0])
writer.add_metadata({'/Title': 'HUSH / AirDnD — aligned pitch', '/Subject': 'Naming and benchmark-label corrections'})
with DEST.open('wb') as handle:
    writer.write(handle)

check = pdfium.PdfDocument(str(DEST))
assert len(check) == 5
last = ' '.join(check[4].get_textpage().get_text_bounded().split())
assert '19.04 ms' in last and 'p95 full simulation' not in last
assert '19.2 ms' not in last
preview = OUT / 'preview' / 'pitch-aligned'
preview.mkdir(parents=True, exist_ok=True)
for index in regions:
    check[index].render(scale=1.5).to_pil().save(preview / f'slide-{index + 1}.png')
print(f'Created {DEST.name}: 5 pages; original deck retained.')
