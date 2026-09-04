'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import { BrandMark } from '@/components/BrandMark';

type Property = {
  id: number;
  apartment_number: number;
  owner_name: string;
  owner_phone: string;
  area_sqm: number;
  debt: number;
  overpayment: number;
  floor: number;
  status: string;
};

type Request = {
  id: number;
  property_id: number;
  description: string;
  status: string;
  created_at: string;
  property: Property | null;
};

export default function PropertiesPage() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const { data, error } = await supabase
        .from('requests')
        .select('*, property:properties(*)')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Ошибка загрузки:', JSON.stringify(error, null, 2));
        return;
      }
      setRequests(data || []);
      setLoading(false);
    }
    fetchData();
  }, []);

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
      <main className="mx-auto max-w-6xl p-4 md:p-6">
        <h1 className="mb-4 text-xl font-semibold text-emerald-400">Заявки и квартиры</h1>
        {loading ? (
          <p className="text-white/50">Загрузка...</p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.03]">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.04] text-left text-white/50">
                  <th className="px-3 py-2">№ квартиры</th>
                  <th className="px-3 py-2">Владелец</th>
                  <th className="px-3 py-2">Телефон</th>
                  <th className="px-3 py-2">Площадь</th>
                  <th className="px-3 py-2">Задолженность</th>
                  <th className="px-3 py-2">Переплата</th>
                  <th className="px-3 py-2">Заявка</th>
                  <th className="px-3 py-2">Статус заявки</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((req) => (
                  <tr key={req.id} className="border-b border-white/5 hover:bg-white/[0.04]">
                    <td className="px-3 py-2">{req.property?.apartment_number}</td>
                    <td className="px-3 py-2">{req.property?.owner_name}</td>
                    <td className="px-3 py-2">{req.property?.owner_phone}</td>
                    <td className="px-3 py-2">{req.property?.area_sqm}</td>
                    <td className="px-3 py-2">{req.property?.debt ?? 0} лв.</td>
                    <td className="px-3 py-2">{req.property?.overpayment ?? 0} лв.</td>
                    <td className="px-3 py-2">{req.description}</td>
                    <td className="px-3 py-2">{req.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
