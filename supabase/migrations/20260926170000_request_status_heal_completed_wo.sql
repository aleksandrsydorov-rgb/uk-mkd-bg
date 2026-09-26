-- Heal Request status when linked Work Orders are already completed.
-- Context: complete_work_order gained Request→выполнена in 20260926040000, but
-- idempotent retry on already-completed WO skipped the Request update, leaving
-- pre-fix tickets stuck as "новая" while admin badge counts them as new.
-- No finance / tariff / Module Core changes.

begin;

-- ---------------------------------------------------------------------------
-- complete_work_order: heal linked Request even on idempotent completed retry
-- ---------------------------------------------------------------------------

create or replace function public.complete_work_order(
  p_work_order_id uuid,
  p_completion_note text default null
)
returns public.work_orders
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_staff_id integer;
  v_row public.work_orders;
  v_note text;
begin
  if auth.uid() is null then
    raise exception 'complete_work_order: not authenticated' using errcode = '28000';
  end if;
  v_staff_id := public.current_staff_id();
  if v_staff_id is null then
    raise exception 'complete_work_order: not allowed' using errcode = '42501';
  end if;

  select wo.* into v_row
  from public.work_orders as wo
  where wo.id = p_work_order_id
  for update;

  if not found then
    raise exception 'complete_work_order: not found or not completable' using errcode = 'P0002';
  end if;

  if v_row.assigned_staff_id is distinct from v_staff_id then
    raise exception 'complete_work_order: not allowed' using errcode = '42501';
  end if;

  -- Idempotent retry: still heal linked Request if it never transitioned.
  if v_row.status = 'completed' then
    if v_row.request_id is not null then
      update public.requests as r
         set status = 'выполнена'
       where r.id = v_row.request_id
         and r.status in ('новая', 'в работе');
    end if;
    return v_row;
  end if;

  if v_row.status <> 'in_progress' then
    raise exception 'complete_work_order: not found or not completable' using errcode = 'P0002';
  end if;

  v_note := nullif(btrim(coalesce(p_completion_note, '')), '');

  update public.work_orders as wo
     set status = 'completed',
         completion_note = coalesce(v_note, wo.completion_note),
         completed_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where wo.id = v_row.id
  returning * into v_row;

  if v_row.request_id is not null then
    update public.requests as r
       set status = 'выполнена'
     where r.id = v_row.request_id
       and r.status in ('новая', 'в работе');
  end if;

  return v_row;
end;
$fn$;

revoke all on function public.complete_work_order(uuid, text) from public;
revoke execute on function public.complete_work_order(uuid, text) from anon;
grant execute on function public.complete_work_order(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- One-shot backfill: Request still open, all linked WOs completed (none active)
-- ---------------------------------------------------------------------------

update public.requests as r
   set status = 'выполнена'
 where r.status in ('новая', 'в работе')
   and exists (
     select 1
     from public.work_orders as wo
     where wo.request_id = r.id
       and wo.status = 'completed'
   )
   and not exists (
     select 1
     from public.work_orders as wo
     where wo.request_id = r.id
       and wo.status in ('open', 'in_progress')
   );

commit;
