# ALSYD EOOD
# ЮРИДИЧЕСКИЙ ПАКЕТ ДЛЯ ЗАПУСКА ПЛАТФОРМЫ
# ПРАВЕН ПАКЕТ ЗА СТАРТИРАНЕ НА ПЛАТФОРМАТА

**ALSYD Control / AMADEUS 11 / uk-mkd-bg**

| | RU | BG |
|--|----|----|
| Статус | Черновик для проверки болгарским адвокатом | Чернова за проверка от български адвокат |
| Дата | 2026-10-08 | 2026-10-08 |
| Источники | Все 16 файлов в `docs/legal/` | Всички 16 файла в `docs/legal/` |
| Оператор | ALSYD EOOD (Болгария) | ALSYD ЕООД (България) |

---

## ОГЛАВЛЕНИЕ / СЪДЪРЖАНИЕ

1. Резюме / Executive summary  
2. Правовой статус ALSYD / Правен статут на ALSYD  
3. Оценка статуса «агрегатор» / Оценка на статута „агрегатор“  
4. Отношения сторон / Отношения между страните  
5. Полный реестр документов (все записи таблицы-источника) / Пълен регистър  
6. Пакет договоров с клиентом / Пакет договори с клиента  
7. Домен: владение, делегирование, передача / Домейн  
8. Хостинг и инфраструктура / Хостинг и инфраструктура  
9. Приглашения и первый вход / Покани и първи вход  
10. Соглашения и чекбоксы пользователей / Споразумения и отметки  
11. ОРЗД/GDPR: роли и обработка / ОРЗД: роли и обработване  
12. Подизпълнители и трети лица / Подизпълнители  
13. Книга собственности / Книга на етажната собственост  
14. Общие собрания и электронное голосование / Общи събрания  
15. Платежи, счета, ДДС / Плащания, фактури, ДДС  
16. Поддержка, чаты, коммуникации / Поддръжка, чатове  
17. Сайт, cookies, раскрытия / Уебсайт, бисквитки  
18. ИС и лицензирование ПО / ИН и лицензиране  
19. Безопасность, резервные копии, инциденты / Сигурност  
20. Прекращение и handover / Прекратяване  
21. Чеклист первого коммерческого запуска / Чеклист за старт  
22. Пробелы внедрения (20) / Пропуски в имплементацията (20)  
23. Вопросы адвокату (25) / Въпроси към адвоката (25)  
24. Решения до запуска / Решения преди старт  
25. Юридическое согласование / Правно съгласуване  

---

## ДИСКЛЕЙМЕР / ОТКАЗ ОТ ОТГОВОРНОСТ

**RU:**  
Настоящий документ **не** является юридической консультацией и **не** удостоверяет соответствие ОРЗД/GDPR, DSA, ЗУЕС, налоговому или иному праву. Это инвентаризация и структура для проверки адвокатом. Выводы о правовом статусе (включая «агрегатор») **не установлены**.  
Требуется проверка болгарским юристом.

**BG:**  
Настоящият документ **не** представлява правна консултация и **не** удостоверява съответствие с ОРЗД/GDPR, DSA, ЗУЕС, данъчно или друго право. Това е инвентаризация и структура за преглед от адвокат. Изводите за правния статут (включително „агрегатор“) **не са установени**.  
Необходима е проверка от български адвокат.

---

## ЗАМЕЧАНИЕ О ЧИСЛЕ ДОКУМЕНТОВ В РЕЕСТРЕ / БЕЛЕЖКА ЗА БРОЯ В РЕГИСТЪРА

**RU:**  
В `LEGAL_PACKAGE_SUMMARY.md` указано **72** документа. В авторитетной таблице `00_MASTER_LEGAL_REGISTER.md` перечислены идентификаторы **C-01…X-03**, арифметически **90** строк (3+30+16+9+4+6+9+2+5+3+3). Итог «72» в summary/регистре — внутренняя ошибка подсчёта источника.  
**Настоящий мастер сохраняет все строки таблицы-источника (90 ID) без изъятий.**

**BG:**  
В `LEGAL_PACKAGE_SUMMARY.md` е посочено **72** документа. В авторитетната таблица `00_MASTER_LEGAL_REGISTER.md` са изброени идентификатори **C-01…X-03**, аритметично **90** реда. Итогът „72“ е вътрешна грешка в източника.  
**Този мастер запазва всички редове от таблицата-източник (90 ID) без пропускане.**

---

# 1. РЕЗЮМЕ
# 1. РЕЗЮМЕ

**RU:**  
Пакет подготовлен по аудиту репозитория жилого комплекса (класс AMADEUS 11). ALSYD EOOD предоставляет ПО/платформу; комплекс/управление используют её для собственников, заявок, финансов, собраний и поддержки. В продукте: приглашения (пароль+OTP) есть; страницы Общих условий и Политики за поверителност, чекбоксы принятия, cookie-баннер, DSAR, формальные протоколы доменов — **отсутствуют или частичны**. Платформенные «счета» — локальные коммерческие записи (`awaiting_master`), не подтверждённые болгарские фактуры. Meeting Core помечен `needs_legal_signoff`. Рабочая гипотеза (не вывод): ALSYD — в первую очередь SaaS/доставчик софтуера и, для данных комплекса по поручению клиента, вероятно **обработващ лични данни**; для собственной биллинга/поддержки — возможно **администратор**. Статус «агрегатор» **не заключён**.

**BG:**  
Пакетът е подготвен след одит на хранилището за жилищен комплекс (клас AMADEUS 11). ALSYD ЕООД предоставя софтуер/платформа; комплексът/управлението я ползват за собственици, заявки, финанси, събрания и поддръжка. В продукта: покани (парола+OTP) има; страници за Общи условия и Политика за поверителност, отметки за приемане, банер за бисквитки, DSAR, формални домейни протоколи — **липсват или са частични**. Платформените „фактури“ са локални търговски записи (`awaiting_master`), не потвърдени български фактури. Meeting Core е маркиран `needs_legal_signoff`. Работна хипотеза (не извод): ALSYD е преди всичко SaaS/доставчик на софтуер и, за данни на комплекса по указания на клиента, вероятно **обработващ лични данни**; за собствен биллинг/поддръжка — възможно **администратор**. Статутът „агрегатор“ **не е заключен**.

### Сводка чисел / Обобщение на числата

| | RU | BG | Значение |
|--|----|----|----------|
| Записи в таблице реестра | 90 ID | 90 ID | см. замечание выше |
| Summary «72» | ошибка подсчёта | грешка | не опускать строки |
| M / R / L (summary) | 28 / 26 / 18 | 28 / 26 / 18 | ориентиры запуска |
| Пробелы внедрения | 20 | 20 | §22 |
| Вопросы адвокату | 25 | 25 | §23 |

### Снимок репозитория / Моментна снимка на хранилището

| Область | RU статус | BG статус |
|---------|-----------|-----------|
| Invite (пароль+OTP) | РЕАЛИЗОВАНО | РЕАЛИЗИРАНО |
| Чекбоксы политик | ОТСУТСТВУЕТ | ЛИПСВА |
| Privacy/Terms страницы | ОТСУТСТВУЕТ (только подписи в футере) | ЛИПСВА |
| Cookie banner | ОТСУТСТВУЕТ | ЛИПСВА |
| Книга собственности | РЕАЛИЗОВАНО (продукт) | РЕАЛИЗИРАНО |
| Guest mode | ЧАСТИЧНО | ЧАСТИЧНО |
| Meeting Core | ЧАСТИЧНО + legal sign-off | ЧАСТИЧНО |
| Platform Support + invoices | ЧАСТИЧНО (`awaiting_master`) | ЧАСТИЧНО |
| User Activation | РЕАЛИЗОВАНО | РЕАЛИЗИРАНО |
| Подтверждённые третьи лица | Supabase; Vercel (env) | Supabase; Vercel |
| Email/SMS провайдер | ОТСУТСТВУЕТ / ЧАСТИЧНО | ЛИПСВА / ЧАСТИЧНО |

---

# 2. ПРАВОВОЙ СТАТУС ALSYD
# 2. ПРАВЕН СТАТУТ НА ALSYD

**RU:** Аудитория — болгарский адвокат. Не юридическое заключение. Метки: МОЖЕТ ПРИМЕНЯТЬСЯ / МОЖЕТ НЕ ПРИМЕНЯТЬСЯ / РЕШЕНИЕ АДВОКАТА.

**BG:** Аудитория — български адвокат. Не е правно становище. Етикети: МОЖЕ ДА СЕ ПРИЛАГА / МОЖЕ ДА НЕ СЕ ПРИЛАГА / РЕШЕНИЕ НА АДВОКАТ.

### Факты продукта (из репозитория) / Факти за продукта

