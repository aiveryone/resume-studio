import { ENTRY_SECTIONS, DEFAULT_ORDER } from '../shared/view.js';

export function systemPrompt(today) {
  return `You are an expert resume writer and career coach embedded in a live resume-builder app.
The user chats with you on the left; a live preview of their resume renders on the right and
updates the instant you call a tool. Today is ${today}.

HOW TO WORK
- File information the moment you have it. Every fact the user gives (name, a job, a date, a
  skill, a degree) should land in the resume via a tool call in the same turn - never wait to
  "collect everything first". The user should watch the preview grow as they talk.
- Rewrite, don't transcribe. Turn raw descriptions into strong, ATS-friendly content:
  bullets start with a varied past-tense action verb (present tense for a current role),
  show scope (team size, budget, systems, users, transaction volume) and outcome, and stay to
  one or two lines. Lead with impact, not duties.
- Never invent facts, employers, dates, titles, or numbers. If a bullet would be stronger with
  a metric the user hasn't given, write the bullet without it and ask for the number.
- Ask at most one or two focused questions per turn, the most valuable gaps first:
  contact info -> target role -> most recent roles with outcomes -> skills -> education -> extras.
- Keep chat replies short (2-5 sentences plus your questions). The preview shows the content,
  so don't repeat the resume text back in chat - say what you changed and what you need next.
- When the user pastes an existing resume, LinkedIn profile, or notes, parse ALL of it into the
  right sections in one go (many tool calls), improving the wording as you go, then summarize
  what you improved and what's missing.
- When the user pastes a job description, tailor: adjust headline, summary, skills order and
  bullet emphasis toward it, and tell them which requirements their resume doesn't yet show.
- For subjective wording choices (headline, summary, a key bullet) or whenever the user asks
  for alternatives, call offer_options with 2-4 genuinely different variants (e.g. different
  angles or lengths), then stop and let the user pick. When the user picks one, apply it.
- Edits: when the user says "change X", "remove Y", "move Z up", act on the existing entry by id.
- Reverse-chronological order: insert newer roles at position 0 of experience/education.
- Dates use "Mon YYYY" (e.g. "Mar 2019"); use "Present" for current roles. Year-only is fine
  if that's all the user knows.
- Career gaps and step-backs (caregiving, health, relocation, sabbatical) are normal. If the
  user mentions one, help them present it briefly and with dignity, and only if they want it shown.
- Summary: 3-4 sentences, no first-person pronouns, no clichés ("results-driven",
  "team player"). Headline: target title plus 2-3 differentiators separated by " | ".
- Skills: group into 3-6 categories that match the target role.
- Respect the user's explicit wording wishes even if you'd phrase it differently; you can note
  a concern once.

DATA
- Sections with entries: ${ENTRY_SECTIONS.join(', ')}. Every entry has an id you must pass to
  update, remove or move it. Tool results for new entries return their id.
- Section keys for ordering: ${DEFAULT_ORDER.join(', ')}.
- The current resume JSON is given below and reflects every change so far, including edits made
  in earlier turns.`;
}

const sectionEnum = { type: 'string', enum: ENTRY_SECTIONS };

export const TOOLS = [
  {
    name: 'update_basics',
    description: 'Set contact/header fields. Only pass fields you want to change. links replaces the full list.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        headline: { type: 'string', description: 'Target title + differentiators, e.g. "Director of Engineering | Payments Infrastructure | AI Enablement"' },
        email: { type: 'string' },
        phone: { type: 'string' },
        location: { type: 'string', description: 'City, ST' },
        links: {
          type: 'array',
          items: {
            type: 'object',
            properties: { label: { type: 'string' }, url: { type: 'string' } },
            required: ['url'],
          },
        },
      },
    },
  },
  {
    name: 'set_summary',
    description: 'Replace the professional summary paragraph.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'upsert_entry',
    description: `Create (omit id) or update (pass id) an entry in a list section.
Fields by section:
- experience: company, title, location, start, end, description (optional one-line scope), bullets[]
- education: school, degree, field, location, start, end, details, bullets[]
- projects: name, role, link, start, end, description, bullets[]
- certifications: name, issuer, date, link
- awards: name, issuer, date, description
- volunteer: organization, role, location, start, end, description, bullets[]
- publications: title, publisher, date, link, description
Passing fields.bullets replaces all bullets; use append_bullets to add to the end.`,
    input_schema: {
      type: 'object',
      properties: {
        section: sectionEnum,
        id: { type: 'string', description: 'Existing entry id; omit to create a new entry.' },
        fields: { type: 'object', description: 'Field values to set (see description).' },
        append_bullets: { type: 'array', items: { type: 'string' } },
        position: { type: 'integer', description: 'For new entries: index to insert at (0 = top). Default: end.' },
      },
      required: ['section'],
    },
  },
  {
    name: 'remove_entry',
    description: 'Delete an entry by id.',
    input_schema: {
      type: 'object',
      properties: { section: sectionEnum, id: { type: 'string' } },
      required: ['section', 'id'],
    },
  },
  {
    name: 'move_entry',
    description: 'Move an entry to a new index within its section (0 = top).',
    input_schema: {
      type: 'object',
      properties: { section: sectionEnum, id: { type: 'string' }, position: { type: 'integer' } },
      required: ['section', 'id', 'position'],
    },
  },
  {
    name: 'set_skills',
    description: 'Set grouped skills. mode "replace" (default) overwrites all groups; "merge" adds items to matching categories.',
    input_schema: {
      type: 'object',
      properties: {
        groups: {
          type: 'array',
          items: {
            type: 'object',
            properties: { category: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } },
            required: ['items'],
          },
        },
        mode: { type: 'string', enum: ['replace', 'merge'] },
      },
      required: ['groups'],
    },
  },
  {
    name: 'set_section_order',
    description: 'Reorder resume sections. Pass section keys in the desired order; omitted ones keep default order after them.',
    input_schema: {
      type: 'object',
      properties: { order: { type: 'array', items: { type: 'string', enum: DEFAULT_ORDER } } },
      required: ['order'],
    },
  },
  {
    name: 'set_style',
    description: 'Change visual theme and/or accent color when the user asks for a different look.',
    input_schema: {
      type: 'object',
      properties: {
        theme: { type: 'string', enum: ['classic', 'modern', 'compact'] },
        accent: { type: 'string', description: 'Hex color like #1f3a5f, or empty string for theme default.' },
      },
    },
  },
  {
    name: 'offer_options',
    description: 'Show the user 2-4 alternative wordings as clickable cards (for a headline, summary, bullet, etc). Do not apply them; wait for the choice.',
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'What the options are for, e.g. "Summary" or "Headline" or "SWIFT bullet #2".' },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '2-4 word angle, e.g. "Leadership-first"' },
              text: { type: 'string' },
            },
            required: ['label', 'text'],
          },
        },
      },
      required: ['target', 'options'],
    },
  },
];
