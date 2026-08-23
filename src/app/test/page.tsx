import { supabase } from '@/lib/supabaseClient'

export default async function PropertiesPage() {
  const { data: properties, error: propError } = await supabase
    .from('properties')
    .select('*')
    .order('apartment_number', { ascending: true })

  const { data: requests, error: reqError } = await supabase
    .from('requests')
    .select('*, properties(apartment_number, owner_name)')
    .order('created_at', { ascending: false })

  if (propError || reqError) {
    return <div style={{ padding: 20 }}>Ошибка: {propError?.message || reqError?.message}</div>
  }

  return (
    <div style={{ padding: 20, fontFamily: 'Arial' }}>
      <h1>Список квартир</h1>

      <table border={1} cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 30 }}>
        <thead style={{ background: '#f0f0f0' }}>
          <tr>
            <th>Квартира</th>
            <th>Собственник</th>
            <th>Телефон</th>
            <th>Площадь</th>
            <th>Долг</th>
            <th>Переплата</th>
          </tr>
        </thead>
        <tbody>
          {properties?.map((p) => (
            <tr key={p.id}>
              <td>{p.apartment_number}</td>
              <td>{p.owner_name}</td>
              <td>{p.phone}</td>
              <td>{p.area_sqm} м²</td>
              <td style={{ color: p.debt > 0 ? 'red' : 'black' }}>{p.debt} лв</td>
              <td style={{ color: p.overpayment > 0 ? 'green' : 'black' }}>{p.overpayment} лв</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h1>Заявки на ремонт</h1>
      <table border={1} cellPadding={8} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead style={{ background: '#f0f0f0' }}>
          <tr>
            <th>Дата</th>
            <th>Квартира</th>
            <th>Описание</th>
            <th>Статус</th>
          </tr>
        </thead>
        <tbody>
          {requests?.map((r) => (
            <tr key={r.id}>
              <td>{new Date(r.created_at).toLocaleDateString('ru-RU')}</td>
              <td>{r.properties?.apartment_number} ({r.properties?.owner_name})</td>
              <td>{r.description}</td>
              <td>{r.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}