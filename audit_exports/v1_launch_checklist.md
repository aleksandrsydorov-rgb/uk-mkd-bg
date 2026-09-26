# v1 launch checklist — 10 live modules

Generated: 2026-09-26  
Canon: [`docs/architecture-cores.md`](../docs/architecture-cores.md)  
Baseline after Support Fee Tariff Core cutover (`da40fdf` / migration `20260926060000`).

Legend:
- **CODE** = verified in source (gating + billing wiring)
- **SQL** = verified against production earlier (Support verify/smoke OK)
- **MANUAL** = needs human click-through on pilot building
- **N/A** = not applicable

---

## Platform cores

| Item | Status | Notes |
|------|--------|-------|
| Module Core catalog + toggles | CODE PASS | Settings → modules; stubs non-toggleable |
| Tariff Core admin | CODE PASS | `AdminTariffs`; keys support_fee / water / electricity |
| Architecture canon in repo | CODE PASS | `docs/architecture-cores.md`, `docs/module-template.md` |
| Drift: Support Fee “still legacy” | CODE PASS | Fixed in `src/lib/tariffs.ts` |

---

## Module matrix (launch surfaces)

| module_key | Pattern | Admin gate | Owner gate | Rate / money source | CODE | MANUAL |
|------------|---------|------------|------------|---------------------|------|--------|
| support_fee | Tariff + annual policy | `showSupportFee` | `supportFeeEnabled` | `get_applicable_support_tariff` | PASS | [ ] rate 8; no rate editor; charge/preview |
| capital_repair | Assessment + ledger | `showCapital` + role | `capitalEnabled` | operator `p_amount_eur` (not Tariff Core) | PASS | [ ] assessment + charge + owner balance |
| water | Tariff + mode | `showWater` + role | module ∧ water_mode | `get_applicable_utility_tariff` | PASS | [ ] meters/readings/charge; mode staff/owner |
| electricity | Tariff + mode | `showElectricity` | module ∧ electricity_mode | `get_applicable_utility_tariff` | PASS | [ ] meters/readings/finance; mode |
| requests | Ops | `showRequests` + role | `requestsEnabled` | N/A | PASS | [ ] create → staff → WO path |
| chat | Comms | `showChat` + role | `chatEnabled` | N/A | PASS | [ ] owner/staff thread |
| polls | Comms | `showPolls` | `pollsEnabled` | N/A | PASS | [ ] create/vote/close |
| announcements | Comms | `showAnnouncements` | `announcementsEnabled` | N/A | PASS | [ ] publish → owner sees |
| general_meeting | Docs | `showGeneralMeeting` | `generalMeetingEnabled` | N/A | PASS | [ ] workflow steps |
| building_documents | Docs | `showBuildingDocuments` | `buildingDocumentsEnabled` | N/A | PASS | [ ] upload/list |

### Toggle-off sanity (MANUAL for each)

When module disabled in Settings:
- [ ] Admin nav entry disappears
- [ ] Owner nav/tab disappears or redirects away
- [ ] No orphaned overview cards for that module

---

## Phase 2 — Finance pass (CODE)

| Module | Wiring check | Result |
|--------|--------------|--------|
| support_fee | Admin/account load `get_applicable_support_tariff`; `annualSupportFee` null-safe; no operational `DEFAULT_SUPPORT_RATE` | PASS |
| support_fee | SQL verify 2026/8.0000 + smoke free-year window | SQL PASS (2026-09-26) |
| water | AdminWater + OwnerUtilities + account use `get_applicable_utility_tariff` | PASS |
| electricity | AdminElectricityFinance + account use `get_applicable_utility_tariff` | PASS |
| capital_repair | `charge_capital_repair` / bulk; not in `TARIFF_KEYS` | PASS |

## Phase 2 — Comms / docs / ops pass (CODE)

| Module | Admin `isBuildingModuleEnabled` | Owner gate | Result |
|--------|--------------------------------|------------|--------|
| requests | yes (+ role) | yes | PASS |
| chat | yes (+ role) | yes | PASS |
| polls | yes | yes | PASS |
| announcements | yes | yes | PASS |
| general_meeting | yes | yes | PASS |
| building_documents | yes | yes | PASS |

---

## Platform services (not modules) — smoke only

| Service | Expected | MANUAL |
|---------|----------|--------|
| UK expenses | Always available by role; not module-gated | [ ] |
| Work orders | Role-gated; linked from requests; not module_key | [ ] |
| Tariffs admin | Visible when Tariff Core role allows | [ ] |
| Staff / settings | Always for admin roles | [ ] |

---

## Stubs (must stay inert)

| Check | Status |
|-------|--------|
| 11 stubs `implemented=false` | CODE PASS |
| Settings shows stubs but no enable toggle | CODE PASS |
| No stub product sections in admin/owner | CODE PASS |
| No accidental tariff_catalog rows for stubs | CODE PASS (only 3 keys) |

---

## Known accepted gaps (v1)

1. Module flag is UX-only; RPC security package later.
2. Capital not in Tariff Core (correct domain split).
3. Expenses / work orders are platform services, not toggles.
4. Fresh “NEW COMPLEX = NEW DATABASE” still blocked (`supabase/README.md`).

---

## Sign-off

| Gate | Result |
|------|--------|
| Architecture + template docs | DONE |
| CODE matrix (10 modules) | PASS |
| SQL support_fee | PASS |
| MANUAL pilot walkthrough | PENDING (checklist boxes above) |

When all MANUAL boxes are checked on the pilot building → **v1 launch READY**.
