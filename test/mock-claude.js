// A tiny stand-in for the Claude Messages API (streaming) so the full
// chat -> tools -> live preview loop can be tested without an API key.
// Run: node test/mock-claude.js  then start the app with
//   ANTHROPIC_API_KEY=test ANTHROPIC_BASE_URL=http://localhost:4010 npm start
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT) || 4010;
const sse = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function stream(res, blocks, stopReason) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  sse(res, 'message_start', { message: { id: 'msg_mock', type: 'message', role: 'assistant', model: 'mock', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  for (const [index, b] of blocks.entries()) {
    if (b.type === 'text') {
      sse(res, 'content_block_start', { index, content_block: { type: 'text', text: '' } });
      for (const word of b.text.split(/(?<= )/)) { sse(res, 'content_block_delta', { index, delta: { type: 'text_delta', text: word } }); await wait(15); }
    } else {
      sse(res, 'content_block_start', { index, content_block: { type: 'tool_use', id: `toolu_${index}_${Date.now()}`, name: b.name, input: {} } });
      sse(res, 'content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
      await wait(250);
    }
    sse(res, 'content_block_stop', { index });
  }
  sse(res, 'message_delta', { delta: { stop_reason: stopReason }, usage: { output_tokens: 10 } });
  sse(res, 'message_stop', {});
  res.end();
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    const { messages } = JSON.parse(body || '{}');
    const last = messages.at(-1);
    const isToolResult = Array.isArray(last.content) && last.content.some((c) => c.type === 'tool_result');
    if (!isToolResult) {
      await stream(res, [
        { type: 'text', text: "Great start — I've added your header and your current role. " },
        { type: 'tool_use', name: 'update_basics', input: { name: 'Jordan Ellis', location: 'McLean, VA', email: 'jordan@example.com' } },
        { type: 'tool_use', name: 'upsert_entry', input: { section: 'experience', position: 0, fields: { company: 'National Mortgage Corp.', title: 'Senior Software Engineer & AI Champion', start: 'Mar 2024', end: 'Present', bullets: ['Lead AI coding-assistant rollout across 30+ engineering teams.'] } } },
        { type: 'tool_use', name: 'offer_options', input: { target: 'Headline', options: [{ label: 'Leadership-first', text: 'Director of Engineering | Financial Infrastructure | AI Enablement' }, { label: 'AI-first', text: 'AI Engineering Leader | Developer Productivity | Payments Platforms' }] } },
      ], 'tool_use');
    } else {
      await stream(res, [{ type: 'text', text: 'Pick a headline above. How many people did you manage at your largest scope?' }], 'end_turn');
    }
  });
}).listen(PORT, () => console.log(`mock Claude on :${PORT}`));
