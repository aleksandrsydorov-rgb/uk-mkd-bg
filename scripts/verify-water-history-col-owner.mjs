/**
 * :3078 — Water → History owner column header: form.colOwner in RU/BG/EN.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3078';
const OUT = path.resolve('opt/cursor-artifacts');
fs.mkdirSync(OUT, { recursive: true });
const results = [];

function note(check, ok, extra = {}) {
  results.push({ check, ok, ...extra });
  console.log(`${ok ? 'OK' : 'FAIL'} ${check}`, extra.detail || extra.headers || '');
}

async function login(page) {
  await page.goto(`${BASE}/#resident-login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const form = page.locator('#resident-login form, .login-embed-form').first();
  await form.locator('input[type="email"]').fill('admin@e2e.local');
  await form.locator('input[type="password"]').fill('AcceptNotify-3078!');
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin/, { timeout: 90000 });
}

async function openHistory(page) {
  await page.goto(`${BASE}/admin?section=${encodeURIComponent('вода')}&tab=history`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('table thead th, [data-workplace-shell="true"]', { timeout: 30000 });
  await page.waitForTimeout(800);
}

async function headers(page) {
  return page.evaluate(() => {
    const ths = [...document.querySelectorAll('main table thead th, table thead th')].map((th) =>
      (th.textContent || '').trim(),
    );
    // Prefer the history register table (apt / section / owner / last)
    const tables = [...document.querySelectorAll('main table')];
    for (const table of tables) {
      const h = [...table.querySelectorAll('thead th')].map((th) => (th.textContent || '').trim());
      if (h.length >= 3) return h;
    }
    return ths;
  });
}

async function setLang(page, code) {
  const btn = page.getByRole('button', { name: new RegExp(`^${code}$`, 'i') });
  if ((await btn.count()) > 0) {
    await btn.first().click();
    await page.waitForTimeout(700);
    return true;
  }
  return false;
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();

try {
  await login(page);
  note('login', true);

  // Source: only form.colOwner, no admin.colOwner
  const src = fs.readFileSync('src/components/admin/AdminWaterHistoryRegister.tsx', 'utf8');
  note('no admin.colOwner in history register', !src.includes("t('admin.colOwner')"));
  note('uses form.colOwner', src.includes("t('form.colOwner')"));

  const usages = [];
  for (const file of [
    'src/components/admin/AdminWaterHistoryRegister.tsx',
    'src/components/admin/AdminUtilityFinanceWorkplace.tsx',
    'src/components/admin/AdminSupportFeeWorkplace.tsx',
    'src/components/admin/AdminCapital.tsx',
    'src/app/admin/page.tsx',
  ]) {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/t\('form\.colOwner'\)/g);
    if (m) usages.push({ file, count: m.length });
  }
  note('form.colOwner shared across registers', usages.length >= 4, { usages });

  await openHistory(page);

  const expected = {
    RU: 'Владелец',
    EN: 'Owner',
    BG: 'Собственик',
  };

  for (const [lang, label] of Object.entries(expected)) {
    await setLang(page, lang);
    // Re-open history after lang switch to ensure table re-renders
    await openHistory(page);
    const h = await headers(page);
    const ok = h.some((x) => x === label) && !h.some((x) => /ADMIN\.COLOWNER|admin\.colOwner/i.test(x));
    note(`${lang} owner header`, ok, { headers: h, expected: label });
    await page.screenshot({
      path: path.join(OUT, `water-history-col-owner-${lang.toLowerCase()}.png`),
      fullPage: false,
    });
  }
} catch (err) {
  note('script error', false, { detail: String(err?.stack || err) });
  await page
    .screenshot({ path: path.join(OUT, 'water-history-col-owner-error.png'), fullPage: true })
    .catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'water-history-col-owner-verify.json'), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}
