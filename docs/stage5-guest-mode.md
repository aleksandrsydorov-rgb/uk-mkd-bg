# Этап 5 — Guest mode

Статус: **внедрение**

## Модель

- Модуль `guest_mode` (building_modules, default off)
- Таблица `property_guest_accesses` (max 2 active на объект)
- Owner UI: `OwnerGuestMode` в кабинете
- Access: `list_my_guest_properties` + `resolveAccess.isGuest`
- Гость: заявки, охрана, чат, обзор услуг (без финансов/голосов собственника)
