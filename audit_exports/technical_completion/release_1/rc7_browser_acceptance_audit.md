# AMADEUS 11 — RC7 Full Browser Acceptance Audit

**Date:** 2026-10-18  
**Target:** `http://localhost:3080` → VPS TEST (SSH tunnel)  
**Supabase:** `zcecvbjjmbhwfjtlyjkt.supabase.co`  
**Release:** `1.0.0-rc7`  
**Administrator:** `zoomconf0001@gmail.com`  
**Method:** Active Cursor browser audit (read-only). No module activation, no business data, no tariff publish, no Email/Debt Gate enable, no deploy/commit.

**Overall verdict: PARTIAL**

RC7 TEST is the correct environment, First Boot session is live, Email Sending is OFF, Meetings/Rental are unavailable, and core admin routes load with safe empty states. Initial Setup and module catalog are **not distribution-ready** for non-technical operators: internal/example modules, adapter/catalog mismatch messaging, dual lifecycle/UX status models, and English/technical keys remain exposed.

---

## 1. Environment verification — PASS

| Check | Result | Evidence |
|-------|--------|----------|
| `/api/health` | PASS | `ok=true`, `release=1.0.0-rc7`, `supabase_host=zcecvbjjmbhwfjtlyjkt.supabase.co`, `supabase_reachable=true`, `email_sending_enabled=false` |
| Port 3080 ownership | PASS | No local Docker app bound to `:3080` (local RC images use `:3081` and other ports). Tunnel/health host matches cloud TEST. |
| Production not used | PASS | Audit used `localhost:3080` only (production tab `amadeus11.online` left untouched). |
| Auth host leakage | PASS | No `127.0.0.1:5xxxx` Auth host in page content during admin session. Cookie jar also contains other project tokens historically, but live health/host is TEST cloud. |

**STOP condition:** not triggered.

---

## 2. First Boot state — PASS

| Check | Result |
|-------|--------|
| Admin session | Authenticated as `zoomconf0001@gmail.com` |
| Initial Setup reachable | `/admin?section=начальная_настройка` |
| Bootstrap | Operator reached Initial Setup (empty inventory / 0 apartments) |
| Password/secrets | Not requested or captured |

---

## 3. Initial Setup — all five steps — PARTIAL

Stepper, Back/Next, and step statuses work. Content is operator-hostile for a universal distribution.

| Step | Status | Finding |
|------|--------|---------|
| 1 Complex Details | PARTIAL | Explains Property Book import path; shows raw `property_book : DISABLED`; no complex identity form (by design). |
| 2 Modules | PARTIAL | Full catalog table with lifecycle/UX/setup columns; includes example + non-R1 entries; warns adapters outside catalog. |
| 3 Finance & Tariffs | PARTIAL | Tariff Core readiness list; English keys (`support_fee`, `internet`, `water`…); correctly states no auto-publish. |
| 4 Notifications | PARTIAL | Email Core card; `email_enabled=false · sending_ready=false`; Reply-To prefilled `reply@example.com`. |
| 5 Readiness | PARTIAL | Repeats module + tariff readiness; states Email Sending / Debt Gate / tariff publish are not auto-enabled. |

**Screenshots:**  
`rc7_browser_audit_assets/01_initial_setup_step1.png`  
`02_initial_setup_modules.png`  
`03_initial_setup_finance.png`  
`04_initial_setup_notifications.png`  
`07_initial_setup_mobile.png`

**Persistent technical copy (all steps):**  
- “ALSYD Module Core”  
- “UX-флаги… не включает `building_modules`”  
Source: `src/i18n/messages.ts` (`is1*` strings), rendered by `src/components/admin/AdminInitialSetup.tsx`.

---

## 4. Eleven mandatory Release 1.0 modules — PARTIAL

Legend: **LC** = Initial Setup lifecycle; **UX** = Settings → Modules; **Menu** = sidebar visibility; **Route** = section loads without fatal error.

| # | Module | Implemented | LC | UX | Menu | Route | Activation path clear? |
|---|--------|-------------|----|----|------|-------|------------------------|
| 1 | Property Book | Yes | DISABLED | (not in UX catalog list observed) | Yes | PASS (`книга`) | PARTIAL — Step 1 deep-link; LC DISABLED but route usable |
| 2 | Water & Electricity | Yes | ACTIVE / ACTIVE | Enabled | Yes | PASS | PASS |
| 3 | UK Budget & Expenses | Yes | Budget ACTIVE; `uk_expenses` DISABLED + adapter-outside-catalog | Budget/expenses reachable | Yes (`Бюджет`, `Расходы УК`) | PASS | PARTIAL — dual naming / LC vs menu |
| 4 | Internet | Yes | DISABLED | Выключен · Реализован | No | Direct URL redirects to Overview (UX gate) | PASS if enable via Settings Modules (not activated in audit) |
| 5 | Tickets & Chat | Yes | ACTIVE | Enabled | Yes (`Заявки` under Operations; `Чат с жильцами`) | PASS | PASS |
| 6 | Ownership Transfer | Yes (platform) | **Absent from Initial Setup catalog table** | Email notify module present | Yes (`смены`) | PASS | PARTIAL — not treated as Initial Setup module |
| 7 | Residence Status | Yes | ACTIVE | (email/notify surface) | Via apartments/book flows | PASS (no fatal) | PARTIAL — not a first-class sidebar leaf |
| 8 | Cleaning | Yes | DISABLED | Выключен · Реализован | No | UX-gated | PASS for disabled state |
| 9 | Support Fee | Yes | ACTIVE | Enabled | Yes | PASS | PASS (tariff readiness not ready — expected) |
| 10 | Capital Repair | Yes | ACTIVE | Enabled | Yes | PASS | PASS |
| 11 | Inventory | Yes | DISABLED | Выключен · Реализован | No | UX-gated | PASS for disabled state |

