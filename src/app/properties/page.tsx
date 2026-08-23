'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

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

  if (loading) return <p className="p-4">Загрузка...</p>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Заявки и квартиры</h1>
      <table className="min-w-full border-collapse border border-gray-300">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2">№ квартиры</th>
            <th className="border p-2">Владелец</th>
            <th className="border p-2">Телефон</th>
            <th className="border p-2">Площадь</th>
            <th className="border p-2">Задолженность</th>
            <th className="border p-2">Переплата</th>
            <th className="border p-2">Заявка</th>
            <th className="border p-2">Статус заявки</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((req) => (
            <tr key={req.id} className="hover:bg-gray-50">
              <td className="border p-2">{req.property?.apartment_number}</td>
              <td className="border p-2">{req.property?.owner_name}</td>
              <td className="border p-2">{req.property?.owner_phone}</td>
              <td className="border p-2">{req.property?.area_sqm}</td>
              <td className="border p-2">{req.property?.debt ?? 0} лв.</td>
              <td className="border p-2">{req.property?.overpayment ?? 0} лв.</td>
              <td className="border p-2">{req.description}</td>
              <td className="border p-2">{req.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}