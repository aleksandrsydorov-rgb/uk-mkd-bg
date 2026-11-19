/**
 * :3078 — Apartment card opens as overlay over water registers (utilities + finance)
 * without navigating to «Апартаменты» / changing left menu or page title.
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

async function snapshot(page) {
  return page.evaluate(() => {
    const url = new URL(window.location.href);
    const h1 = document.querySelector('main h1');
    const activeNav = document.querySelector(
      '[data-workplace-sidebar="true"] button[aria-current="page"], [data-workplace-sidebar="true"] a[aria-current="page"]',
    );
    const shell = document.querySelector('[data-workplace-shell="true"]');
    const overlay = document.querySelector('[data-workplace-overlay="true"]');
    const cardTabs = shell
      ? [...shell.querySelectorAll('[role="tab"], button')].map((el) => (el.textContent || '').trim()).filter(Boolean)
      : [];
    return {
      url: url.pathname + url.search,
      section: url.searchParams.get('section'),
      tab: url.searchParams.get('tab'),
      property: url.searchParams.get('property'),
      cardProperty: url.searchParams.get('cardProperty'),
      cardTab: url.searchParams.get('cardTab'),
      h1: (h1?.textContent || '').trim(),
      activeNav: (activeNav?.textContent || '').trim().slice(0, 80),
      hasShell: Boolean(shell),
      hasOverlay: Boolean(overlay),
      cardTabLabels: cardTabs.slice(0, 12),
    };
  });
}

async function openFirstIdentityLink(page) {
  const link = page.locator('[data-apartment-card-overlay="true"]').first();
  await link.waitFor({ state: 'visible', timeout: 20000 });
  await link.click();
  await page.waitForFunction(() => new URL(window.location.href).searchParams.has('cardProperty'), null, {
    timeout: 15000,
  });
  await page.waitForSelector('[data-workplace-shell="true"]', { timeout: 15000 });
}

async function closeShell(page) {
  const closeBtn = page.locator('[data-workplace-close="true"]').first();
  if (await closeBtn.count()) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForSelector('[data-workplace-shell="true"]', { state: 'detached', timeout: 10000 });
  await page.waitForFunction(() => !new URL(window.location.href).searchParams.has('cardProperty'), null, {
    timeout: 10000,
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

try {
  await login(page);
  note('login', true);

  // ——— Utilities → Water → Payments ———
  await page.goto(`${BASE}/admin?section=${WATER}&tab=payments`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('table tbody tr', { timeout: 25000 });
  const beforeUtil = await snapshot(page);
  note('util water payments loaded', beforeUtil.section === 'вода' && beforeUtil.tab === 'payments', beforeUtil);

  await openFirstIdentityLink(page);
  const utilOpen = await snapshot(page);
  note(
    'util overlay keeps section/tab',
    utilOpen.section === 'вода' && utilOpen.tab === 'payments' && Boolean(utilOpen.cardProperty),
    utilOpen,
  );
  note('util overlay no apartments section', utilOpen.section !== 'квартиры', utilOpen);
  note('util overlay has WorkplaceCardShell', utilOpen.hasShell && utilOpen.hasOverlay, utilOpen);
  note(
    'util h1 stays water (not apartments)',
    /вод|water/i.test(utilOpen.h1) && !/апартамент|apartment|апартамент/i.test(utilOpen.h1),
    { h1: utilOpen.h1 },
  );
  await page.screenshot({
    path: path.join(OUT, 'water-apartment-card-overlay-utilities.png'),
    fullPage: false,
  });

  // Internal card tab without remount / section change
  const metersTab = page
    .locator('[data-workplace-shell="true"] button, [data-workplace-shell="true"] [role="tab"]')
    .filter({ hasText: /Счётчик|Meter|Брояч|финанс|Finance|Финанс/i })
    .first();
  if (await metersTab.count()) {
    await metersTab.click();
    await page.waitForTimeout(500);
  }
  const utilTab = await snapshot(page);
  note(
    'util inner card tab keeps overlay section',
    utilTab.section === 'вода' && utilTab.tab === 'payments' && utilTab.hasShell,
    utilTab,
  );

  // Reload restores overlay + background
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-workplace-shell="true"]', { timeout: 20000 });
  const utilReload = await snapshot(page);
  note(
    'util reload restores overlay over water',
    utilReload.section === 'вода' &&
      utilReload.tab === 'payments' &&
      Boolean(utilReload.cardProperty) &&
      utilReload.hasShell,
    utilReload,
  );

  await closeShell(page);
  const utilClosed = await snapshot(page);
  note(
    'util close stays on payments register',
    utilClosed.section === 'вода' &&
      utilClosed.tab === 'payments' &&
      !utilClosed.cardProperty &&
      !utilClosed.hasShell,
    utilClosed,
  );

  // Back/Forward
  await openFirstIdentityLink(page);
  await page.waitForTimeout(400);
  await page.goBack();
  await page.waitForTimeout(700);
  const utilBack = await snapshot(page);
  note(
    'util back closes overlay keeps water',
    utilBack.section === 'вода' && utilBack.tab === 'payments' && !utilBack.hasShell,
    utilBack,
  );
  await page.goForward();
  await page.waitForSelector('[data-workplace-shell="true"]', { timeout: 15000 });
  const utilFwd = await snapshot(page);
  note(
    'util forward restores overlay',
    utilFwd.section === 'вода' && Boolean(utilFwd.cardProperty) && utilFwd.hasShell,
    utilFwd,
  );
  await closeShell(page);

  // Specialized pay popup still works (not apartment card)
  await page.getByRole('button', { name: /Зарегистрировать оплату|Register payment|Регистрирай/i }).first().click();
  await page.waitForTimeout(700);
  const payPopup = await page.locator('[data-admin-modal-overlay="true"]').count();
  const noAptShell = (await page.locator('[data-workplace-shell="true"]').count()) === 0;
  note('util pay popup still separate', payPopup > 0 && noAptShell);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ——— Finance → Water ———
  await page.goto(`${BASE}/admin?section=${WATER}&tab=finance`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('table tbody tr', { timeout: 25000 });
  const beforeFin = await snapshot(page);
  note('finance water loaded', beforeFin.tab === 'finance', beforeFin);

  await openFirstIdentityLink(page);
  const finOpen = await snapshot(page);
  note(
    'finance overlay keeps tab=finance',
    finOpen.section === 'вода' && finOpen.tab === 'finance' && Boolean(finOpen.cardProperty) && finOpen.hasShell,
    finOpen,
  );
  note('finance overlay not apartments', finOpen.section !== 'квартиры', finOpen);
  await page.screenshot({
    path: path.join(OUT, 'water-apartment-card-overlay-finance.png'),
    fullPage: false,
  });

  await closeShell(page);
  const finClosed = await snapshot(page);
  note(
    'finance close stays on finance water',
    finClosed.tab === 'finance' && !finClosed.cardProperty && !finClosed.hasShell,
    finClosed,
  );

  // Mobile viewport
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/admin?section=${WATER}&tab=payments`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('table tbody tr, ul li', { timeout: 25000 });
  await openFirstIdentityLink(page);
  const mobile = await snapshot(page);
  note(
    'mobile overlay keeps water payments',
    mobile.section === 'вода' && mobile.tab === 'payments' && mobile.hasShell,
    mobile,
  );
  await page.screenshot({
    path: path.join(OUT, 'water-apartment-card-overlay-mobile.png'),
    fullPage: false,
  });
  await closeShell(page);
} catch (err) {
  note('script error', false, { detail: String(err?.stack || err) });
  await page.screenshot({ path: path.join(OUT, 'water-apartment-card-overlay-error.png'), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'water-apartment-card-overlay-verify.json'), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}
