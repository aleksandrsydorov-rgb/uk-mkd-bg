/** Spreadsheet-safe CSV cell. Values that Excel would treat as formulas stay text. */
export function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/^[=+\-@\t\n]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
