# AMADEUS 11 — IS-7 Initial Data Coverage  
## Remaining Modules Inventory (READ ONLY)

**Date:** 2026-10-15  
**Repository:** uk-mkd-bg · **Branch:** main (`bbdf52a` tip; feat `a2b5bc7`)  
**Supabase:** `klowacuvufknbrkayjhz`  
**Production:** https://amadeus11.online  
**Mode:** READ ONLY — no code, migration, import, module, email, or debt-gate changes  

**Baseline:** IS-1–IS-6a released · 261 tests · Email OFF · Debt gate OFF  

**Sources:** `src/lib/modules.ts`, `src/lib/moduleCore/bootstrap.ts`, live `module_catalog` + `building_modules`, prior IS-2…IS-6a phase/audit docs, admin surfaces.

---

## RETURN scorecard

| # | Item | Result |
|---|------|--------|
| 1 | Registered modules reviewed | **27** catalog keys (live) + **3** platform-service setup keys (`property_book`, `uk_expenses`, example) + **1** non-module platform area (`staff`) |
| 2 | Coverage matrix | §3 (A/B/C/D/E) |
| 3 | New adapters still needed | **Capital repair opening** (if product locks inventarisation) · optional **Tariffs setup gate** · optional **Budget plan seed** · optional **Security posts/staff checklist** |
| 4 | Manual setup suffices | Budget, building_documents (thin confirm already), security posts, cleaning ops, staff, platform_support, user_activation, Tariff Core rate entry |
| 5 | Can start empty | Chat, requests, announcements, polls, guest_mode, service_lock, general_meeting (ops), cleaning orders, parcels |
| 6 | Genuine product decisions | Q-CR capital opening · Q-TARIFF setup adapter vs manual · Q-BUDGET plan inventarisation · Q-STAFF bootstrap · Q-STUBS when to implement · Q-AP = IS-6b timing |
| 7 | Fresh-install blockers | **IS-3 DDL packaging gap** (properties/meters not created by `migrations/` alone) · Tariffs must be publishable before SF/Internet charge paths · Property Book before meters/SF/Internet |
| 8 | Recommended next phase | **IS-7a distributive readiness:** migrate DDL packaging proposal + tariffs activation gate; then **capital_repair opening decision**; defer IS-6b |
| 9 | Overall Initial Setup coverage | **Core finance/utilities opening path largely covered (Book→meters→SF→Internet→optional expenses).** Remaining = capital opening?, tariff/budget/staff soft gates, stubs, deferred E2E, fresh-install DDL. |

---

## Classification legend

| Code | Meaning |
|------|---------|
| **A** | Initial data adapter **REQUIRED** (inventarisation / opening SoT) |
| **B** | Initial data adapter **OPTIONAL** |
| **C** | Existing **manual** admin / thin confirm sufficient |
| **D** | Can **start empty** (no opening inventarisation) |
| **E** | **Blocked** / needs product decision / domain missing / stub |

**Rule:** UI loading alone ≠ complete. Covered by IS-2…IS-6a only when adapter + (where applicable) DB opening path exists.

---

## 1. What is already covered (IS-2…IS-6a)

| Key / area | Type | Adapter | Status |
|------------|------|---------|--------|
| `property_book` | Platform-service setup | IS-2 XLSX + Book RPCs | **Done (A)** |
| `water` | Module | IS-3 assign inventory | **Done (A)** — opening **reading rows BLOCKED** |
| `electricity` | Module | IS-3 assign inventory | **Done (A)** — opening **reading rows BLOCKED** |
| `support_fee` | Module | IS-4 opening RPC | **Done (A)** — live inventarisation E2E deferred |
| `internet` | Module | IS-5 opening RPC | **Done (A)** — live inventarisation E2E deferred |
| `uk_expenses` | Platform-service setup | IS-6a optional opening | **Done (B)** — live import E2E deferred |

Registered thin metadata (no inventarisation importer):

| Key | `requiresInitialSetup` | Note |
|-----|------------------------|------|
| `guest_mode` | false | May DISABLED → READY |
| `chat` | false | |
| `requests` | false | |
| `announcements` | false | |
| `building_documents` | **true** | Manual confirm only — not XLSX inventarisation |

---

## 2. Live catalog snapshot (`klowacuvufknbrkayjhz`)

**27** `module_catalog` rows. Implemented+enabled on this complex (19):  
`requests`, `chat`, `polls`, `announcements`, `service_lock`, `general_meeting`, `building_documents`, `tariffs`, `budget`, `platform_support`, `user_activation`, `security`, `cleaning`, `guest_mode`, `support_fee`, `capital_repair`, `water`, `electricity`, `internet`.

