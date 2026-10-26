import {
  SECTION_TITLES, INLINE_SECTIONS, THEMES, entryView, contactParts,
  hasContent, completeness, emptyResume,
} from '/shared/view.js';

const STORE_KEY = 'resume-studio.v1';
const $ = (id) => document.getElementById(id);
const els = {
  messages: $('messages'), chips: $('chips'), form: $('composer'), input: $('input'),
  send: $('send'), stop: $('stop'), page: $('page'), theme: $('theme'), accent: $('accent'),
  undo: $('undo'), reset: $('reset'), docx: $('dl-docx'), gdoc: $('gdoc'),
  meterFill: $('meter-fill'), meterLabel: $('meter-label'), toast: $('toast'), divider: $('divider'),
};

const WELCOME = {
  role: 'assistant', local: true,
  content: "Hi! I'll build your resume with you as we talk — everything you tell me lands in the preview on the right as soon as I understand it.\n\nThe fastest start is to **paste your current resume or LinkedIn profile**. Or just tell me your name and the role you're aiming for, and I'll interview you from there.",
};
const STARTERS = [
  { label: 'Paste my current resume', text: "Here's my current resume — please parse it and improve it:\n\n" },
  { label: 'Interview me from scratch', text: "Let's start from scratch. Interview me one step at a time." },
  { label: 'Tailor to a job description', text: "Here's a job description I'm targeting. Tailor my resume to it and tell me what's missing:\n\n" },
];

let state = load();
let config = { ai: false, googleConfigured: false, googleConnected: false };
let controller = null;
let lastSections = {};

/* ---------- persistence ---------- */
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s?.resume) return { undo: [], ...s };
  } catch { /* ignore */ }
  return { resume: emptyResume(), messages: [WELCOME], undo: [] };
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...state, undo: state.undo.slice(-30) })); } catch { /* ignore */ }
}