**RU:**
1. Изолированная установка комплекса: отдельный deployment/БД/доменный класс.  
2. Модули: финансы, utilities, заявки, чат, документы, polls, общие собрания, platform support, user activation.  
3. Клиент (админ комплекса / управляваща компания / етажна собственост) ведёт собственников, приглашения, таксы, собрания.  
4. Конечные пользователи: собственники, гости, персонал.  
5. Platform Support: канал админ комплекса ↔ ALSYD (`awaiting_master`).  
6. Коммерция: setup + месячная плата; локальные commercial documents, синхронизация Master позже.  
7. В репозитории нет marketplace «продавец–покупатель» и нет PSP (Stripe и т.п.) в `package.json`.  
8. Стек: Next.js + Supabase + признаки Vercel.

**BG:**
1. Изолирана инсталация на комплекса: отделен deployment/БД/домейн клас.  
2. Модули: финанси, utilities, заявки, чат, документи, анкети, общи събрания, platform support, user activation.  
3. Клиентът (админ / управляваща компания / етажна собственост) управлява собственици, покани, такси, събрания.  
4. Крайни потребители: собственици, гости, персонал.  
5. Platform Support: канал админ ↔ ALSYD (`awaiting_master`).  
6. Търговия: setup + месечна такса; локални търговски документи; Master по-късно.  
7. Няма marketplace и няма PSP в `package.json`.  
8. Стек: Next.js + Supabase + индикации за Vercel.

### Сравнительная таблица классификаций / Сравнителна таблица

| Классификация RU | Классификация BG | Может применяться | Может не применяться | Вопрос адвокату |
|------------------|------------------|-------------------|----------------------|-----------------|
| SaaS-провайдер | Доставчик на SaaS | Удалённый доступ к ПО за плату | Если договор = услуги управител, не софтуер | Основная поставка — доступ к ПО? |
| Поставщик ПО-услуг | Доставчик на софтуерни услуги | Разработка/эксплуатация | Если ALSYD сам выполняет функции управител | Отличие от управител по ЗУЕС? |
| Услуга информационного общества | Услуга на информационното общество | Онлайн за вознаграждение (ISD) | Пограничные случаи | Применим ли ISD к B2B SaaS? |
| Посредническая услуга | Посредническа услуга | Хостинг UGC (чат, docs) | Не публичный marketplace | DSA intermediary? |
| Хостинг | Хостинг услуга | Хранение контента | ALSYD сам клиент Supabase/Vercel | Кто «хостинг-провайдер»? |
| Онлайн-платформа | Онлайн платформа | Связывает пользователей | Закрытый комплекс, не публичная диссеминация | Закрытое приложение = DSA platform? |
| P2B intermediation | Онлайн посредническа услуга (P2B) | Если marketplace business users | Нет классического listing | Регламент 2019/1150? |
| «Агрегатор» | „Агрегатор“ | Коммерческий жаргон multi-module | Нет multi-vendor marketplace в репо | См. §3 |
| Обработващ лични данни | Обработващ лични данни | По поручению клиента | Если ALSYD сам определяет цели книги/собраний | По каждому потоку? |
| Администратор лични данни | Администратор на лични данни | Свои CRM, биллинг, support | Если всё только по инструкциям клиента | Какие наборы контролирует ALSYD? |
| Съвместни администратори | Съвместни администратори | Общие цели с УК | Предпочтителен чистый processor | Art. 26? |
| Подизпълнител | Подизпълнител (sub-processor) | Supabase/Vercel | — | Согласие клиента на привлечение? |
| Платёжный посредник | Платежен посредник | Если сбор денег жильцов | В репо только внутренние леджеры, нет PSP | Будет ли ALSYD принимать деньги жильцов? |
| Управитель / УК | Управител / професионален управител | Если ALSYD исполняет ЗУЕС-обязанности | Продукт — инструмент; УК = клиент | ALSYD = управител по ЗУЕС? |

**RU:** Рабочая гипотеза (не вывод): ALSYD — прежде всего B2B SaaS; по данным комплекса — вероятно обработващ; по своим биллингу/поддержке — возможно администратор. Уверенность: низкая–средняя. Проверка адвокатом: **ДА**.

**BG:** Работна хипотеза (не извод): ALSYD е преди всичко B2B SaaS; за данни на комплекса — вероятно обработващ; за собствен биллинг/поддръжка — възможно администратор. Увереност: ниска–средна. Проверка от адвокат: **ДА**.

---

# 3. ОЦЕНКА СТАТУСА «АГРЕГАТОР»
# 3. ОЦЕНКА НА СТАТУТА „АГРЕГАТОР“

## STATUS: NOT CONCLUDED / НЕ ЗАКЛЮЧЕН

### FACTS / ФАКТЫ / ФАКТИ

**RU (за «агрегатор» как разговорный термин):** один продукт объединяет многие процессы здания; возможны будущие модули; программно ALSYD — слой между админом и жильцами.

**RU (против регулируемого marketplace-агрегатора):** нет multi-sided marketplace несвязанных продавцов; биллинг жильцов — учёт комплекса; плата ALSYD↔клиент независима от модулей; Platform Support — B2B, не consumer marketplace; «агрегатор» не явная единая статутная категория для condominium SaaS (подтвердить адвокатом).

**BG (за разговорен смисъл):** един продукт обединява много процеси; възможни бъдещи модули; ALSYD е софтуерен слой.

**BG (против регулиран marketplace):** няма multi-sided marketplace; счетоводството на жильци е на комплекса; таксата е ALSYD↔клиент; Platform Support е B2B; „агрегатор“ не е ясна единна законова категория за SaaS на етажна собственост — **необходима е проверка от български адвокат**.

### ASSUMPTIONS / ДОПУЩЕНИЯ / ДОПУСКАНИЯ

**RU/BG:** Коммерческое использование слова «агрегатор» в маркетинге ≠ правовой статус. В договорах предпочтительны роли: Provider / Обработващ / Администратор / Лицензиар.

### LAWYER DECISION REQUIRED / РЕШЕНИЕ АДВОКАТА

**RU:** Можно ли публично называть ALSYD «агрегатором»? Какое краткое описание утвердить для сайта и договоров? Превращает ли какой-либо модуль ALSYD в онлайн-платформу / intermediator?

**BG:** Може ли публично ALSYD да се нарича „агрегатор“? Какво кратко описание да се утвърди? Някой модул ли превръща ALSYD в онлайн платформа / посредник?

### Лучшие кандидаты описания / По-добри кандидати

1. B2B SaaS за жилищни комплекси / B2B SaaS for residential complexes  
2. Доставчик на услуга на информационното общество (ако ISD се прилага)  
3. Обработващ (+ администратор за собствени данни)  
4. Хостинг (само ако DSA анализът го изисква)

---

# 4. ОТНОШЕНИЯ СТОРОН
# 4. ОТНОШЕНИЯ МЕЖДУ СТРАНИТЕ

## 4.1 ALSYD ↔ управляваща компания (УК)

**RU:** Типичный клиент — юридическое лицо УК. Подписывает представитель по ТР. Платит УК. Получатель услуги — УК (+ пользователи по разрешению). Администратор лични данни жильцов: обычно УК или етажна собственост — **решение адвоката**. ALSYD: обработващ по данным здания; администратор по своим счетам/support. Доказательство полномочий: выписка ТР.

**BG:** Типичен клиент — ЮЛ управляваща компания. Подписва представител по ТР. Плаща УК. Получател — УК. Администратор на данни на жильци: обикновено УК или етажна собственост — **решение на адвокат**. ALSYD: обработващ; администратор за собствени фактури/support. Доказателство: извлечение от ТР.

## 4.2 ALSYD ↔ етажна собственост

**RU:** Подписант: председатель / управител при решении ОС? — **критично для адвоката**. Оплата со счёта ЕС. Дееспособность ЕС как стороны SaaS — **проверка**. Администратор данных — часто ЕС или управител. Доказательство: протокол ОС / иное — **адвокат**.

**BG:** Подписващ: председател / управител при решение на ОС? — **критично**. Плащане от сметка на ЕС. Правосубектност на ЕС за SaaS — **проверка**. Администратор — често ЕС или управител. Доказателство: протокол на ОС — **адвокат**.

## 4.3 ALSYD ↔ администратор комплекса (роль в системе)

**RU:** Роль staff `администрация` в продукте — операционный доступ, не замена договора. Нужна номинация администраторов (A-28), условия для персонала (U-11). Platform Support — канал к ALSYD.

**BG:** Ролята `администрация` е опериращ достъп, не заместител на договор. Нужна номинация (A-28), условия за персонал (U-11). Platform Support — канал към ALSYD.

## 4.4 ALSYD ↔ собственники / жильцы / гости

**RU:** Открытый вопрос: договор конечного пользователя с **ALSYD**, с **УК/ЕС**, или оба? Сейчас нет страниц ОУ/Privacy и нет accept flow. Гости — модуль `guest_mode` (частично). Не смешивать «accepted invite» (доступ к объекту) с принятием ОУ.

