# Выкат портала «Амадеус XI» — soft-opening display поверх schema 233

Актуальный пакет для оператора: `tmp/r1_rc8_utility_opening_233_display/`  
(см. `DEPLOY.md`, `RELEASE.txt`, `SHA256SUMS` внутри каталога).

Если на VPS ещё нет схемы `233 / 20261130340100`, сначала пакет  
`tmp/r1_rc8_utility_opening_233/` (миграции 399→401), затем этот образ.

Кратко:

| | Значение |
|---|---|
| Build SHA | `58f6796fc20ae2f140c9a66ca3d783d16553c0b2` |
| Image | `amadeus11-app:1.0.0-rc8-utility-opening-233-display` |
| Image ID | `sha256:ed24f4a80081a84b1010c4a9294a01b0a30ee49f188ae90b055b9e89302bbdd5` |
| Схема | без изменений: `233 / 20261130340100` (только образ) |

Полная инструкция выката, health и отката —
в `tmp/r1_rc8_utility_opening_233_display/DEPLOY.md`.
