# PKG-XFER Package 1 Progress

**Project:** `klowacuvufknbrkayjhz` · **Apt:** 99401 / property_id 107  
**Started:** 2026-10-11  
**Mode:** human login checkpoints · Cursor shared cookie jar (one session at a time)

## Preflight (read-only)

| Check | Result |
|-------|--------|
| Linked project | `klowacuvufknbrkayjhz` ✓ |
| Active Book | Owner2 sole 100% / 1% |
| Pending transfers | 0 |
| Debt gate | OFF |
| Forbidden 99501 | untouched |

## Checkpoints

| CP | Role | Action | Status |
|----|------|--------|--------|
| 1 | Owner2 | Login + submit partial 70/30 | **PASS** — transfer id 33 pending; roster 70/30; Book unchanged sole Owner2 100%/1% |
| 2 | Admin | Approve partial | **PASS** — #33 `утверждена`; Book Owner2 70%/0.7 + Owner3 30%/0.3; history preserved |
| 3 | Owner3 | Verify 30% + modules | **PASS** — 99401; myShare 30%/0.3; apt ideal 1%; modules visible |
| 4 | Owner2 | Verify 70% + modules | **PASS** — retained; 70%/0.7; modules OK |
| 5 | Owner3 | Submit 2→2 (40/60) | **PASS** — transfer id 34 pending; target Owner1 40%/0.4 + Owner3 60%/0.6; Book unchanged 70/30 |
| 6 | Admin | Approve 2→2 | **PASS** — #34 `утверждена`; Book Owner1 40%/0.4 + Owner3 60%/0.6; pending=0 |
| 7 | Owner1 | Verify 40% + modules | **PASS** — 99401; myShare 40%/0.4; Book 40/60; modules visible |
| 8 | Owner3 | Verify 60% + modules | **PASS** — 99401; myShare 60%/0.6; Book 40/60; modules visible |
| 9 | Owner2 | Former-owner denial | **PASS** — no apt / no UK staff; 99401 absent; Book active = test1+test3 only |

## Evidence log

### CP1
- Session: `zoomconf0001+test2@gmail.com` verified
- UI Book: Test Owner 2 · 100 % / 1 %
- Submitted `partial_transfer` roster Owner2 70%/0.7 + Owner3 30%/0.3
- DB: transfer **id=33** status `ожидает`; pending_n=1
- Active Book unchanged: sole Owner2 100%/1%

### CP2
- Session: `admin@example.com`
- PDF: `%PDF-1.4`, 24304 bytes, no PII pattern hits; attached via Documents Core as `test_owner.pdf`
- Docs: type «Тестовый документ передачи доли»; № TEST-XFER-P1-99401; dates 2026-10-11
- DB #33: status **`утверждена`**; has_doc=true
- Active Book: test2 **70%/0.7**, test3 **30%/0.3** (no active duplicates); property `shared`; pending=0
- Historical deregistered rows retained

### CP3
- Session: `zoomconf0001+test3@gmail.com`
- Heading: № 99401 · Test Owner3
- My share 30%; my ideals 0,3%; apt ideals 1%
- Book list: Owner2 70%/0,7 + Owner3 30%/0,3
- Modules visible: finance, internet, security, cleaning, budget, meetings, decisions, documents, meters, polls, management

### CP4
- Session: `zoomconf0001+test2@gmail.com`
- Heading: № 99401 · Test Owner2
- My share 70%; my ideals 0,7%; apt ideals 1%
- Book list unchanged 70/30 co-ownership
- Modules available (moduleCount≈14)

### CP5
- Session: `zoomconf0001+test3@gmail.com`
- Submitted `sale` roster Owner1 40%/0.4 + Owner3 60%/0.6
- UI: cancel pending visible; Book list still Owner2 70% + Owner3 30%
- DB: transfer **id=34** status `ожидает`; pending_n=1
- Active Book unchanged: test2 **70%/0.7**, test3 **30%/0.3**

### CP6
- Session: Admin
- PDF: `test_owner.pdf` (24304 bytes) via Documents Core
- Docs: type «Тестовый документ передачи доли»; № TEST-XFER-P2-99401; dates 2026-10-11
- DB #34: status **`утверждена`**; has_doc=true
- Active Book: test1 **40%/0.4**, test3 **60%/0.6**; property `shared`; pending=0

### CP7
- Session: `zoomconf0001+test1@gmail.com`
- Heading: № 99401 · Test Owner1
- My share 40%; my ideals 0,4%; apt ideals 1%
- Book list: Owner1 40%/0,4 + Owner3 60%/0,6
- Modules visible: finance, internet, security, cleaning, budget, meetings, decisions, documents, meters, polls, management

### CP8
- Session: `zoomconf0001+test3@gmail.com`
- Heading: № 99401 · Test Owner3
- My share 60%; my ideals 0,6%; apt ideals 1%
- Book list: Owner1 40%/0,4 + Owner3 60%/0,6
- Modules visible: finance, internet, security, cleaning, budget, meetings, decisions, documents, meters, polls, management

### CP9
- Session: `zoomconf0001+test2@gmail.com`
- UI banner: «Для этого email нет апартаментов и нет доступа персонала УК.»
- Overview/apartment: no `99401`; heading without Owner2; ownership modules not granted
- DB Book active: test1 40%/0.4 + test3 60%/0.6 only (test2 absent)

## Package 1 final result

**PASS** (CP1–CP9). End state apt **99401 / 107**: shared Book Owner1 **40%/0.4** + Owner3 **60%/0.6**; pending=0; transfers **#33** (partial 70/30) and **#34** (2→2 sale 40/60) both `утверждена` with Documents Core PDFs. Forbidden **99501** untouched. No migrations / commit / push / deploy.

**STOP before Package 2.** Do not start P2 until explicitly requested.
