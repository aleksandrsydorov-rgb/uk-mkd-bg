import fs from 'fs';

const envText = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const url = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('NO_ENV');
  process.exit(1);
}

const tables = [
  'announcements',
  'apartment_guests',
  'chat_messages',
  'meter_readings',
  'n525_commands',
  'owner_transfers',
  'poll_options',
  'poll_suggestions',
  'poll_vote_history',
  'poll_votes',
  'polls',
  'properties',
  'requests',
  'staff',
  'uk_expenses',
  'building_settings',
  'support_fee_ledger',
];

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
};

for (const table of tables) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers });
  const text = await res.text();
  let cols = '';
  let note = '';
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data) && data[0]) cols = Object.keys(data[0]).join(', ');
    else if (Array.isArray(data)) note = 'empty (columns unknown until first row)';
    else note = data.message || text.slice(0, 120);
  } catch {
    note = text.slice(0, 120);
  }
  console.log(`${table}\t${res.status}\t${cols || note}`);
}
