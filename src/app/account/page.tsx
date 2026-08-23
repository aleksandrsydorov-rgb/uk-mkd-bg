'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import type { Database } from '@/lib/database.types';
import Link from 'next/link';

type Category = 'сантехника' | 'электрика' | 'уборка' | 'отопление' | 'другое';
type Priority = 'низкий' | 'средний' | 'высокий';

type Property = Database['public']['Tables']['properties']['Row'];
type Request = Database['public']['Tables']['requests']['Row'];

interface MeterReading {
  id: number;
  property_id: number;
  meter_type: 'electricity_day' | 'electricity_night' | 'cold_water';
  value: number;
  reading_date: string;
  submitted_by: string | null;
}

const SUPPORT_RATE_EUR_PER_SQM_YEAR = 8;

export default function AccountPage() {
  const [devEmail, setDevEmail] = useState<string>('');
  const [emailInput, setEmailInput] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [property, setProperty] = useState<Property | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [meterReadings, setMeterReadings] = useState<{
    electricity_day: MeterReading[];
    electricity_night: MeterReading[];
    cold_water: MeterReading[];
  }>({ electricity_day: [], electricity_night: [], cold_water: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('dev_email') : null;
    if (saved) {
      setDevEmail(saved);
      setEmailInput(saved);
    }
  }, []);

  useEffect(() => {
    async function load() {
      if (!devEmail) return;
      setLoading(true);
      setError(null);
      try {
        const { data: propData, error: propErr } = await supabase
          .from('properties')
          .select('*')
          .eq('owner_email', devEmail)
          .maybeSingle();
        if (propErr) throw propErr;
        if (!propData) {
          setProperty(null);
          setRequests([]);
          setMeterReadings({ electricity_day: [], electricity_night: [], cold_water: [] });
          setError('Не найдена квартира для этого email.');
          return;
        }
        setProperty(propData);

        const { data: reqData, error: reqErr } = await supabase
          .from('requests')
          .select('*')
          .eq('property_id', propData.id)
          .order('created_at', { ascending: false });
        if (reqErr) throw reqErr;
        setRequests(reqData ?? []);

        const [dayRes, nightRes, waterRes] = await Promise.all([
          supabase
            .from('meter_readings')
            .select('*')
            .eq('property_id', propData.id)
            .eq('meter_type', 'electricity_day')
            .order('reading_date', { ascending: false })
            .limit(2),
          supabase
            .from('meter_readings')
            .select('*')
            .eq('property_id', propData.id)
            .eq('meter_type', 'electricity_night')
            .order('reading_date', { ascending: false })
            .limit(2),
          supabase
            .from('meter_readings')
            .select('*')
            .eq('property_id', propData.id)
            .in('meter_type', ['cold_water_1', 'cold_water_2', 'cold_water'])
            .order('reading_date', { ascending: false })
            .limit(2),
        ]);

        if (dayRes.error && dayRes.error.code !== 'PGRST116') console.error(dayRes.error);
        if (nightRes.error && nightRes.error.code !== 'PGRST116') console.error(nightRes.error);
        if (waterRes.error && waterRes.error.code !== 'PGRST116') console.error(waterRes.error);

        setMeterReadings({
          electricity_day: (dayRes.data ?? []) as MeterReading[],
          electricity_night: (nightRes.data ?? []) as MeterReading[],
          cold_water: (waterRes.data ?? []) as MeterReading[],
        });
      } catch (e: any) {
        setError(e?.message ?? 'Ошибка загрузки данных');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [devEmail]);

  const debtColor = useMemo(() => {
    const d = Number(property?.debt ?? 0);
    if (d <= 0) return 'text-emerald-300';
    if (d < 100) return 'text-yellow-300';
    return 'text-red-400';
  }, [property]);

  const overColor = useMemo(() => {
    const o = Number(property?.overpayment ?? 0);
    if (o <= 0) return 'text-emerald-300';
    return 'text-emerald-200';
  }, [property]);

  const annualSupportFeeEur = useMemo(() => {
    if (!property?.area_sqm) return 0;
    return property.area_sqm * SUPPORT_RATE_EUR_PER_SQM_YEAR;
  }, [property]);

  function renderMeterBlock(
    label: string,
    unit: string,
    readings: MeterReading[]
  ) {
    const current = readings[0] ?? null;
    const previous = readings[1] ?? null;
    const consumption =
      current && previous ? current.value - previous.value : null;

    return (
      <div className="rounded-xl border border-gray-700 bg-gray-900/30 p-4">
        <div className="text-sm text-gray-400">{label}</div>
        <div className="mt-3 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Текущее:</span>
            <span className="text-2xl font-semibold text-gray-100">
              {current !== null ? `${current.value.toFixed(2)} ${unit}` : ''}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Предыдущее:</span>
            <span className="text-lg font-medium text-gray-200">
              {previous !== null ? `${previous.value.toFixed(2)} ${unit}` : ''}
            </span>
          </div>
          {consumption !== null && (
            <div className="flex items-center justify-between border-t border-gray-700 pt-2 mt-2">
              <span className="text-sm text-gray-400">Потребление за период:</span>
              <span className="text-lg font-semibold text-emerald-300">
                {consumption.toFixed(2)} {unit}
              </span>
            </div>
          )}
        </div>
        <div className="mt-2 text-xs text-gray-500">
          {current
            ? `Последнее обновление: ${new Date(current.reading_date).toLocaleString('ru-RU')}`
            : 'Нет данных'}
        </div>
        {previous && (
          <div className="text-xs text-gray-500">
            Предыдущее: {new Date(previous.reading_date).toLocaleString('ru-RU')}
          </div>
        )}
      </div>
    );
  }

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('другое');
  const [priority, setPriority] = useState<Priority>('средний');
  const [photo, setPhoto] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const email = emailInput.trim();
    if (!email) return;
    localStorage.setItem('dev_email', email);
    setDevEmail(email);
  }

  function handleLogout() {
    localStorage.removeItem('dev_email');
    setDevEmail('');
    setProperty(null);
    setRequests([]);
    setError(null);
    setEmailInput('');
  }

  async function uploadPhotoIfAny(file: File | null) {
    if (!file || !property) return null;
    const fileExt = file.name.split('.').pop();
    const safeExt = fileExt ? fileExt.toLowerCase() : 'jpg';
    const filePath = `${property.id}/${Date.now()}-${Math.random().toString(16).slice(2)}.${safeExt}`;
    const { data: uploadData, error: uploadErr } = await supabase.storage
      .from('request-photos')
      .upload(filePath, file, { upsert: true });
    if (uploadErr) throw uploadErr;
    const publicUrl = supabase.storage.from('request-photos').getPublicUrl(uploadData.path).data.publicUrl;
    return publicUrl;
  }

  async function handleCreateRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!property || !devEmail) return;
    const sub = subject.trim();
    const desc = description.trim();
    if (!sub || !desc) return;
    setCreating(true);
    setError(null);
    try {
      let photoUrl: string | null = null;
      if (photo) photoUrl = await uploadPhotoIfAny(photo);

      const { error: insertErr } = await supabase.from('requests').insert({
        property_id: property.id,
        subject: sub,
        description: desc,
        status: 'новая',
        priority,
        category,
        owner_name: property.owner_name ?? '',
        owner_phone: property.owner_phone ?? '',
        photo_url: photoUrl,
      });
      if (insertErr) throw insertErr;

      const { data: reqData, error: reqErr } = await supabase
        .from('requests')
        .select('*')
        .eq('property_id', property.id)
        .order('created_at', { ascending: false });
      if (reqErr) throw reqErr;
      setRequests(reqData ?? []);
      setSubject('');
      setDescription('');
      setCategory('другое');
      setPriority('средний');
      setPhoto(null);
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка создания заявки');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Личный кабинет</h1>
          {devEmail ? (
            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm hover:bg-gray-700"
            >
              Выйти
            </button>
          ) : (
            <Link href="/" className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm hover:bg-gray-700">
              На главную
            </Link>
          )}
        </div>

        {!devEmail && (
          <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-sm text-gray-300">Email</label>
                <input
                  className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="ivan.petrov@example.com"
                  type="email"
                  autoComplete="email"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium text-gray-900 hover:bg-emerald-400"
              >
                Войти (dev без кода)
              </button>
              <p className="text-xs text-gray-400">Режим разработки  данные подгружаются по email владельца.</p>
            </form>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-900/20 p-4 text-red-200">
            {error}
          </div>
        )}

        {devEmail && loading && (
          <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
            Загрузка данных...
          </div>
        )}

        {devEmail && !loading && property && (
          <>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
                <h2 className="text-lg font-semibold text-emerald-200">Ваша квартира</h2>
                <div className="mt-4 space-y-2 text-sm text-gray-200">
                  <div>Номер: <span className="text-gray-100">{property.apartment_number}</span></div>
                  <div>Этаж: <span className="text-gray-100">{property.floor}</span></div>
                  <div>Площадь: <span className="text-gray-100">{property.area_sqm} м</span></div>
                  <div>Статус: <span className="text-gray-100">{property.status}</span></div>
                  <div>Тип владельца: <span className="text-gray-100">{property.owner_type ?? 'физическое лицо'}</span></div>
                  {property.company_name && (
                    <div>Компания: <span className="text-gray-100">{property.company_name}</span></div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
                <h2 className="text-lg font-semibold text-emerald-200">Финансы</h2>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Задолженность:</span>
                    <span className={`${debtColor} font-medium`}>
                      {Number(property.debt ?? 0).toFixed(2)} EUR
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Переплата:</span>
                    <span className={`${overColor} font-medium`}>
                      {Number(property.overpayment ?? 0).toFixed(2)} EUR
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-gray-700 pt-2 mt-2">
                    <span className="text-gray-300">Такса поддержки (годовая):</span>
                    <span className="font-medium text-gray-100">
                      {annualSupportFeeEur.toFixed(2)} EUR
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 text-right">
                    {SUPPORT_RATE_EUR_PER_SQM_YEAR} /мгод  {property.area_sqm} м
                  </div>
                </div>
                {property.owner_type === 'юридическое лицо' && (
                  <p className="mt-3 text-xs text-gray-400">
                    Для юридических лиц могут применяться отдельные тарифы (ставка обслуживания будет уточнена в договоре).
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
              <h2 className="text-lg font-semibold text-emerald-200">Показания счётчиков</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {renderMeterBlock('Электроэнергия (день)', 'кВтч', meterReadings.electricity_day)}
                {renderMeterBlock('Электроэнергия (ночь)', 'кВтч', meterReadings.electricity_night)}
                {renderMeterBlock('Холодная вода', 'м', meterReadings.cold_water)}
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-emerald-200">Заявки</h2>
                <div className="text-sm text-gray-400">{requests.length} шт.</div>
              </div>
              <div className="mt-4 space-y-3">
                {requests.length === 0 ? (
                  <div className="text-sm text-gray-400">Нет заявок</div>
                ) : (
                  requests.map((r) => (
                    <div key={r.id} className="rounded-xl border border-gray-700 bg-gray-900/30 p-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-100">{r.subject}</span>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={r.status} />
                          <PriorityBadge priority={r.priority} />
                        </div>
                      </div>
                      {r.description && (
                        <p className="mt-2 text-sm text-gray-400 line-clamp-2">{r.description}</p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
                        <span>Категория: {r.category ?? ''}</span>
                        <span>Дата: {r.created_at ? new Date(r.created_at).toLocaleString('ru-RU') : ''}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
              <h2 className="text-lg font-semibold text-emerald-200">Новая заявка</h2>
              <form onSubmit={handleCreateRequest} className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm text-gray-300">Тема</label>
                  <input
                    className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Кратко опишите проблему"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-300">Категория</label>
                  <select
                    className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as Category)}
                  >
                    <option value="сантехника">Сантехника</option>
                    <option value="электрика">Электрика</option>
                    <option value="уборка">Уборка</option>
                    <option value="отопление">Отопление</option>
                    <option value="другое">Другое</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-300">Приоритет</label>
                  <select
                    className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as Priority)}
                  >
                    <option value="низкий">Низкий</option>
                    <option value="средний">Средний</option>
                    <option value="высокий">Высокий</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-300">Фото (необязательно)</label>
                  <input
                    className="mt-2 w-full text-sm text-gray-300"
                    type="file"
                    accept="image/*"
                    onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm text-gray-300">Описание</label>
                  <textarea
                    className="mt-2 w-full min-h-28 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Опишите проблему подробнее"
                  />
                </div>
                <div className="md:col-span-2">
                  <button
                    disabled={creating}
                    className="w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium text-gray-900 hover:bg-emerald-400 disabled:opacity-60"
                    type="submit"
                  >
                    {creating ? 'Создаём...' : 'Отправить заявку'}
                  </button>
                </div>
              </form>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Вспомогательные компоненты (можно вынести в отдельные файлы)
function StatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const colors: Record<string, string> = {
    новая: 'bg-blue-900/40 text-blue-200 border-blue-700',
    'в работе': 'bg-yellow-900/40 text-yellow-200 border-yellow-700',
    выполнена: 'bg-green-900/40 text-green-200 border-green-700',
    отменена: 'bg-red-900/40 text-red-200 border-red-700',
  };
  const cls = colors[status] ?? 'bg-gray-800 text-gray-300 border-gray-600';
  return (
    <span className={`rounded px-2 py-0.5 text-xs border ${cls}`}>
      {status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return null;
  const colors: Record<string, string> = {
    низкий: 'bg-gray-800 text-gray-300 border-gray-600',
    средний: 'bg-yellow-900/40 text-yellow-200 border-yellow-700',
    высокий: 'bg-red-900/40 text-red-200 border-red-700',
  };
  const cls = colors[priority] ?? 'bg-gray-800 text-gray-300 border-gray-600';
  return (
    <span className={`rounded px-2 py-0.5 text-xs border ${cls}`}>
      {priority}
    </span>
  );
}
