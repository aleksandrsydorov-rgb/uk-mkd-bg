'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from 'next/link';

export default function AdminPage() {
  const [staffEmail, setStaffEmail] = useState<string>('');
  const [staffInput, setStaffInput] = useState<string>('');
  const [staff, setStaff] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // ---------- DEV-ЛОГИН СОТРУДНИКА ----------
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('staff_email') : null;
    if (saved) {
      setStaffEmail(saved);
      setStaffInput(saved);
    }
  }, []);

  // ---------- ЗАГРУЗКА СОТРУДНИКА ----------
  useEffect(() => {
    async function loadStaff() {
      if (!staffEmail) return;
      setLoading(true);
      setError(null);
      try {
        const { data, error: staffErr } = await supabase
          .from('staff')
          .select('*')
          .eq('email', staffEmail)
          .maybeSingle();
        if (staffErr) throw staffErr;
        if (!data) {
          setStaff(null);
          setError('Сотрудник с таким email не найден.');
          return;
        }
        setStaff(data);
      } catch (e: any) {
        setError(e?.message ?? 'Ошибка загрузки сотрудника');
      } finally {
        setLoading(false);
      }
    }
    loadStaff();
  }, [staffEmail]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const email = staffInput.trim();
    if (!email) return;
    localStorage.setItem('staff_email', email);
    setStaffEmail(email);
  }

  function handleLogout() {
    localStorage.removeItem('staff_email');
    setStaffEmail('');
    setStaff(null);
    setError(null);
    setStaffInput('');
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Панель управления</h1>
          {staffEmail ? (
            <button
              onClick={handleLogout}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm hover:bg-gray-700"
            >
              Выйти
            </button>
          ) : (
            <Link
              href="/"
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm hover:bg-gray-700"
            >
              На главную
            </Link>
          )}
        </div>

        {!staffEmail && (
          <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-800/40 p-6 max-w-md mx-auto">
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="text-sm text-gray-300">Email сотрудника</label>
                <input
                  className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
                  value={staffInput}
                  onChange={(e) => setStaffInput(e.target.value)}
                  placeholder="admin@uk.com"
                  type="email"
                  autoComplete="email"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium text-gray-900 hover:bg-emerald-400"
              >
                Войти
              </button>
              <p className="text-xs text-gray-400">
                Режим разработки – вход по email из таблицы staff.
              </p>
            </form>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-xl border border-red-800 bg-red-900/20 p-4 text-red-200">
            {error}
          </div>
        )}

        {staffEmail && loading && (
          <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
            Загрузка данных...
          </div>
        )}

        {staffEmail && !loading && staff && (
          <>
            {staff.role === 'администрация' && <AdminDashboard staff={staff} />}
            {staff.role === 'инженер' && <EngineerDashboard staff={staff} />}
            {staff.role === 'уборщик' && <CleanerDashboard staff={staff} />}
            {staff.role === 'бухгалтер' && <AccountantDashboard staff={staff} />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- ДАШБОРД АДМИНИСТРАТОРА ----------
function AdminDashboard({ staff }: { staff: any }) {
  const [stats, setStats] = useState<{
    apartments: number;
    activeRequests: number;
    staffCount: number;
  } | null>(null);
  const [latestRequests, setLatestRequests] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [sending, setSending] = useState(false);

  // Загрузка статистики и объявлений
  useEffect(() => {
    async function load() {
      try {
        const [aptRes, reqRes, staffRes, annRes] = await Promise.all([
          supabase.from('properties').select('*', { count: 'exact', head: true }),
          supabase
            .from('requests')
            .select('*', { count: 'exact', head: true })
            .neq('status', 'завершена'),
          supabase.from('staff').select('*', { count: 'exact', head: true }),
          supabase
            .from('announcements')
            .select('*')
            .order('created_at', { ascending: false }),
        ]);
        const apartments = aptRes.count ?? 0;
        const activeRequests = reqRes.count ?? 0;
        const staffCount = staffRes.count ?? 0;
        setStats({ apartments, activeRequests, staffCount });
        setAnnouncements(annRes.data ?? []);

        const { data: reqData } = await supabase
          .from('requests')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(5);
        setLatestRequests(reqData ?? []);
      } catch (e) {
        console.error(e);
      }
    }
    load();
  }, []);

  // Отправка нового объявления
  async function handleSendAnnouncement(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    const body = newBody.trim();
    if (!title || !body) return;
    setSending(true);
    try {
      const { error: insertErr } = await supabase.from('announcements').insert({
        title,
        body,
        created_by: staff.email,
      });
      if (insertErr) throw insertErr;
      // перезагружаем
      const { data: updated } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false });
      setAnnouncements(updated ?? []);
      setNewTitle('');
      setNewBody('');
    } catch (e: any) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  // Форматирование даты
  function formatDate(date: string) {
    return new Date(date).toLocaleString('ru-RU', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="mt-8 space-y-6">
      {/* Приветствие */}
      <div className="rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
        <h2 className="text-lg font-semibold text-emerald-200">
          {staff.name} (администрация)
        </h2>
        <p className="mt-2 text-sm text-gray-300">
          Полный доступ к управлению домом.
        </p>
      </div>

      {/* Статистика */}
      {stats && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-700 bg-gray-800/20 p-4">
            <h3 className="text-sm font-medium text-gray-400">Квартиры</h3>
            <p className="mt-2 text-2xl font-semibold">{stats.apartments}</p>
          </div>
          <div className="rounded-xl border border-gray-700 bg-gray-800/20 p-4">
            <h3 className="text-sm font-medium text-gray-400">Заявки (активные)</h3>
            <p className="mt-2 text-2xl font-semibold text-yellow-300">
              {stats.activeRequests}
            </p>
          </div>
          <div className="rounded-xl border border-gray-700 bg-gray-800/20 p-4">
            <h3 className="text-sm font-medium text-gray-400">Сотрудники</h3>
            <p className="mt-2 text-2xl font-semibold text-emerald-300">
              {stats.staffCount}
            </p>
          </div>
        </div>
      )}

      {/* Последние заявки */}
      <div className="rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
        <h3 className="mb-3 text-sm font-medium text-gray-400">Последние заявки</h3>
        {latestRequests.length === 0 ? (
          <p className="text-sm text-gray-500">Нет заявок</p>
        ) : (
          <div className="space-y-2">
            {latestRequests.map((r: any) => (
              <div
                key={r.id}
                className="rounded-lg border border-gray-700 bg-gray-900/30 p-3 text-sm"
              >
                <div className="flex justify-between">
                  <span className="font-medium text-gray-200">{r.subject}</span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      r.priority === 'высокий'
                        ? 'bg-red-500/20 text-red-300'
                        : r.priority === 'средний'
                        ? 'bg-yellow-500/20 text-yellow-300'
                        : 'bg-gray-600/50 text-gray-300'
                    }`}
                  >
                    {r.priority}
                  </span>
                </div>
                <div className="mt-1 text-gray-400">
                  Статус: {r.status} — {r.category}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Коммуникация – отправка сообщения */}
      <div className="rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
        <h3 className="mb-4 text-sm font-medium text-gray-400">Отправить объявление жителям</h3>
        <form onSubmit={handleSendAnnouncement} className="space-y-4">
          <div>
            <label className="text-sm text-gray-300">Тема</label>
            <input
              className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Например: Замена стояков"
            />
          </div>
          <div>
            <label className="text-sm text-gray-300">Текст сообщения</label>
            <textarea
              className="mt-2 w-full min-h-24 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
              value={newBody}
              onChange={(e) => setNewBody(e.target.value)}
              placeholder="Подробности..."
            />
          </div>
          <button
            type="submit"
            disabled={sending}
            className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-gray-900 hover:bg-emerald-400 disabled:opacity-60"
          >
            {sending ? 'Отправка...' : 'Отправить'}
          </button>
        </form>
      </div>

      {/* История объявлений */}
      <div className="rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
        <h3 className="mb-3 text-sm font-medium text-gray-400">История объявлений</h3>
        {announcements.length === 0 ? (
          <p className="text-sm text-gray-500">Пока нет отправленных объявлений</p>
        ) : (
          <div className="space-y-3">
            {announcements.map((a: any) => (
              <div
                key={a.id}
                className="rounded-lg border border-gray-700 bg-gray-900/30 p-3"
              >
                <div className="flex justify-between">
                  <h4 className="font-medium text-emerald-200">{a.title}</h4>
                  <span className="text-xs text-gray-500">{formatDate(a.created_at)}</span>
                </div>
                <p className="mt-1 text-sm text-gray-300 whitespace-pre-wrap">{a.body}</p>
                <p className="mt-1 text-xs text-gray-500">Отправитель: {a.created_by}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- ЗАГЛУШКИ ДЛЯ ОСТАЛЬНЫХ РОЛЕЙ ----------
function EngineerDashboard({ staff }: { staff: any }) {
  return (
    <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
      <h2 className="text-lg font-semibold text-emerald-200">
        {staff.name} (инженер)
      </h2>
      <p className="mt-2 text-sm text-gray-300">Раздел для инженера.</p>
    </div>
  );
}

function CleanerDashboard({ staff }: { staff: any }) {
  return (
    <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
      <h2 className="text-lg font-semibold text-emerald-200">
        {staff.name} (уборщик)
      </h2>
      <p className="mt-2 text-sm text-gray-300">Раздел для уборщика.</p>
    </div>
  );
}

function AccountantDashboard({ staff }: { staff: any }) {
  return (
    <div className="mt-8 rounded-2xl border border-gray-800 bg-gray-800/40 p-6">
      <h2 className="text-lg font-semibold text-emerald-200">
        {staff.name} (бухгалтер)
      </h2>
      <p className="mt-2 text-sm text-gray-300">Раздел для бухгалтера.</p>
    </div>
  );
}