**Important:** Lifecycle DISABLED ≠ implementation failure. Internet / Cleaning / Inventory show **Реализован** + Выключен in Settings Modules — intended.

**Catalog warning (confirmed):**  
`Зарегистрированные адаптеры вне каталога: example_opening_roster, property_book, uk_expenses`  
Source: Module Core registry vs `module_catalog` / `building_modules` (`src/lib/moduleCore/adapters/exampleOpeningAdapter.ts`, `AdminInitialSetup.tsx`).

---

## 5. Additional / internal modules — grouping proposal

### A. Core business modules (R1 mandatory)
Property Book, Water, Electricity, UK Budget & Expenses, Internet, Tickets & Chat, Ownership Transfer, Residence Status, Cleaning, Support Fee, Capital Repair, Inventory.

### B. Supporting functions
Tariffs, Budget, Reporting, Service blocking, Documents, Announcements, Polls, Guest access, User activation, Staff.

### C. System / internal components
Platform & Support, Access control (if unimplemented), Security settings hub, Email Core config, Initial Setup itself.

### D. Not implemented / unavailable / should not face operators in Initial Setup
| Entry | Classification |
|-------|----------------|
| Пример opening roster (`example_opening_roster`) | **D — remove from admin Initial Setup list** |
| Коммерческая аренда / Аренда | D / R1 unavailable (`Недоступен в R1`) |
| Общие собрания | D / R1 unavailable |
| Парковка, Обслуживание, Контроль доступа, Подрядчики, Общие зоны | D or unimplemented |
| Охрана | Implemented but disabled UX — B/C, not mandatory |

**Do not hide** working Ownership Transfer, Service lock, Tariffs, Platform — they belong in B/C, not as undifferentiated Initial Setup “нужен” peers of example roster.

---

## 6. Settings Hub — PASS (with copy notes)

Tabs present and loadable: Overview, Complex, Modules, Access, Notifications, Finance, Security.

| Area | Result |
|------|--------|
| Overview cards / deep-links | PASS |
| Modules catalog (UX enable/disable + implemented flags) | PASS |
| Notifications | PASS functionally; Email OFF; technical Phase D / Vercel Cron wording |
| Security | PASS — states Meetings/Rental unavailable; Email Sending & Debt Gate separate |
| Duplicate controls | PARTIAL — Initial Setup vs Settings Modules vs lifecycle table (three surfaces) |
| Prior functionality retained | PASS |

**Screenshot:** `05_settings_hub.png`, `06_settings_security.png`

---

## 7. Sidebar navigation — PASS (gated leaves expected)

Soft-nav probe (programmatic click of sidebar leaves) — no fatal JS errors observed:

| Section | Result |
|---------|--------|
| Overview | PASS — empty safe state (0 apartments) |
| Apartments, Property Book, Owner transfer, Service lock | PASS |
| Support Fee, Capital Repair, UK Expenses, Budget, Tariffs, Reporting | PASS |
| Water, Electricity | PASS |
| Tickets, Work orders | PASS |
| Announcements, Polls, Chat | PASS |
| Staff, Platform, User activation, Settings, Initial Setup | PASS |
| Cleaning / Inventory / Security / Internet | Absent from menu while UX off — expected |
| Meetings (`собрания`) | Redirects to Overview — expected R1 hide |

---

## 8. RU / BG / EN — PASS

Locale toggles switch chrome and page titles (e.g. Service lock → Блокиране на услуги → Блокировка услуг). No broken locale crash observed.

---

## 9. Desktop / mobile — PARTIAL

| Viewport | Result |
|----------|--------|
| Desktop 1440×900 | PASS — grouped sidebar, readable hub |
| Mobile 390×844 | PARTIAL — Initial Setup usable; horizontal stepper scrolls; technical copy denser; bottom nav present |

**Screenshot:** `07_initial_setup_mobile.png`

---

## 10. Auth / security — PASS