/* ---------- helpers ---------- */
const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function md(text = '') {
  // Tiny, safe markdown: paragraphs, bullet lists, **bold**, *italic*.
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<i>$2</i>');
  return text.split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${lines.map(inline).join('<br>')}</p>`;
  }).join('');
}

function toast(html, ms = 3500) {
  els.toast.innerHTML = html;
  els.toast.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => els.toast.classList.remove('show'), ms);
}

/* ---------- chat rendering ---------- */
const OP_LABELS = {
  update_basics: 'contact info', set_summary: 'summary', upsert_entry: null, remove_entry: 'removed an entry',
  move_entry: 'reordered', set_skills: 'skills', set_section_order: 'section order', set_style: 'style',
};

function renderMessages() {
  els.messages.innerHTML = '';
  state.messages.forEach((m, i) => els.messages.appendChild(messageEl(m, i)));
  els.chips.innerHTML = '';
  const onlyWelcome = state.messages.every((m) => m.local);
  if (onlyWelcome) {
    for (const s of STARTERS) {
      const b = document.createElement('button');
      b.className = 'chip'; b.type = 'button'; b.textContent = s.label;
      b.onclick = () => { els.input.value = s.text; els.input.focus(); els.input.setSelectionRange(s.text.length, s.text.length); };
      els.chips.appendChild(b);
    }
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function messageEl(m, index) {
  const div = document.createElement('div');
  div.className = `msg ${m.role}${m.error ? ' error' : ''}`;
  div.dataset.index = index;
  fillMessage(div, m);
  return div;
}

function fillMessage(div, m) {
  if (m.role === 'user') { div.textContent = m.content; return; }
  div.innerHTML = md(m.content || '');
  if (m.pending && !m.content) div.innerHTML = '<p class="typing">Thinking</p>';
  else if (m.pending) div.lastElementChild?.classList.add('typing');
  if (m.activity?.length) {
    const a = document.createElement('div');
    a.className = 'activity';
    a.textContent = `✎ Updated: ${[...new Set(m.activity)].join(', ')}`;
    div.appendChild(a);
  }
  for (const opt of m.options || []) {
    const wrap = document.createElement('div');
    wrap.className = 'options';
    wrap.innerHTML = `<div class="target">Options — ${esc(opt.target)}</div>`;
    opt.options.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `option${opt.chosen === i ? ' chosen' : ''}`;
      b.innerHTML = `<b>${esc(o.label)}</b>${esc(o.text)}`;
      b.disabled = opt.chosen != null || !!controller;
      b.onclick = () => {
        opt.chosen = i;
        send(`Use option "${o.label}" for the ${opt.target}:\n${o.text}`);
      };
      wrap.appendChild(b);
    });
    div.appendChild(wrap);
  }
}

function updateMessage(m) {
  const index = state.messages.indexOf(m);
  const div = els.messages.querySelector(`[data-index="${index}"]`);
  if (div) fillMessage(div, m);
  const nearBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 140;
  if (nearBottom) els.messages.scrollTop = els.messages.scrollHeight;
}

/* ---------- preview rendering ---------- */
function sectionHTML(r, key) {
  if (key === 'summary') return `<p class="r-summary">${esc(r.summary)}</p>`;
  if (key === 'skills') {
    return r.skills.filter((g) => g.items?.length).map((g) =>
      `<p class="r-skill">${g.category ? `<b>${esc(g.category)}:</b> ` : ''}${esc(g.items.join(', '))}</p>`).join('');
  }
  const inline = INLINE_SECTIONS.has(key);
  return r[key].map((e) => {
    const v = entryView(key, e);
    const linkHtml = v.link ? ` <a href="${esc(/^https?:/i.test(v.link) ? v.link : `https://${v.link}`)}" target="_blank" rel="noopener">link</a>` : '';
    if (inline) {
      return `<div class="r-entry"><div class="r-row"><span><span class="r-title">${esc(v.title || '')}</span>${v.subtitle ? ` — ${esc(v.subtitle)}` : ''}${linkHtml}</span><span class="r-meta">${esc(v.dates || '')}</span></div>${v.description ? `<div class="r-desc">${esc(v.description)}</div>` : ''}</div>`;
    }
    return `<div class="r-entry">
      <div class="r-row"><span class="r-title">${esc(v.title || '') || '<span class="placeholder">Title</span>'}${linkHtml}</span><span class="r-meta">${esc(v.dates || '')}</span></div>
      ${v.subtitle || v.location ? `<div class="r-row"><span class="r-sub">${esc(v.subtitle || '')}</span><span class="r-meta r-loc">${esc(v.location || '')}</span></div>` : ''}
      ${v.description ? `<div class="r-desc">${esc(v.description)}</div>` : ''}
      ${v.bullets.length ? `<ul>${v.bullets.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
}

function renderPreview({ flash = true } = {}) {
  const r = state.resume;
  const theme = THEMES[r.meta?.theme] || THEMES.classic;
  const accent = r.meta?.accent || theme.accent;
  const page = els.page;
  page.style.setProperty('--accent', accent);
  page.style.setProperty('--font', theme.css);
  page.style.setProperty('--base', `${theme.size}pt`);
  page.style.setProperty('--name', `${theme.nameSize}pt`);
  page.style.setProperty('--align', theme.align);

  const b = r.basics || {};
  const contacts = contactParts(b);
  const head = `<header class="r-head" data-key="basics">
    <div class="r-name">${b.name ? esc(b.name) : '<span class="placeholder">Your Name</span>'}</div>
    ${b.headline ? `<div class="r-headline">${esc(b.headline)}</div>` : ''}
    ${contacts.length ? `<div class="r-contact">${contacts.map((c) => (c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.text)}</a>` : esc(c.text))).join('<span class="dot">|</span>')}</div>`
      : '<div class="r-contact placeholder">City, ST | phone | email | LinkedIn</div>'}
  </header>`;

  const sections = r.sectionOrder.filter((k) => hasContent(r, k)).map((k) =>
    `<section data-key="${k}" class="${INLINE_SECTIONS.has(k) ? 'inline' : ''}"><h2>${SECTION_TITLES[k]}</h2>${sectionHTML(r, k)}</section>`).join('');

  page.innerHTML = head + (sections || `<div class="empty-hint">Your sections will appear here as you chat.<br>Experience, skills, education, certifications…</div>`);

  // Flash whatever changed since the last render.
  const snapshot = { basics: JSON.stringify(b) };
  for (const k of r.sectionOrder) snapshot[k] = JSON.stringify(k === 'summary' ? r.summary : r[k]);
  if (flash) {
    for (const [k, v] of Object.entries(snapshot)) {
      if (lastSections[k] !== undefined && lastSections[k] !== v) {
        const el = page.querySelector(`[data-key="${k}"]`);
        if (el) {
          el.classList.add('flash');
          requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('flash')));
          if (controller) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    }
  }
  lastSections = snapshot;

  const pct = completeness(r);
  els.meterFill.style.width = `${pct}%`;
  els.meterLabel.textContent = `${pct}%`;
  els.theme.value = r.meta?.theme || 'classic';
  els.accent.value = accent;
  els.undo.disabled = !state.undo.length || !!controller;
}

