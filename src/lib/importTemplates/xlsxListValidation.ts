/**
 * SheetJS community build does not serialize worksheet dataValidations.
 * Patch the written .xlsx (ZIP) to inject an Excel list dropdown.
 *
 * Runs in the browser (wizard download) and in Node. Turbopack's zlib polyfill
 * accepts only Buffer/string — never pass a bare Uint8Array to inflate/deflate.
 * Written entries use store (method 0) so the write path does not depend on deflate.
 */
import { inflateRawSync } from 'node:zlib';

type ZipEntry = {
  name: string;
  bytes: Buffer;
  crc: number;
};

function asBuffer(data: ArrayBuffer | Uint8Array | Buffer): Buffer {
  if (Buffer.isBuffer(data)) return data;
  // Copy into a real Buffer — Uint8Array views / polyfill Buffers are rejected by zlib.
  return Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
}

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function readZip(buf: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let i = 0;
  while (i + 30 <= buf.length) {
    if (buf[i] !== 0x50 || buf[i + 1] !== 0x4b || buf[i + 2] !== 0x03 || buf[i + 3] !== 0x04) {
      // Seek next local header; stop at central directory signature.
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) break;
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) break;
      i += 1;
      continue;
    }
    const compression = buf[i + 8]! | (buf[i + 9]! << 8);
    const compSize =
      buf[i + 18]! | (buf[i + 19]! << 8) | (buf[i + 20]! << 16) | (buf[i + 21]! << 24);
    const nameLen = buf[i + 26]! | (buf[i + 27]! << 8);
    const extraLen = buf[i + 28]! | (buf[i + 29]! << 8);
    const nameStart = i + 30;
    const name = asBuffer(buf.subarray(nameStart, nameStart + nameLen)).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = asBuffer(buf.subarray(dataStart, dataStart + compSize));
    let bytes: Buffer;
    if (compression === 0) {
      bytes = Buffer.from(compressed);
    } else if (compression === 8) {
      // Polyfill requires Buffer, not Uint8Array.
      bytes = asBuffer(inflateRawSync(compressed));
    } else {
      throw new Error(`xlsxListValidation: unsupported compression ${compression} for ${name}`);
    }
    entries.push({ name, bytes, crc: crc32(bytes) });
    i = dataStart + compSize;
  }
  return entries;
}

/** Write ZIP with store (method 0) — no deflate; Excel accepts this. */
function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const payload = asBuffer(entry.bytes);
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20), // version needed
      u16(0), // flags
      u16(0), // compression = store
      u16(0),
      u16(0),
      u32(entry.crc),
      u32(payload.length),
      u32(payload.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      payload,
    ]);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(0),
      u16(0), // store
      u16(0),
      u16(0),
      u32(entry.crc),
      u32(payload.length),
      u32(payload.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralDir, end]);
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Inject a list data-validation dropdown into the worksheet XML inside an .xlsx.
 * Throws if the ZIP/XML cannot be patched — callers must not download a file without the list.
 */
export function injectXlsxListValidation(
  xlsxBuf: ArrayBuffer | Uint8Array | Buffer,
  opts: {
    /** ZIP path; default first worksheet. */
    sheetFile?: string;
    /** Excel range like `E2:E500`. */
    sqref: string;
    /** Comma-separated list values, e.g. `0,1`. */
    list: string;
    allowBlank?: boolean;
  },
): ArrayBuffer {
  const input = asBuffer(xlsxBuf);
  const entries = readZip(input);
  const sheetFile =
    opts.sheetFile ??
    entries.map((e) => e.name).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n));
  if (!sheetFile) throw new Error('xlsxListValidation: worksheet not found');
  const entry = entries.find((e) => e.name === sheetFile);
  if (!entry) throw new Error(`xlsxListValidation: missing ${sheetFile}`);

  let xml = entry.bytes.toString('utf8');
  xml = xml.replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/gi, '');
  const formula = escapeXmlAttr(`"${opts.list}"`);
  const allowBlank = opts.allowBlank === false ? '0' : '1';
  // showDropDown="1" hides the arrow in OOXML (inverted); keep 0 for visible dropdown.
  const block =
    `<dataValidations count="1">` +
    `<dataValidation type="list" allowBlank="${allowBlank}" showDropDown="0" ` +
    `showErrorMessage="1" sqref="${escapeXmlAttr(opts.sqref)}">` +
    `<formula1>${formula}</formula1>` +
    `</dataValidation></dataValidations>`;
  if (!/<\/worksheet>/i.test(xml)) {
    throw new Error('xlsxListValidation: </worksheet> not found');
  }
  xml = xml.replace(/<\/worksheet>/i, `${block}</worksheet>`);
  entry.bytes = Buffer.from(xml, 'utf8');
  entry.crc = crc32(entry.bytes);

  const out = writeZip(entries);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
