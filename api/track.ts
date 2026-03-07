import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

const VALID_EVENTS = new Set([
  'app_opened',
  'share_clicked',
  'mic_allowed',
  'guest_joined',
  'call_started',
  'call_failed',
]);

export const config = {
  runtime: 'edge',
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  let body: { event?: string; room_id?: string; tg_user_id?: number; reason?: string };
  try {
    body = await request.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const { event, room_id, tg_user_id, reason } = body;

  if (!event || !VALID_EVENTS.has(event)) {
    return new Response('Invalid event', { status: 400 });
  }

  // Атомарный инкремент счётчика через SQL-функцию (upsert + increment)
  const { error: counterError } = await supabase.rpc('increment_event_counter', {
    p_event_name: event,
  });

  if (counterError) {
    console.error('[track] counter error:', counterError);
    return new Response('DB Error', { status: 500 });
  }

  // Детальный лог (best-effort, не возвращаем ошибку если не сработал)
  await supabase.from('analytics_log').insert({
    event_name: event,
    room_id: room_id ?? null,
    tg_user_id: tg_user_id ?? null,
    reason: reason ?? null,
  });

  return new Response('ok', { status: 200 });
}