/* ---------- chat ---------- */
function apiMessages() {
  return state.messages.filter((m) => !m.local && !m.pending).map((m) => {
    let content = m.content || '';
    for (const o of m.options || []) {
      content += `\n\n[Offered options for ${o.target}: ${o.options.map((x, i) => `${i + 1}) ${x.label}: ${x.text}`).join(' / ')}]`;
    }
    return { role: m.role, content };
  });
}

function setBusy(busy) {
  els.send.disabled = busy;
  els.stop.classList.toggle('hidden', !busy);
  els.undo.disabled = busy || !state.undo.length;
}

async function send(text) {
  text = text.trim();
  if (!text || controller) return;
  if (!config.ai) { toast('Chat is disabled: the server has no ANTHROPIC_API_KEY. See README.'); return; }

  state.undo.push(structuredClone(state.resume));
  state.messages.push({ role: 'user', content: text });
  const reply = { role: 'assistant', content: '', pending: true, activity: [], options: [] };
  state.messages.push(reply);
  els.input.value = '';
  controller = new AbortController();
  setBusy(true);
  renderMessages();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages(), resume: state.resume }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Server error ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let event = 'message'; let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) handleEvent(event, JSON.parse(data), reply);
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      reply.content += `${reply.content ? '\n\n' : ''}⚠ ${err.message}`;
      reply.error = true;
    } else if (!reply.content) {
      reply.content = '(stopped)';
    }
  } finally {
    reply.pending = false;
    if (!reply.content && !reply.options.length) reply.content = reply.activity.length ? 'Done — see the preview.' : '(no reply)';
    // If nothing changed this turn, drop the undo snapshot.
    if (JSON.stringify(state.undo.at(-1)) === JSON.stringify(state.resume)) state.undo.pop();
    controller = null;
    setBusy(false);
    renderMessages();
    renderPreview({ flash: false });
    save();
  }
}

function handleEvent(event, data, reply) {
  switch (event) {
    case 'text':
      reply.content += data.delta;
      updateMessage(reply);
      break;
    case 'resume': {
      state.resume = data.resume;
      const label = OP_LABELS[data.op] ?? (data.section || data.op);
      if (label) reply.activity.push(label);
      renderPreview();
      updateMessage(reply);
      save();
      break;
    }
    case 'options':
      reply.options.push(data);
      updateMessage(reply);
      break;
    case 'error':
      reply.content += `${reply.content ? '\n\n' : ''}⚠ ${data.message}`;
      reply.error = true;
      updateMessage(reply);
      break;
    case 'done':
      if (data.resume) state.resume = data.resume;
      break;
    default:
  }
}

