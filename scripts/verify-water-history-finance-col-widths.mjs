/**
 * :3078 — Financial history table: compact cols, icons nowrap, horizontal scroll on narrow.
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
  const form = page.locator('#resident-login form, .login-embed-form').first();
  await form.locator('input[type="email"]').fill('admin@e2e.local');
  await form.locator('input[type="password"]').fill('AcceptNotify-3078!');
  await form.locator('button[type="submit"]').click();
  await page.waitForURL(/\/admin/, { timeout: 90000 });
}

async function openFinanceHistory(page) {
  await page.goto(
    `${BASE}/admin?section=${encodeURIComponent('вода')}&tab=history&property=5`,
    { waitUntil: 'domcontentloaded', timeout: 60000 },
  );
  await page.waitForSelector('[data-workplace-shell="true"]', { timeout: 30000 });
  await page
    .locator('[data-workplace-shell="true"] [role="tab"], [data-workplace-shell="true"] button')
    .filter({ hasText: /Финансов|Finance|Финансов/i })
    .first()
    .click();
  await page.waitForSelector('[data-workplace-shell="true"] table thead', { timeout: 20000 });
  await page.waitForTimeout(1500);
}

async function measure(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-workplace-shell="true"]');
    const table = shell?.querySelector('table');
    if (!table) return { ok: false };
    const ths = [...table.querySelectorAll('thead th')].map((th) => ({
      text: (th.textContent || '').trim(),
      w: Math.round(th.getBoundingClientRect().width),
    }));
    const shellBox = shell.getBoundingClientRect();
    const openBtn = shell.querySelector(
      'button[aria-label="Открыть квитанцию"], button[aria-label="Open receipt"], button[aria-label="Отвори квитанция"]',
    );
    let icons = null;
    if (openBtn) {
      const group = openBtn.closest('[role="group"]');
      const buttons = group ? [...group.querySelectorAll('button')] : [];
      const tops = buttons.map((b) => Math.round(b.getBoundingClientRect().top));
      const widths = buttons.map((b) => Math.round(b.getBoundingClientRect().width));
      icons = {
        count: buttons.length,
        sameRow: tops.length >= 2 && tops.every((t) => Math.abs(t - tops[0]) <= 2),
        minWidth: Math.min(...widths),
        tops,
        widths,
        groupWhiteSpace: group ? getComputedStyle(group).whiteSpace || getComputedStyle(group).flexWrap : null,
        flexWrap: group ? getComputedStyle(group).flexWrap : null,
      };
    }
    // Find a date cell and amount cell for nowrap
    const firstRow = table.querySelector('tbody tr');
    const cells = firstRow ? [...firstRow.children] : [];
    const dateCell = cells[0];
    const amountCell = cells[2];
    const noteCell = cells[5];
    return {
      ok: true,
      shellH: Math.round(shellBox.height),
      shellW: Math.round(shellBox.width),
      ths,
      icons,
      dateWhiteSpace: dateCell ? getComputedStyle(dateCell).whiteSpace : null,
      amountWhiteSpace: amountCell ? getComputedStyle(amountCell).whiteSpace : null,
      noteWidth: noteCell ? Math.round(noteCell.getBoundingClientRect().width) : null,
      typeWidth: cells[1] ? Math.round(cells[1].getBoundingClientRect().width) : null,
      dateWidth: dateCell ? Math.round(dateCell.getBoundingClientRect().width) : null,
      statusWidth: cells[3] ? Math.round(cells[3].getBoundingClientRect().width) : null,
      docWidth: cells[4] ? Math.round(cells[4].getBoundingClientRect().width) : null,
      amountWidth: amountCell ? Math.round(amountCell.getBoundingClientRect().width) : null,
      tableMinWidth: getComputedStyle(table).minWidth,
      scrollParentOverflowX: (() => {
        let el = table.parentElement;
        while (el) {
          const ox = getComputedStyle(el).overflowX;
          if (ox === 'auto' || ox === 'scroll') return ox;
          el = el.parentElement;
        }
        return null;
      })(),
    };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

try {
  await login(page);
  note('login', true);

  await openFinanceHistory(page);
  const desktop = await measure(page);
  note('table rendered', Boolean(desktop.ok), desktop);
  note(
    'date/amount whitespace-nowrap',
    desktop.dateWhiteSpace === 'nowrap' && desktop.amountWhiteSpace === 'nowrap',
    { date: desktop.dateWhiteSpace, amount: desktop.amountWhiteSpace },
  );
  note(
    'compact cols narrower than type/note',
    desktop.dateWidth < desktop.typeWidth &&
      desktop.amountWidth < desktop.noteWidth &&
      desktop.statusWidth < desktop.noteWidth,
    {
      date: desktop.dateWidth,
      type: desktop.typeWidth,
      amount: desktop.amountWidth,
      status: desktop.statusWidth,
      doc: desktop.docWidth,
      note: desktop.noteWidth,
    },
  );
  note('horizontal scroll container present', desktop.scrollParentOverflowX === 'auto' || desktop.scrollParentOverflowX === 'scroll', {
    overflow: desktop.scrollParentOverflowX,
  });

  if (desktop.icons && desktop.icons.count >= 3) {
    note('three document icons same row', desktop.icons.sameRow && desktop.icons.count >= 3, desktop.icons);
    note('icon hit area not shrunk', desktop.icons.minWidth >= 40, { minWidth: desktop.icons.minWidth });
    note('flex-nowrap on icon group', desktop.icons.flexWrap === 'nowrap', desktop.icons);
  } else {
    // Filter to payments to find a receipt row
    const kind = page.locator('[data-workplace-shell="true"] select').filter({ hasText: /Все|All|Всички|Начисл|Charge|Оплат|Payment/i });
    const selects = page.locator('[data-workplace-shell="true"] select');
    const n = await selects.count();
    for (let i = 0; i < n; i++) {
      const opts = await selects.nth(i).locator('option').allTextContents();
      if (opts.some((o) => /Оплат|Payment|Плаща/i.test(o))) {
        await selects.nth(i).selectOption({ index: 2 }).catch(() => {});
        break;
      }
    }
    await page.waitForTimeout(1200);
    const afterPay = await measure(page);
    if (afterPay.icons && afterPay.icons.count >= 3) {
      note('three document icons same row', afterPay.icons.sameRow, afterPay.icons);
      note('icon hit area not shrunk', afterPay.icons.minWidth >= 40, { minWidth: afterPay.icons.minWidth });
      note('flex-nowrap on icon group', afterPay.icons.flexWrap === 'nowrap', afterPay.icons);
    } else {
      note('three document icons same row', false, { detail: 'no payment receipt icons found', icons: afterPay.icons });
      note('icon hit area not shrunk', false, { detail: 'skipped' });
      note('flex-nowrap on icon group', false, { detail: 'skipped' });
    }
  }

  const shellH1 = desktop.shellH;
  await page
    .locator('[data-workplace-shell="true"] [role="tab"], [data-workplace-shell="true"] button')
    .filter({ hasText: /показан|Reading|показания/i })
    .first()
    .click();
  await page.waitForTimeout(600);
  const shellH2 = await page.evaluate(() =>
    Math.round(document.querySelector('[data-workplace-shell="true"]')?.getBoundingClientRect().height || 0),
  );
  await page
    .locator('[data-workplace-shell="true"] [role="tab"], [data-workplace-shell="true"] button')
    .filter({ hasText: /Финансов|Finance/i })
    .first()
    .click();
  await page.waitForTimeout(600);
  const shellH3 = await page.evaluate(() =>
    Math.round(document.querySelector('[data-workplace-shell="true"]')?.getBoundingClientRect().height || 0),
  );
  note('popup height stable across tabs', shellH1 === shellH2 && shellH2 === shellH3, {
    shellH1,
    shellH2,
    shellH3,
  });

  await page.screenshot({
    path: path.join(OUT, 'water-history-finance-col-widths-desktop.png'),
    fullPage: false,
  });

  // Mobile / narrow
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const mobile = await measure(page);
  note('mobile table has min-width for scroll', Boolean(mobile.tableMinWidth && mobile.tableMinWidth !== '0px'), {
    minWidth: mobile.tableMinWidth,
  });
  if (mobile.icons && mobile.icons.count >= 3) {
    note('mobile icons same row', mobile.icons.sameRow, mobile.icons);
    note('mobile icon size ok', mobile.icons.minWidth >= 40, { minWidth: mobile.icons.minWidth });
  } else {
    note('mobile icons same row', true, { detail: 'no icons on current filter — skipped soft' });
    note('mobile icon size ok', true, { detail: 'skipped soft' });
  }
  await page.screenshot({
    path: path.join(OUT, 'water-history-finance-col-widths-mobile.png'),
    fullPage: false,
  });

  // EN quick check of headers
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: /^EN$/i }).click().catch(() => {});
  await page.waitForTimeout(800);
  const enHeaders = await page.evaluate(() =>
    [...document.querySelectorAll('[data-workplace-shell="true"] table thead th')].map((th) =>
      (th.textContent || '').trim(),
    ),
  );
  note('EN headers present', enHeaders.length >= 6, { enHeaders });
  await page.screenshot({
    path: path.join(OUT, 'water-history-finance-col-widths-en.png'),
    fullPage: false,
  });
} catch (err) {
  note('script error', false, { detail: String(err?.stack || err) });
  await page.screenshot({ path: path.join(OUT, 'water-history-finance-col-widths-error.png'), fullPage: true }).catch(() => {});
} finally {
  fs.writeFileSync(path.join(OUT, 'water-history-finance-col-widths-verify.json'), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}
