/**
 * SheetJS community build does not serialize worksheet dataValidations.
 * Patch the written .xlsx (ZIP) to inject an Excel list dropdown.
 */
import { deflateRawSync, inflateRawSync } from 'node:zlib';

type ZipEntry = {
  name: string;
  compression: number;
  bytes: Uint8Array;
  crc: number;
};

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

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
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
    const name = Buffer.from(buf.subarray(nameStart, nameStart + nameLen)).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + compSize);
    let bytes: Uint8Array;
    if (compression === 0) bytes = compressed.slice();
    else if (compression === 8) bytes = inflateRawSync(compressed);
    else throw new Error(`xlsxListValidation: unsupported compression ${compression} for ${name}`);
    entries.push({ name, compression: 8, bytes, crc: crc32(bytes) });
    i = dataStart + compSize;
  }
  return entries;
}

function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.bytes);
    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(entry.crc),
      u32(compressed.length),
      u32(entry.bytes.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      compressed,
    ]);
    const central = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(0),
      u16(0),
      u32(entry.crc),
      u32(compressed.length),
      u32(entry.bytes.length),
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
 * Inject a list data-validation dropdown into the first worksheet matching
 * `sheetFile` (e.g. `xl/worksheets/sheet1.xml`).
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
  const input = Buffer.isBuffer(xlsxBuf)
    ? new Uint8Array(xlsxBuf)
    : xlsxBuf instanceof ArrayBuffer
      ? new Uint8Array(xlsxBuf)
      : xlsxBuf;
  const entries = readZip(input);
  const sheetFile =
    opts.sheetFile ??
    entries.map((e) => e.name).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n));
  if (!sheetFile) throw new Error('xlsxListValidation: worksheet not found');
  const entry = entries.find((e) => e.name === sheetFile);
  if (!entry) throw new Error(`xlsxListValidation: missing ${sheetFile}`);

  let xml = Buffer.from(entry.bytes).toString('utf8');
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