**BG:** Отворен въпрос: договор на крайния потребител с **ALSYD**, с **УК/ЕС**, или и двете? Няма страници ОУ/Privacy и няма accept flow. Гости — `guest_mode` (частично). „Accepted invite“ ≠ приемане на ОУ.

---

# 5. ПОЛНЫЙ РЕЕСТР ДОКУМЕНТОВ
# 5. ПЪЛЕН РЕГИСТЪР НА ДОКУМЕНТИТЕ

**RU:** Ниже — все **90** записей из таблицы `00_MASTER_LEGAL_REGISTER.md` (не «72» из summary). Легенда M/R/L: обязательный (при подтверждении адвокатом) / рекомендованный / решение адвоката.

**BG:** По-долу са всички **90** записа от таблицата-източник. Легенда M/R/L: задължителен (след потвърждение от адвокат) / препоръчителен / решение на адвокат.

| ID | Name EN (source) | Name RU | Name BG | Parties / Audience | Purpose | M/R/L | When signed/accepted | Who signs/accepts | System / process | Versioned | E-sign | Storage / evidence | Owner | Status | Lawyer comments |
|----|------------------|---------|---------|--------------------|---------|-------|----------------------|-------------------|------------------|-----------|--------|--------------------|-------|--------|------------------|
| C-01 | Articles / corporate docs ALSYD EOOD | Учредительные / корпоративные документы ALSYD EOOD | Учредителни / корпоративни документи ALSYD ЕООД | Corporate / Корпорация | Capacity / Правоспособност | M | Pre-trading / Преди дейност | ALSYD | Offline | Y | L | Legal archive | ALSYD | Draft ops |  |
| C-02 | Trade register extract | Выписка из торгового регистра | Извлечение от Търговския регистър | Corporate | KYC контрагента | R | Per deal | ALSYD | Offline | Y | N | Deal file | ALSYD | Ops |  |
| C-03 | UBO / AML checklist if required | Чеклист UBO/AML при необходимости | Чеклист UBO/AML при нужда | Corporate | Compliance | L | Per deal | ALSYD | Offline | Y | N | Legal | ALSYD | L |  |
| A-01 | Master SaaS Agreement | Рамочный договор SaaS / платформы | Рамков договор за SaaS / платформа | ALSYD↔Customer | Core contract | M | Before go-live | ALSYD + Customer | Offline (+ vault) | Y | L | Contract life+ | ALSYD Legal | Missing |  |
| A-02 | Order Form / Service Order | Заказ / спецификация услуг | Поръчка / спецификация на услугата | ALSYD↔Customer | SKU, fees, domain | M | With A-01 | ALSYD + Customer | Offline | Y | L | Contract life+ | ALSYD | Missing |  |
| A-03 | Service specification | Спецификация объёма услуг | Спецификация на обхвата | ALSYD↔Customer | Modules scope | M | Annex | ALSYD + Customer | Offline | Y | N | Contract life+ | Product | Missing |  |
| A-04 | Setup & implementation SoW | Условия внедрения / SoW | Условия за внедряване / SoW | ALSYD↔Customer | Onboarding | M | Annex | ALSYD + Customer | Offline | Y | N | Project | Delivery | Missing |  |
| A-05 | Monthly service schedule | Условия ежемесячной платы | Условия за месечна такса | ALSYD↔Customer | Recurring fees | M | Annex | ALSYD + Customer | Offline | Y | N | Contract | Finance | Missing |  |
| A-06 | SLA | SLA / доступность | SLA / наличност | ALSYD↔Customer | Availability | R | Annex | ALSYD + Customer | Offline | Y | N | Contract | Ops | Missing |  |
| A-07 | Support terms | Условия поддержки | Условия за поддръжка | ALSYD↔Customer | Support | M | Annex | ALSYD + Customer | Platform Support | Y | N | Contract | Support | Partial product |  |
| A-08 | Maintenance/update policy | Политика обновлений | Политика за поддръжка/обновления | ALSYD↔Customer | Changes | R | Annex | ALSYD + Customer | Offline | Y | N | Contract | Product | Missing |  |
| A-09 | DPA Art. 28 | Договор за обработване на лични данни (орд. 28) | Договор за обработване на лични данни (чл. 28 ОРЗД) | ALSYD↔Customer | Processor terms | M | With A-01 | ALSYD + Customer | Offline | Y | L | Contract+GDPR | ALSYD DPO/Legal | Missing | L |
| A-10 | Security annex | Приложение по безопасности | Приложение за сигурност | ALSYD↔Customer | Controls | R | Annex | ALSYD + Customer | Offline | Y | N | Contract | Security | Missing |  |
| A-11 | Subprocessor annex | Приложение подизпълнители | Приложение подизпълнители | ALSYD↔Customer | Supabase/Vercel… | M | With DPA | ALSYD + Customer | Offline + 06_ | Y | N | Contract | Legal | Missing |  |
| A-12 | Retention/deletion annex | Приложение сроки хранения/удаления | Приложение срокове за съхранение/изтриване | ALSYD↔Customer | Erasure/exit | M | Annex | ALSYD + Customer | Offline | Y | N | Contract | Legal | Missing |  |
| A-13 | Exit/migration procedure | Процедура выхода/миграции | Процедура за изход/миграция | ALSYD↔Customer | Portability | M | Annex | ALSYD + Customer | Offline | Y | N | Contract | Delivery | Missing |  |
| A-14 | Backup/recovery roles | Роли backup/recovery | Роли за backup/recovery | ALSYD↔Customer | RPO/RTO | R | Annex | ALSYD + Customer | Offline | Y | N | Contract | Ops | Missing |  |
| A-15 | Domain responsibility schedule | График ответственности за домен | График за отговорност за домейн | ALSYD↔Customer | DNS/SSL | M | If DNS touched | ALSYD + Customer | 03_ | Y | Y | Contract | Ops | Missing |  |
| A-16 | Hosting responsibility | Ответственность за хостинг | Отговорност за хостинг | ALSYD↔Customer | Who contracts host | M | Annex | ALSYD + Customer | Offline | Y | N | Contract | Ops | Missing |  |
| A-17 | Liability schedule | Ограничение ответственности | Ограничение на отговорността | ALSYD↔Customer | Caps | M | In MSA | ALSYD + Customer | Offline | Y | L | Contract | Legal | Missing | L |
| A-18 | IP / licence grant | ИС / лицензия на ПО | ИН / лиценз за софтуер | ALSYD↔Customer | Software licence | M | In MSA | ALSYD + Customer | Offline | Y | N | Contract | Legal | Missing |  |
| A-19 | Confidentiality | Конфиденциальность | Поверителност | ALSYD↔Customer | Mutual NDA-in-MSA | M | In MSA | ALSYD + Customer | Offline | Y | N | Contract | Legal | Missing |  |
| A-20 | Payment terms | Платёжные условия | Условия за плащане | ALSYD↔Customer | Invoicing cycle | M | In MSA/OF | ALSYD + Customer | Offline | Y | N | Contract | Finance | Missing |  |
| A-21 | Overdue/suspension schedule | Просрочка / приостановка | Просрочие / спиране | ALSYD↔Customer | Non-payment | M | Annex | ALSYD + Customer | Product intent | Y | N | Contract | Finance | Partial |  |
| A-22 | Termination clauses | Прекращение договора | Прекратяване | ALSYD↔Customer | Exit | M | In MSA | ALSYD + Customer | Offline | Y | N | Contract | Legal | Missing |  |
| A-23 | Suspension rules detail | Детальные правила приостановки | Подробни правила за спиране | ALSYD↔Customer | Ops | M | Annex | ALSYD + Customer | Platform Support | Y | N | Contract | Support | Partial |  |
| A-24 | Data handover protocol | Протокол передачи данных | Протокол за предаване на данни | ALSYD↔Customer | Termination | M | On exit | ALSYD + Customer | Offline | Y | Y | Exit file | Delivery | Missing |  |
| A-25 | Governing law clause | Применимое право / подсудность | Приложимо право / подсъдност | ALSYD↔Customer | BG law typical | M | In MSA | ALSYD + Customer | Offline | Y | N | Contract | Legal | Missing | L |
| A-26 | Change-control | Управление изменениями | Управление на промени | ALSYD↔Customer | Versions | R | Annex | ALSYD + Customer | Offline | Y | N | Contract | Product | Missing |  |
| A-27 | Authority warranty (signer) | Гарантия полномочий подписанта | Гаранция за представителна власт | Customer | Capacity | M | Signature block | Customer signer | Offline | Y | Y | Deal file | Legal | Missing | L |
| A-28 | Admin nomination form | Форма назначения администраторов | Форма за номинация на администратори | Customer→ALSYD | Named admins | M | Onboarding | Customer | Staff roles | Y | Y | Contract life | Delivery | Partial |  |
| A-29 | Contacts schedule | Контактные лица | Лица за контакт | Both | Escalation | M | Order Form | Both | Offline | Y | N | Contract | Both | Missing |  |
| A-30 | Condominium vs УК role rider | Оговорка ЕС vs УК | Клауза етажна собственост vs УК | Both | Party clarity | L | Annex | Both | Offline | Y | L | Contract | Legal | Missing | L |
| U-01 | Platform Terms of Use | Общие условия платформы | Общи условия на платформата | End users | Use rules | M | First login | User accept | Missing pages | Y | N | Accept log | Legal+Product | Missing | L who is party |
| U-02 | Acceptable Use Policy | Политика допустимого использования | Политика за приемлива употреба | End users | Abuse | R | Part of ToU | User | Missing | Y | N | Accept log | Legal | Missing |  |
| U-03 | Privacy Notice (end users) | Политика за поверителност (потребители) | Политика за поверителност (потребители) | End users | Art. 13/14 | M | First login + link | User ack | Footer label only | Y | N | Public+log | Legal | Missing |  |
| U-04 | Cookie Policy | Политика cookies / бисквитки | Политика за бисквитки | Visitors/users | Cookies | R/L | Banner/link | User | Missing | Y | N | Public | Legal | Missing | L |
| U-05 | Electronic communications notice | Уведомление об электронных сообщениях | Известие за електронни съобщения | Users | e-notice | L | Accept | User | Missing | Y | N | Accept log | Legal | Missing | L |
| U-06 | Notification policy | Политика уведомлений | Политика за уведомления | Users | Channels | R | Link | User | Missing | Y | N | Public | Product | Missing |  |
| U-07 | Account security rules | Правила безопасности аккаунта | Правила за сигурност на акаунт | Users | Hygiene | R | ToU section | User | Missing | Y | N | Accept log | Security | Missing |  |
| U-08 | Guest Terms | Условия для гостей | Условия за гости | Guests | Guest_mode | R | Guest activate | Guest | Partial module | Y | N | Accept log | Legal | Missing |  |
| U-09 | Tenant Terms | Условия для нанимателей | Условия за наематели | Tenants | If used | L | Onboard | Tenant | Partial | Y | N | Accept log | Legal | Missing | L |
| U-10 | Owner duties addendum | Дополнение обязанностей собственника | Допълнение задължения на собственик | Owners | Book contacts | R | ToU | Owner | Missing | Y | N | Accept log | Legal | Missing |  |
| U-11 | Administrator Terms | Условия для администраторов | Условия за администратори | Staff admins | Elevated access | M | Staff onboarding | Admin staff | Partial roles | Y | Y | HR/contract | Legal | Missing |  |
| U-12 | Engineer/contractor terms | Условия инженеров/подрядчиков | Условия за инженери/изпълнители | Assignees | Confidentiality | R | Staff/vendor | Assignee | Work orders | Y | Y | HR | Legal | Missing |  |
| U-13 | Chat/community rules | Правила чата | Правила за чат | Chat users | Conduct | R | ToU | User | Chat module | Y | N | Accept log | Product | Missing |  |
| U-14 | Complaints / abuse procedure | Жалобы / злоупотребления | Жалби / злоупотреба | All | Reporting | R/L | Link | User | Missing | Y | N | Public | Legal | Missing | DSA? |
| U-15 | Account suspension/deletion policy | Приостановка/удаление аккаунта | Спиране/изтриване на акаунт | Users | Lifecycle | R | ToU | User | Partial | Y | N | Public | Product | Missing |  |
| U-16 | Marketing consent record | Запись согласия на маркетинг | Запис на съгласие за маркетинг | Users | Optional marketing | L | Opt-in | User | Missing | Y | N | Consent DB | Marketing | Missing |  |
| G-01 | RoPA (ALSYD) | Регистр операций обработки (ALSYD) | Регистър на дейностите по обработване (ALSYD) | ALSYD | Art. 30 | M | Ongoing | ALSYD | Offline | Y | N | Ongoing | DPO/Legal | Missing |  |
| G-02 | RoPA (Customer guidance) | Руководство RoPA для клиента | Упътване RoPA за клиента | Customer | Art. 30 help | R | Onboarding | Customer | Offline | Y | N | Customer | Legal | Missing |  |
| G-03 | Lawful basis matrix | Матрица правовых оснований | Матрица на правни основания | Both | GDPR | M | Pre-launch | Both | 05_ | Y | N | Compliance | Legal | Draft | L |
| G-04 | DPIA (if required) | Оценка воздействия (DPIA) | Оценка на въздействието (DPIA) | ALSYD/Customer | High risk | L | Pre-meetings prod | Controller | Offline | Y | N | Compliance | DPO | Missing | L |
| G-05 | LIA templates | Шаблоны LIA | Шаблони LIA | Controller | L.I. basis | L | As needed | Controller | Offline | Y | N | Compliance | DPO | Missing | L |
| G-06 | DSAR playbook | Процедура прав субъектов | Процедура за права на субекти | Controllers | Rights | M | Pre-launch | Controller | Missing product | Y | N | Compliance | Support | Missing |  |
| G-07 | Breach procedure | Процедура при нарушении | Процедура при нарушение | Controllers | 72h | M | Pre-launch | Controller | 11_ | Y | N | Compliance | Security | Missing |  |
| G-08 | Privacy Notice (admins/contacts) | Политика за поверителност (админы/контакты) | Политика за поверителност (админи/контакти) | Customer staff | Transparency | M | Contracting | Customer staff | Missing | Y | N | Public | Legal | Missing |  |
| G-09 | Privacy Notice (website) | Политика за поверителност (сайт) | Политика за поверителност (уебсайт) | Visitors | Transparency | M | Site live | Operator | Missing | Y | N | Public | Legal | Missing |  |
| D-01 | Domain Management Authorization | Авторизация управления доменом | Упълномощаване за управление на домейн | ALSYD↔Customer | DNS authority | M | Pre-cutover | ALSYD + Customer | 03_ | Y | Y | Infra file | Ops | Missing |  |
| D-02 | Domain Transfer Protocol | Протокол трансфера домена | Протокол за трансфер на домейн | ALSYD↔Customer | In/out transfer | R | On transfer | ALSYD + Customer | 03_ | Y | Y | Infra file | Ops | Missing |  |
| D-03 | Domain Handover Protocol (exit) | Протокол передачи домена (выход) | Протокол за предаване на домейн (изход) | ALSYD↔Customer | Exit DNS | M | Termination | ALSYD + Customer | 03_ | Y | Y | Exit file | Ops | Missing |  |
| D-04 | Infrastructure Handover Protocol | Протокол передачи инфраструктуры | Протокол за предаване на инфраструктура | ALSYD↔Customer | Hosting/secrets | M | Exit/change | ALSYD + Customer | 03_ | Y | Y | Exit file | Ops | Missing |  |
| B-01 | Setup fee commercial offer | Коммерческое предложение setup | Търговска оферта за setup | ALSYD↔Customer | Price | M | Pre-contract | ALSYD + Customer | Offline | Y | N | Deal | Sales | Missing |  |
| B-02 | Tax invoice (BG) | Данъчна фактура (България) | Данъчна фактура (България) | ALSYD→Customer | Accounting | M | Per charge | ALSYD | Accounting system | Y | L | Legal archive | Finance | Not = app row | L |
| B-03 | Credit note / correction | Кредитно известие / коррекция | Кредитно известие / корекция | ALSYD→Customer | Adjustments | R | As needed | ALSYD | Accounting | Y | L | Archive | Finance | Missing |  |
| B-04 | Overdue notice template | Шаблон уведомления о просрочке | Шаблон за просрочие | ALSYD→Customer | Collection | M | D+N | ALSYD | Email/ops | Y | N | Deal | Finance | Missing |  |
| B-05 | Suspension notice template | Шаблон уведомления о приостановке | Шаблон за спиране | ALSYD→Customer | Suspend | M | Pre-suspend | ALSYD | Email+app | Y | N | Deal | Finance | Missing |  |
| B-06 | Restoration notice | Уведомление о возобновлении | Известие за възстановяване | ALSYD→Customer | Restore | R | After pay | ALSYD | Email | Y | N | Deal | Finance | Missing |  |
| M-01 | Meeting invitation template (BG) | Шаблон покана за ОС (BG) | Шаблон за покана за ОС (BG) | Complex→Owners | ЗУЕС invite | M | Per meeting | Complex admin | Meeting Core | Y | L | Long | Complex+ALSYD proc | Partial product | L |
| M-02 | Placement protocol template | Шаблон протокол размещения | Шаблон протокол за поставяне | Complex | Proof of posting | M | Per meeting | Complex | Documents | Y | L | Long | Complex | Partial | L |
| M-03 | Proxy / power of attorney form | Форма доверенности / представителство | Форма за пълномощно / представителство | Owners | Representation | M | Per meeting | Owner | Proxies | Y | L | Long | Complex | Partial | L |
| M-04 | Registration / attendance list | Регистрационный список | Регистрационен списък | Complex | Quorum evidence | M | Meeting day | Complex | Conduct UI | Y | N | Long | Complex | Partial |  |
| M-05 | Ballot / voting record | Бюллетень / запись голосования | Бюлетина / запис на гласуване | Complex | Votes | M | Meeting | Complex | Votes | Y | N | Long | Complex | Partial | L |
| M-06 | Minutes / protocol ОС | Протокол общего собрания | Протокол на общото събрание | Complex | Decisions | M | After meeting | Complex | Protocol | Y | L | Long | Complex | Partial | L |
| M-07 | Candidate consent form | Согласие кандидата | Съгласие на кандидат | Candidates | Elections | R | Pre-election | Candidate | Governance | Y | Y | Term | Complex | Missing/roadmap | L |
| M-08 | House rules extract (video/hybrid) | Выписка от правилник (видео/хибрид) | Извлечение от правилник (видео/хибрид) | Complex | Hybrid legal basis | L | Pre-hybrid | Complex | Offline | Y | N | Building | Complex | External | L |
| M-09 | Meeting delivery log export | Экспорт журнала доставки | Експорт на дневник за доставка | Complex | Notice proof | M | Per meeting | Complex | Notifications | Y | N | Long | Complex | Partial/missing email | L |
| P-01 | Book import accuracy declaration | Декларация точности импорта книги | Декларация за точност при импорт | Admin | Data quality | R | Import | Admin | Property Book | Y | Y | Audit | Complex | Missing |  |
| P-02 | Ownership change packet checklist | Чеклист смены собственности | Чеклист при промяна на собственост | Complex | Updates | R | On change | Complex | Book | Y | L | Audit | Complex | Partial | L |
| S-01 | Information Security Policy | Политика информационной безопасности | Политика за информационна сигурност | ALSYD | Governance | M | Corporate | ALSYD | Offline | Y | N | Ongoing | Security | Missing |  |
| S-02 | Incident / breach response | Реагирование на инциденты/нарушения | Реагиране при инциденти/нарушения | ALSYD | Incidents | M | Corporate | ALSYD | Offline | Y | N | Ongoing | Security | Missing |  |
| S-03 | Backup & DR policy | Политика backup и DR | Политика за backup и DR | ALSYD | Continuity | R | Corporate | ALSYD | Offline | Y | N | Ongoing | Ops | Missing |  |
| S-04 | Staff confidentiality / access | Конфиденциальность персонала | Поверителност на персонала | ALSYD staff | Insider risk | M | Hiring | Staff | HR | Y | Y | Employment | HR | Missing |  |
| S-05 | Production access register | Регистр доступа к production | Регистър за достъп до production | ALSYD | Who has prod | R | Continuous | ALSYD | Offline | Y | N | Ongoing | Ops | Missing |  |
| V-01 | Supabase DPA / terms | DPA/условия Supabase | DPA/условия Supabase | ALSYD↔Supabase | Subprocessor | M | Before prod data | ALSYD | Vendor | Y | N | Vendor file | Legal | Confirm |  |
| V-02 | Vercel DPA / terms | DPA/условия Vercel | DPA/условия Vercel | ALSYD↔Vercel | Subprocessor | M | Before prod | ALSYD | Vendor | Y | N | Vendor file | Legal | Confirm |  |
| V-03 | Email provider DPA (if any) | DPA email-провайдера (если есть) | DPA на email доставчик (ако има) | ALSYD↔ESP | Subprocessor | M | Before email PII | ALSYD | Vendor | Y | N | Vendor file | Legal | N/A until wired |  |
| X-01 | Customer onboarding checklist | Чеклист онбординга клиента | Чеклист за онбординг на клиент | Internal | Launch | M | Each complex | ALSYD | 12_ | Y | N | Deal | Delivery | Draft |  |
| X-02 | Go-live approval record | Запись утверждения go-live | Запис за одобрение go-live | ALSYD+Customer | Gate | M | Launch | Both | Offline | Y | Y | Deal | Delivery | Missing |  |
| X-03 | Compliance calendar | Календарь compliance | Календар за съответствие | ALSYD | Renewals | R | Annual | ALSYD | Offline | Y | N | Ongoing | Legal | Missing |  |

