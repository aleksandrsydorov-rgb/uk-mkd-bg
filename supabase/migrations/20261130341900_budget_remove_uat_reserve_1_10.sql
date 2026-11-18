-- Remove UAT exemplar budget article 1.10 («Резерв группы 1») when unused.
-- Seeded only as a text-code demo in 20261130341700; not a real catalog item.

delete from public.budget_categories as c
where c.code = '1.10'
  and c.name_ru = 'Резерв группы 1'
  and not exists (select 1 from public.budget_lines bl where bl.category_id = c.id)
  and not exists (select 1 from public.budget_adjustments ba where ba.category_id = c.id)
  and not exists (select 1 from public.uk_expenses ue where ue.budget_category_id = c.id)
  and not exists (
    select 1 from public.uk_expense_opening_imports u where u.budget_category_id = c.id
  );
