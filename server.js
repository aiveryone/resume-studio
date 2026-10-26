import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt, TOOLS } from './lib/prompt.js';
import { applyOp, normalizeResume } from './lib/resume.js';
import { buildDocx, fileBaseName } from './lib/docx.js';
import * as google from './lib/google.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const MAX_TOOL_ROUNDS = 8;

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-only-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { sameSite: 'lax', httpOnly: true },
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/shared', express.static(path.join(__dirname, 'shared')));

app.get('/api/config', (req, res) => {
  res.json({
    ai: !!anthropic,
    model: MODEL,
    googleConfigured: google.isConfigured(),
    googleConnected: !!req.session.googleTokens,
  });
});

// Chat history from the browser is plain text; it must start with a user
// turn and alternate roles.
function toApiMessages(messages = []) {
  const out = [];
  for (const m of messages) {
    if (!['user', 'assistant'].includes(m?.role)) continue;
    const content = String(m.content || '').trim() || '(no reply)';
    if (!out.length && m.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  const recent = out.slice(-40);
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return recent;
}

app.post('/api/chat', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!anthropic) {
    send('error', { message: 'ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart.' });
    return res.end();
  }

  let resume = normalizeResume(req.body?.resume);
  const convo = toApiMessages(req.body?.messages);
  if (!convo.length || convo[convo.length - 1].role !== 'user') {
    send('error', { message: 'Nothing to respond to.' });
    return res.end();
  }

  let closed = false;
  let current = null;
  res.on('close', () => { closed = true; current?.abort(); });

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const staticSystem = { type: 'text', text: systemPrompt(today), cache_control: { type: 'ephemeral' } };

  try {
    let wroteText = false;
    for (let round = 0; round < MAX_TOOL_ROUNDS && !closed; round++) {
      const toolResults = [];
      let newParagraph = wroteText;

      current = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 8000,
        system: [staticSystem, { type: 'text', text: `CURRENT RESUME JSON:\n${JSON.stringify(resume)}` }],
        tools: TOOLS,
        messages: convo,
      });

      current.on('text', (delta) => {
        if (newParagraph) { send('text', { delta: '\n\n' }); newParagraph = false; }
        wroteText = true;
        send('text', { delta });
      });

      // Fires as each tool_use block finishes streaming, so the preview
      // updates mid-response instead of waiting for the whole turn.
      current.on('contentBlock', (block) => {
        if (block.type !== 'tool_use') return;
        try {
          const result = applyOp(resume, block.name, block.input || {});
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
          if (block.name === 'offer_options') send('options', block.input);
          else send('resume', { resume, op: block.name, section: block.input?.section });
        } catch (err) {
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: err.message, is_error: true });
        }
      });

      const final = await current.finalMessage();
      if (final.stop_reason !== 'tool_use') break;

      convo.push({ role: 'assistant', content: final.content });
      convo.push({
        role: 'user',
        content: [
          ...toolResults,
          { type: 'text', text: `Updated resume JSON:\n${JSON.stringify(resume)}` },
        ],
      });
      // If the only tool was offer_options, the model should stop and wait.
      if (final.content.filter((b) => b.type === 'tool_use').every((b) => b.name === 'offer_options')) break;
    }
    send('done', { resume });
  } catch (err) {
    if (!closed) send('error', { message: err?.error?.error?.message || err.message || 'Claude request failed' });
  } finally {
    res.end();
  }
});

app.post('/api/export/docx', async (req, res) => {
  try {
    const resume = normalizeResume(req.body?.resume);
    const buf = await buildDocx(resume);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBaseName(resume)}.docx"`);
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/export/gdoc', async (req, res) => {
  if (!google.isConfigured()) return res.status(501).json({ error: 'Google export is not configured on the server.' });
  if (!req.session.googleTokens) return res.status(401).json({ needsAuth: true });
  try {
    const resume = normalizeResume(req.body?.resume);
    const buf = await buildDocx(resume);
    const { file, tokens } = await google.uploadAsGoogleDoc(req.session.googleTokens, buf, fileBaseName(resume));
    if (tokens) req.session.googleTokens = tokens;
    res.json({ id: file.id, url: file.webViewLink || `https://docs.google.com/document/d/${file.id}/edit` });
  } catch (err) {
    console.error(err);
    if (err.status === 401 || /invalid_grant/i.test(err.message)) {
      delete req.session.googleTokens;
      return res.status(401).json({ needsAuth: true });
    }
    res.status(500).json({ error: err.message });
  }
});

app.get('/auth/google', (req, res) => {
  if (!google.isConfigured()) return res.status(501).send('Google OAuth is not configured. See README.');
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(google.authUrl(state));
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect(`/?google=error&reason=${encodeURIComponent(error)}`);
  if (!code || state !== req.session.oauthState) return res.redirect('/?google=error&reason=state');
  try {
    req.session.googleTokens = await google.exchangeCode(code);
    delete req.session.oauthState;
    res.redirect('/?google=connected');
  } catch (err) {
    console.error(err);
    res.redirect(`/?google=error&reason=${encodeURIComponent(err.message)}`);
  }
});

app.post('/auth/google/disconnect', (req, res) => {
  delete req.session.googleTokens;
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Resume Builder running at http://localhost:${PORT}`);
  if (!anthropic) console.warn('  ! ANTHROPIC_API_KEY not set - chat is disabled until you add it to .env');
  if (!google.isConfigured()) console.warn('  ! Google OAuth not configured - "Save to Google Docs" is disabled (download .docx still works)');
});
