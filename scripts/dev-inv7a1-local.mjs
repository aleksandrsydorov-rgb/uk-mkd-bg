#!/usr/bin/env node
/**
 * INV-7A.1 isolated Next.js launcher.
 *
 * Next.js always loads .env.local. Process env vars set BEFORE spawn
 * take precedence over .env* files — that is the isolation mechanism.
 *
 * Usage: node scripts/dev-inv7a1-local.mjs
 * Port: 3011 (avoids colliding with a cloud-targeted `next dev` on 3000)
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env.inv7a1.local');
const PORT = process.env.INV7A1_PORT || '3011';

if (!fs.existsSync(envFile)) {
  console.error('Missing .env.inv7a1.local — abort.');
  process.exit(1);
}

const parsed = {};
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  parsed[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const url = parsed.NEXT_PUBLIC_SUPABASE_URL || '';
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(url.replace(/\/$/, ''))) {
  console.error('REFUSE: NEXT_PUBLIC_SUPABASE_URL is not local:', url);
  process.exit(1);
}
if (/klowacuvufknbrkayjhz/i.test(url)) {
  console.error('REFUSE: cloud project ref detected in URL');
  process.exit(1);
}

const childEnv = {
  ...process.env,
  ...parsed,
  NEXT_PUBLIC_SUPABASE_URL: parsed.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: parsed.SUPABASE_SERVICE_ROLE_KEY,
  INV7A1_ISOLATION_PROBE: '1',
  INV7A1_LOCAL: '1',
  PORT,
};

console.log('[inv7a1] isolated launch');
console.log('[inv7a1] NEXT_PUBLIC_SUPABASE_URL =', childEnv.NEXT_PUBLIC_SUPABASE_URL);
console.log('[inv7a1] port =', PORT);
console.log('[inv7a1] .env.local is NOT modified; process env overrides it');

const nextBin = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextBin, 'dev', '-p', PORT, '-H', '127.0.0.1'], {
  cwd: root,
  env: childEnv,
  stdio: 'inherit',
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
