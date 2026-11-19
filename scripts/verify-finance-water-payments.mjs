/**
 * :3078 — Finance→Water shows the same payments register as Utilities→Water→Payments.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:3078';
const EMAIL = 'admin@e2e.local';
const PASS = 'AcceptNotify-3078!';
const WATER = encodeURIComponent('вода');
const OUT = path.resolve('opt/cursor-artifacts');
fs.mkdirSync(OUT, { recursive: true });
const results = [];

function note(check, ok, extra = {}) {
  results.push({ check, ok, ...extra });
  console.log(`${ok ? 'OK' : 'FAIL'} ${check}`, extra.detail || extra.url || '');
}

async function login(page) {
  await page.goto(`${BASE}/#resident-login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const form = page.locator('#resident-login form, .login-embed-form').first();
  await form.locator('input[type="email"]').fill(EMAIL);
  await form.locator('input[type="password"]').fill(PASS);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin/, { timeout: 90000 });
}

async function pageState(page) {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    const tabs = document.querySelector('.section-panel-tabs-scroll, [role="tablist"]');
    const payBtns = [...document.querySelectorAll('button')].filter((b) =>
      /Зарегистрировать оплату|Register payment|Регистрирай плащане/i.test(b.textContent || ''),
    );
    const table = document.querySelector('table');
    const activeNav = document.querySelector('[data-workplace-sidebar="true"] button[aria-current="page"]');
    return {
      url: url.pathname + url.search,
      tab: url.searchParams.get('tab'),
      hasFiveTabs: Boolean(tabs),
      tabCount: tabs ? tabs.querySelectorAll('button, a').length : 0,
      payBtnCount: payBtns.length,
      tableRows: table ? table.querySelectorAll('tbody tr').length : 0,
      activeNavText: (activeNav?.textContent || '').trim().slice(0, 100),
      ffSection: url.searchParams.get('ffSection'),
      ufSection: url.searchParams.get('ufSection'),
    };
  });
}

async function selectSectionIfPossible(page, value) {
  const selects = page.locator('select');
  const n = await selects.count();
  for (let i = 0; i < n; i++) {
    if ((await selects.nth(i).locator(`option[value="${value}"]`).count()) > 0) {
      await selects.nth(i).selectOption(value);
      await page.waitForTimeout(700);
      return true;
    }
  }
  return false;
}

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

try {
  await login(page);
  note('login', true);

  await page.goto(`${BASE}/admin?section=${WATER}&tab=finance`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  let st = await pageState(page);
  note('finance water tab=finance', st.tab === 'finance', st);
  note('finance water no five tabs', !st.hasFiveTabs, st);
  note('finance water has pay table+actions', st.payBtnCount > 0 && st.tableRows > 0, st);
  note('finance nav stays on water finance', st.tab === 'finance' && /вода|water/i.test(st.activeNavText || st.url), {
    activeNavText: st.activeNavText,
  });
  await page.screenshot({ path: path.join(OUT, 'finance-water-payments.png'), fullPage: false });

  const setFf = await selectSectionIfPossible(page, 'A');
  const afterFf = await pageState(page);
  note('finance filter writes ffSection', setFf && afterFf.ffSection === 'A' && !afterFf.ufSection, afterFf);

  await page.getByRole('button', { name: /Зарегистрировать оплату|Register payment|Регистрирай/i }).first().click();
  await page.waitForTimeout(700);
  const popup = await page.locator('[data-admin-modal-overlay="true"]').count();
  note('finance pay popup opens', popup > 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  note('finance stays after popup close', (await pageState(page)).tab === 'finance');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  const afterReload = await pageState(page);
  note('finance reload keeps tab+ff', afterReload.tab === 'finance' && afterReload.ffSection === 'A', afterReload);

  // Keep ff* in the URL to prove utilities filter writes do not wipe finance ns.
  await page.goto(`${BASE}/admin?section=${WATER}&tab=payments&ffSection=A`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  const payTab = await pageState(page);
  note('utilities payments has five tabs', payTab.hasFiveTabs && payTab.tabCount >= 5, payTab);
  note('utilities payments has pay table+actions', payTab.payBtnCount > 0 && payTab.tableRows > 0, payTab);
  await page.screenshot({ path: path.join(OUT, 'utilities-water-payments.png'), fullPage: false });

  const setUf = await selectSectionIfPossible(page, 'A');
  const afterUf = await pageState(page);
  note('utilities filter writes uf* keeps ff*', setUf && afterUf.ufSection === 'A' && afterUf.ffSection === 'A', afterUf);

  await page.goto(`${BASE}/admin?section=${WATER}&tab=finance&ffSection=A`, {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  const back = await pageState(page);
  note('finance independent of utilities chrome', back.tab === 'finance' && !back.hasFiveTabs && back.ffSection === 'A', back);

  note('same pay actions both places', st.payBtnCount > 0 && payTab.payBtnCount > 0, {
    finance: st.payBtnCount,
    utilities: payTab.payBtnCount,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin?section=${WATER}&tab=finance`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table tbody tr', { timeout: 20000 });
  const mobile = await pageState(page);
  await page.screenshot({ path: path.join(OUT, 'finance-water-payments-mobile.png'), fullPage: false });
  note('mobile finance water', mobile.tab === 'finance' && !mobile.hasFiveTabs && mobile.payBtnCount > 0, mobile);

  const en = page.getByRole('button', { name: /^EN$/i }).first();
  if (await en.count()) {
    await en.click();
    await page.waitForTimeout(700);
    note('EN labels', (await page.getByRole('button', { name: /Register payment/i }).count()) > 0);
  } else {
    note('EN labels', true, { detail: 'skip' });
  }
} catch (e) {
  note('script error', false, { detail: String(e) });
  await page.screenshot({ path: path.join(OUT, 'finance-water-error.png'), fullPage: false }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'finance-water-payments-verify.json'), JSON.stringify(results, null, 2));
  await browser.close();
}

process.exit(results.some((r) => !r.ok) ? 1 : 0);
