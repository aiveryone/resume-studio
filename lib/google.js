import { OAuth2Client } from 'google-auth-library';

// drive.file only grants access to files this app creates - the narrowest
// scope that still lets us create a Google Doc in the user's Drive.
const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

export function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function client() {
  const port = process.env.PORT || 3000;
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `http://localhost:${port}/auth/google/callback`,
  );
}

export function authUrl(state) {
  return client().generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES, state });
}

export async function exchangeCode(code) {
  const { tokens } = await client().getToken(code);
  return tokens;
}

/**
 * Uploads a .docx and asks Drive to convert it to a native Google Doc
 * (target mimeType application/vnd.google-apps.document).
 * Returns { file: {id, name, webViewLink}, tokens } - tokens is non-null if refreshed.
 */
export async function uploadAsGoogleDoc(tokens, docxBuffer, name) {
  const c = client();
  c.setCredentials(tokens);
  let refreshed = null;
  c.on('tokens', (t) => { refreshed = { ...tokens, ...t }; });
  const { token } = await c.getAccessToken();

  const boundary = `resume${Date.now()}`;
  const metadata = JSON.stringify({ name, mimeType: 'application/vnd.google-apps.document' });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
    ),
    docxBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const r = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );
  if (!r.ok) {
    const err = new Error(`Google Drive upload failed (${r.status}): ${await r.text()}`);
    err.status = r.status;
    throw err;
  }
  return { file: await r.json(), tokens: refreshed };
}