**RU:** Итого строк реестра в данном мастере: **90**. Расхождение с «72» в summary задокументировано во введении.

**BG:** Общо редове в регистъра: **90**. Разминаването с „72“ е документирано във въведението.

---


# 6. ПАКЕТ ДОГОВОРОВ С КЛИЕНТОМ
# 6. ПАКЕТ ДОГОВОРИ С КЛИЕНТА

**RU:** В продукте подписанные договоры **отсутствуют**. Ниже — структура для составления адвокатом (из `02_CUSTOMER_CONTRACT_PACKAGE.md`).

**BG:** В продукта подписани договори **липсват**. По-долу — структура за изготвяне от адвокат.

**RU — минимум к оценке:** рамочный SaaS; Order Form; спецификация; setup; месячная плата; SLA; поддержка; обновления; **Договор за обработване на лични данни**; security annex; подизпълнители; retention; exit/export; backup; домен; хостинг; ответственность; ИС/лицензия; конфиденциальность; оплата; просрочка; прекращение; приостановка; handover данных; право/подсудность; change-control; оговорка ЕС vs УК; гарантия полномочий; номинация админов; контакты.

**BG — минимум:** рамков SaaS; поръчка; спецификация; setup; месечна такса; SLA; поддръжка; обновления; **договор за обработване**; security; подизпълнители; retention; exit; backup; домейн; хостинг; отговорност; ИН/лиценз; поверителност; плащане; просрочие; прекратяване; спиране; handover; приложимо право; change-control; клауза ЕС vs УК; гаранция за представителство; номинация на админи; контакти.