**Stubs** (`implemented=false`, enabled=false):  
`rental`, `commercial_rentals`, `maintenance`, `access_control`, `parking`, `contractors`, `inventory`, `common_areas`.

**Not in catalog but in Initial Setup registry:** `property_book`, `uk_expenses` (+ example roster).

**Not a module:** Staff (`staff` table + Admin «Персонал») — platform identity for roles.

**Not found as registered module:** Partner advertising / partner marketplace (no catalog key). Related commercial stubs only.

---

## 3. Coverage matrix (remaining + covered for completeness)

### 3.1 Finance / utilities / Book

| Area | Impl | Initial data? | Manual admin? | XLSX today? | Class | Notes |
|------|------|---------------|---------------|-------------|-------|-------|
| Property Book | yes (svc) | **Yes** — apartments/owners | Yes | IS-2 | **A done** | Fresh-install prerequisite for meters/SF/Internet |
| Tariffs (Tariff Core) | yes | **Config yes** — published versions | Yes (`AdminTariffs`) | No opening adapter | **B / C** | Not historical inventarisation; **activation gate** for IS-4/5/utilities. Prefer thin “tariffs published” confirm (**B**) or pure manual (**C**) |
| Support Fee | yes | Opening balances | Yes + IS-4 | IS-4 | **A done** | |
| Capital repair | yes | **Maybe** opening assessments/debts | Yes (assess/pay UI) | **No** opening adapter | **E → A if locked** | Analogous to SF; no `import_capital_*`. Product must decide inventarisation vs start empty (**D** ops) |
| Water / Electricity | yes | Meter inventory **yes**; readings **no** | Yes | IS-3 assign | **A done** | Readings inventarisation still **BLOCKED** |
| Internet | yes | Opening subs/balances | Yes + IS-5 | IS-5 | **A done** | |
| UK expenses | svc | Historical optional | Yes + IS-6a | IS-6a | **B done** | AP = IS-6b **E** |
| Budget | yes | Plan lines optional; categories seeded | Yes (`AdminBudget`) | No | **C** | Fact isolation from opening expenses = IS-6a. Plan seed ≠ payables |

### 3.2 Communication / documents

| Area | Impl | Initial data? | Manual? | XLSX? | Class | Notes |
|------|------|---------------|---------|-------|-------|-------|
| Requests | yes | No | Yes | No | **D** | Metadata adapter: no setup required |
| Chat | yes | No | Yes | No | **D** | |
| Announcements | yes | No | Yes | No | **D** | |
| Polls | yes | No | Yes | No | **D** | Create after go-live |
| Service lock | yes | No | Yes | No | **D** | Operational locks |
| General meeting | yes | Historical meetings usually **no** | Yes | No | **D** | Legal packages/docs are separate from inventarisation |
| Building documents | yes | Archive may matter | Yes upload | Thin confirm only | **C** | Already `requiresInitialSetup: true` metadata — **not** a bulk inventarisation adapter |

### 3.3 Services / platform

| Area | Impl | Initial data? | Manual? | XLSX? | Class | Notes |
|------|------|---------------|---------|-------|-------|-------|
| Guest mode | yes | No | Yes | No | **D** | |
| Cleaning | yes | Orders start empty | Yes | No | **D** | Apartment cleaning orders; complex cleaning via requests |
| Security | yes | Posts/shifts **config**; parcels ops empty | Yes | No | **C** | Parcel/handover is operational (**D**). Optional checklist adapter (**B**) for posts |
| Platform support | yes (core) | Installation SaaS config | Master/ops | No | **C** | Not complex inventarisation |
| User activation | yes (core) | Invites after Book/users | Yes | No | **C** | Depends on Book + auth; not opening ledger |
| **Staff** (non-module) | — | At least one admin + roles | `admin_upsert_staff` | No | **C / E** | First-admin bootstrap may be Control/install concern (**E** if distributive must define it) |

### 3.4 Unimplemented stubs

| Area | Impl | Class | Notes |
|------|------|-------|-------|
| Parking, maintenance, access_control, contractors, inventory, common_areas, rental, commercial_rentals | false | **E** (stub) | Do **not** build Initial Setup adapters until `implemented=true`. When promoted: re-run coverage |

### 3.5 Explicit non-modules / deferred domains

| Area | Class | Notes |
|------|-------|-------|
| Partner advertising / partner services | **E** / N/A | No catalog module discovered |
| Accounts Payable / suppliers (IS-6b) | **E** | Domain absent; deferred after IS-6a |
| Work orders / tasks | Platform | Start empty (**D**); assignment needs staff (**C**) |

