-- =============================================================================
-- AMADEUS 11 — find admin test water reading (READ-ONLY)
-- =============================================================================
-- Does not DELETE/UPDATE/INSERT. Review rows, then decide cleanup separately.
-- Target: meter TEST-WATER-12, reading 2026-09-23 / 100, submitted_via = staff.
-- =============================================================================

select
  r.id as reading_id,
  r.property_id,
  r.meter_id,
  m.meter_number,
  r.reading_date,
  r.previous_value,
  r.current_value,
  r.consumption_m3,
  r.tariff_eur_per_m3,
  r.charge_amount_eur,
  r.submitted_via,
  r.submitted_by_email,
  r.status,
  r.idempotency_key,
  r.created_at
from public.water_readings as r
join public.water_meters as m
  on m.id = r.meter_id
where m.meter_number = 'TEST-WATER-12'
  and r.reading_date = date '2026-09-23'
  and r.current_value = 100
  and r.submitted_via = 'staff'
order by r.created_at;

select
  l.id as ledger_id,
  l.property_id,
  l.reading_id,
  l.kind,
  l.amount_eur,
  l.note,
  l.recorded_by_email,
  l.idempotency_key,
  l.created_at
from public.water_ledger as l
join public.water_readings as r
  on r.id = l.reading_id
join public.water_meters as m
  on m.id = r.meter_id
where m.meter_number = 'TEST-WATER-12'
  and r.reading_date = date '2026-09-23'
  and r.current_value = 100
  and r.submitted_via = 'staff'
  and l.kind = 'charge'
order by l.created_at;
