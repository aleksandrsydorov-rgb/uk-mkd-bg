# Этап 3 — Тарифы natural / legal

Статус: **внедрение**

## Модель

- `tariff_rate_items.subject_kind`: `natural` | `legal` (PK: version + component + subject)
- Publish: flat rates копируются в оба вида; либо `{ natural: {...}, legal: {...} }`
- `property_tariff_subject_kind(property_id)`: `legal_entity` в книге → `legal`, иначе `natural` (ЕТ = natural)
- Support / capital charge и `support_fee_base_amount_for_year` берут subject с объекта
- List UI показывает natural rates (совместимость)

## UI

Админ → Тарифы: отдельные поля физ/юр при публикации (пустое юр = как физ).
