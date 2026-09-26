# AMADEUS 11 — Platform cores and modules

Canonical map for scale. Live product = 11 implemented modules.
Stub catalog keys are future-only. Do not implement stub UIs until a real product brief exists.

## Platform cores

| Core | Responsibility | Source of truth |
|------|----------------|-----------------|
| **Module Core** | Enable/disable product surfaces per building | `module_catalog`, `building_modules`, [`src/lib/modules.ts`](../src/lib/modules.ts) |
| **Tariff Core** | Versioned published rates for recurring billing | `tariff_catalog` / `tariff_versions` / `tariff_rate_items`, [`src/lib/tariffs.ts`](../src/lib/tariffs.ts), Admin → Тарифы |
| **Access** | Auth, staff roles, ownership | [`src/lib/access.ts`](../src/lib/access.ts), RLS + security definer RPCs |
| **Finance patterns** | Two legal billing shapes (below) | Domain migrations + admin/owner finance UIs |

Module flags are **UX gating** today (`modules.ts` comment). RPCs remain the security boundary.
Hardening module checks inside every RPC is a later security package — not a v1 launch blocker.

## Finance patterns (do not merge)

```text
Tariff-backed (recurring rate)
  support_fee | capital_repair | water | electricity
  → publish in Tariff Core
  → operational billing resolves published version where cut over
    (support / water / electricity live; capital rate is published for Tariffs UI —
     charges still use assessment + operator amount until a dedicated cutover)
  → no hard-coded rate fallback in UI/RPC for cut-over domains

Assessment + ledger (campaign / operator amount)
  capital_repair charges
  → assessment + ledger + bulk charge with explicit amount
  → tariff_catalog row exists for rate visibility / future cutover
```

Capital appears in Admin → Тарифы; charging still uses the capital section amounts until cutover.

## Live modules (implemented = true)

| module_key | Category | Billing | Admin surface | Owner surface |
|------------|----------|---------|---------------|---------------|
| `tariffs` | finance | — (gates Tariff Core admin UI) | Финансы → Тарифы | — |
| `support_fee` | utilities | Tariff Core (€/m²·year) + annual policy (discount/deadline) | Такса; ставка в Тарифы | Account support fee |
| `capital_repair` | utilities | Assessment + ledger; rate also in Tariff Core (€/m²·year) | Капитальный ремонт; ставка в Тарифы | Capital balances |
| `water` | utilities | Tariff Core (€/m³) + modes | Вода | Water (mode-gated) |
| `electricity` | utilities | Tariff Core (day/night €/kWh) + modes | Электроэнергия | Electricity (mode-gated) |
| `requests` | communication | none | Заявки | Requests |
| `chat` | communication | none | Чат | Chat |
| `polls` | communication | none | Опросы | Polls |
| `announcements` | communication | none | Объявления | Announcements |
| `general_meeting` | documents | none | Собрания | GM |
| `building_documents` | documents | none | Документы | Docs |

Keys must stay aligned with `IMPLEMENTED_MODULE_KEYS` in [`src/lib/modules.ts`](../src/lib/modules.ts)
and `module_catalog.implemented=true` seed.

Finance category in Settings has **only** `tariffs`. Fee and capital live under utilities.

## Stub modules (implemented = false)

`internet`, `parking`, `security`, `rental`, `cleaning`, `maintenance`,
`access_control`, `contractors`, `inventory`, `common_areas`, `commercial_rentals`

Visible in Settings catalog as non-toggleable stubs. No product surface. No tariffs.
Use [`docs/module-template.md`](module-template.md) when promoting one to live.

## Platform services (not building modules)

Always role-gated, not `module_key` toggles:

- UK expenses (`расходы`)
- Work orders / my tasks
- Staff, settings shell, reports (role), apartment book / shifts overview

Tariff Core admin (`тарифы`) is **role-gated and** toggled by the `tariffs` finance module (UX only; publish still checks water/support_fee/electricity module flags).

Do not convert remaining platform services into modules without a product decision.

## Contract for a new live module

1. Add `module_key` to catalog seed + `BUILDING_MODULE_KEYS` / `IMPLEMENTED_MODULE_KEYS`.
2. Gate admin + owner nav/sections with `isBuildingModuleEnabled`.
3. If recurring rate → add `tariff_catalog` row (`tariff_key` = `module_key`) and wire resolvers; publish only via Tariff Core.
4. If campaign amounts → assessment + ledger pattern (capital style).
5. RPCs: authenticated, role checks, fail closed; no silent default rates.
6. i18n labels; Settings toggle only when `implemented=true`.

## Launch rule

First test launch = all **11 live** modules behave under one rule set
(off → hidden; on → full path; tariff-backed → Core only).
Stubs stay stubs. See [`audit_exports/v1_launch_checklist.md`](../audit_exports/v1_launch_checklist.md).
