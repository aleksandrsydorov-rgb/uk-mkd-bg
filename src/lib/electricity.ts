export type ElectricityMode = 'owner_and_staff' | 'staff_only' | 'disabled';
export type ElectricitySource = 'owner' | 'staff';

export const DEFAULT_ELECTRICITY_MODE: ElectricityMode = 'owner_and_staff';

export type MeterReadingRow = {
  id: number;
  property_id: number | null;
  meter_type: string | null;
  value: number | null;
  reading_date: string | null;
  submitted_by: string | null;
  created_at?: string;
  submitted_source?: string | null;
  idempotency_key?: string | null;
  electricity_meter_id?: string | null;
};

export type ElectricityMeter = {
  id: string;
  property_id: number;
  meter_number: string;
  initial_day_reading: number;
  initial_night_reading: number;
  installed_at: string;
  retired_at: string | null;
  replacement_reason: string | null;
  assigned_by_email: string;
  created_at: string;
};

export type ElectricityPair = {
  key: string;
  reading_date: string;
  created_at: string;
  day: number | null;
  night: number | null;
  prevDay: number | null;
  prevNight: number | null;
  consumptionDay: number | null;
  consumptionNight: number | null;
  source: ElectricitySource | null;
  submitted_by: string | null;
  electricity_meter_id: string | null;
  meter_number: string | null;
};

export type ElectricitySubmitResult = {
  day_reading_id: number;
  night_reading_id: number;
  property_id: number;
  reading_date: string;
  previous_day: number;
  current_day: number;
  consumption_day: number;
  previous_night: number;
  current_night: number;
  consumption_night: number;
  submitted_source: string;
};

export function parseElectricityMode(value: unknown): ElectricityMode {
  if (value === 'owner_and_staff' || value === 'staff_only' || value === 'disabled') {
    return value;
  }
  return DEFAULT_ELECTRICITY_MODE;
}

export function canSubmitElectricityStaff(role?: string | null, active?: boolean | null) {
  if (active !== true) return false;
  const r = (role ?? '').trim().toLowerCase();
  return r === 'администрация' || r === 'инженер';
}

export function canManageElectricityMeter(role?: string | null, active?: boolean | null) {
  return canSubmitElectricityStaff(role, active);
}

export function activeElectricityMeter(meters: ElectricityMeter[]) {
  return meters.find((m) => m.retired_at == null) ?? null;
}

/** Owner display for the active meter. Previous is never the same pair as current. */
export function electricityActiveMeterReadings(
  pairsNewestFirst: ElectricityPair[],
  meter: ElectricityMeter | null,
) {
  if (!meter) {
    const latest = pairsNewestFirst[0] ?? null;
    return {
      currentDay: latest?.day ?? null,
      currentNight: latest?.night ?? null,
      previousDay: latest?.prevDay ?? null,
      previousNight: latest?.prevNight ?? null,
      readingDate: latest?.reading_date ?? null,
      submitFloorDay: latest?.day ?? null,
      submitFloorNight: latest?.night ?? null,
    };
  }

  const meterPairs = pairsNewestFirst.filter((p) => p.electricity_meter_id === meter.id);
  const current = meterPairs[0] ?? null;
  const prior = meterPairs[1] ?? null;
  const initialDay = Number(meter.initial_day_reading);
  const initialNight = Number(meter.initial_night_reading);

  return {
    currentDay: current?.day ?? null,
    currentNight: current?.night ?? null,
    previousDay: prior?.day ?? initialDay,
    previousNight: prior?.night ?? initialNight,
    readingDate: current?.reading_date ?? null,
    submitFloorDay: current?.day ?? initialDay,
    submitFloorNight: current?.night ?? initialNight,
  };
}

/** Presentation only: strip a leading № / No. so labels like "Счётчик № {n}" are not doubled. */
export function displayElectricityMeterNumber(value?: string | null) {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  return raw.replace(/^(?:№|n[oо]\.?|no\.?)\s*/i, '').trim() || raw;
}

