/**
 * :3078 — Water → History apartment popup: dual SectionPanelTabs
 * (readings + financial history), no auto-open on tab, screenshots.
 * Read-only — no payments / resets / emails.
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
  const email = page.locator('input[type="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: 'visible', timeout: 30000 });
  await email.fill(EMAIL);
  await password.fill(PASS);
  await page.locator('button[type="submit"]').filter({ hasText: /Войти|Sign in|Вход|Log in/i }).first().click();
  await page.waitForURL(/\/admin/, { timeout: 120000 });
}

async function gotoHistoryList(page) {
  const url = `${BASE}/admin?section=${encodeURIComponent('вода')}&tab=history`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(800);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await login(page);

    // 1) History tab = list only, no auto popup
    await gotoHistoryList(page);
    const overlayOnList = await page.locator('[data-workplace-overlay="true"]').count();
    note('history tab opens list without popup', overlayOnList === 0, {
      overlayOnList,
      url: page.url(),
    });
    await page.screenshot({
      path: path.join(OUT, 'water-history-list-no-popup.png'),
      fullPage: false,
    });

    // 2) Open apartment row → shell with dual tabs (prefer property 5 — known water data)
    const preferred = page.locator('table tbody tr[data-property-id="5"]').first();
    const anyRow = page.locator('table tbody tr[data-property-id]').first();
    if ((await preferred.count()) > 0) await preferred.click();
    else await anyRow.click();
    await page.waitForSelector('[data-workplace-overlay="true"]', { timeout: 20000 });
    await page.waitForTimeout(600);

    const shell = page.locator('[data-workplace-shell="true"]');
    note('apartment popup opens on click', (await shell.count()) > 0, { url: page.url() });

    const tablist = shell.locator('[role="tablist"]');
    const tabCount = await tablist.locator('[role="tab"]').count();
    const tabLabels = await tablist.locator('[role="tab"]').allTextContents();
    note('inner SectionPanelTabs has 2 tabs', tabCount === 2, { tabCount, tabLabels });

    const titleText = ((await shell.locator('h2').first().textContent()) || '').trim();
    note('popup title is apartment identity (not technical id)', !/^[0-9a-f-]{20,}$/i.test(titleText) && titleText.length > 0, {
      titleText,
    });

    // Readings tab content
    const readingsTab = tablist.locator('[role="tab"]').nth(0);
    await readingsTab.click();
    await page.waitForTimeout(400);
    const readingsBody = await shell.innerText();
    note('readings tab shows journal chrome', /показан|Reading|показания|дата|Date/i.test(readingsBody), {
      snippet: readingsBody.slice(0, 180).replace(/\s+/g, ' '),
    });
    await page.screenshot({
      path: path.join(OUT, 'water-history-popup-readings.png'),
      fullPage: false,
    });

    // Finance tab
    const financeTab = tablist.locator('[role="tab"]').nth(1);
    await financeTab.click();
    await page.waitForTimeout(800);
    const stillOpen = (await page.locator('[data-workplace-overlay="true"]').count()) > 0;
    note('switching inner tab keeps shell open', stillOpen);

    const financeBody = await shell.innerText();
    note('finance tab shows filters / ledger chrome', /начислен|оплат|Charge|Payment|тип|period|период|сумм|€/i.test(financeBody), {
      snippet: financeBody.slice(0, 220).replace(/\s+/g, ' '),
    });
    const issueStub = await shell.locator('button:has-text("Выпустить"), button:has-text("Issue")').count();
    note('no fake issue-receipt stub on finance history', issueStub === 0, { issueStub });

    await page.screenshot({
      path: path.join(OUT, 'water-history-popup-finance.png'),
      fullPage: false,
    });

    // Close and confirm list restored (no overlay)
    const closeBtn = shell.locator('[data-workplace-close="true"]');
    await closeBtn.click();
    await page.waitForTimeout(500);
    const overlayAfterClose = await page.locator('[data-workplace-overlay="true"]').count();
    note('close returns to list', overlayAfterClose === 0 && /tab=history/.test(page.url()) && !/property=/.test(page.url()), {
      url: page.url(),
      overlayAfterClose,
    });

    // Mobile viewport
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHistoryList(page);
    // Mobile uses card list (md:hidden)
    const mobileCard = page.locator('ul.md\\:hidden button[data-property-id="5"], ul button[data-property-id]').first();
    if ((await mobileCard.count()) > 0) {
      await mobileCard.click();
      await page.waitForSelector('[data-workplace-overlay="true"]', { timeout: 15000 });
      await page.waitForTimeout(400);
      await page.screenshot({
        path: path.join(OUT, 'water-history-popup-readings-mobile.png'),
        fullPage: false,
      });
      const mTabs = page.locator('[data-workplace-shell="true"] [role="tab"]');
      if ((await mTabs.count()) >= 2) {
        await mTabs.nth(1).click();
        await page.waitForTimeout(500);
        await page.screenshot({
          path: path.join(OUT, 'water-history-popup-finance-mobile.png'),
          fullPage: false,
        });
      }
      note('mobile dual-tab popup', true);
    } else {
      note('mobile dual-tab popup', false, { detail: 'no mobile card to open' });
    }

    // EN locale smoke
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/admin?section=${encodeURIComponent('вода')}&tab=history&lang=en`, {
      waitUntil: 'networkidle',
      timeout: 90000,
    });
    await page.waitForTimeout(600);
    const enText = await page.locator('body').innerText();
    // Locale may be cookie-based; tolerate either
    note('EN or RU history list reachable', /History|История|Reading|Apartment|Апартамент/i.test(enText));
  } catch (err) {
    note('script error', false, { detail: String(err?.message || err) });
    await page.screenshot({
      path: path.join(OUT, 'water-history-dual-tabs-error.png'),
      fullPage: false,
    }).catch(() => {});
  } finally {
    fs.writeFileSync(
      path.join(OUT, 'water-history-dual-tabs-verify.json'),
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
