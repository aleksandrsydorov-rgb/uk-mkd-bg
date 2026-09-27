# Этап 4 — Голос по party (ideal parts)

Статус: **внедрение**

## Polls

- Вес голоса = `ideal_parts_percent` партии книги (`property_registry_people`)
- Уникальность: `(poll_id, registry_people_id)`; legacy без party — `(poll_id, property_id)`
- `cast_poll_vote` пишет строку на каждую party текущего email
- Итог / 51% — по сумме `weight` vs сумма ideal parts дома

## Общее собрание

- `general_meeting_votes.registry_people_id`
- Owner: голосует своей party на объекте
- Admin `record_general_meeting_vote`: одна и та же опция на все party объекта
- Snapshot ideal parts с party (fallback — participant snapshot)
