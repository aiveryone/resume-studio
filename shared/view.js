// Shared between the browser (live preview) and the server (.docx export),
// so the preview and the exported document lay out content the same way.

export const ENTRY_SECTIONS = [
  'experience', 'education', 'projects', 'certifications',
  'awards', 'volunteer', 'publications',
];

export const DEFAULT_ORDER = [
  'summary', 'experience', 'skills', 'education', 'projects',
  'certifications', 'awards', 'volunteer', 'publications',
];

export const SECTION_TITLES = {
  summary: 'Professional Summary',
  experience: 'Professional Experience',
  skills: 'Core Competencies',
  education: 'Education',
  projects: 'Selected Projects',
  certifications: 'Certifications',
  awards: 'Awards & Recognition',
  volunteer: 'Volunteer & Leadership',
  publications: 'Publications & Speaking',
};

// Sections whose entries render compactly on one line ("Name — Issuer ... Date").
export const INLINE_SECTIONS = new Set(['certifications', 'awards', 'publications']);

export const THEMES = {
  classic: {
    label: 'Classic', font: 'Cambria', css: 'Cambria, Georgia, "Times New Roman", serif',
    size: 10.5, nameSize: 22, accent: '#1f3a5f', align: 'center',
  },
  modern: {
    label: 'Modern', font: 'Calibri', css: 'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
    size: 10.5, nameSize: 24, accent: '#0f766e', align: 'left',
  },
  compact: {
    label: 'Compact', font: 'Arial', css: 'Arial, Helvetica, sans-serif',
    size: 9.5, nameSize: 18, accent: '#333333', align: 'left',
  },
};

export function emptyResume() {
  return {
    basics: { name: '', headline: '', email: '', phone: '', location: '', links: [] },
    summary: '',
    skills: [],
    experience: [], education: [], projects: [], certifications: [],
    awards: [], volunteer: [], publications: [],
    sectionOrder: [...DEFAULT_ORDER],
    meta: { theme: 'classic', accent: '' },
  };
}

export function dateRange(start, end) {
  if (start && end) return `${start} – ${end}`;
  return start || end || '';
}

// Normalizes every entry type to one display shape.
export function entryView(section, e = {}) {
  const dates = dateRange(e.start, e.end);
  const bullets = Array.isArray(e.bullets) ? e.bullets.filter(Boolean) : [];
  switch (section) {
    case 'experience':
      return { title: e.title, subtitle: e.company, location: e.location, dates, description: e.description, bullets };
    case 'education': {
      const degree = [e.degree, e.field].filter(Boolean).join(', ');
      return {
        title: degree || e.school, subtitle: degree ? e.school : '',
        location: e.location, dates, description: e.details, bullets,
      };
    }
    case 'projects':
      return { title: e.name, subtitle: e.role, location: '', dates, description: e.description, bullets, link: e.link };
    case 'certifications':
      return { title: e.name, subtitle: e.issuer, dates: e.date || dates, link: e.link, bullets: [] };
    case 'awards':
      return { title: e.name, subtitle: e.issuer, dates: e.date || dates, description: e.description, bullets: [] };
    case 'volunteer':
      return { title: e.role, subtitle: e.organization, location: e.location, dates, description: e.description, bullets };
    case 'publications':
      return { title: e.title, subtitle: e.publisher, dates: e.date || dates, link: e.link, description: e.description, bullets: [] };
    default:
      return { title: e.title || e.name, subtitle: '', dates, bullets };
  }
}

export function contactParts(basics = {}) {
  const parts = [];
  if (basics.location) parts.push({ text: basics.location });
  if (basics.phone) parts.push({ text: basics.phone });
  if (basics.email) parts.push({ text: basics.email, url: `mailto:${basics.email}` });
  for (const l of basics.links || []) {
    if (!l?.url) continue;
    const url = /^https?:\/\//i.test(l.url) ? l.url : `https://${l.url}`;
    parts.push({ text: l.label || l.url.replace(/^https?:\/\/(www\.)?/i, ''), url });
  }
  return parts;
}

export function hasContent(resume, key) {
  if (key === 'summary') return !!resume.summary?.trim();
  if (key === 'skills') return (resume.skills || []).some((g) => g.items?.length);
  return (resume[key] || []).length > 0;
}

// Rough "how far along" signal for the preview header.
export function completeness(resume) {
  const b = resume.basics || {};
  const checks = [
    !!b.name, !!b.headline, !!(b.email || b.phone), !!b.location,
    (b.links || []).length > 0,
    (resume.summary || '').length > 120,
    (resume.experience || []).length > 0,
    (resume.experience || []).some((e) => (e.bullets || []).length >= 3),
    (resume.experience || []).length > 0 && resume.experience.every((e) => e.start),
    hasContent(resume, 'skills'),
    (resume.education || []).length > 0,
    (resume.experience || []).flatMap((e) => e.bullets || []).some((t) => /\d/.test(t)),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}
