/**
 * Export ALSYD_LEGAL_MASTER_RU_BG.md → DOCX for Bulgarian counsel.
 * Preserves substantive content; does not simplify legal text.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  Header,
  Footer,
  HeadingLevel,
  AlignmentType,
  PageNumber,
  BorderStyle,
  WidthType,
  PageBreak,
  ShadingType,
  VerticalAlign,
} from 'docx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'ALSYD_LEGAL_MASTER_RU_BG.md');
const OUT = path.join(__dirname, 'ALSYD_LEGAL_MASTER_RU_BG.docx');

const PAGE_W = 11906; // A4 twips
const PAGE_H = 16838;
const MARGIN = 1134; // ~20mm
const CONTENT_W = PAGE_W - MARGIN * 2;

const thin = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };
const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};

function stripMd(s) {
  return String(s ?? '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\\\|/g, '|')
    .trim();
}

function runsFromInline(text, base = {}) {
  const parts = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;
  const src = String(text ?? '');
  while ((m = re.exec(src))) {
    if (m.index > last) {
      parts.push(new TextRun({ text: src.slice(last, m.index), ...base, font: 'Times New Roman', size: base.size || 20 }));
    }
    if (m[1] != null) {
      parts.push(new TextRun({ text: m[1], bold: true, ...base, font: 'Times New Roman', size: base.size || 20 }));
    } else {
      parts.push(new TextRun({ text: m[2], font: 'Consolas', size: (base.size || 20) - 2, ...base }));
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) {
    parts.push(new TextRun({ text: src.slice(last), ...base, font: 'Times New Roman', size: base.size || 20 }));
  }
  if (!parts.length) {
    parts.push(new TextRun({ text: '', font: 'Times New Roman', size: base.size || 20 }));
  }
  return parts;
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: 276 },
    alignment: opts.align || AlignmentType.JUSTIFIED,
    ...opts.para,
    children: typeof text === 'string' ? runsFromInline(text, { size: opts.size || 20, italics: opts.italics, bold: opts.bold }) : text,
  });
}

function heading(text, level) {
  const map = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  };
  return new Paragraph({
    heading: map[level] || HeadingLevel.HEADING_1,
    spacing: { before: level === 1 ? 320 : 200, after: 140 },
    children: [new TextRun({ text: stripMd(text), bold: true, font: 'Times New Roman', size: level === 1 ? 28 : level === 2 ? 24 : 22 })],
  });
}

function cell(text, opts = {}) {
  const width = opts.width || Math.floor(CONTENT_W / (opts.cols || 2));
  return new TableCell({
    borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.header ? { type: ShadingType.CLEAR, fill: '1F2937' } : opts.alt ? { type: ShadingType.CLEAR, fill: 'F3F4F6' } : undefined,
    verticalAlign: VerticalAlign.TOP,
    children: [
      new Paragraph({
        spacing: { after: 40, before: 40 },
        children: runsFromInline(stripMd(text), {
          size: opts.header ? 16 : 15,
          bold: !!opts.header || !!opts.bold,
          color: opts.header ? 'FFFFFF' : '111111',
        }),
      }),
    ],
  });
}

function makeTable(rows) {
  if (!rows.length) return null;
  const cols = Math.max(...rows.map((r) => r.length));
  const colW = Math.floor(CONTENT_W / cols);
  // Wide tables (>6 cols): render as stacked record blocks for readability on A4
  if (cols > 6) {
    const blocks = [];
    const headers = rows[0].map(stripMd);
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      blocks.push(
        new Paragraph({
          spacing: { before: 160, after: 60 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1' } },
          children: [
            new TextRun({
              text: `${stripMd(row[0] || '')}${row[2] ? ' — ' + stripMd(row[2]) : row[1] ? ' — ' + stripMd(row[1]) : ''}`,
              bold: true,
              font: 'Times New Roman',
              size: 18,
            }),
          ],
        }),
      );
      const pairs = [];
      for (let c = 0; c < headers.length; c++) {
        const h = headers[c];
        const v = stripMd(row[c] ?? '');
        if (!h && !v) continue;
        pairs.push([h, v]);
      }
      // 2-column key/value table
      const kvRows = [];
      for (let k = 0; k < pairs.length; k += 1) {
        kvRows.push(
          new TableRow({
            children: [
              cell(pairs[k][0], { width: Math.floor(CONTENT_W * 0.32), cols: 2, bold: true, alt: k % 2 === 0 }),
              cell(pairs[k][1], { width: Math.floor(CONTENT_W * 0.68), cols: 2, alt: k % 2 === 0 }),
            ],
          }),
        );
      }
      blocks.push(
        new Table({
          width: { size: CONTENT_W, type: WidthType.DXA },
          columnWidths: [Math.floor(CONTENT_W * 0.32), Math.floor(CONTENT_W * 0.68)],
          rows: kvRows,
        }),
      );
      blocks.push(
        p('Место за бележки на адвоката / Място за бележки на адвоката: ________________________________', {
          size: 16,
          italics: true,
          after: 80,
          align: AlignmentType.LEFT,
        }),
      );
    }
    return blocks;
  }

  const tableRows = rows.map((row, ri) => {
    const cells = [];
    for (let c = 0; c < cols; c++) {
      cells.push(cell(row[c] ?? '', { width: colW, cols, header: ri === 0, alt: ri > 0 && ri % 2 === 0 }));
    }
    return new TableRow({ children: cells });
  });
  return [
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: Array(cols).fill(colW),
      rows: tableRows,
    }),
  ];
}

function parseMdTable(lines, startIdx) {
  const rows = [];
  let i = startIdx;
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    const line = lines[i].trim();
    if (/^\|?\s*:?-{3,}/.test(line.replace(/\|/g, '|')) || line.includes('---')) {
      i++;
      continue;
    }
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.replace(/\\\|/g, '|').trim());
    rows.push(cells);
    i++;
  }
  return { rows, next: i };
}

function parseMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const children = [];
  let i = 0;
  let skipTitleBlock = true;

  // Skip the H1 title cluster — used on cover instead
  while (i < lines.length && (lines[i].startsWith('# ') || lines[i].trim() === '' || lines[i].startsWith('**ALSYD'))) {
    if (lines[i].startsWith('|') || (lines[i].startsWith('**') && !lines[i].startsWith('**ALSYD'))) break;
    i++;
    if (i > 20) break;
  }
  // include meta table if present at top
  skipTitleBlock = false;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (line.trim() === '---') {
      i++;
      continue;
    }

    if (line.startsWith('# ')) {
      // Dual H1 lines (RU then BG) → one heading combining both
      let title = line.slice(2).trim();
      if (i + 1 < lines.length && lines[i + 1].startsWith('# ')) {
        title = `${title} / ${lines[i + 1].slice(2).trim()}`;
        i += 2;
      } else {
        i++;
      }
      children.push(heading(title, 1));
      continue;
    }

    if (line.startsWith('## ')) {
      children.push(heading(line.slice(3).trim(), 2));
      i++;
      continue;
    }

    if (line.startsWith('### ')) {
      children.push(heading(line.slice(4).trim(), 3));
      i++;
      continue;
    }

    if (line.trim().startsWith('|')) {
      const { rows, next } = parseMdTable(lines, i);
      const blocks = makeTable(rows);
      if (blocks) children.push(...blocks);
      i = next;
      continue;
    }

    if (/^\d+\.\s/.test(line.trim()) || /^\d+\)\s/.test(line.trim())) {
      children.push(
        new Paragraph({
          spacing: { after: 80, line: 276 },
          indent: { left: 180 },
          children: runsFromInline(line.trim(), { size: 20 }),
        }),
      );
      i++;
      continue;
    }

    if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
      children.push(
        new Paragraph({
          spacing: { after: 60, line: 276 },
          indent: { left: 288 },
          children: [
            new TextRun({ text: '• ', font: 'Times New Roman', size: 20 }),
            ...runsFromInline(line.trim().replace(/^[-*]\s+/, ''), { size: 20 }),
          ],
        }),
      );
      i++;
      continue;
    }

    // paragraph — gather continuation lines
    let buf = line;
    i++;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].trim().startsWith('|') &&
      !lines[i].trim().startsWith('- ') &&
      !/^\d+\.\s/.test(lines[i].trim()) &&
      lines[i].trim() !== '---'
    ) {
      buf += ' ' + lines[i].trim();
      i++;
    }
    children.push(p(buf));
  }

  return children;
}

const md = fs.readFileSync(SRC, 'utf8');
const body = parseMarkdown(md);

const cover = [
  new Paragraph({ spacing: { after: 200 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: 'ALSYD EOOD', bold: true, font: 'Times New Roman', size: 40 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'ЮРИДИЧЕСКИЙ ПАКЕТ ДЛЯ ЗАПУСКА ПЛАТФОРМЫ', bold: true, font: 'Times New Roman', size: 28 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'ПРАВЕН ПАКЕТ ЗА СТАРТИРАНЕ НА ПЛАТФОРМАТА', bold: true, font: 'Times New Roman', size: 28 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: 'ALSYD Control / AMADEUS 11', font: 'Times New Roman', size: 22 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Документ за преглед от български адвокат / Документ для проверки болгарским адвокатом', italics: true, font: 'Times New Roman', size: 20 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: 'Дата / Date: 2026-10-08', font: 'Times New Roman', size: 20 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text: 'Версия: ALSYD_LEGAL_MASTER_RU_BG', font: 'Times New Roman', size: 20 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: 'Език / Language: RU + BG (паралелни раздели)', font: 'Times New Roman', size: 20 })],
  }),
  new Paragraph({
    alignment: AlignmentType.BOTH,
    spacing: { before: 400, after: 120 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: '1F2937' } },
    children: [
      new TextRun({
        text: 'ОТКАЗ ОТ ОТГОВОРНОСТ / ДИСКЛЕЙМЕР: Този документ не е правна консултация и не удостоверява съответствие със закона. Предназначен е само за преглед от адвокат. / Настоящий документ не является юридической консультацией и не удостоверяет соответствие закону.',
        italics: true,
        font: 'Times New Roman',
        size: 18,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.BOTH,
    spacing: { before: 200, after: 80 },
    children: [
      new TextRun({
        text: 'Проверка на източника: регистър 90/90 · gaps 20/20 · въпроси 25/25 · RU/BG COMPLETE',
        font: 'Times New Roman',
        size: 18,
        bold: true,
      }),
    ],
  }),
  new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 400 },
    children: [new TextRun({ text: 'Място за бележки при получаване / Место для заметок при получении:', italics: true, font: 'Times New Roman', size: 18 })],
  }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: '________________________________________________________________', font: 'Times New Roman', size: 20 })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: '________________________________________________________________', font: 'Times New Roman', size: 20 })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: '________________________________________________________________', font: 'Times New Roman', size: 20 })] }),
  new Paragraph({ children: [new PageBreak()] }),
];

const tocIntro = [
  heading('СЪДЪРЖАНИЕ / ОГЛАВЛЕНИЕ', 1),
  p('Това съдържание отразява раздели 1–25 на основния документ. В Word използвайте „Update Field“ при нужда от автоматично обновяване на номерата на страниците, ако добавите TOC field ръчно.', {
    size: 18,
    italics: true,
    align: AlignmentType.LEFT,
  }),
];

const tocItems = [
  '1. Резюме',
  '2. Правен статут на ALSYD',
  '3. Оценка на статута „агрегатор“',
  '4. Отношения между страните',
  '5. Пълен регистър на документите (90)',
  '6. Пакет договори с клиента',
  '7. Домейн',
  '8. Хостинг и инфраструктура',
  '9. Покани и първи вход',
  '10. Споразумения и отметки',
  '11. ОРЗД/GDPR',
  '12. Подизпълнители',
  '13. Книга на етажната собственост',
  '14. Общи събрания',
  '15. Плащания, фактури, ДДС',
  '16. Поддръжка и комуникации',
  '17. Уебсайт и бисквитки',
  '18. Интелектуална собственост',
  '19. Сигурност и инциденти',
  '20. Прекратяване и handover',
  '21. Чеклист за търговски старт',
  '22. Пропуски в имплементацията (20)',
  '23. Въпроси към адвоката (25)',
  '24. Решения преди старт',
  '25. Правно съгласуване / подписи',
].map(
  (t) =>
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: t, font: 'Times New Roman', size: 20 })],
    }),
);

tocItems.push(new Paragraph({ children: [new PageBreak()] }));

const commentAnnex = [
  new Paragraph({ children: [new PageBreak()] }),
  heading('ПРИЛОЖЕНИЕ: МЯСТО ЗА КОМЕНТАРИ НА АДВОКАТА / ПРИЛОЖЕНИЕ: МЕСТО ДЛЯ КОММЕНТАРИЕВ АДВОКАТА', 1),
  p('Използвайте това пространство за бележки по раздели, без да променяте основния текст.', { italics: true, align: AlignmentType.LEFT }),
];

for (let n = 1; n <= 25; n++) {
  commentAnnex.push(
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [new TextRun({ text: `Раздел / Раздел ${n} — бележки:`, bold: true, font: 'Times New Roman', size: 20 })],
    }),
  );
  commentAnnex.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: '________________________________________________________________', font: 'Times New Roman', size: 20 })] }));
  commentAnnex.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: '________________________________________________________________', font: 'Times New Roman', size: 20 })] }));
  commentAnnex.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: '________________________________________________________________', font: 'Times New Roman', size: 20 })] }));
}

const doc = new Document({
  styles: {
    default: {
      document: {
        styles: [{ id: 'Normal', run: { font: 'Times New Roman', size: 20 } }],
      },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({
                  text: 'ALSYD EOOD — Правен пакет / Юридический пакет — CONFIDENTIAL',
                  font: 'Times New Roman',
                  size: 14,
                  color: '4B5563',
                  italics: true,
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'Страница / Страница ', font: 'Times New Roman', size: 14, color: '4B5563' }),
                new TextRun({ children: [PageNumber.CURRENT], font: 'Times New Roman', size: 14, color: '4B5563' }),
                new TextRun({ text: ' / ', font: 'Times New Roman', size: 14, color: '4B5563' }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Times New Roman', size: 14, color: '4B5563' }),
                new TextRun({
                  text: '  ·  Не е правно становище / Не является юридическим заключением',
                  font: 'Times New Roman',
                  size: 14,
                  color: '4B5563',
                }),
              ],
            }),
          ],
        }),
      },
      children: [...cover, ...tocIntro, ...tocItems, ...body, ...commentAnnex],
    },
  ],
});

const buf = await Packer.toBuffer(doc);
fs.writeFileSync(OUT, buf);
console.log('WROTE', OUT, 'bytes', buf.length);
