import { ENTRY_SECTIONS, DEFAULT_ORDER, THEMES, emptyResume } from '../shared/view.js';

const uid = () => Math.random().toString(36).slice(2, 8);
const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const strList = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

const ALLOWED_FIELDS = {
  experience: ['company', 'title', 'location', 'start', 'end', 'description', 'bullets'],
  education: ['school', 'degree', 'field', 'location', 'start', 'end', 'details', 'bullets'],
  projects: ['name', 'role', 'link', 'start', 'end', 'description', 'bullets'],
  certifications: ['name', 'issuer', 'date', 'link'],
  awards: ['name', 'issuer', 'date', 'description'],
  volunteer: ['organization', 'role', 'location', 'start', 'end', 'description', 'bullets'],
  publications: ['title', 'publisher', 'date', 'link', 'description'],
};

export function normalizeResume(input) {
  const base = emptyResume();
  const r = input && typeof input === 'object' ? structuredClone(input) : {};
  const out = { ...base, ...r };
  out.basics = { ...base.basics, ...(r.basics || {}) };
  out.basics.links = Array.isArray(out.basics.links) ? out.basics.links : [];
  out.skills = Array.isArray(r.skills) ? r.skills : [];
  for (const s of ENTRY_SECTIONS) {
    out[s] = Array.isArray(r[s]) ? r[s].map((e) => ({ id: e.id || uid(), ...e })) : [];
  }
  const order = Array.isArray(r.sectionOrder) ? r.sectionOrder.filter((k) => DEFAULT_ORDER.includes(k)) : [];
  out.sectionOrder = [...new Set([...order, ...DEFAULT_ORDER])];
  out.meta = { ...base.meta, ...(r.meta || {}) };
  return out;
}

function assertSection(section) {
  if (!ENTRY_SECTIONS.includes(section)) {
    throw new Error(`Unknown section "${section}". Use one of: ${ENTRY_SECTIONS.join(', ')}`);
  }
}

function findEntry(resume, section, id) {
  const entry = resume[section].find((x) => x.id === id);
  if (!entry) {
    const ids = resume[section].map((e) => e.id).join(', ') || 'none';
    throw new Error(`No ${section} entry with id "${id}". Existing ids: ${ids}`);
  }
  return entry;
}

/**
 * Applies one tool call to the resume (mutating it) and returns a short
 * result string for the model. Throws on invalid input; the caller turns
 * that into an is_error tool_result so the model can correct itself.
 */
export function applyOp(resume, name, input = {}) {
  switch (name) {
    case 'update_basics': {
      const b = resume.basics;
      for (const k of ['name', 'headline', 'email', 'phone', 'location']) {
        if (input[k] !== undefined) b[k] = str(input[k]);
      }
      if (Array.isArray(input.links)) {
        b.links = input.links.filter((l) => l?.url).map((l) => ({ label: str(l.label), url: str(l.url) }));
      }
      return 'Contact details updated.';
    }

    case 'set_summary':
      resume.summary = str(input.text);
      return 'Summary updated.';

    case 'upsert_entry': {
      const { section, id, fields = {}, append_bullets, position } = input;
      assertSection(section);
      const list = resume[section];
      let entry;
      let created = false;
      if (id) {
        entry = findEntry(resume, section, id);
      } else {
        entry = { id: uid() };
        created = true;
        const pos = Number.isInteger(position) ? Math.max(0, Math.min(position, list.length)) : list.length;
        list.splice(pos, 0, entry);
      }
      for (const key of ALLOWED_FIELDS[section]) {
        if (fields[key] === undefined) continue;
        entry[key] = key === 'bullets' ? strList(fields[key]) : str(fields[key]);
      }
      if (Array.isArray(append_bullets) && ALLOWED_FIELDS[section].includes('bullets')) {
        entry.bullets = [...(entry.bullets || []), ...strList(append_bullets)];
      }
      return `${created ? 'Created' : 'Updated'} ${section} entry id=${entry.id}`;
    }

    case 'remove_entry': {
      assertSection(input.section);
      findEntry(resume, input.section, input.id);
      resume[input.section] = resume[input.section].filter((e) => e.id !== input.id);
      return `Removed ${input.section} entry ${input.id}.`;
    }

    case 'move_entry': {
      assertSection(input.section);
      const list = resume[input.section];
      const entry = findEntry(resume, input.section, input.id);
      list.splice(list.indexOf(entry), 1);
      const pos = Math.max(0, Math.min(Number(input.position) || 0, list.length));
      list.splice(pos, 0, entry);
      return `Moved ${input.section} entry ${input.id} to position ${pos}.`;
    }

    case 'set_skills': {
      const groups = (input.groups || [])
        .map((g) => ({ category: str(g.category), items: strList(g.items) }))
        .filter((g) => g.items.length);
      if (input.mode === 'merge') {
        for (const g of groups) {
          const existing = resume.skills.find((x) => x.category.toLowerCase() === g.category.toLowerCase());
          if (existing) {
            const seen = new Set(existing.items.map((i) => i.toLowerCase()));
            existing.items.push(...g.items.filter((i) => !seen.has(i.toLowerCase())));
          } else {
            resume.skills.push(g);
          }
        }
      } else {
        resume.skills = groups;
      }
      return `Skills ${input.mode === 'merge' ? 'merged' : 'replaced'} (${resume.skills.length} groups).`;
    }

    case 'set_section_order': {
      const order = strList(input.order).filter((k) => DEFAULT_ORDER.includes(k));
      resume.sectionOrder = [...new Set([...order, ...DEFAULT_ORDER])];
      return `Section order: ${resume.sectionOrder.join(', ')}`;
    }

    case 'set_style': {
      if (input.theme && THEMES[input.theme]) resume.meta.theme = input.theme;
      if (input.accent !== undefined) {
        const a = str(input.accent);
        resume.meta.accent = /^#[0-9a-f]{6}$/i.test(a) ? a : '';
      }
      return `Style: ${resume.meta.theme}${resume.meta.accent ? ` / ${resume.meta.accent}` : ''}.`;
    }

    case 'offer_options':
      return 'Options are shown to the user as clickable cards. Stop and wait for their choice; do not apply any option yourself.';

    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
