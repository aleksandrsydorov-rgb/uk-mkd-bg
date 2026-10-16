# AMADEUS 11 — MTR-5  
## Meter Reading Correction Admin UI

**Date:** 2026-10-16  
**Repository:** uk-mkd-bg · **Branch:** `main`  
**Cloud:** unchanged — **no writes / migrations / deploy**  
**Mode:** Local implementation + unit acceptance · **no** commit/push  

**Reference:** `phase_mtr_4_final_acceptance.md` (P1 correction UI gap)

---

## RETURN scorecard

| Item | Result |
|------|--------|
| Water correction UI | **PASS** |
| Electricity correction UI | **PASS** |
| Admin authorization | **PASS** |
| Financial safety | **PASS** |
| BG/RU/EN | **PASS** |
| Tests/build | **403/403** · `tsc` PASS · `build` PASS |
| Local browser | **BLOCKED** (no authenticated isolated admin session on disposable local) |
| Remaining blockers | None for MTR-5 UI shipping; browser smoke deferred |
| Ready for safe release | **YES** (with MTR-2…MTR-4 package/migrations already listed in MTR-4 §9; MTR-5 is app/i18n/tests only) |

---

## 1. Implementation

### Shared panel
- `src/components/admin/AdminMeterCorrectionPanel.tsx` — original summary, new value(s), mandatory reason, confirm checkbox, charge impact note, submit/cancel.

### Water (`AdminWater.tsx`)
- Correct action on **latest active** reading for the active meter.
- Calls `correct_water_reading` only (idempotency key rotated on success).
- Uncharged: admin/engineer (active). Charged: **admin only** (`canCorrectWaterReading`).
- Estimated delta when `charge_amount_eur > 0` via `estimateWaterCorrectionDeltaEur` (same formula as RPC); always notes server confirms.
- Uncharged: explicit “no financial adjustment” copy.
- Reloads readings + ledger/balance after success.

### Electricity (`admin/page.tsx`)
- Correct on latest active day/night pair (`latestCorrectableElectricityPair`).
- `pairElectricityReadings` now exposes `day_reading_id` / `night_reading_id` / `status`.
- On open: loads matching `electricity_charges` row for charged detection + optional estimate; admin-only if charged.
- Calls `correct_electricity_reading` only.
- Without charge tariffs: shows server-side impact message (no invented amount).

### Auth / owners
- Owner surfaces (`OwnerUtilities`, `OwnerElectricity`) do **not** call correction RPCs.
- Accountant cannot correct water meters; engineer blocked on charged path (client + RPC).
- Server-side enforcement unchanged (MTR-3 / MTR-3F RPCs).

### Financial safety
- No direct `water_readings` / `meter_readings` updates from UI.
- No parallel ledger inserts from UI.
- No rewrite of charges/payments — adjustments remain RPC-only.

### i18n
- New `admin.meterCorrection*` + `admin.errCorrection*` keys in **RU / EN / BG**.

### Helpers
- `src/lib/utilities.ts` — `canCorrectWaterReading`, `waterReadingHasCharge`, `estimateWaterCorrectionDeltaEur`, correction error keys in `mapAdminRpcError`.
- `src/lib/electricity.ts` — `canCorrectElectricityReading`, pair IDs, `latestCorrectableElectricityPair`, `estimateElectricityCorrectionDeltaEur`.

---

## 2. Tests

| Suite | Result |
|-------|--------|
| `moduleCoreMtr5CorrectionUi.test.ts` | **9/9 PASS** |
| Full `npm test` | **403/403 PASS** |
| `npx tsc --noEmit` | **PASS** |
| `npm run build` | **PASS** |

Coverage: auth gates, delta estimates, pair IDs, UI wiring to `correct_*` only, no owner exposure, BG/RU/EN keys.

---

## 3. Browser

| Check | Result |
|-------|--------|
| Authenticated disposable local admin session | **Not available** (`127.0.0.1:3011` at login; production tabs not used) |
| UI smoke | **BLOCKED** |

Code-path acceptance is complete; do not claim browser PASS.

---

## 4. Remaining / release

| Severity | Item | Blocks R1.0? |
|----------|------|--------------|
| — | MTR-5 UI | No |
| Ops | Cloud apply of MTR-2…MTR-4 SQL (unchanged list from MTR-4 §9) | Safe-release step only |
| Ops | Authenticated local browser smoke of Correct flow | No |

**MTR-5 files (app only — no new migrations):**

- `src/components/admin/AdminMeterCorrectionPanel.tsx`
- `src/components/admin/AdminWater.tsx`
- `src/app/admin/page.tsx`
- `src/lib/utilities.ts`
- `src/lib/electricity.ts`
- `src/i18n/messages.ts`
- `tests/security/unit/moduleCoreMtr5CorrectionUi.test.ts`
- `audit_exports/technical_completion/meters/phase_mtr_5_correction_ui.md`

Email Core sending and debt gate remain **OFF**. Rental Management remains on pause. No Initial Setup changes in this phase.

---

## 5. STOP

Local implementation and report complete. **No** commit, push, cloud migration, or deploy performed.
