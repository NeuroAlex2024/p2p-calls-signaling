/**
 * Легковесный трекер аналитической воронки.
 * Отправляет события через /api/track (serverless function → Supabase).
 * Fire-and-forget: не блокирует UI, ошибки пишет только в console.
 */

export type AnalyticsEvent =
  | 'app_opened'
  | 'share_clicked'
  | 'mic_allowed'
  | 'guest_joined'
  | 'call_started'
  | 'call_failed';

interface TrackPayload {
  event: AnalyticsEvent;
  room_id?: string;
  tg_user_id?: number;
  reason?: string;
}

export function trackEvent(event: AnalyticsEvent, extra?: { room_id?: string; tg_user_id?: number; reason?: string }): void {
  const payload: TrackPayload = {
    event,
    ...extra,
  };

  // Читаем tg_user_id из Telegram WebApp если не передан явно
  if (!payload.tg_user_id) {
    try {
      const tg = (window as any).Telegram?.WebApp;
      const userId = tg?.initDataUnsafe?.user?.id;
      if (userId) payload.tg_user_id = userId;
    } catch {
      // ignore
    }
  }

  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.warn('[Analytics] Failed to track event:', event, err);
  });
}
