# PKG-XFER Package 4 Progress

**Project:** `klowacuvufknbrkayjhz`  
**Isolated apts:** **99403** (pid 109) · **99404** (pid 110)

## Scenarios

| ID | Scenario | Status |
|----|----------|--------|
| P4.1 | Inheritance pending + death docs | **PASS** |
| P4.2 | Ideal parts unchanged | **PASS** |
| P4.3 | Vote / ownership as deceased+guest | **PASS** — guest cab 99404; no owned apts; submit denied; history denied; UK tabs only Заявки/Чат |
| P4.4 | Multi-heir inheritance approve | **PASS** — #42 on 99403 → 50/50 Owner1+Owner3 |
| P4.5 | Inheritance with overdue debt | **BLOCKED** — Finance fixture (P5) |
| P4.6 | Guest grant / revoke | **PASS** — grant+revoke proven; guest active for Owner2 verify; admin revoke remaining optional |

## Guest render-loop fix
- File: `src/app/account/page.tsx`
- Competing managementTab effects merged into one guest-aware fallback
- Retest: № 99404 guest loads; tabs Заявки↔Чат; no Maximum update depth

## Protected
99401 / 99402 / 99501 not mutated for P4 goals.
