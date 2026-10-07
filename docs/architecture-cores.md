# AMADEUS 11 — Platform cores and modules

Canonical map for scale. Live product = 13 implemented modules.
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
  support_fee | capital_repair | water | electricity | internet
  → publish in Tariff Core
  → operational billing resolves published version where cut over
    (support / water / electricity / internet live; capital rate is published for Tariffs UI —
     capital charges resolve from published year tariff via bulk/year RPCs)
  → no hard-coded rate fallback in UI/RPC for cut-over domains

Assessment + ledger (campaign / operator amount)
  capital_repair
  → fixed EUR per apartment per calendar year in Tariff Core
  → charge_capital_repair / bulk resolve amount from published tariff for billing year
  → assessment remains the grouping/decision key; payments unchanged
```

Capital appears in Admin → Тарифы; charging uses the capital section (year bulk by tariff).

Internet: monthly subscription tariff; charge on connect and auto-charge on billing day until disconnect; engineer completes system work orders for enable/disable.

## Live modules (implemented = true)

| module_key | Category | Billing | Admin surface | Owner surface |
|------------|----------|---------|---------------|---------------|
| `tariffs` | finance | — (gates Tariff Core admin UI) | Финансы → Тарифы | — |
| `budget` | finance | none (plan vs fact; no owner billing) | Финансы → Бюджет; статья в расходах УК | План/факт бюджета (published/adopted/closed) |
| `support_fee` | utilities | Tariff Core (€/m²·year) + annual policy (discount/deadline) | Такса; ставка в Тарифы | Account support fee |
| `capital_repair` | utilities | Tariff Core fixed €/apartment·year + assessment/ledger | Капитальный ремонт; сумма в Тарифы | Capital balances |
| `water` | utilities | Tariff Core (€/m³) + modes | Вода | Water (mode-gated) |
| `electricity` | utilities | Tariff Core (day/night €/kWh) + modes | Электроэнергия | Electricity (mode-gated) |
| `internet` | utilities | Tariff Core (monthly) + subscription/ledger + system WOs + monthly charge cron | Интернет; тарифы в Тарифы | Connect / disconnect; auto-charge until disconnect |
| `service_lock` | communication | none (admin debt restriction) | Блокировка услуг | Soft lock with live scopes (water/internet/security/requests/…) |
| `security` | services | none (v1) | Охрана: посты + заявки | Заявки пропуск/доставка/передача; кабинет `/guard` |
| `cleaning` | services | none (v1) | Заказы уборки квартиры | Заказ уборки (standard/deep/after_guests); не путать с заявками «уборка» общих зон |
| `requests` | communication | none | Заявки | Requests |
| `chat` | communication | none | Чат | Chat |
| `polls` | communication | none | Опросы | Polls |
| `announcements` | communication | none | Объявления | Announcements |
| `general_meeting` | documents | none (Meeting Core: snapshots + ZUES ruleset; evolve in-place) | Собрания (wizard / conduct) | Собрания / live vote |
| `building_documents` | documents | none | Документы | Docs |

Keys must stay aligned with `IMPLEMENTED_MODULE_KEYS` in [`src/lib/modules.ts`](../src/lib/modules.ts)
and `module_catalog.implemented=true` seed.

**Meeting Core** (module `general_meeting`): see [`docs/meeting-core.md`](meeting-core.md). Property Book is SoT; meetings only freeze immutable snapshots. Do not treat generic polls as legal GM voting.

Finance category in Settings has `tariffs` and `budget`. Fee, capital and internet live under utilities.

## Stub modules (implemented = false)

`parking`, `rental`, `maintenance`,
`access_control`, `contractors`, `inventory`, `common_areas`, `commercial_rentals`

Visible in Settings catalog as non-toggleable stubs. No product surface. No tariffs.
Use [`docs/module-template.md`](module-template.md) when promoting one to live.

## Platform services (not building modules)

Always role-gated, not `module_key` toggles:

- UK expenses (`расходы`)
- Work orders / my tasks
- Staff, settings shell, reports (role), apartment book / shifts overview

Tariff Core admin (`тарифы`) is **role-gated and** toggled by the `tariffs` finance module (UX only; publish still checks water/support_fee/electricity/internet module flags).

Do not convert remaining platform services into modules without a product decision.

## Contract for a new live module

1. Add `module_key` to catalog seed + `BUILDING_MODULE_KEYS` / `IMPLEMENTED_MODULE_KEYS`.
2. Gate admin + owner nav/sections with `isBuildingModuleEnabled`.
3. If recurring rate → add `tariff_catalog` row (`tariff_key` = `module_key`) and wire resolvers; publish only via Tariff Core.
4. If campaign amounts → assessment + ledger pattern (capital style).
5. RPCs: authenticated, role checks, fail closed; no silent default rates.
6. i18n labels; Settings toggle only when `implemented=true`.

## Launch rule

First test launch = all **13 live** modules behave under one rule set
(off → hidden; on → full path; tariff-backed → Core only).
Stubs stay stubs. See [`audit_exports/v1_launch_checklist.md`](../audit_exports/v1_launch_checklist.md).
