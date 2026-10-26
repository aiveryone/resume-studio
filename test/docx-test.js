import fs from 'node:fs';
import { buildDocx } from '../lib/docx.js';
import { sampleResume } from './sample.js';
const out = process.argv[2];
for (const theme of ['classic','modern']) {
  const r = sampleResume(); r.meta.theme = theme;
  fs.writeFileSync(`${out}/sample-${theme}.docx`, await buildDocx(r));
}
console.log('ok');
