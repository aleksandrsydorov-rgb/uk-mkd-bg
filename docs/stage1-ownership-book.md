# Этап 1 — Книга этажной собственности v2 (проектный отчёт)

Статус: **внедрение применено в коде** — нужен `db push` и ручной тест в админке.  
Базовый коммит отката: `8afe9fb`.

## Решения при внедрении

1. Заявка на смену собственника — **Этап 2**.  
2. Нет апартамента в БД при импорте — **ошибка** (не создаём).  
3. Повторный импорт owners — **полная замена** по апартаментам из файла.  
4. Шаблон — **CSV** (открывается в Excel), два файла: objects + owners.

## Цель этапа

Довести внутреннюю **Книгу этажной собственности** до модели, согласованной с ЗУЕС (ст. 7) и нашим ТЗ релиза: доли, ideal parts, sole/shared, юрлицо+один управляющий, Excel-импорт.  
**Не входит в Этап 1:** invite/OTP, смена access с `owner_email`, голосование, guest_mode, тарифы natural/legal (это этапы 2–5).

## Что есть сейчас

| Сущность | Состояние |
|----------|-----------|
| `properties` | `area_sqm`, `purpose`, `ideal_parts_*`, `owner_email` / `owner_name` |
| `property_registry_people` | relation, entity_kind, ФИО/юрлицо, email — **нет долей и ideal parts на человека** |
| `objectBookComplete()` | UX-проверка объекта (площадь + ideal parts), не гейт доступа |
| `owns_property` | завязан на email объекта (не на книгу) |
| Админ | реестр/экспорт апартаментов, не полноценная книга v2 |
| Импорт Excel | нет |

## Модель данных (проектируемая)

### A. Объект (`properties` + поля книги)

Новые/обязательные для «книга заполнена»:

- `ownership_type`: `sole` | `shared` (NOT NULL после cutover для объектов в режиме ЭС)
- уже есть: `apartment_number`, `purpose`, `area_sqm`, `ideal_parts_percent` (+ source/note/meeting_ref)

Правила:

- `sole` → ровно **один** активный owner-party; share = 100%; ideal parts party = ideal parts объекта.
- `shared` → ≥2 owner-party, только `natural_person` (и при необходимости ЕТ как natural для тарифов позже); сумма `ownership_share_percent` = 100% (±0.01).
- Запрет: физ + юр на одном объекте; запрет нескольких юрлиц на одном объекте.
- Юрлицо: `ownership_type = sole`, один owner `legal_entity` 100%.

### B. Собственник в книге (`property_registry_people` расширение)

Для `relation_type = 'owner'` добавить:

- `ownership_share_percent` numeric  
- `ideal_parts_percent` numeric (вес голоса; хранится, не считается на лету)  
- для `legal_entity`: управляющий = тот же поток, что email входа — **один** `email` на party (управляющий); отдельных представителей нет  

Опционально v1.1: отдельная таблица `legal_entity_manager` — **не нужна**, если email юрлица в книге = email управляющего.

### C. Полнота книги (гейт для следующих этапов)

Функция `property_book_is_complete(property_id)`:

1. объект: purpose, area_sqm > 0, ideal_parts объекта, ownership_type;  
2. владельцы по правилам sole/shared;  
3. у каждого owner с правом кабинета — непустой email.

В Этапе 1 гейт **считается и показывается в админке** («книга ОК / не ОК»). Жёсткая блокировка кабинета собственника — **Этап 2** (чтобы не сломать текущий вход на тестах до invite-потока).

### D. Обитатели

В импорт Этапа 1 **не входят**. Собственник вводит сам (существующий UX / позже).

## Excel

### Шаблон

Один файл Excel (`.xlsx`), два листа; ключ объекта = **`apartment_number`** (текст, trim).

**objects**

| column | required |
|--------|----------|
| apartment_number | yes |
| purpose | yes |
| area_sqm | yes |
| ideal_parts_percent | yes |
| ownership_type | yes (`sole`/`shared`) |

**owners**

| column | required |
|--------|----------|
| apartment_number | yes |
| entity_kind | yes (`natural_person` / `legal_entity` / `sole_trader`) |
| ownership_share_percent | yes |
| ideal_parts_percent | yes |
| email | yes (для доступа) |
| first_name, middle_name, last_name | natural / sole_trader |
| entity_name, eik_bulstat | legal_entity (ЕТ: entity_name + eik, ФИО опционально) |

Заголовки: **EN keys** + строка подписей RU/BG в шаблоне.

### Импорт

1. Админ скачивает шаблон.  
2. Загрузка → dry-run валидация → список ошибок (лист, строка, код).  
3. Подтверждение → upsert: найти `properties` по `apartment_number`; обновить поля объекта; заменить/синхронизировать owner-строки книги (стратегия: **replace owners for listed apartments** в транзакции).  
4. Не трогать апартаменты, которых нет в файле (или опция «только перечисленные» — default).

Ошибки-стоп: нет апартамента в БД; неверная сумма долей; mixed физ+юр; shared с 1 владельцем; sole с ≠1; email пустой.

## Админ UI (Этап 1)

- Раздел **«Книга»** (platform core, не `module_key`).  
- Список объектов: номер, тип sole/shared, статус полноты, число собственников.  
- Карточка объекта: поля объекта + список собственников (CRUD вручную).  
- Кнопки: скачать шаблон, импорт Excel, «проверить полноту».  
- i18n RU/EN/BG.

Ручной CRUD и импорт пишут через **security definer RPC** (админ `администрация`), не прямой insert с клиента без RPC.

## Заявка на смену собственника/управляющего

В Этапе 1: **только заготовка** (таблица статусов + админ создаёт/закрывает вручную) **или** отложить UI заявки на Этап 2 вместе с invite.  
Рекомендация: **отложить заявку на Этап 2**, в Этапе 1 админ меняет книгу напрямую + импорт (как источник правды до invite).

## Миграции (после ОК)

1. `ownership_type` на `properties` + check.  
2. Колонки share / ideal_parts на `property_registry_people`.  
3. Constraints / validate function.  
4. RPC: `admin_book_get`, `admin_book_upsert_object`, `admin_book_upsert_owners`, `admin_book_import_validate`, `admin_book_import_apply`, `property_book_is_complete`.  
5. Types + `src/lib/propertyBook.ts` расширить.

## Критерии приёмки Этапа 1

- [ ] Шаблон скачивается, импорт sole 1 owner проходит.  
- [ ] shared 60/40 проходит; 40+40 стопится.  
- [ ] legal_entity 100% sole проходит; физ+юр стопится.  
- [ ] Админ видит complete/incomplete.  
- [ ] Существующий кабинет по `owner_email` пока ещё работает (гейт кабинета не режем в этом этапе).  
- [ ] Коммит отдельный; откат на `8afe9fb` возможен до следующих этапов.

## Вне скоупа Этапа 1

Invite, OTP, пароль, уведомление «контекст добавлен», смена `owns_property` на книгу, polls/GM, guest_mode, тарифы natural/legal.

## Решение, нужное от тебя

Ответь **«Этап 1 ОК — делай»** или правки по пунктам:

1. Заявку на смену собственника — отложить на Этап 2? (рекомендую да)  
2. Импорт: если апартамента нет в БД — ошибка (нужно сначала создать объект в реестре) или создавать объект из строки Excel?  
3. При повторном импорте owners: полная замена списка собственников по апартаменту из файла — ок?
