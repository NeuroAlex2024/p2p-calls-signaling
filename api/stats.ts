import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

export const config = {
  runtime: 'edge',
};

// Простая защита страницы статистики паролем через query-параметр
// Пример: /api/stats?token=MY_SECRET
const STATS_TOKEN = process.env.STATS_TOKEN ?? '';

export default async function handler(request: Request): Promise<Response> {
  // Если токен задан — проверяем
  if (STATS_TOKEN) {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (token !== STATS_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const { data, error } = await supabase
    .from('analytics_events')
    .select('event_name, count, updated_at')
    .order('count', { ascending: false });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}
