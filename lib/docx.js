import {
  Document, Packer, Paragraph, TextRun, ExternalHyperlink,
  AlignmentType, TabStopType, BorderStyle, LevelFormat,
} from 'docx';
import {
  SECTION_TITLES, INLINE_SECTIONS, THEMES, entryView, contactParts, hasContent,
} from '../shared/view.js';

// US Letter, 0.7" side margins, 0.6" top/bottom (twips: 1440 = 1 inch)
const PAGE = { width: 12240, height: 15840 };
const MARGIN = { top: 864, bottom: 864, left: 1008, right: 1008 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const RIGHT_TAB = [{ type: TabStopType.RIGHT, position: CONTENT_WIDTH }];

export function fileBaseName(resume) {
  const name = (resume.basics?.name || 'Resume').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().replace(/\s+/g, '_');
  return `${name || 'Resume'}_Resume`;
}

export async function buildDocx(resume) {
  const theme = THEMES[resume.meta?.theme] || THEMES.classic;
  const accent = (resume.meta?.accent || theme.accent).replace('#', '');
  const base = Math.round(theme.size * 2); // half-points
  const small = base - 2;
  const align = theme.align === 'center' ? AlignmentType.CENTER : AlignmentType.LEFT;
  const b = resume.basics || {};
  const children = [];

  const link = (text, url, size = small) => new ExternalHyperlink({
    link: url,
    children: [new TextRun({ text, size, color: accent, underline: {} })],
  });

  // Header
  children.push(new Paragraph({
    alignment: align,
    spacing: { after: 40 },
    children: [new TextRun({ text: b.name || 'Your Name', bold: true, size: theme.nameSize * 2, color: accent })],
  }));
  if (b.headline) {
    children.push(new Paragraph({
      alignment: align,
      spacing: { after: 40 },
      children: [new TextRun({ text: b.headline, size: base + 1, color: '444444' })],
    }));
  }
  const contacts = contactParts(b);
  if (contacts.length) {
    const runs = [];
    contacts.forEach((c, i) => {
      if (i) runs.push(new TextRun({ text: '  |  ', size: small, color: '888888' }));
      runs.push(c.url ? link(c.text, c.url) : new TextRun({ text: c.text, size: small }));
    });
    children.push(new Paragraph({ alignment: align, spacing: { after: 80 }, children: runs }));
  }

  const heading = (text) => new Paragraph({
    keepNext: true,
    spacing: { before: 200, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: accent, space: 2 } },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: base + 2, color: accent, characterSpacing: 20 })],
  });

  const bullet = (text) => new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 30 },
    children: [new TextRun({ text, size: base })],
  });

  for (const key of resume.sectionOrder) {
    if (!hasContent(resume, key)) continue;
    children.push(heading(SECTION_TITLES[key]));

    if (key === 'summary') {
      children.push(new Paragraph({
        spacing: { after: 60 },
        alignment: AlignmentType.JUSTIFIED,
        children: [new TextRun({ text: resume.summary, size: base })],
      }));
      continue;
    }

    if (key === 'skills') {
      for (const g of resume.skills) {
        if (!g.items?.length) continue;
        const runs = [];
        if (g.category) runs.push(new TextRun({ text: `${g.category}: `, bold: true, size: base }));
        runs.push(new TextRun({ text: g.items.join(', '), size: base }));
        children.push(new Paragraph({ spacing: { after: 40 }, children: runs }));
      }
      continue;
    }

    resume[key].forEach((entry, idx) => {
      const v = entryView(key, entry);
      const before = idx === 0 ? 0 : (INLINE_SECTIONS.has(key) ? 30 : 140);

      if (INLINE_SECTIONS.has(key)) {
        const runs = [new TextRun({ text: v.title || '', bold: true, size: base })];
        if (v.subtitle) runs.push(new TextRun({ text: ` — ${v.subtitle}`, size: base }));
        if (v.link) runs.push(new TextRun({ text: '  ', size: base }), link('link', v.link));
        if (v.dates) runs.push(new TextRun({ text: `\t${v.dates}`, size: small, color: '555555' }));
        children.push(new Paragraph({ tabStops: RIGHT_TAB, spacing: { before, after: 20 }, children: runs }));
        if (v.description) {
          children.push(new Paragraph({ spacing: { after: 30 }, children: [new TextRun({ text: v.description, size: small, italics: true })] }));
        }
        return;
      }

      // Line 1: Title ............ Dates
      const line1 = [new TextRun({ text: v.title || '', bold: true, size: base + 1 })];
      if (v.link) line1.push(new TextRun({ text: '  ', size: base }), link('link', v.link));
      if (v.dates) line1.push(new TextRun({ text: `\t${v.dates}`, size: small, color: '555555' }));
      children.push(new Paragraph({ tabStops: RIGHT_TAB, keepNext: true, spacing: { before, after: 10 }, children: line1 }));

      // Line 2: Organization ..... Location
      if (v.subtitle || v.location) {
        const line2 = [new TextRun({ text: v.subtitle || '', italics: true, size: base, color: accent })];
        if (v.location) line2.push(new TextRun({ text: `\t${v.location}`, italics: true, size: small, color: '555555' }));
        children.push(new Paragraph({ tabStops: RIGHT_TAB, keepNext: !!(v.description || v.bullets.length), spacing: { after: 40 }, children: line2 }));
      }
      if (v.description) {
        children.push(new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: v.description, size: base, italics: true, color: '333333' })] }));
      }
      v.bullets.forEach((t) => children.push(bullet(t)));
    });
  }

  const doc = new Document({
    creator: b.name || 'Resume Builder',
    title: `${b.name || ''} Resume`.trim(),
    styles: { default: { document: { run: { font: theme.font, size: base } } } },
    numbering: {
      config: [{
        reference: 'bullets',
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: '•',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 320, hanging: 200 } } },
        }],
      }],
    },
    sections: [{ properties: { page: { size: PAGE, margin: MARGIN } }, children }],
  });

  return Packer.toBuffer(doc);
}
