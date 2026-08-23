import { supabase } from '@/lib/supabaseClient'

export default async function TestPage() {
  const { data, error } = await supabase.from('requests').select('*').limit(1)
  
  if (error) {
    return <div>Ошибка: {error.message}</div>
  }
  
  return (
    <div>
      <h1>Подключение к Supabase работает!</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  )
}