/* ---------- export ---------- */
async function downloadDocx() {
  els.docx.disabled = true;
  try {
    const res = await fetch('/api/export/docx', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: state.resume }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    const blob = await res.blob();
    const name = /filename="(.+?)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'Resume.docx';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Downloaded <b>${esc(name)}</b> — opens in Word, or in Google Docs via File › Open › Upload.`);
  } catch (err) {
    toast(`Export failed: ${esc(err.message)}`);
  } finally {
    els.docx.disabled = false;
  }
}

async function saveToGoogle() {
  if (!config.googleConfigured) {
    toast('Google export isn\'t configured on this server (see README). Use ⬇ .docx and open it in Google Docs.', 6000);
    return;
  }
  els.gdoc.disabled = true;
  const label = els.gdoc.textContent;
  els.gdoc.textContent = 'Saving…';
  try {
    const res = await fetch('/api/export/gdoc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resume: state.resume }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && data.needsAuth) {
      sessionStorage.setItem('pending-gdoc', '1');
      window.location.href = '/auth/google';
      return;
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    window.open(data.url, '_blank', 'noopener');
    toast(`Saved to Google Docs — <a href="${esc(data.url)}" target="_blank" rel="noopener">open it</a>`, 8000);
  } catch (err) {
    toast(`Google Docs export failed: ${esc(err.message)}`, 6000);
  } finally {
    els.gdoc.disabled = false;
    els.gdoc.textContent = label;
  }
}

/* ---------- wiring ---------- */
function initControls() {
  for (const [key, t] of Object.entries(THEMES)) els.theme.add(new Option(t.label, key));

  els.form.addEventListener('submit', (e) => { e.preventDefault(); send(els.input.value); });
  els.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(els.input.value); }
  });
  els.stop.onclick = () => controller?.abort();

  const pushUndo = () => { state.undo.push(structuredClone(state.resume)); };
  els.theme.onchange = () => { pushUndo(); state.resume.meta.theme = els.theme.value; state.resume.meta.accent = ''; renderPreview(); save(); };
  els.accent.oninput = () => { state.resume.meta.accent = els.accent.value; renderPreview({ flash: false }); };
  els.accent.onchange = () => save();

  const undo = () => {
    if (controller || !state.undo.length) return;
    state.resume = state.undo.pop();
    renderPreview(); save();
    toast('Undid last change.');
  };
  els.undo.onclick = undo;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && document.activeElement !== els.input) { e.preventDefault(); undo(); }
  });

  els.reset.onclick = () => {
    if (!confirm('Start a new resume? This clears the chat and the current resume.')) return;
    controller?.abort();
    state = { resume: emptyResume(), messages: [WELCOME], undo: [] };
    lastSections = {};
    save(); renderMessages(); renderPreview({ flash: false });
  };

  els.docx.onclick = downloadDocx;
  els.gdoc.onclick = saveToGoogle;

  // Draggable divider between panes
  let dragging = false;
  els.divider.addEventListener('pointerdown', (e) => { dragging = true; els.divider.setPointerCapture(e.pointerId); });
  els.divider.addEventListener('pointerup', () => { dragging = false; });
  els.divider.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const pct = Math.min(70, Math.max(25, (e.clientX / window.innerWidth) * 100));
    document.documentElement.style.setProperty('--chat-w', `${pct}%`);
  });
}

async function init() {
  initControls();
  renderMessages();
  renderPreview({ flash: false });
  try { config = await (await fetch('/api/config')).json(); } catch { /* offline */ }
  if (!config.ai) toast('Server has no ANTHROPIC_API_KEY — chat is disabled until it\'s set.', 6000);
  if (config.googleConnected) els.gdoc.title = 'Connected to Google Drive';

  const params = new URLSearchParams(location.search);
  const g = params.get('google');
  if (g) {
    history.replaceState(null, '', '/');
    if (g === 'connected') {
      toast('Google connected.');
      if (sessionStorage.getItem('pending-gdoc')) { sessionStorage.removeItem('pending-gdoc'); saveToGoogle(); }
    } else {
      toast(`Google sign-in failed: ${esc(params.get('reason') || 'unknown error')}`, 6000);
    }
  }
}

init();
