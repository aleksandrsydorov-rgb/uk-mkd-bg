# Этап 2 — Access из книги + приглашения (проект)

Статус: **внедрение**  
Базовый коммит после Этапа 1: `fe5d969`.

## Цель

1. Доступ собственника к апартаменту из **книги** (email активного owner), не только `properties.owner_email`.
2. Админ отправляет **приглашение** (привязка email ↔ апартамент), срок ссылки **24 ч**.
3. Регистрация: **задать пароль** + **OTP на email**.
4. Если email уже в Auth — только **добавить контекст** + уведомление.
5. Кабинет: несколько апартаментов / контекстов в одном логине (список уже есть; усилим загрузку из книги).

## Вне скоупа Этапа 2

- Жёсткий гейт «книга неполная → кабинет закрыт» (пока soft: доступ по книге + legacy `owner_email`).
- Голосование по party, guest_mode, тарифы natural/legal (этапы 3–5).
- UI заявки на смену собственника (можно тонкий stub позже).

## Модель

### `property_access_invites`
- property_id, email, token_hash, status (`pending`|`accepted`|`expired`|`revoked`)
- expires_at (now + 24h), invited_by_staff_id, created_at, accepted_at
- Unique active pending per (property_id, email)

### Access resolution
`owns_property(id)` =
- legacy: `properties.owner_email` = auth.email **OR**
- book: active owner in `property_registry_people` with matching email

`resolveAccess`: load properties where user owns via either path (RPC `list_my_properties` preferred).

### Invite flow
1. Admin: pick apt + email (from book owner or manual) → `admin_create_property_invite`
2. System emails link `/auth/invite?token=...` (Supabase Auth invite / generateLink + custom page)
3. User sets password; OTP verify if required by Auth settings
4. On accept: mark invite accepted; access via book email already or sync `owner_email` for sole if empty

### Existing user
`admin_attach_property_access(email, property_id)` — ensure book owner row / notify; no new registration.

## Deliverables этого инкремента

- Migration: invites table + rewrite `owns_property` + `list_my_owned_properties` + invite RPCs
- Admin Книга / карточка: кнопки «Пригласить» / «Повторно» / «Отозвать»
- Page `/auth/invite` accept flow
- Update `resolveAccess` / login to use owned properties list from RPC if available
- i18n

## Критерии приёмки

- [ ] Сособственник с email только в книге видит апт в кабинете
- [ ] Invite 24h, повторная отправка работает
- [ ] Уже зарегистрированный email получает контекст без полной регистрации
- [ ] Legacy `owner_email` по-прежнему работает
