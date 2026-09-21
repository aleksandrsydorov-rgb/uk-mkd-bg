export type OccupantKind = 'owner' | 'tenant' | 'user';
export type PetSpecies = 'dog' | 'cat' | 'other';

export interface ApartmentPet {
  id: number;
  created_at?: string;
  property_id: number;
  species: string;
  name: string | null;
  chip_no: string | null;
  passport_no: string | null;
  notes: string | null;
}

export function normalizeOccupantKind(raw: string | null | undefined): OccupantKind {
  if (raw === 'tenant' || raw === 'user') return raw;
  return 'owner';
}

export function householdPeople<T extends { first_name: string; last_name: string; is_permanent?: boolean | null }>(
  guests: T[],
) {
  return guests.filter((g) => g.is_permanent !== false);
}

export function householdNames<T extends { first_name: string; last_name: string; is_permanent?: boolean | null }>(
  guests: T[],
) {
  return householdPeople(guests)
    .map((g) => `${g.first_name} ${g.last_name}`.trim())
    .filter(Boolean)
    .join(', ');
}

export function dogsOf(pets: ApartmentPet[]) {
  return pets.filter((p) => p.species === 'dog');
}

export function dogChips(pets: ApartmentPet[]) {
  return dogsOf(pets)
    .map((p) => [p.name, p.chip_no, p.passport_no].filter(Boolean).join(' / '))
    .filter(Boolean)
    .join('; ');
}

export function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell ?? '');
          if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
          return value;
        })
        .join(';'),
    )
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildRegistryPdfHtml(opts: {
  title: string;
  generated: string;
  hint: string;
  headers: string[];
  rows: string[][];
}) {
  const head = opts.headers
    .map(
      (h) =>
        `<th style="text-align:left;padding:6px 7px;border-bottom:1px solid #ccc;font-size:10px;color:#444;">${escapeHtml(h)}</th>`,
    )
    .join('');
  const body = opts.rows
    .map(
      (row) =>
        `<tr>${row
          .map(
            (cell) =>
              `<td style="padding:6px 7px;border-bottom:1px solid #eee;font-size:10px;vertical-align:top;">${escapeHtml(cell)}</td>`,
          )
          .join('')}</tr>`,
    )
    .join('');
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;padding:24px 28px 36px;color:#111;font-size:12px;line-height:1.4;background:#fff;">
    <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#667;">МКД Болгария</div>
    <h1 style="margin:6px 0 4px;font-size:20px;font-weight:700;">${escapeHtml(opts.title)}</h1>
    <div style="margin-bottom:8px;color:#666;font-size:11px;">${escapeHtml(opts.generated)}</div>
    <p style="margin:0 0 16px;color:#555;font-size:11px;">${escapeHtml(opts.hint)}</p>
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr>${head}</tr></thead>
      <tbody>${body || `<tr><td colspan="${opts.headers.length}" style="padding:12px;color:#888;">—</td></tr>`}</tbody>
    </table>
  </div>`;
}
