import fs from 'fs';
import path from 'path';

const src =
  process.argv[2] ||
  'C:/Users/aleks/.cursor/browser-logs/cdp-response-Runtime.evaluate-2026-11-05T08-39-42-775Z.json';
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
const payload = raw.result?.value ?? raw.result ?? raw;
const pages = typeof payload === 'string' ? JSON.parse(payload) : payload;
const outDir = 'tmp/receipts/layout-v2/pages';
fs.mkdirSync(outDir, { recursive: true });
for (const p of pages) {
  const base = String(p.file).replace(/\.pdf$/i, '');
  const name = `${base}-p${p.page}.png`;
  const b64 = String(p.data).replace(/^data:image\/png;base64,/, '');
  const buf = Buffer.from(b64, 'base64');
  fs.writeFileSync(path.join(outDir, name), buf);
  console.log('wrote', name, buf.length);
}
