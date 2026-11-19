/**
 * Stage 1 electricity admin layout smoke — http://127.0.0.1:3078
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3078';
const EMAIL = 'admin@e2e.local';
const PASS = 'AcceptNotify-3078!';
const EL = encodeURIComponent('электроэнергия');
const WATER = encodeURIComponent('вода');
const OUT = path.resolve('opt/cursor-artifacts');
fs.mkdirSync(OUT, { recursive: true });
const results = [];

function note(check, ok, extra = {}) {
  results.push({ check, ok, ...extra });
  console.log(`${ok ? 'OK' : 'FAIL'} ${check}`, extra.detail || '');
}

async function login(page) {
  await page.goto(`${BASE}/#resident-login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const form = page.locator('#resident-login form, .login-embed-form').first();
  await form.locator('input[type="email"]').fill(EMAIL);
  await form.locator('input[type="password"]').fill(PASS);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin/, { timeout: 90000 });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await login(page);
    await page.goto(`${BASE}/admin?section=${EL}&tab=overview`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.screenshot({ path: path.join(OUT, 'electricity-stage1-overview.png'), fullPage: true });

    const tabCount = await page.locator('main nav.section-panel-tabs-scroll a').count();
    note('SectionPanelTabs five items', tabCount === 5, { detail: String(tabCount) });

    const mainH1s = await page.locator('main h1').count();
    note('No duplicate AdminPageHeader h1 in main work area', mainH1s <= 1, { detail: String(mainH1s) });

    const cards = await page.locator('main .grid.sm\\:grid-cols-3 > *').count();
    note('Overview three cards', cards >= 3, { detail: String(cards) });

  const thCount = await page.locator('main table thead th').count();
    note('Register table 12 headers', thCount === 12, { detail: String(thCount) });

    const link = page.locator('[data-apartment-card-overlay="true"]').first();
    await link.waitFor({ state: 'visible', timeout: 20000 });
    const href = await link.getAttribute('href');
    note('PropertyIdentityLink contains cardProperty', Boolean(href && href.includes('cardProperty')), { detail: href || '' });

    await page.goto(`${BASE}/admin?section=${WATER}&tab=overview`, { waitUntil: 'networkidle', timeout: 60000 });
    const waterTabs = await page.locator('main nav.section-panel-tabs-scroll a').count();
    note('Water overview tabs still render', waterTabs >= 5, { detail: String(waterTabs) });
    await page.screenshot({ path: path.join(OUT, 'water-overview-after-el-stage1.png'), fullPage: true });
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'electricity-stage1-verify.json'), JSON.stringify({ results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  if (failed.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});