# E2.3-D Finance E2E — working notes

## Scope
- Prefix: `E2E-FINANCE-D`
- Forbidden apts: 1, 2, 111, 112, 99401–99406
- Baseline before test (E2.3-C smoke): props=20, rem=800, debt=800, ledger n=5

## Test apartments
| Apt | Area | Purpose | property_id |
|-----|------|---------|-------------|
| 99407 | 15 m² | SF assess/pay/reverse (+ paid void later) | **113** |
| 99408 | 15 m² | Second unpaid assessment void | **114** |

Rate: 8 €/m²/year → base **120,00 €**.
Billing year for primary assessment: **2026** (late rule → 132, then correction −12 → remaining **120**).
Assessment 99407: `8febdaa5-ffcb-4186-8641-c065bb1539da`
Correction ledger_id: 28 (`E2E-FINANCE-D adjust to 120 EUR test assessment`)
Note: 2027 early window blocks unpaid finalize (`early_window_not_qualified`).

Created via admin apartments UI. Owner blank (Book mirror). Isolation: new apts.
