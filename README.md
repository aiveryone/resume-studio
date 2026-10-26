# Resume Studio

A single-page Node.js resume builder. You chat with Claude on the left; a live,
paper-accurate preview on the right updates the moment Claude understands each
piece of information and files it into the right section. Export to Word
(.docx) or straight into Google Docs.

## Quick start

```bash
npm install
cp .env.example .env      # add your ANTHROPIC_API_KEY
npm start                 # http://localhost:3000
```

Node 20+ required.

## How it works

```
Browser (public/)                      Server (server.js)                  Claude API
─────────────────                      ──────────────────                  ──────────
chat message + current resume JSON ──▶ POST /api/chat (SSE stream) ──────▶ messages.stream
                                       │ text deltas      ──▶ event: text      (tools: update_basics,
                                       │ each finished tool_use block           set_summary, upsert_entry,
                                       │   → applyOp() on resume                remove/move_entry, set_skills,
live preview re-renders + flashes ◀─── │   → event: resume                      set_section_order, set_style,
option cards in chat            ◀───── │   → event: options                     offer_options)
                                       └ loops tool_result → Claude until end_turn
```

- **Incremental + live:** tool calls are applied as each one finishes streaming
  (`contentBlock` event), so the preview grows mid-reply instead of at the end.
- **Structured resume model** (`shared/view.js`, `lib/resume.js`): basics,
  summary, grouped skills, and list sections (experience, education, projects,
  certifications, awards, volunteer, publications) with stable ids for edits.
- **Same layout logic for preview and export:** `shared/view.js` is imported by
  both the browser and the .docx builder.
- **Options, not just one answer:** for headlines, summaries and key bullets
  Claude offers 2–4 variants as clickable cards; clicking one applies it.
- **Guardrails in the prompt** (`lib/prompt.js`): no invented facts or metrics,
  asks for numbers instead, ATS-friendly wording, handles pasted resumes and job
  descriptions (tailoring + gap list), dignified handling of career breaks.
- **State** lives in the browser (localStorage): chat, resume, undo stack.
  The server is stateless apart from the Google OAuth session.

## Features

| | |
|---|---|
| Live preview | Letter-size page, approximate page-break guides, changed sections flash |
| Themes | Classic (serif, centered), Modern, Compact + custom accent color |
| Undo | Per-turn snapshots (button or Ctrl/⌘+Z) |
| Export .docx | Native Word file, real bullets, right-aligned dates via tab stops |
| Google Docs | Uploads the .docx to Drive with conversion to a native Google Doc |
| Resizable panes | Drag the divider; stacks vertically on narrow screens |

### About "Google Docs format" downloads
Google Docs has no downloadable file format of its own (a `.gdoc` is only a
shortcut). The two real paths are both supported: **⬇ .docx** (opens in Word,
and in Google Docs via File › Open › Upload), or **Save to Google Docs**, which
creates a native Google Doc in your Drive.

## Enabling "Save to Google Docs"

1. Google Cloud Console → create/select a project → **APIs & Services › Library**
   → enable **Google Drive API**.
2. **OAuth consent screen** → External → add yourself as a test user.
   Scope: `.../auth/drive.file` (app can only see files it creates).
3. **Credentials › Create credentials › OAuth client ID** → *Web application*.
   Authorized redirect URI: `http://localhost:3000/auth/google/callback`
   (or your deployed URL + `/auth/google/callback`).
4. Put the client ID/secret in `.env` and restart.

The first click on **Save to Google Docs** sends you through Google sign-in and
then completes the export automatically.

## Testing without an API key

`test/mock-claude.js` is a fake streaming Claude endpoint that exercises the
whole loop (text, tool calls, option cards):

```bash
node test/mock-claude.js &
ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4010 npm start
```

`node test/docx-test.js <dir>` writes sample .docx files in two themes.

## Project layout

```
server.js            Express app: SSE chat loop, exports, Google OAuth
lib/prompt.js        System prompt + tool schemas
lib/resume.js        Applies tool calls to the resume JSON (validation, ids)
lib/docx.js          .docx builder (docx library)
lib/google.js        OAuth + Drive multipart upload with Doc conversion
shared/view.js       Themes, section titles, entry → display mapping (browser + server)
public/              index.html, app.js, styles.css (no build step)
```

## Suggested next steps

- **PDF export:** render `shared/view.js` HTML with Playwright `page.pdf()`, or
  convert the .docx with LibreOffice headless.
- **Upload an existing resume** (.docx/.pdf) and feed the extracted text to chat.
- **Click-to-edit** directly in the preview, writing back through `applyOp`.
- **Multiple versions** per target role (save/load named variants).
- **Server-side persistence** + user accounts if you deploy it for others.
- **Production hardening:** a persistent session store (express-session's
  default MemoryStore is dev-only), rate limiting on `/api/chat`, HTTPS.
