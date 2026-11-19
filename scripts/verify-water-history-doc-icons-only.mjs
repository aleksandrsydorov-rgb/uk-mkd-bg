/**
 * :3078 — Document column: icons only (no series/name text in cell).
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
  console.log(`${ok ? 'OK' : 'FAIL'} ${check}`, extra.detail || '');
}

async function login(page) {
  await page.goto(`${BASE}/#resident-login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(600);
  await page.locator('input[type="email"]').first().fill('admin@e2e.local');
  await page.locator('input[type="password"]').first().fill('AcceptNotify-3078!');
  await page
    .locator('button[type="submit"]')
    .filter({ hasText: /Войти|Sign in|Log in/i })
    .first()
    .click();
  await page.waitForURL(/\/admin/, { timeout: 120000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  try {
    await login(page);

    // Deep-link history shell for property 5 (known water payments in prior verifies).
    await page.goto(
      `${BASE}/admin?section=${encodeURIComponent('вода')}&tab=history&property=5`,
      { waitUntil: 'networkidle', timeout: 90000 },
    );
    await page.waitForSelector('[data-workplace-overlay="true"]', { timeout: 30000 });
    await page.locator('[data-workplace-shell="true"] [role="tab"]').nth(1).click();
    await page.waitForTimeout(2000);

    const shell = page.locator('[data-workplace-shell="true"]');
    const openSel =
      'button[aria-label="Открыть квитанцию"], button[aria-label="Open receipt"], button[aria-label="Отвори квитанция"]';
    const open = shell.locator(openSel);
    const iconCount = await open.count();
    note('receipt icons in document column', iconCount > 0, { iconCount });

    const txt = await shell.innerText();
    note('no visible series label «Квитанция ·»', !/Квитанция\s*[·•]/.test(txt), {
      hit: (txt.match(/Квитанция[^\n]{0,50}/) || [])[0],
    });

    if (iconCount > 0) {
      note(
        'download + print icons',
        (await shell.locator('button[aria-label="Скачать PDF"], button[aria-label="Download PDF"]').count()) >
          0 &&
          (await shell.locator('button[aria-label="Распечатать"], button[aria-label="Print"]').count()) >
            0,
      );
      await open.first().hover();
      await page.waitForTimeout(300);
      note('tooltip still works', (await page.locator('[role="tooltip"]').count()) > 0);
    } else {
      note('download + print icons', false, { detail: 'no icons found' });
      note('tooltip still works', false, { detail: 'skipped' });
    }

    await page.screenshot({
      path: path.join(OUT, 'water-history-doc-icons-only.png'),
      fullPage: false,
    });
    note('screenshot', true);

    const cell = fs.readFileSync('src/components/admin/AdminWaterApartmentFinanceHistory.tsx', 'utf8');
    note('finance history passes hideDocLabel', /hideDocLabel/.test(cell));
  } catch (err) {
    note('script error', false, { detail: String(err?.message || err) });
    await page
      .screenshot({ path: path.join(OUT, 'water-history-doc-icons-only-error.png'), fullPage: false })
      .catch(() => {});
  } finally {
    fs.writeFileSync(
      path.join(OUT, 'water-history-doc-icons-only-verify.json'),
      JSON.stringify(results, null, 2),
    );
    await browser.close();
  }
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

main();
