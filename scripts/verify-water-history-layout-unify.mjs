/**
 * :3078 — Water history popup: shared filter bar + aligned tables across tabs.
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
  await page.waitForTimeout(500);
  await page.locator('input[type="email"]').first().fill(EMAIL);
  await page.locator('input[type="password"]').first().fill(PASS);
  await page
    .locator('button[type="submit"]')
    .filter({ hasText: /Войти|Sign in|Вход|Log in/i })
    .first()
    .click();
  await page.waitForURL(/\/admin/, { timeout: 120000 });
}

async function openHistory(page) {
  await page.goto(
    `${BASE}/admin?section=${encodeURIComponent('вода')}&tab=history`,
    { waitUntil: 'networkidle', timeout: 90000 },
  );
  await page.waitForTimeout(500);
  const preferred = page.locator('table tbody tr[data-property-id="5"]').first();
  if ((await preferred.count()) > 0) await preferred.click();
  else await page.locator('table tbody tr[data-property-id]').first().click();
  await page.waitForSelector('[data-workplace-overlay="true"]', { timeout: 20000 });
  await page.waitForTimeout(600);
}

async function measure(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-workplace-shell="true"]');
    if (!shell) return null;
    const dates = [...shell.querySelectorAll('input[type="date"]')];
    const from = dates[0]?.getBoundingClientRect();
    const to = dates[1]?.getBoundingClientRect();
    const table =
      shell.querySelector('table')?.getBoundingClientRect() ||
      shell.querySelector('[class*="Empty"]')?.getBoundingClientRect();
    const titleDup = /история показаний/i.test(
      [...shell.querySelectorAll('p,h2,h3')].map((el) => el.textContent || '').join('|'),
    );
    // Uppercase section title above table (old pattern)
    const upperTitles = [...shell.querySelectorAll('p')].filter((p) =>
      /ИСТОРИЯ ПОКАЗАНИЙ|READING HISTORY/i.test(p.textContent || ''),
    );
    return {
      from: from ? { x: Math.round(from.left), y: Math.round(from.top), w: Math.round(from.width), h: Math.round(from.height) } : null,
      to: to ? { x: Math.round(to.left), y: Math.round(to.top), w: Math.round(to.width), h: Math.round(to.height) } : null,
      tableTop: table ? Math.round(table.top) : null,
      tableLeft: table ? Math.round(table.left) : null,
      dateCount: dates.length,
      upperTitleCount: upperTitles.length,
      kindSelect: Boolean(shell.querySelector('select')),
      text: (shell.innerText || '').slice(0, 200),
    };
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  try {
    await login(page);
    await openHistory(page);
    const shell = page.locator('[data-workplace-shell="true"]');
    const tabs = shell.locator('[role="tab"]');

    await tabs.nth(0).click();
    await page.waitForTimeout(400);
    const readings = await measure(page);
    await page.screenshot({
      path: path.join(OUT, 'water-history-layout-readings.png'),
      fullPage: false,
    });

    await tabs.nth(1).click();
    await page.waitForTimeout(500);
    const finance = await measure(page);
    await page.screenshot({
      path: path.join(OUT, 'water-history-layout-finance.png'),
      fullPage: false,
    });

    note('readings has 2 date fields', readings?.dateCount === 2, readings || {});
    note('finance has 2 date fields', finance?.dateCount === 2, finance || {});
    note('finance has kind select', Boolean(finance?.kindSelect));
    note('readings has no kind select', !readings?.kindSelect);

    const dx = Math.abs((readings?.from?.x ?? 0) - (finance?.from?.x ?? -999));
    const dy = Math.abs((readings?.from?.y ?? 0) - (finance?.from?.y ?? -999));
    const dw = Math.abs((readings?.from?.w ?? 0) - (finance?.from?.w ?? -999));
    const dh = Math.abs((readings?.from?.h ?? 0) - (finance?.from?.h ?? -999));
    note('from-date same x/y (±2px)', dx <= 2 && dy <= 2, { dx, dy, readings: readings?.from, finance: finance?.from });
    note('from-date same size (±2px)', dw <= 2 && dh <= 2, { dw, dh });

    const tdx = Math.abs((readings?.to?.x ?? 0) - (finance?.to?.x ?? -999));
    const tdy = Math.abs((readings?.to?.y ?? 0) - (finance?.to?.y ?? -999));
    note('to-date same x/y (±2px)', tdx <= 2 && tdy <= 2, { tdx, tdy });

    const tableDy = Math.abs((readings?.tableTop ?? 0) - (finance?.tableTop ?? -999));
    const tableDx = Math.abs((readings?.tableLeft ?? 0) - (finance?.tableLeft ?? -999));
    note('table top/left aligned (±4px)', tableDy <= 4 && tableDx <= 4, {
      tableDy,
      tableDx,
      readingsTop: readings?.tableTop,
      financeTop: finance?.tableTop,
    });

    note('no duplicate uppercase readings title', (readings?.upperTitleCount ?? 1) === 0, {
      count: readings?.upperTitleCount,
    });

    // Mobile
    await page.setViewportSize({ width: 390, height: 844 });
    await tabs.nth(0).click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT, 'water-history-layout-readings-mobile.png'),
      fullPage: false,
    });
    await tabs.nth(1).click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(OUT, 'water-history-layout-finance-mobile.png'),
      fullPage: false,
    });
    note('mobile screenshots saved', true);

    // Locale labels in shared bar source
    const bar = fs.readFileSync('src/components/admin/HistoryJournalFilterBar.tsx', 'utf8');
    note('shared HistoryJournalFilterBar exists', /HistoryJournalFilterBar/.test(bar));
  } catch (err) {
    note('script error', false, { detail: String(err?.message || err) });
    await page
      .screenshot({ path: path.join(OUT, 'water-history-layout-error.png'), fullPage: false })
      .catch(() => {});
  } finally {
    fs.writeFileSync(
      path.join(OUT, 'water-history-layout-unify-verify.json'),
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
