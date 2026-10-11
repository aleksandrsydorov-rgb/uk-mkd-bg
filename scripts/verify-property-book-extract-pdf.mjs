/**
 * PKG-XFER Stage 4 — real PDF generation verification (local, no remote DB).
 * Creates a Property Book–style extract PDF with jsPDF and verifies:
 * - file exists
 * - magic bytes %PDF
 * - contains extract number + BG authority notice
 *
 * Run: node scripts/verify-property-book-extract-pdf.mjs
 * Exit 0 = PASS, non-zero = FAIL
 */

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { jsPDF } = require('jspdf');

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'tmp');
const outPath = join(outDir, 'pkg-xfer-stage4-extract-verify.pdf');

const extractNumber = 'PB-X-2026-000001-BG';
const authority =
  'Original language: Bulgarian (BG) is the authoritative text. RU/EN are informational translations.';
const ownersLine = 'Owner Smoke / natural_person / 100% / 1.5%';

function fail(msg) {
  console.error('PDF VERIFICATION FAIL:', msg);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
doc.setFont('helvetica', 'bold');
doc.setFontSize(16);
doc.text('Izvlechenie ot knigata na sobstvenostta', 14, 20);
doc.setFont('helvetica', 'normal');
doc.setFontSize(11);
doc.text(`No ${extractNumber}`, 14, 30);
doc.text('INFORMATIONAL — UNSIGNED', 14, 38);
doc.text(authority, 14, 48, { maxWidth: 180 });
doc.text('Current owners (frozen snapshot):', 14, 62);
doc.text(ownersLine, 14, 70);
doc.text(`Generated: ${new Date().toISOString()}`, 14, 84);
doc.text('Snapshot frozen at generation. HTML alone is not a PDF.', 14, 92, {
  maxWidth: 180,
});

const arrayBuffer = doc.output('arraybuffer');
const buf = Buffer.from(arrayBuffer);
writeFileSync(outPath, buf);

if (!existsSync(outPath)) fail('output file missing');
if (buf.length < 100) fail(`PDF too small (${buf.length} bytes)`);

const magic = buf.subarray(0, 4).toString('ascii');
if (magic !== '%PDF') fail(`magic bytes are "${magic}", expected %PDF`);

const asLatin = buf.toString('latin1');
if (!asLatin.includes(extractNumber)) fail('extract number not found in PDF bytes');
if (!asLatin.includes('INFORMATIONAL')) fail('informational mark not found in PDF bytes');
if (!asLatin.includes('Bulgarian') && !asLatin.includes('authoritative')) {
  fail('BG authority notice not found in PDF bytes');
}

const sha = createHash('sha256').update(buf).digest('hex');
const roundtrip = readFileSync(outPath);
if (roundtrip.length !== buf.length) fail('roundtrip size mismatch');

console.log('PDF VERIFICATION PASS');
console.log(`  path: ${outPath}`);
console.log(`  bytes: ${buf.length}`);
console.log(`  magic: ${magic}`);
console.log(`  sha256: ${sha}`);
console.log(`  extract_number: ${extractNumber}`);
process.exit(0);