---

## 4. Historical vs operational (remaining gaps)

| Domain | Historical / opening | Operational after launch |
|--------|----------------------|---------------------------|
| Capital repair | Opening unpaid/partial assessments — **no adapter** | Admin assess/pay |
| Tariffs | Prior published rates → Tariff Core versions (manual) | Publish new versions |
| Budget | Opening expenses → IS-6a; plan year → AdminBudget | Day-2 expenses + adjustments |
| Documents | Prior PDF archive → manual upload | Ongoing uploads |
| Security posts | Prior post roster → manual | Shifts/parcels |
| Staff | Prior employees → manual staff UI | Role/capability updates |
| Polls / meetings / chat / requests | Rarely inventarised | Create as needed |
| Meter readings | Still **BLOCKED** in IS-3 | `submit_*` after go-live |

---

## 5. Deferred technical limitations (track explicitly)

| Item | Status |
|------|--------|
| IS-3 fresh-install DDL gap (`properties` / meters not in `migrations/` alone) | **Open** — `is_3_migration_packaging_proposal.md` |
| IS-3 standalone historical reading import | **BLOCKED** — no charge-free opening reading path |
| IS-4 / IS-5 live inventarisation E2E on production | **Deferred** (Safe Release used synthetic dry-run) |
| IS-6a live import E2E | **Deferred** (`uk_expenses` still 0) |
| Browser XLSX upload→preview coverage | **Limited** (download/classify covered; full upload injection constrained) |
| IS-6b Accounts Payable | **Deferred** — separate domain + adapter |

---

## 6. Fresh-install vs legacy import

| Need | Fresh distributive | Legacy transition (this complex class) |
|------|--------------------|----------------------------------------|
| Book | IS-2 required | IS-2 |
| Tariffs published | Soft gate before charges | Soft gate |
| Meters assign | IS-3 after Book | IS-3 |
| Opening readings | Still blocked | Still blocked |
| SF / Internet opening | IS-4 / IS-5 if balances exist | IS-4 / IS-5 |
| Expenses history | Optional IS-6a | Optional IS-6a |
| Capital opening | Product | Product |
| Baseline DDL packaging | **Blocker for empty Supabase** | N/A (already applied historically) |
| Staff first admin | Install/Control bootstrap | Manual staff UI |

---

## 7. Recommended implementation order

1. **Distributive DDL packaging** (IS-3 proposal) — unblock greenfield `migrations/`-only installs.  
2. **Tariffs activation gate** — thin Module Core confirm or documented manual checklist before SF/Internet ACTIVE charges (**B/C**).  
3. **Product lock: capital_repair opening** — if yes → IS-7b capital inventarisation (mirror IS-4 patterns, own ledger kinds); if no → document **D**.  
4. **Budget plan** — keep **C** (AdminBudget); optional metadata `requiresInitialSetup` only if product wants lifecycle READY gate.  
5. **Staff + security posts** — checklist / ops runbook (**C**); optional thin adapter (**B**).  
6. **building_documents** — keep existing thin confirm (**C**); no bulk inventarisation unless product asks.  
7. Close deferred **live E2E** for IS-4/5/6a when authorized (not new adapters).  
8. **IS-6b AP** only after domain design — after remaining launch-critical items above.  
9. Stub modules — ignore until promotion.

**Suggested next named phase:** **IS-7a — Distributive readiness (DDL packaging + tariffs gate)**, not IS-6b.

---

## 8. Product decisions (genuine)

| ID | Decision |
|----|----------|
| **Q-CR** | Inventarise capital_repair opening balances at transition? (→ adapter **A**) or start empty (**D**)? |
| **Q-TARIFF** | Thin Initial Setup “tariffs published” adapter (**B**) vs Tariff Core manual only (**C**)? |
| **Q-BUDGET** | Require adopted budget year before READY, or leave fully optional (**C/D**)? |
| **Q-STAFF** | Who creates the first `администрация` on a fresh install (Control vs in-app)? |
| **Q-DOCS** | Is building_documents manual confirm enough, or bulk archive inventarisation? |
| **Q-SEC** | Must security posts exist before ACTIVE, or create later (**C/D**)? |
| **Q-AP** | When to schedule IS-6b (suppliers/AP)? |
| **Q-STUBS** | Priority order for parking/access/contractors/etc. (no adapters until implemented) |

---

## 9. Safety observed

- Read-only catalog query only  
- No application changes, migrations, imports, commits, pushes, deploys  
- Email sending OFF · Debt gate OFF  

---

## STOP

IS-7 coverage inventory complete. No implementation in this phase.
