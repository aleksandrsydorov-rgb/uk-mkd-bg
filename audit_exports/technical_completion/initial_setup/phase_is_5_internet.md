# AMADEUS 11 — Phase IS-5  
## Internet Initial Data Adapter — Implementation

**Date:** 2026-10-14  
**Repository:** uk-mkd-bg  
**Branch:** main (local implementation only — **not committed / not pushed / not deployed**)  
**Supabase:** `klowacuvufknbrkayjhz` (**migration prepared, not applied**)  
**Production:** https://amadeus11.online  
**Baseline:** IS-1 Core · IS-2 Property Book · IS-3 meters · IS-4 Support Fee · Internet module · Email OFF · Debt gate OFF  
**Audit:** `is_5_internet_audit.md` (PARTIAL)  
**Approved product decisions:** Q1–Q5 (one opening sub/apt; paid-through → next_charge_on; Internet opening_debit/credit; SKIP identical / CONFLICT mismatch; block pending Internet WOs)

---

## Scorecard (RETURN)

| # | Item | Result |
|---|------|--------|
| 1 | Internet adapter implemented | **YES** |
| 2 | Opening subscription RPC implemented | **YES** |
| 3 | Paid-through and next_charge_on safety | **PASS** |
| 4 | Opening debt | **PASS** |
| 5 | Opening credit | **PASS** |
| 6 | XLSX template ready | **YES** |
| 7 | Preview / validation | **PASS** |
| 8 | Idempotency / concurrency | **PASS** |
| 9 | Pending work-order protection | **PASS** |
| 10 | No synthetic payments / charges | **PASS** |
| 11 | Migration filename | `20261024120000_is5_internet_opening_state.sql` |
| 12 | Tests / build | **PASS** — `npm test` 250/250; `tsc --noEmit` PASS; `npm run build` PASS |
| 13 | Existing business data unchanged | **YES** (no migration apply; no live import; no module/email/debt/cron changes) |
| 14 | Remaining technical blockers | DB Safe Release (apply migration + staged dry-run); published Internet tariff required at commit; packaging gap: migration not yet in release train |
| 15 | Ready for Database Release | **YES** (local complete; release **not** performed) |

---

## Opening mechanism (Q1–Q5 → canonical path)

| Decision | Representation |
|----------|----------------|
| Q1 one opening sub / apartment | Insert into `internet_subscriptions` only when none exists; statuses `active` \| `inactive` only |
| Q2 paid-through | Declared date → `next_charge_on = internet_next_charge_on(paid_through, billing_day)`; must be **strictly after** Sofia today (`internet_next_charge_after_paid_through`) — no payment rows, no immediate cron fire |
| Q3 opening debt / credit | Append-only `internet_ledger` kinds `opening_debit` / `opening_credit`; `get_internet_balance` includes them; **not** Support Fee RPCs |
| Q4 existing subscription | Identical prior opening → SKIP; any other existing sub/ledger → CONFLICT; never overwrite; never `request_internet_connect` |
| Q5 pending WO | `work_orders` with `internet_action IS NOT NULL` and status `open`/`in_progress` → conflict / BLOCKED |

### Canonical objects written (inventarisation only)

1. `internet_subscriptions` — schedule + `opening_import=true` + paid-through audit columns  
2. `internet_ledger` — `opening_debit` / `opening_credit` only (never `payment` / `charge` in this path)  
3. `internet_opening_imports` — idempotency key + unique property audit  

### Explicitly not written

- No `request_internet_connect` / connect workflow  
- No `work_orders` inserts  
- No `internet_ledger.kind = 'payment'` or synthetic historical charges  
- No invoices / Email Core / debt gate  
- No automatic module activation  

---

## What was implemented

### Database (prepared only)

- `supabase/migrations/20261024120000_is5_internet_opening_state.sql`
  - Opening columns on `internet_subscriptions`
  - Ledger kind CHECK extended with `opening_debit` / `opening_credit`
  - Table `internet_opening_imports` (idempotency + property uniqueness, RLS staff select)
  - Updated `get_internet_balance` for opening kinds
  - Helper `internet_next_charge_after_paid_through`
  - RPC `import_internet_opening_state` — `администрация` only, `search_path=''`, transactional, conflict-safe

### Adapters / commit

- `src/lib/moduleCore/adapters/internetOpening.ts` — validate, classify CREATE/SKIP/CONFLICT/ERROR, paid-through→next_charge, XLSX template + error report  
- `src/lib/moduleCore/adapters/internetOpeningAdapter.ts` — moduleKey `internet`  
- `src/lib/moduleCore/adapters/internetImportCommit.ts` — per-row RPC commit, stop-on-FAILED, retry merge, audit payload  
- Registered in `bootstrap.ts`; exported from `index.ts`

### Admin UI + i18n

- `AdminInitialSetup.tsx` — Internet template, preview, confirm → RPC, retry FAILED/NOT_PROCESSED  
- BG/RU/EN `admin.is5*` keys in `src/i18n/messages.ts`

### Types

- `src/lib/database.types.ts` — `internet_opening_imports`, subscription opening columns, `import_internet_opening_state`

### Tests

- `tests/security/unit/moduleCoreIs5Internet.test.ts` — registration, migration safety, paid-through/month boundaries/cron block, debt/credit, WO block, SKIP/CONFLICT, retry, no synthetic payments/WOs, template, ownership transfer policy hook

---

## XLSX template

Sheet `subscriptions` columns:

`apartment_number`, `tariff_code`, `status`, `connection_date`, `transition_date`, `paid_through`, `opening_debt`, `opening_credit`, `source_reference`, `notes`

Plus `instructions_bg` / `instructions_ru` / `instructions_en` and examples.  
`schema_version`: `1.0`. Tariff code must be canonical `internet`. Spoofed `property_id` / `tariff_version_id` rejected.

---

## Preview / commit safety

| Rule | Behavior |
|------|----------|
| Preview | Classify only — **never** writes Internet data |
| Apartment match | Property Book lookup; rejects spoofed `property_id` |
| Tariff | Canonical Tariff Core `internet` published version required |
| Paid-through (active) | Required; next_charge_on must be after Sofia today |
| Existing subscription | CONFLICT (manual reconcile) |
| Identical prior opening | SKIP (idempotent) |
| Pending Internet WO | BLOCKED |
| Commit | Sequential `import_internet_opening_state`; per-row outcomes |
| Partial batch | Never reported as full success; retry only FAILED/NOT_PROCESSED |
| Auth | DB enforces administration role |

---

## Safety observed this phase

- Migration **not** applied  
- No real Internet subscription / ledger imports  
- No billing cron triggered  
- No Internet work orders created  
- No module state changes on production  
- No Email Core / debt gate changes  
- No commit / push / deploy  
- Existing AMADEUS business data untouched  

---

## Remaining blockers (for Safe Release, not for local IS-5 close)

1. Apply `20261024120000_is5_internet_opening_state.sql` via approved DB release process (not done here).  
2. Staged dry-run / controlled import on non-production before production inventarisation.  
3. Published Internet tariff + Property Book readiness remain operational gates (adapter does not auto-activate).  
4. Apartments with unfinished Internet WOs or any existing subscription/ledger require manual reconciliation before inventarisation.

---

## STOP

Local IS-5 implementation, tests, and report complete.  
**Do not** apply migrations, commit, push, or deploy from this phase.
