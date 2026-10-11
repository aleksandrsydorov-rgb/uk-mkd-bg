# PKG-XFER Package 6 Progress — PASS

**Project:** `klowacuvufknbrkayjhz`

## Scenarios

| ID | Scenario | Status | Evidence |
|----|----------|--------|----------|
| P6.1 | Pending counter = SQL count | **PASS** | #47; rpc=sql=1 |
| P6.2 | Two owners: own notifications only | **PASS** | Owner2 22/0 foreign; Owner1 35/0 foreign |
| P6.3 | Email NOT_CONFIGURED | **PASS** | skip_reason=`NOT_CONFIGURED` |
| P6.4 | Supporting doc private | **PASS** | storage keys; public HEAD 400 |
| P6.5 | BG+RU+EN `has_pdf=false` | **PASS** | Extracts **3/4/5** on **99403** |
| P6.6 | Real PDF attach API | **PASS** | has_pdf true; private paths |
| P6.7 | Forged/foreign rejected | **PASS** | 401 / 404 / 400 |
| P6.8 | Immutable after attach | **PASS** | reattach blocked; content SHA frozen |
| P6.9 | Certified → unsigned fulfill | **PASS** | Extract **#6** `fulfilled`, **`is_signed=false`** |

## Safety end-state
- Transfer **#47** still `ожидает` (property 112 / 99406)
- `ordinary_debt_gate_enabled=false`
- 99401 / 99501 not mutated in P6 extract/fulfill path (extracts on **99403**)