export function pairElectricityReadings(
  rows: MeterReadingRow[],
  meters: ElectricityMeter[] = [],
): ElectricityPair[] {
  const meterById = new Map(meters.map((m) => [m.id, m]));
  const groups = new Map<string, MeterReadingRow[]>();
  for (const row of rows) {
    if (row.meter_type !== 'electricity_day' && row.meter_type !== 'electricity_night') continue;
    const idem = row.idempotency_key?.trim();
    const key = idem
      ? `idemp:${idem}`
      : `legacy:${row.reading_date ?? ''}|${(row.created_at ?? '').slice(0, 19)}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const pairs: ElectricityPair[] = [...groups.entries()].map(([key, list]) => {
    const dayRow = list.find((r) => r.meter_type === 'electricity_day') ?? null;
    const nightRow = list.find((r) => r.meter_type === 'electricity_night') ?? null;
    const sample = dayRow ?? nightRow!;
    const sourceRaw = sample.submitted_source;
    const source: ElectricitySource | null =
      sourceRaw === 'owner' || sourceRaw === 'staff'
        ? sourceRaw
        : sample.submitted_by
          ? 'staff'
          : null;
    const meterId = dayRow?.electricity_meter_id ?? nightRow?.electricity_meter_id ?? null;
    return {
      key,
      reading_date: sample.reading_date ?? '',
      created_at: sample.created_at ?? '',
      day: dayRow?.value != null ? Number(dayRow.value) : null,
      night: nightRow?.value != null ? Number(nightRow.value) : null,
      prevDay: null,
      prevNight: null,
      consumptionDay: null,
      consumptionNight: null,
      source,
      submitted_by: sample.submitted_by,
      electricity_meter_id: meterId,
      meter_number: meterId ? meterById.get(meterId)?.meter_number ?? null : null,
    };
  });

  pairs.sort((a, b) => {
    const dateCmp = String(a.reading_date).localeCompare(String(b.reading_date));
    if (dateCmp !== 0) return dateCmp;
    return String(a.created_at).localeCompare(String(b.created_at));
  });

  let prevDay: number | null = null;
  let prevNight: number | null = null;
  let prevMeterId: string | null | undefined = undefined;
  for (const pair of pairs) {
    const meter = pair.electricity_meter_id ? meterById.get(pair.electricity_meter_id) : undefined;
    if (prevMeterId !== pair.electricity_meter_id) {
      prevDay = meter ? Number(meter.initial_day_reading) : null;
      prevNight = meter ? Number(meter.initial_night_reading) : null;
    }
    pair.prevDay = prevDay;
    pair.prevNight = prevNight;
    pair.consumptionDay = pair.day != null && prevDay != null ? Number((pair.day - prevDay).toFixed(3)) : null;
    pair.consumptionNight = pair.night != null && prevNight != null ? Number((pair.night - prevNight).toFixed(3)) : null;
    if (pair.day != null) prevDay = pair.day;
    if (pair.night != null) prevNight = pair.night;
    prevMeterId = pair.electricity_meter_id;
  }

  return pairs.reverse();
}

export function mapSubmitElectricityError(
  message: string,
): 'lower' | 'datePrev' | 'future' | 'conflict' | 'disabled' | 'staffOnly' | 'noMeter' | 'generic' {
  const msg = message.toLowerCase();
  if (msg.includes('electricity readings are disabled')) return 'disabled';
  if (msg.includes('submitted by the management company') || msg.includes('staff only')) return 'staffOnly';
  if (msg.includes('electricity meter is not assigned') || msg.includes('no active electricity meter')) return 'noMeter';
  if (msg.includes('cannot be lower than previous')) return 'lower';
  if (msg.includes('earlier than previous reading') || msg.includes('earlier than meter installation')) return 'datePrev';
  if (msg.includes('cannot be in the future')) return 'future';
  if (msg.includes('idempotency key conflict')) return 'conflict';
  return 'generic';
}
