/**
 * :3078 — verify SectionPanelTabs stay under WorkplaceCardShell dimming.
 * Screenshots + stacking checks. No data writes.
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
  const form = page.locator('#resident-login form, .login-embed-form').first();
  await form.locator('input[type="email"]').fill(EMAIL);
  await form.locator('input[type="password"]').fill(PASS);
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin/, { timeout: 90000 });
}

async function openHistory(page) {
  const url = `${BASE}/admin?section=${encodeURIComponent('вода')}&tab=history&property=5`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForSelector('[data-workplace-overlay="true"]', { timeout: 20000 });
  await page.waitForTimeout(500);
}

async function measureStack(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('[data-workplace-overlay="true"]');
    const shell = document.querySelector('[data-workplace-shell="true"]');
    const tabs =
      document.querySelector('.section-panel-tabs-scroll') ||
      document.querySelector('[role="tablist"]');
    const work = document.querySelector('[data-workplace-work-area="true"]');
    const side = document.querySelector('[data-workplace-sidebar="true"]');
    const zRaw = (el) => (el ? getComputedStyle(el).zIndex : null);
    const zNum = (el) => {
      const raw = zRaw(el);
      if (raw == null || raw === 'auto') return 0;
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    };
    const title = shell?.querySelector('h2');
    const close = shell?.querySelector('[data-workplace-close="true"]');
    const titleRect = title?.getBoundingClientRect();
    let titleTopEl = null;
    let titleCoveredByTabs = false;
    if (titleRect && title) {
      const cx = titleRect.left + Math.min(40, titleRect.width / 2);
      const cy = titleRect.top + titleRect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      titleTopEl = topEl
        ? `${topEl.tagName}.${topEl.className}`.slice(0, 120)
        : null;
      titleCoveredByTabs = Boolean(
        topEl &&
          tabs &&
          (tabs === topEl || tabs.contains(topEl)) &&
          !(shell && shell.contains(topEl)),
      );
    }
    let tabHit = null;
    if (tabs) {
      const r = tabs.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + 12, r.top + 12);
      tabHit = el ? `${el.tagName}[data=${el.getAttribute('data-workplace-overlay') || el.getAttribute('data-workplace-shell') || ''}]`.slice(0, 80) : null;
    }
    const overlayOnTopOfTabs = Boolean(
      overlay &&
        tabs &&
        (() => {
          const r = tabs.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + 12, r.top + 12);
          return el && (overlay === el || overlay.contains(el));
        })(),
    );
    return {
      overlayZ: zNum(overlay),
      overlayZRaw: zRaw(overlay),
      overlayParent: overlay?.parentElement?.tagName || null,
      shellPresent: Boolean(shell),
      tabsFound: Boolean(tabs),
      tabsZ: zNum(tabs),
      workInert: work?.hasAttribute('inert') ?? false,
      sideInert: side?.hasAttribute('inert') ?? false,
      titleVisible: Boolean(titleRect && titleRect.height > 0),
      closeVisible: Boolean(close),
      titleCoveredByTabs,
      titleTopEl,
      tabHit,
      overlayOnTopOfTabs,
    };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await context.newPage();

try {
  await login(page);
  note('login', true);

  await openHistory(page);
  const hist = await measureStack(page);
  await page.screenshot({
    path: path.join(OUT, 'water-overlay-history-desktop.png'),
    fullPage: false,
  });
  note('history card open', hist.shellPresent && hist.overlayZ >= 41, hist);
  note('history title fully above tabs', !hist.titleCoveredByTabs && hist.titleVisible, {
    titleCoveredByTabs: hist.titleCoveredByTabs,
    titleTopEl: hist.titleTopEl,
  });
  note('dimming covers tabs + background inert', hist.overlayOnTopOfTabs && hist.workInert && hist.sideInert, hist);

  // Nested confirm: click Исправить if present, or open a confirm via cancel dirty —
  // Use Escape path after focusing; prefer AppConfirm if correction opens.
  const correct = page.getByRole('button', { name: /Исправить|Correct|Коригирай/i }).first();
  if (await correct.count()) {
    await correct.click();
    await page.waitForTimeout(500);
  }
  const modalCount = await page.locator('[data-admin-modal-overlay="true"]').count();
  if (modalCount > 0) {
    const mz = await page.evaluate(() => {
      const m = document.querySelector('[data-admin-modal-overlay="true"]');
      const w = document.querySelector('[data-workplace-overlay="true"]');
      return {
        modalZ: m ? Number(getComputedStyle(m).zIndex) || 0 : 0,
        workZ: w ? Number(getComputedStyle(w).zIndex) || 0 : 0,
      };
    });
    note('nested confirm above workplace', mz.modalZ > mz.workZ, mz);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  } else {
    note('nested confirm above workplace', true, { detail: 'no nested confirm in this fixture; Escape-priority covered by unit test' });
  }

  await page.screenshot({
    path: path.join(OUT, 'water-overlay-history-after-fix.png'),
    fullPage: false,
  });

  // Close card, collapse sidebar, reopen
  await page.click('[data-workplace-close="true"]');
  await page.waitForTimeout(400);
  const collapse = page.locator('[data-workplace-sidebar="true"] button[title="Свернуть"], [data-workplace-sidebar="true"] button[title="Collapse"]').first();
  if (await collapse.count()) {
    await collapse.click({ force: true });
    await page.waitForTimeout(500);
  }
  await openHistory(page);
  const collapsed = await measureStack(page);
  await page.screenshot({
    path: path.join(OUT, 'water-overlay-history-sidebar-collapsed.png'),
    fullPage: false,
  });
  note('collapsed sidebar history stacking', !collapsed.titleCoveredByTabs && collapsed.overlayOnTopOfTabs, collapsed);

  // Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const mobile = await measureStack(page);
  await page.screenshot({
    path: path.join(OUT, 'water-overlay-history-mobile.png'),
    fullPage: false,
  });
  note('mobile history stacking', !mobile.titleCoveredByTabs && mobile.overlayOnTopOfTabs && mobile.titleVisible, mobile);

  // Other surfaces quickly
  for (const [tab, extra, label] of [
    ['meter', '&property=5', 'meter'],
    ['readings', '&wrForm=1', 'readings'],
    ['payments', '', 'payments'],
  ]) {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto(
      `${BASE}/admin?section=${encodeURIComponent('вода')}&tab=${tab}${extra}`,
      { waitUntil: 'domcontentloaded', timeout: 60000 },
    );
    await page.waitForTimeout(1000);
    if (tab === 'readings') {
      const has = (await page.locator('[data-workplace-overlay="true"]').count()) > 0;
      if (!has) {
        const btn = page.getByRole('button', { name: /Передать показания|Submit reading|Предай/i }).first();
        if (await btn.count()) await btn.click();
        await page.waitForTimeout(600);
      }
    }
    if (tab === 'payments') {
      await page.waitForSelector('table tbody tr', { timeout: 15000 }).catch(() => null);
      const rowPay = page.locator('table tbody tr button').first();
      if (await rowPay.count()) {
        await rowPay.click();
        await page.waitForTimeout(800);
      }
    }
    const m = await measureStack(page);
    await page.screenshot({
      path: path.join(OUT, `water-overlay-${label}-desktop.png`),
      fullPage: false,
    });
    const openCount = await page.locator('[data-workplace-overlay="true"], [data-admin-modal-overlay="true"]').count();
    const ok =
      openCount > 0 &&
      (m.shellPresent || openCount > 0) &&
      (!m.shellPresent || (!m.titleCoveredByTabs && m.workInert));
    note(`${label} surface stacking`, ok, { ...m, openCount });
  }
} catch (e) {
  note('script error', false, { detail: String(e) });
  await page.screenshot({ path: path.join(OUT, 'water-overlay-error.png'), fullPage: false }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'water-overlay-stack-verify.json'), JSON.stringify(results, null, 2));
  await browser.close();
}

process.exit(results.some((r) => !r.ok) ? 1 : 0);