**RU:** Каркас MSA: стороны; объём (исключая обязанности управител по ЗУЕС, если не согласовано отдельно); обязанности клиента; плата/ДДС; SLA; DPA; security; ИС; данные клиента; AUP; suspension/termination; exit; ответственность; право; подписи.

**BG:** Скелет на MSA: страни; обхват (без задължения на управител по ЗУЕС, освен ако изрично); задължения на клиента; такси/ДДС; SLA; DPA; security; ИН; данни на клиента; AUP; спиране/прекратяване; exit; отговорност; право; подписи.

---

# 7. ДОМЕН: ВЛАДЕНИЕ, ДЕЛЕГИРОВАНИЕ, ПЕРЕДАЧА
# 7. ДОМЕЙН: СОБСТВЕНОСТ, ДЕЛЕГИРАНЕ, ПРЕДАВАНЕ

**RU:** Протоколы в продукте **отсутствуют**. Жизненный цикл:

1. Домен принадлежит ALSYD — риск зависимости при выходе.  
2. Домен принадлежит клиенту — ALSYD действует по письменным инструкциям (риск ошибок инструкций).  
3. Клиент делегирует DNS ALSYD — документ D-01 Domain Management Authorization.  
4. Трансфер к ALSYD — D-02 (auth-code, unlock, rollback).  
5. Трансфер обратно клиенту — D-02 outbound + D-03 handover.  
6. Продление (renewal) — кто платит/мониторит истечение.  
7. Прекращение — D-03 + D-04 (инфраструктура: Supabase, Vercel, secrets, backup export).  
8. Подписанный протокол передачи обязателен при смене контроля.

**BG:** Протоколите в продукта **липсват**. Жизнен цикъл:

1. Домейнът е на ALSYD — риск при изход.  
2. Домейнът е на клиента — ALSYD действа по писмени указания.  
3. Делегиране на DNS към ALSYD — D-01.  
4. Трансфер към ALSYD — D-02.  
5. Трансфер обратно — D-02 + D-03.  
6. Подновяване — кой плаща/следи.  
7. Прекратяване — D-03 + D-04.  
8. Подписан протокол при смяна на контрол.

**RU:** Требуется проверка болгарским юристом — оптимальная модель владения доменом и ответственность за неверные DNS-инструкции клиента.

**BG:** Необходима е проверка от български адвокат — оптимален модел на собственост и отговорност за грешни DNS указания.

---

# 8. ХОСТИНГ И ИНФРАСТРУКТУРА
# 8. ХОСТИНГ И ИНФРАСТРУКТУРА

**RU:** Наблюдаемый стек: Next.js-приложение; Supabase (Auth/DB/Storage); признаки Vercel. Кто является стороной договора с хостером — в A-16. При выходе — D-04: владение проектом Supabase/Vercel, ротация секретов, экспорт backup, buckets. RPO/RTO — A-14.

**BG:** Наблюдаван стек: Next.js; Supabase; индикации за Vercel. Страна по договор с хостера — A-16. При изход — D-04. RPO/RTO — A-14.

---

# 9. ПРИГЛАШЕНИЯ И ПЕРВЫЙ ВХОД
# 9. ПОКАНИ И ПЪРВИ ВХОД

## Текущий поток (факт репозитория) / Текущ поток