| Check | Result |
|-------|--------|
| Session persists across soft navigation | PASS |
| Role / admin email shown | `zoomconf0001@gmail.com` |
| Auth not redirected to local Supabase API | PASS (health + live host) |
| Meetings / Rental unavailable | PASS (Settings Security copy + meetings URL strip) |
| Email Sending OFF | PASS (`/api/health` + Email Core flags) |
| Debt Gate OFF / not auto-enabled | PASS (Settings Security states separate enable; no ON control exercised) |

---

## 11. Browser errors / broken routes

| Item | Result |
|------|--------|
| Fatal application errors on probed screens | None observed (`err=false` across soft-nav set) |
| Hard URL to UX-disabled module | Redirects to Overview (by design) |
| Wrong section key `апартаменты` | Redirects — correct key is `квартиры` |
| Automation note | Accessibility `browser_click` sometimes focused without navigating; DOM `.click()` soft-nav worked |

---

## 12. Screenshot evidence

Directory: `audit_exports/technical_completion/release_1/rc7_browser_audit_assets/`

| File | Subject |
|------|---------|
| `01_initial_setup_step1.png` | Step 1 + technical status |
| `02_initial_setup_modules.png` | Module catalog |
| `03_initial_setup_finance.png` | Tariff readiness |
| `04_initial_setup_notifications.png` | Email Core OFF |
| `05_settings_hub.png` | Settings overview |
| `06_settings_security.png` | Security / R1 limits |
| `07_initial_setup_mobile.png` | Mobile Initial Setup |

No secrets or invitation URLs captured.

---

## 13. Confirmed defects (severity)

### P1
1. **Initial Setup exposes internal/example module** (`Пример opening roster`) to administrators.  
   Source: `exampleOpeningAdapter.ts` + Initial Setup catalog render.
2. **Adapter/catalog mismatch banner** for `property_book`, `uk_expenses`, `example_opening_roster` on clean RC7.  
   Affects future clean installs until catalog/registry parity is fixed.
3. **Operator-facing technical jargon** (`ALSYD Module Core`, `building_modules`, raw `property_book : DISABLED`, English tariff keys).  
   Source: `src/i18n/messages.ts` / `AdminInitialSetup.tsx`.
4. **Ownership Transfer missing from Initial Setup module table** while mandatory for R1 — discoverable only via sidebar / email notify modules.

### P2
5. Document title / brand lock **“AMADEUS 11 \| Sunny Beach”** on empty TEST (`src/app/layout.tsx`) — marketing complex name on generic install.
6. Email Reply-To default **`reply@example.com`** on Notifications step.
7. **Three parallel module status models** (lifecycle table, UX Settings Modules, sidebar flags) without a single operator explanation of “how to activate”.
8. Settings Notifications mentions **Phase D / Vercel Cron** — too technical for complex admins.
9. Mobile stepper truncates step labels; dense technical notes reduce Initial Setup readability.

### P0
None confirmed that block basic authenticated admin use of RC7 TEST.

---

## 14. Recommended corrections (main development codebase)

1. **Filter Initial Setup module list** to R1 mandatory + explicitly allowed supporting modules; hide `example_opening_roster` outside non-production/dev flag.
2. **Resolve adapter↔catalog parity** for `property_book` and `uk_expenses` (register in catalog or stop advertising “вне каталога” on clean installs).
3. **Rewrite Initial Setup copy** for operators: remove ALSYD/`building_modules` from default RU/BG/EN strings; localize tariff readiness labels.
4. **Add Ownership Transfer** (and clear Residence Status guidance) to Initial Setup inventory or document as platform-core outside module activation.
5. **Single “Activation” explainer**: one sentence linking Settings Modules UX toggle ↔ lifecycle setup ↔ menu visibility.
6. **Install branding**: title/metadata from complex identity / env, not hard-coded Sunny Beach for universal images.
7. **Email Initial Setup**: empty Reply-To (no `example.com`) when unset.
8. Keep Meetings/Rental unavailable and Email/Debt Gate off by default (already correct).

---

## 15. Implications for final universal distribution

| Topic | Implication |
|-------|-------------|
| Clean install First Boot → Initial Setup | Works, but wizard still reads as internal Module Core tooling |
| Module readiness | Mandatory modules are largely **implemented**; several start DISABLED/UX-off by design — activation UX must be clarified before calling R1 “operator complete” |
| Catalog hygiene | Example + outside-catalog adapters will confuse every new complex until fixed in main repo |
| Branding | Hard-coded Sunny Beach metadata is unsuitable for multi-complex distribution images |
| Security defaults | Email OFF / Meetings & Rental unavailable / Debt Gate not auto-on — **good** for RC7 and should remain the distribution default |

**Distribution readiness for browser UX:** **PARTIAL — not yet final.**  
Fix P1 catalog/copy/activation clarity in the main repository before treating RC7 Initial Setup as the universal operator path.

---

## Audit constraints respected

- TEST only; no production changes  
- Read-only browser interactions  
- No module activation/deactivation  
- No business records / tariff publish  
- No Email Sending or Debt Gate activation  
- No commit / push / Docker rebuild / deploy  
