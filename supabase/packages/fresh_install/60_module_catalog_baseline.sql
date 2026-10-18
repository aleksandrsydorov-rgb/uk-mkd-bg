-- =============================================================================
-- IS-9a fresh-install package — module catalog + building_modules shell
-- =============================================================================
-- Required system metadata only. No AMADEUS 11 production building state.
-- building_modules rows left empty — administrator / later migrations decide enablement.
-- =============================================================================

create table if not exists public.module_catalog (
  module_key text primary key,
  default_name text not null,
  category text not null,
  implemented boolean not null default false,
  sort_order integer not null default 0
);

comment on table public.module_catalog is
  'Release-controlled module catalog. One complex = one database; no tenant_id.';

alter table public.module_catalog enable row level security;

revoke all on table public.module_catalog from public;
revoke all on table public.module_catalog from anon;
revoke all on table public.module_catalog from authenticated;

-- System metadata keys (names/categories only — not financial tariffs).
-- R1 live surfaces must seed implemented=true to match IMPLEMENTED_MODULE_KEYS.
-- Meetings / Rental stay false (R1-MT-HIDE). building_modules stays empty (admin enables).
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
  -- R1-MT-HIDE: Meetings not activatable in Distribution R1.0 (schema retained).
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

create table if not exists public.building_modules (
  module_key text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

comment on table public.building_modules is
  'Per-complex module enable flags. Fresh-install: no rows — admin/migrations populate.';

alter table public.building_modules enable row level security;

revoke all on table public.building_modules from public;
revoke all on table public.building_modules from anon;
revoke all on table public.building_modules from authenticated;