| Шаг | RU | BG | Статус |
|-----|----|----|--------|
| Админ создаёт invite | Книга / property_access_invites | Книга / покани | РЕАЛИЗОВАНО |
| `/auth/invite?token=` | Страница приглашения | Страница за покана | РЕАЛИЗОВАНО |
| Пароль + OTP | Регистрация | Регистрация | РЕАЛИЗОВАНО |
| accept_property_invite | Доступ к объекту | Достъп до имот | РЕАЛИЗОВАНО |
| ОУ / Privacy checkbox | — | — | **ОТСУТСТВУЕТ / ЛИПСВА** |
| Версия политики в БД | — | — | **ОТСУТСТВУЕТ / ЛИПСВА** |
| Cookie consent | Только session Auth | Само session Auth | **ОТСУТСТВУЕТ / ЛИПСВА** |
| Повторный логин | Без re-accept | Без re-accept | РЕАЛИЗОВАНО логин |

**RU:** Подписи Privacy/Rules в футере главной — **не ссылки**.

**BG:** Етикетите Privacy/Rules в футъра — **не са връзки**.

## Где показывать уведомления / Къде да се показват

**RU:** (1) письмо/лендинг invite — ссылки на Privacy + ОУ; (2) установка пароля — матрица принятия; (3) первый успешный вход — если не завершено; (4) обновление политик — re-accept или уведомление (**адвокат**).

**BG:** (1) покана — връзки към Privacy + ОУ; (2) задаване на парола — матрица; (3) първи вход; (4) обновяване — re-accept (**адвокат**).

---

# 10. СОГЛАШЕНИЯ И ЧЕКБОКСЫ ПОЛЬЗОВАТЕЛЕЙ
# 10. СПОРАЗУМЕНИЯ И ОТМЕТКИ НА ПОТРЕБИТЕЛИТЕ

**RU:** Не создавать лишние согласия ОРЗД. Различать: принятие договора (ОУ); ознакомление с уведомлением (Privacy); законный интерес / договор / правно задължение; настоящее согласие (marketing, иногда cookies/push).

**BG:** Не създавайте излишни съгласия по ОРЗД. Разграничавайте: приемане на договор (ОУ); запознаване с известие (Privacy); легитимен интерес / договор / правно задължение; действително съгласие (маркетинг, понякога cookies/push).

| ID | RU | BG | Обяз.? | Основание-кандидат | Нужно ли согласие ОРЗД? | Бандл | Доказательства | Статус |
|----|----|----|--------|--------------------|-------------------------|-------|----------------|--------|
| A1 | Принятие Общих условий | Приемане на Общи условия | Вероятно да | Договор | Нет (acceptance ≠ consent) | Часто с A2 | timestamp, version, audit | ОТСУТСТВУЕТ |
| A2 | Ознакомление с Политикой за поверителност | Запознаване с Политика за поверителност | Вероятно да | Прозрачност чл. 13/14 | Нет (acknowledgement) | С A1 | timestamp, version | ОТСУТСТВУЕТ |
| A3 | Cookie (несущественные) | Бисквитки (несъществени) | Если есть | Consent ePrivacy | Да, если несъществени | Отдельно | Cookie Policy ver | ОТСУТСТВУЕТ; essential Auth — **адвокат** |
| A4 | Эл. сервисные сообщения | Ел. служебни съобщения | **Адвокат** | Договор / LI / consent | Часто нет для service | Не с marketing | prefs | ОТСУТСТВУЕТ |
| A5 | Email-предпочтения | Email предпочитания | UI реком. | Preference | Не всегда | Soft | — | ОТСУТСТВУЕТ |
| A6 | Push | Push | Если push | Consent | Часто да | Отдельно | — | Н/П пока нет push |
| A7 | Маркетинг | Маркетинг | Опционально | Consent | **Да** | **Никогда** с A1/A2 | opt-in | ОТСУТСТВУЕТ |
| A8 | Согласие на обработку как единственное основание | Съгласие като единствено основание | Только если basis=consent | Consent | Избегать если есть иное | Не force | Art. 7(3) | **Адвокат** — вероятно не primary |
| A9 | Правила здания | Правилник на сградата | **Адвокат** | Договор с комплексом | Acknowledgement | Отдельно | rules ver | ОТСУТСТВУЕТ |
| A10 | Идентичность УК/админа | Идентичност на УК/админ | Рекоменд. | Прозрачность | Info notice | С A2 | — | ОТСУТСТВУЕТ |
| A11 | Условия e-voting / собраний | Условия за е-гласуване / събрания | При голосовании | **Адвокат**/ЗУЕС | Возможно | Module gate | ruleset ver | ЧАСТИЧНО продукт |
| A12 | Эл. доставка уведомлений ЗУЕС | Ел. доставка по ЗУЕС | **Адвокат** | Договор/consent/закон | Открытый вопрос | Отдельно | — | ОТСУТСТВУЕТ |
| A13 | Условия гостя | Условия за гост | Если guest_mode | Договор | Acceptance | Guest | — | ОТСУТСТВУЕТ |
| A14 | Условия нанимателя | Условия за наемател | Если tenants | Договор | Acceptance | Tenant | — | ОТСУТСТВУЕТ / модель частична |
| A15 | Декларация представителя | Декларация на представител | Proxies | **Адвокат**/ЗУЕС | Declaration | Meeting | form ver | ЧАСТИЧНО RPC |
| A16 | Декларация точности данных | Декларация за точност | Рекоменд. | Договор | Soft | С A1 | — | ОТСУТСТВУЕТ |

### Доказательства принятия / Доказателства за приемане

**RU:** Хранить: subject_id, document_key, version, accepted_at, locale; опционально ip_hash, user_agent (**адвокат**). Не считать accept invite = accept ОУ. Marketing A7 — default off. Блокировка кабинета до A1+A2 — если адвокат потребует. Re-accept при существенном изменении. Отзыв: для consent (A7/A3) — механизм отказа; для ОУ — прекращение использования.

**BG:** Съхранявайте: subject_id, document_key, version, accepted_at, locale; опционално ip_hash, user_agent (**адвокат**). Accept invite ≠ accept ОУ. Marketing — off по подразбиране. Блокиране до A1+A2 — ако адвокатът изиска. Re-accept при съществена промяна. Оттегляне: за consent — opt-out; за ОУ — спиране на ползване.

---

# 11. ОРЗД/GDPR: РОЛИ И ОБРАБОТКА
# 11. ОРЗД/GDPR: РОЛИ И ОБРАБОТВАНЕ

**RU:** В репозитории нет опубликованной Политики за поверителност, DSAR UI, готового RoPA. Кандидаты ролей — не выводы.

**BG:** Няма публикувана Политика за поверителност, DSAR UI, готов RoPA. Кандидатите за роли не са изводи.

| Процесс | Данные | Субект | Цель | Админ. (кандидат) | Обработващ (кандидат) | Основание (кандидат) | Модуль |
|---------|--------|--------|------|-------------------|----------------------|----------------------|--------|
| Auth | email, session | Owner/guest/staff | Достъп | УК/ЕС или open | ALSYD (+Supabase) | Договор / LI | Auth |
| Invite | email, property | Invitee | Onboarding | УК/ЕС | ALSYD | Договор / LI | Invites |
| Книга | имена, контакты, дялове | Собственици | Регистър | УК/ЕС | ALSYD | Закон?/LI/договор — **open** | Property Book |
| Guest | guest email | Guest | Временен достъп | УК/ЕС | ALSYD | Договор/consent? | guest_mode |
| Finance ledgers | суми, имоти | Собственици | Счетоводство на комплекса | УК/ЕС | ALSYD | Договор/задължение? | Finance |
| Requests/WO | текст, файлове | Residents/staff | Поддръжка | УК/ЕС | ALSYD | Договор/LI | Requests |
| Chat | съобщения | Users | Комуникация | УК/ЕС | ALSYD | Договор/LI | Chat |
| Polls | гласове | Owners | Анкети | УК/ЕС | ALSYD | LI/consent | Polls |
| Meetings | snapshots, votes | Owners/proxies | ЗУЕС | УК/ЕС | ALSYD | Закон?/open | Meeting Core |
| Platform Support | tickets | Admin/ALSYD | B2B support | **ALSYD** (likely) | — | Договор | platform_support |
| Platform billing | invoice rows | Customer contacts | Такси ALSYD | **ALSYD** | — | Договор | billing |
| User Activation | email, activity | Owners | Метрики | УК/ЕС или ALSYD — open | ALSYD | LI/договор | user_activation |

**RU:** Права субъектов (достъп, изтриване, преносимост), breach 72h, DPIA, DPO — решение/внедрение отсутствуют или требуют адвоката. Auth metadata в admin RPC — безопасные поля, но всё ещё лични данни.

**BG:** Правата на субектите, breach, DPIA, DPO — липсват или изискват адвокат. Auth metadata са „safe columns“, но остават лични данни.

---

# 12. ПОДИЗПЪЛНИТЕЛИ И ТРЕТИ ЛИЦА
# 12. ПОДИЗПЪЛНИТЕЛИ И ТРЕТИ СТРАНИ

