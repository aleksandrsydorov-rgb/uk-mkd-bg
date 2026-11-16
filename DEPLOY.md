# Выкат портала «Амадеус XI» — support-fee soft-defer opening (233 → 234)

Актуальный пакет для оператора: `tmp/r1_rc8_sf_opening_soft_234/`
(см. `DEPLOY.md`, `RELEASE.txt`, `SHA256SUMS` внутри каталога).

На VPS сейчас ожидается схема `233 / 20261130340100` (utility-opening-233-display).
Этот пакет поднимает схему до `234 / 20261130340200` и переключает образ.

Кратко:

| | Значение |
|---|---|
| Build SHA | `18ca0eb31b5551a400e993ab0b62b14ebed009ef` |
| Image | `amadeus11-app:1.0.0-rc8-sf-opening-soft-234` |
| Image ID | `sha256:aac84c7548f722d297631932b810b9261700296a17908f5feb94fb46ed582985` |
| TAR SHA256 | `75815ea98c5db7248d2731005d43609aa30f62d3ece9935c61edaa5823325398` |
| Схема | `233 / 20261130340100` → `234 / 20261130340200` |

Полная инструкция выката, миграции, health и отката —
в `tmp/r1_rc8_sf_opening_soft_234/DEPLOY.md`.

