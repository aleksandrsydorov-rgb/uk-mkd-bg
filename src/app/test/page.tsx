import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { BrandMark } from '@/components/BrandMark';

export const dynamic = 'force-dynamic';

export default async function TestPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return (
      <div className="min-h-screen bg-[#070b0a] p-6 text-white/70">
        Задайте NEXT_PUBLIC_SUPABASE_URL и NEXT_PUBLIC_SUPABASE_ANON_KEY.
      </div>
    );
  }

  const { data: properties, error: propError } = await supabase
    .from('properties')
    .select('*')
    .order('apartment_number', { ascending: true });

  const { data: requests, error: reqError } = await supabase
    .from('requests')
    .select('*, properties(apartment_number, owner_name)')
    .order('created_at', { ascending: false });

  if (propError || reqError) {
    return (
      <div className="min-h-screen bg-[#070b0a] p-6 text-red-200">
        Ошибка: {propError?.message || reqError?.message}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b0a] text-white">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-[#070b0a]/90 px-4 py-3 backdrop-blur md:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <BrandMark />
          <Link href="/" className="text-sm text-white/50 hover:text-white/80">
            ← На главную
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-8 p-4 md:p-6">
        <section>
          <h1 className="mb-4 text-xl font-semibold text-emerald-400">Список квартир</h1>
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.04] text-left text-white/50">
                  <th className="px-3 py-2">Квартира</th>
                  <th className="px-3 py-2">Собственник</th>
                  <th className="px-3 py-2">Телефон</th>
                  <th className="px-3 py-2">Площадь</th>
                  <th className="px-3 py-2">Долг</th>
                  <th className="px-3 py-2">Переплата</th>
                </tr>
              </thead>
              <tbody>
                {properties?.map((p) => (
                  <tr key={p.id} className="border-b border-white/5">
                    <td className="px-3 py-2">{p.apartment_number}</td>
                    <td className="px-3 py-2">{p.owner_name}</td>
                    <td className="px-3 py-2">{p.phone}</td>
                    <td className="px-3 py-2">{p.area_sqm} м²</td>
                    <td className={`px-3 py-2 ${p.debt > 0 ? 'text-red-300' : 'text-white/80'}`}>{p.debt} лв</td>
                    <td className={`px-3 py-2 ${p.overpayment > 0 ? 'text-emerald-300' : 'text-white/80'}`}>{p.overpayment} лв</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h1 className="mb-4 text-xl font-semibold text-emerald-400">Заявки на ремонт</h1>
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.04] text-left text-white/50">
                  <th className="px-3 py-2">Дата</th>
                  <th className="px-3 py-2">Квартира</th>
                  <th className="px-3 py-2">Описание</th>
                  <th className="px-3 py-2">Статус</th>
                </tr>
              </thead>
              <tbody>
                {requests?.map((r) => (
                  <tr key={r.id} className="border-b border-white/5">
                    <td className="px-3 py-2">{new Date(r.created_at).toLocaleDateString('ru-RU')}</td>
                    <td className="px-3 py-2">
                      {r.properties?.apartment_number} ({r.properties?.owner_name})
                    </td>
                    <td className="px-3 py-2">{r.description}</td>
                    <td className="px-3 py-2">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