| Услуга | Доказательство | Данные | Роль-кандидат | Регион | DPA | Статус |
|--------|----------------|--------|---------------|--------|-----|--------|
| Supabase | deps + env | Auth/DB/files | Sub-processor | **CONFIRM** | ДА | Подтверждён |
| Vercel | NEXT_PUBLIC_VERCEL_* | logs/hosting | Hosting sub-processor | **CONFIRM** | ДА | Подтверждён |
| Email API | — | — | — | — | — | **НЕ в deps**; LOCAL_ONLY |
| SMS / PSP / Analytics / Sentry | — | — | — | — | — | **НЕ найдены** |
| Netcup | вне репо brief | — | — | — | — | **Проверить ops вне репо** |

**RU/BG:** При включении Master sync — обновить annex до live delivery.

---

# 13. КНИГА СОБСТВЕННОСТИ
# 13. КНИГА НА ЕТАЖНАТА СОБСТВЕНОСТ

**RU:** Источник истины для Meeting Core и доступа. Дизайн ориентирован на понятия ЗУЕС (дялове, ideal parts) — **не сертификация**. Ввод — админ; формальной аттестации собственником нет. Смена собственности — частично/stub. Риск: ошибочная книга → неверные кворум/приглашения. ALSYD как обработващ следует инструкциям клиента; клиент отвечает за законность содержания (**draft posture**).

**BG:** Източник на истина за Meeting Core и достъп. Дизайнът е ориентиран към ЗУЕС — **не е сертификация**. Въвеждане — админ; няма формална атестация от собственик. Промяна на собственост — частична. Риск: грешна книга → грешен кворум/покани. ALSYD като обработващ следва указанията; клиентът носи отговорност за законосъобразността (**draft**).

**RU:** Требуется проверка болгарским юристом — можно ли считать Книгу «официальным регистром» и каково правовое основание хранения.

**BG:** Необходима е проверка от български адвокат — дали Книгата може да се третира като „официален регистър“ и какво е правното основание.

---

# 14. ОБЩИЕ СОБРАНИЯ И ЭЛЕКТРОННОЕ ГОЛОСОВАНИЕ
# 14. ОБЩИ СЪБРАНИЯ И ЕЛЕКТРОННО ГЛАСУВАНЕ

**RU:** Не утверждать юридическую силу онлайн-голосования, сканов подписей или in-app уведомлений до проверки по ЗУЕС. Продукт: `needs_legal_signoff`.

**BG:** Не твърдете правна сила на онлайн гласуване, сканирани подписи или in-app известия преди проверка по ЗУЕС. Продукт: `needs_legal_signoff`.

| Тема | Продукт | Документ | Адвокат |
|------|---------|----------|---------|
| Покана | PARTIAL/IMPL | Шаблон BG + доказательство доставки | ДА |
| Протокол размещения | brief | Подписанный PDF + фото | ДА |
| Регистрация | IMPL | Списък | ДА |
| Proxies max 3 | PARTIAL | Пълномощно | ДА |
| Кворум | IMPL | Immutable checks | ДА |
| Гласуване | IMPL target | Запис | ДА |
| Хибрид | PARTIAL | Правилник + идентификация | ДА |
| Протокол ОС | PARTIAL WET_SCAN | Реквизиты | ДА |
| Delivery log | PARTIAL | Канал+доказателство | ДА |

**RU:** Вопросы адвокату по собраниям — см. §23 п.16–18 и `08_`.

**BG:** Въпроси — §23 т.16–18 и `08_`.

---

# 15. ПЛАТЕЖИ, СЧЕТА, ДДС
# 15. ПЛАЩАНИЯ, ФАКТУРИ, ДДС

**RU:** `platform_billing_invoices` — **внутренний коммерческий документ** приложения, режим `awaiting_master`. **Не считать** автоматически болгарской данъчна фактура. Леджеры таксы/utilities — учёт комплекса, не эквайринг ALSYD. PSP в зависимостях нет. Нужны: оферта setup, данъчни фактури из учётной системы, кредитни известия, уведомления о просрочке/приостановке, учёт ДДС — **адвокат + счетоводител**.

**BG:** `platform_billing_invoices` е **вътрешен търговски запис**, не автоматично данъчна фактура. Леджерите са на комплекса. Няма PSP. Нужни: оферта, данъчни фактури, кредитни известия, просрочие/спиране, ДДС — **адвокат + счетоводител**.

---

# 16. ПОДДЕРЖКА, ЧАТЫ, КОММУНИКАЦИИ
# 16. ПОДДРЪЖКА, ЧАТОВЕ, КОМУНИКАЦИИ

**RU:** Platform Support ≠ чат жильцов. Заявки/WO, вложения (private storage), retention не формализованы. Доказательственная сила чата — **адвокат**. Экспорт для споров — пробел. Честность доставки: LOCAL_ONLY / PROVIDER_NOT_CONFIGURED.

**BG:** Platform Support ≠ чат с жильци. Retention не е формализиран. Доказателствена сила — **адвокат**. Експорт — пропуск. Честна доставка: LOCAL_ONLY / PROVIDER_NOT_CONFIGURED.

---

# 17. САЙТ, COOKIES, РАСКРЫТИЯ
# 17. УЕБСАЙТ, БИСКВИТКИ, РАЗКРИВАНИЯ

| Элемент | RU статус | BG статус |
|---------|-----------|-----------|
| Essential Auth cookies | Есть (Supabase SSR) | Има |
| Analytics cookies | Не найдены | Не са намерени |
| Cookie banner | Нет | Няма |
| Рабочая ссылка Privacy | Нет | Няма |
| ЕИК / седалище на сайте | Нет | Няма |
| Общи условия link | Нет | Няма |

**RU:** Являются ли Auth cookies строго необходимыми без баннера — вопрос 25 адвокату.

**BG:** Дали Auth cookies са строго необходими без банер — въпрос 25.

---

# 18. ИНТЕЛЛЕКТУАЛЬНАЯ СОБСТВЕННОСТЬ И ЛИЦЕНЗИРОВАНИЕ
# 18. ИНТЕЛЕКТУАЛНА СОБСТВЕНОСТ И ЛИЦЕНЗИРАНЕ

**RU:** В договоре зафиксировать: ПО ALSYD — собственность ALSYD; клиенту — неисключительная лицензия на комплекс; данные клиента — собственность клиента; UGC — лицензия оператору; логотипы/фото комплекса; OSS; database rights; документация; custom vs reusable modules. В продукте IP-оговорки **отсутствуют**.

**BG:** В договора: софтуерът е на ALSYD; неисключителен лиценз за комплекса; данните на клиента са негови; UGC лиценз; лога/снимки; OSS; права върху БД; документация; custom vs reusable. В продукта IP клаузи **липсват**.

---

# 19. БЕЗОПАСНОСТЬ, РЕЗЕРВНЫЕ КОПИИ, ИНЦИДЕНТЫ
# 19. СИГУРНОСТ, РЕЗЕРВНИ КОПИЯ, ИНЦИДЕНТИ

**RU:** Техконтроль частичен (RLS, SECURITY DEFINER). Корпоративные политики S-01…S-05 в репо как утверждённые PDF **отсутствуют**: IS policy, IR/breach, backup/DR, staff confidentiality, production access register.

**BG:** Технически контрол е частичен. Корпоративните политики S-01…S-05 като одобрени PDF **липсват**.

---

# 20. ПРЕКРАЩЕНИЕ И HANDOVER
# 20. ПРЕКРАТЯВАНЕ И HANDOVER

**RU:** При расторжении: A-13 exit/export; A-24 data handover; D-03 domain; D-04 infra; отзыв админов; прекращение Platform Support; биллинг закрытие. Смена УК/клиента — отдельный протокол полномочий и контроллера данных (**адвокат**).

**BG:** При прекратяване: A-13; A-24; D-03; D-04; отнемане на админи; спиране на support; затваряне на биллинг. Смяна на УК — отделен протокол (**адвокат**).

---

# 21. ЧЕКЛИСТ ПЕРВОГО КОММЕРЧЕСКОГО ЗАПУСКА
# 21. ЧЕКЛИСТ ЗА ПЪРВИ ТЪРГОВСКИ СТАРТ

1. Квалификация клиента (УК / етажна собственост / иное) **(L)**  
2. Полномочия подписанта **(L)**  
3. Договор MSA + Order Form  
4. DPA + subprocessors  
5. Данные получателя услуги / ДДС номер  
6. Домен — авторизация  
7. Инфраструктура (Supabase/Vercel/backup)  
8. Админы + MFA **(P)**  
9. Privacy/ОУ URL live **(P)**  
10. Версии политик загружены **(P)**  
11. Приглашения из Книги  
12. First-login acceptance **(P)** — сейчас отсутствует  
13. RoPA **(L/ops)**  
14. Раскрытие подизпълнителей  
15. Учётные фактуры (не только app rows) **(L/accountant)**  
16. Platform Support; честный Master mode  
17. Security checks  
18. Письменный go-live  
19. Handover protocol  
20. Compliance calendar  

