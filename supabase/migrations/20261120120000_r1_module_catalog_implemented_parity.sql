-- =============================================================================
-- R1 module catalog implemented parity
-- =============================================================================
-- Root cause (Internet «Не реализован» after clean install / RC6):
--   20260926200000 promoted internet=true, then
--   20261028120000_is9a_* re-seeded module_catalog with implemented=false for
--   internet / cleaning / security (and left inventory false).
-- UI status comes from get_building_modules_v2 → module_catalog.implemented,
-- not from client IMPLEMENTED_MODULE_KEYS alone.
--
-- This migration restores shipped R1 surfaces to implemented=true to match
-- src/lib/modules.ts IMPLEMENTED_MODULE_KEYS (+ inventory for R1 mandatory #11).
-- Does NOT enable building_modules rows, Email Sending, or Debt Gate.
-- Meetings / Rental stay implemented=false / disabled.
-- =============================================================================

insert into public.module_catalog (module_key, default_name, category, implemented, sort_order)
values
  ('tariffs', 'Тарифы', 'finance', true, 5),
  ('support_fee', 'Такса поддержки', 'finance', true, 10),
  ('capital_repair', 'Капитальный ремонт', 'finance', true, 20),
  ('budget', 'Бюджет', 'finance', true, 30),
  ('water', 'Вода', 'utilities', true, 10),
  ('electricity', 'Электроэнергия', 'utilities', true, 20),
  ('internet', 'Интернет', 'utilities', true, 30),
  ('requests', 'Заявки', 'communication', true, 10),
  ('chat', 'Чат', 'communication', true, 20),
  ('polls', 'Опросы', 'communication', true, 30),
  ('announcements', 'Объявления', 'communication', true, 40),
  ('service_lock', 'Блокировка услуг', 'communication', true, 50),
  ('general_meeting', 'Общие собрания', 'documents', false, 10),
  ('building_documents', 'Документы', 'documents', true, 20),
  ('parking', 'Парковка', 'utilities', false, 40),
  ('security', 'Охрана', 'services', true, 10),
  ('residence_status', 'Статус проживания', 'services', true, 15),
  ('rental', 'Аренда', 'commercial', false, 10),
  ('cleaning', 'Уборка', 'services', true, 20),
  ('maintenance', 'Обслуживание', 'services', false, 30),
  ('access_control', 'Контроль доступа', 'services', false, 40),
  ('contractors', 'Подрядчики', 'services', false, 50),
  ('inventory', 'Инвентарь', 'services', true, 60),
  ('common_areas', 'Общие зоны', 'services', false, 70),
  ('commercial_rentals', 'Коммерческая аренда', 'commercial', false, 20),
  ('guest_mode', 'Гостевой режим', 'services', true, 80),
  ('platform_support', 'Платформа и поддержка', 'services', true, 90),
  ('user_activation', 'Активация пользователей', 'services', true, 100)
on conflict (module_key) do update
  set default_name = excluded.default_name,
      category = excluded.category,
      implemented = excluded.implemented,
      sort_order = excluded.sort_order;

update public.module_catalog
set implemented = false
where module_key in ('general_meeting', 'rental');

update public.building_modules
set enabled = false,
    updated_at = now()
where module_key in ('general_meeting', 'rental')
  and enabled is distinct from false;
