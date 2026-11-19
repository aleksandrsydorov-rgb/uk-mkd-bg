/**
 * :3078 — Water History popup finance table columns/status/notes.
 * Read-only.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3078';
const EMAIL = 'admin@e2e.local';
const PASS = 'AcceptNotify-3078!';
const OUT = path.resolve('opt/cursor-artifacts');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function note(check, ok, extra = {}) {
  results.push({ check, ok, ...extra });
  console.log(`${ok ? 'OK' : 'FAIL'} ${check}`, extra.detail || '');
}

async function login(page) {
  await page.goto(`${BASE}/#resident-login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.locator('input[type="email"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page
    .locator('button[type="submit"]')
    .filter({ hasText: /Войти|Sign in|Вход|Log in/i })
    .first()
    .click();
  await page.waitForURL(/\/admin/, { timeout: 120000 });
}

async function openFinanceTab(page) {
  const url = `${BASE}/admin?section=${encodeURIComponent('вода')}&tab=history`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(600);
  const preferred = page.locator('table tbody tr[data-property-id="5"]').first();
  const any = page.locator('table tbody tr[data-property-id]').first();
  if ((await preferred.count()) > 0) await preferred.click();
  else await any.click();
  await page.waitForSelector('[data-workplace-overlay="true"]', { timeout: 20000 });
  const shell = page.locator('[data-workplace-shell="true"]');
  await shell.locator('[role="tab"]').nth(1).click();
  await page.waitForTimeout(900);
  return shell;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await login(page);
    const shell = await openFinanceTab(page);
    const text = await shell.innerText();

    note('lead text shortened', /Начисления и оплаты за воду\. Квитанции доступны/i.test(text), {
      snippet: text.slice(0, 200).replace(/\s+/g, ' '),
    });
    note('no Period column header', !/Период/i.test(text.split('\n').slice(0, 30).join(' ')));
    note('Document column present', /Документ/i.test(text));
    note('six-column order cues', /Дата[\s\S]*Тип[\s\S]*Сумма[\s\S]*Статус[\s\S]*Документ[\s\S]*Примечание/i.test(text.replace(/\s+/g, ' ')));

    note('no raw opening_balance code', !/opening_balance/i.test(text), {
      detail: /opening_balance/i.test(text) ? 'leaked' : 'clean',
    });
    note('opening balance human note', /Начальн(ая задолженность|ая переплата|ый остаток)/i.test(text), {
      snippet: text.match(/Начальн[^\n]{0,80}/)?.[0],
    });
    note('type is Opening balance not Adjustment', /Начальный остаток/i.test(text) && !/Корректировка \(\+\)/i.test(text));

    // Status must not show receipt-ready «Готова» as op status for opening rows
    const statusReadyInShell = (await shell.locator('text=Готова').count()) > 0;
    note('no Готова badge as finance/doc status for this apartment', !statusReadyInShell);

    await page.screenshot({
      path: path.join(OUT, 'water-history-finance-table.png'),
      fullPage: false,
    });
    note('screenshot saved', true, { path: 'opt/cursor-artifacts/water-history-finance-table.png' });
  } catch (err) {
    note('script error', false, { detail: String(err?.message || err) });
    await page
      .screenshot({ path: path.join(OUT, 'water-history-finance-table-error.png'), fullPage: false })
      .catch(() => {});
  } finally {
    fs.writeFileSync(
      path.join(OUT, 'water-history-finance-table-verify.json'),
      JSON.stringify(results, null, 2),
      'utf8',
    );
    await browser.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main();