**RU/BG:** Meeting Core не считать юридически production-ready до снятия `needs_legal_signoff`.

---

# 22. ПРОБЕЛЫ ВНЕДРЕНИЯ (20 / 20)
# 22. ПРОПУСКИ В ИМПЛЕМЕНТАЦИЯТА (20 / 20)

| # | RU | BG | Область | Серьёзность |
|---|----|----|---------|-------------|
| 1 | Нет страницы Privacy; футер без ссылок | Няма Privacy страница; футър без връзки | GDPR | High |
| 2 | Нет страницы Общих условий | Няма Общи условия | Договор UX | High |
| 3 | Нет чекбоксов/хранилища версий accept | Няма отметки/хранилище за accept | First login | High |
| 4 | Нет Cookie Policy / анализа баннера | Няма Cookie Policy / анализ | ePrivacy | Med–High |
| 5 | Нет DSAR / erasure / export self-service | Няма DSAR / изтриване / експорт | GDPR rights | High |
| 6 | Нет UI/PDF DPA и subprocessors для клиента | Няма UI/PDF DPA за клиента | Contracts | High |
| 7 | Platform invoices ≠ данъчни фактури | Platform invoices ≠ данъчни фактури | Billing | High |
| 8 | Нет email/SMS; LOCAL_ONLY | Няма email/SMS; LOCAL_ONLY | ЗУЕС notices | High |
| 9 | Meeting Core needs_legal_signoff | Meeting Core needs_legal_signoff | Meetings | High |
| 10 | Нет domain handover в ops pack | Няма domain handover в ops | Domain | Medium |
| 11 | Нет breach/IR runbooks в репо | Няма breach/IR в репо | Security | High |
| 12 | Нет retention jobs/расписаний | Няма retention jobs | GDPR | High |
| 13 | Нет отдельных accept для guest/tenant/proxy | Няма отделни accept за guest/tenant/proxy | Roles | Medium |
| 14 | Нет marketing consent (OK если нет маркетинга) | Няма marketing consent | GDPR | Low if unused |
| 15 | Неясна сторона ОУ (ALSYD vs УК) в UX | Неясна страна по ОУ в UX | Terms | High |
| 16 | Master Control live delivery выключен | Master live delivery изключен | Support/billing | Medium |
| 17 | Ownership change workflow stub | Ownership change stub | Book | Medium |
| 18 | Нет экспорта chat/support для споров | Няма експорт chat/support | Evidence | Medium |
| 19 | Нет ЕИК/седалище на сайте комплекса | Няма ЕИК/седалище на сайта | Disclosure | Medium |
| 20 | Нет flow обновления политик / re-accept | Няма flow за обновяване / re-accept | Compliance ops | Medium |

---

# 23. ВОПРОСЫ АДВОКАТУ (25 / 25)
# 23. ВЪПРОСИ КЪМ АДВОКАТА (25 / 25)

**RU:** Контекст: ALSYD EOOD; SaaS для комплексов; изолированная БД/домен; Platform Support B2B; Meeting Core ориентирован на ЗУЕС.

**BG:** Контекст: ALSYD ЕООД; SaaS за комплекси; изолирана БД/домейн; Platform Support B2B; Meeting Core към ЗУЕС.

### Классификация / Класификация
1. Каков правовой статус ALSYD для этого продукта? / Какъв е правният статут на ALSYD за този продукт?  
2. «Агрегатор» — юридически корректно или только маркетинг? / „Агрегатор“ — правно коректно или само маркетинг?  
3. Является ли ALSYD поставщиком услуги информационного общества? / Доставчик ли е ALSYD на услуга на информационното общество?  
4. Является ли ALSYD посредником/хостинг-провайдером по праву ЕС/Болгарии? / Посредник/хостинг доставчик ли е ALSYD?  
5. Применяется ли DSA к каким-либо функциям? / Прилага ли се DSA към някоя функция?

### Защита данных / Защита на данните
6. Кто администратор/обработващ по каждому потоку (книга, auth, собрания, чат, support, биллинг ALSYD, user activation)?  
7. Нужна ли DPIA? / Необходима ли е DPIA?  
8. Нужен ли DPO для ALSYD и/или комплекса? / Необходим ли е DPO?  
9. Есть ли регистрации/уведомления в Болгарии? / Има ли регистрации/уведомления в България?  
10. Какие сроки хранения для книги, собраний, чата, support, биллинга?  
11. Нужно ли явно согласие на электронные служебные уведомления / кабинет?  
12. Что обязательно в ОУ vs Политика за поверителност и **с кем** договор у конечного пользователя?

### Стороны договора / Страни по договор
13. Может ли етажна собственост быть получателем SaaS?  
14. Кто вправе подписывать за етажна собственост?  
15. Если клиент — УК, кто администратор данных жильцов?

### Собрания / Събрания (ЗУЕС)
16. Какие точные документы нужны для электронных/гибридных ОС?  
17. Какие электронные подтверждения достаточны для покана и протокол размещения?  
18. Юридическая сила онлайн-кворума/голосования и WET_SCAN протоколов?

### Коммерция / Търговия
19. Требования к фактурам/учёту для setup и месячной платы ALSYD?  
20. Применимо ли потребительское право (B2B vs B2C)?  
21. Отличаются ли юридически акаунты guest/tenant от собственника?

### Домен и выход / Домейн и изход
22. Какая модель владения доменом наиболее безопасна?  
23. Что обязательно при прекращении или смене УК (данные, домен, админы)?

### Ответственность / Отговорност
24. Какие оговорки об ответственности допустимы/исполнимы?

### Cookies
25. Являются ли cookies Supabase Auth «строго необходимыми» без баннера на landing и в приложении?

---

# 24. РЕШЕНИЯ ДО ЗАПУСКА
# 24. РЕШЕНИЯ ПРЕДИ СТАРТ

**RU (TOP 10 из summary):**  
1) Точная классификация ALSYD. 2) Допустимость слова «агрегатор». 3) Администратор vs обработващ по потокам. 4) Кто подписывает за етажна собственост vs УК. 5) Достаточность электронных покана/протоколов/кворума по ЗУЕС. 6) Нужно ли consent для аккаунта или иные основания. 7) Форма фактуры/ДДС vs app commercial document. 8) Модель домена и ответственность. 9) Сроки хранения. 10) DPIA/DPO и регистрации в Болгарии.

**BG (TOP 10):**  
1) Точна класификация на ALSYD. 2) Допустимост на „агрегатор“. 3) Администратор vs обработващ. 4) Кой подписва за етажна собственост vs УК. 5) Достатъчност на електронни покани/протоколи/кворум по ЗУЕС. 6) Нужно ли е съгласие за акаунт. 7) Форма на фактура/ДДС. 8) Модел на домейн. 9) Срокове за съхранение. 10) DPIA/DPO и регистрации.

---

# 25. ЮРИДИЧЕСКОЕ СОГЛАСОВАНИЕ
# 25. ПРАВНО СЪГЛАСУВАНЕ

**RU:** Настоящий документ подготовлен для проверки. Он **не** создаёт соответствие закону сам по себе.

**BG:** Документът е за преглед. Той **не** създава съответствие със закона сам по себе си.

### Представитель ALSYD / Представител на ALSYD

| Поле | RU | BG |
|------|----|----|
| Имя / Име | | |
| Должность / Длъжност | | |
| Дата | | |
| Подпись / Подпис | | |

### Болгарский адвокат / Български адвокат

| Поле | RU | BG |
|------|----|----|
| Имя / Име | | |
| Коллегия / регистрация / Адвокатска колегия / рег. № | | |
| Дата | | |
| Подпись / Подпис | | |

### Решения / Решения

| | |
|--|--|
| Decisions approved / Одобрени решения | |
| Outstanding issues / Открити въпроси | |
| Required corrections / Изисквани корекции | |
| Approval status / Статус на одобрение | ☐ Draft · ☐ Reviewed · ☐ Conditionally approved · ☐ Approved · ☐ Rejected |

---

## КОНТРОЛЬ КАЧЕСТВА / КОНТРОЛ НА КАЧЕСТВОТО

| Проверка | Результат |
|----------|-----------|
| Сверка с 16 исходными файлами `docs/legal/` | Выполнено / Извършено |
| Строки реестра из таблицы `00_` | **90 / 90** (summary «72» — ошибка подсчёта источника) |
| Пробелы внедрения | **20 / 20** |
| Вопросы адвокату | **25 / 25** |
| Параллельный RU/BG по разделам | COMPLETE |
| Новые юридические выводы | НЕТ / NO |
| Изменения кода приложения | НЕТ / NO |
| Изменения БД | НЕТ / NO |

---

*Конец документа / Край на документа*  
*Источники: `docs/legal/00_` … `14_`, `LEGAL_PACKAGE_SUMMARY.md`*
