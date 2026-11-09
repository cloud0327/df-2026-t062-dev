"""Overlay synthetic answers on the two official Hiroshima form PDFs."""
import argparse
import csv
from datetime import date
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path

import pdfplumber
from pypdf import PdfReader, PdfWriter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas

HERE = Path(__file__).resolve().parent
BASIC_SHA = 'a92b8e87067944fe85a9c55aa1829b96892896052d5a7d9ede417ec5c6d89435'
NOTES_SHA = 'ebef79d26003a4f93df295535bda7b0efec9777eab2b8e1f4a5f19a78aeea072'
FONT = 'BIZUDPGothic'
FONT_FILE = HERE.parents[2] / 'forms/fonts/BIZUDPGothic-Regular.ttf'


def checked_bytes(path, expected):
    data = path.read_bytes()
    if sha256(data).hexdigest() != expected:
        raise ValueError(f'{path}: expected the Hiroshima PDF linked in README.md')
    return data


def box_rows(page, bounds, width, height, tolerance=0.5):
    """Find the paired horizontal borders of each checkbox in one section."""
    x_min, x_max, y_min, y_max = bounds
    borders = {
        (round(r['x0'], 1), round(r['top'], 1))
        for r in page.rects
        if x_min < r['x0'] < x_max and y_min < r['top'] < y_max + height
        and abs(r['width'] - width) < 0.3 and 0.8 < r['height'] < 1.2
    }
    rows = {}
    for x, y in sorted(borders):
        if y < y_max and any(xx == x and abs(yy - y - height) < tolerance for xx, yy in borders):
            rows.setdefault(y, []).append((x, y))
    return [rows[y] for y in sorted(rows)]


def checkboxes(basic):
    with pdfplumber.open(BytesIO(basic)) as pdf:
        first, second = pdf.pages
        left = box_rows(first, (60, 295, 532, 703), 13.8, 16.3)
        right = box_rows(first, (340, 556, 532, 682), 13.8, 16.3)
        # The first two multi-select questions each occupy two lines.
        group_one = [
            left[0][:3] + left[1] + left[0][3:],
            left[2][:3] + left[3] + left[2][3:],
            *left[4:], *right,
        ]
        groups = [
            group_one,
            box_rows(second, (90, 280, 66, 328), 11, 13.5),
            box_rows(second, (90, 280, 359, 557), 11, 13.5),
            box_rows(second, (400, 540, 66, 399), 11, 13.5, tolerance=0.9),
            box_rows(second, (355, 540, 434, 557), 11, 13.5),
        ]
    if [len(rows) for rows in groups] != [13, 12, 9, 15, 6]:
        raise ValueError('Unexpected checkbox layout')
    return {
        f'{group}-{item}': boxes
        for group, rows in enumerate(groups, 1)
        for item, boxes in enumerate(rows, 1)
    }


def mark(c, height, box, faint=False):
    x, top = box
    c.setStrokeGray(0.76 if faint else 0.08)
    c.setLineWidth(0.65 if faint else 1.35)
    c.setLineCap(1)
    c.line(x + 2.5, height - top - 10.5, x + 9, height - top - 3.5)


def write_fixture(path, basic, notes, boxes, answers, cases, difficult):
    pages = [*PdfReader(BytesIO(basic)).pages, *PdfReader(BytesIO(notes)).pages]
    writer = PdfWriter()
    for index, page in enumerate(pages, 1):
        width, height = float(page.mediabox.width), float(page.mediabox.height)
        buffer = BytesIO()
        c = Canvas(buffer, pagesize=(width, height))
        c.setFont(FONT, 9)
        c.drawString(24, 16, f'架空の検証資料｜提出不可｜{cases["subject"]}｜調査日 {cases["surveyDate"]}')
        if index == 1:
            when = date.fromisoformat(cases['surveyDate'])
            for value, first_cell in ((when.year - 2018, 75), (when.month, 114), (when.day, 152)):
                for offset, digit in enumerate(f'{value:02d}'):
                    c.drawCentredString(first_cell + 14 * offset, height - 105, digit)
            mark(c, height, (26.5, 132.6))
            c.drawString(83, height - 209, cases['subject'])
            for item in ('1-1', '1-2'):
                count = len(answers[item]['selected'].split(','))
                c.drawCentredString(255, height - (568 if item == '1-1' else 611), str(count))
        if index in (1, 2):
            for item, answer in answers.items():
                if int(answer['source_page']) != index:
                    continue
                case = cases['difficult'].get(item, {}) if difficult else {}
                for selection in map(int, answer['selected'].split(',')):
                    mark(c, height, boxes[item][selection - 1], case.get('kind') == 'faint_mark')
                if case.get('kind') == 'multiple_marks':
                    mark(c, height, boxes[item][case['additionalChoice'] - 1])
        if index == 3:
            c.setFont(FONT, 9)
            for i, note in enumerate(cases['notes']):
                y = height - (326 + i * 17)
                c.drawString(46, y, note['item'])
                c.drawString(87, y, note['text'])
        c.showPage()
        c.save()
        page.merge_page(PdfReader(buffer).pages[0])
        writer.add_page(page)
    writer.add_metadata({'/Title': '架空の認定調査票（難読版）' if difficult else '架空の認定調査票（通常版）'})
    with path.open('wb') as file:
        writer.write(file)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--basic', type=Path, required=True)
    p.add_argument('--notes', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    basic = checked_bytes(args.basic, BASIC_SHA)
    notes = checked_bytes(args.notes, NOTES_SHA)
    boxes = checkboxes(basic)
    with (HERE / 'gold.tsv').open(encoding='utf-8') as file:
        answers = {r['item']: r for r in csv.DictReader(file, delimiter='\t')}
    cases = json.loads((HERE / 'cases.json').read_text(encoding='utf-8'))
    if boxes.keys() != answers.keys():
        raise ValueError('The answer key does not match the form items')
    pdfmetrics.registerFont(TTFont(FONT, str(FONT_FILE)))
    args.out.mkdir(parents=True, exist_ok=True)
    for filename, difficult in [('survey-clean.pdf', False), ('survey-difficult.pdf', True)]:
        path = args.out / filename
        write_fixture(path, basic, notes, boxes, answers, cases, difficult)
        print(path)


if __name__ == '__main__':
    main()
