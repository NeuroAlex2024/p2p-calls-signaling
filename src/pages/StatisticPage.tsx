import { useEffect, useState } from 'react';

interface EventStat {
  event_name: string;
  count: number;
  updated_at: string;
}

const EVENT_META: Record<string, { label: string; emoji: string; description: string; isError?: boolean }> = {
  app_opened:    { emoji: '📱', label: 'Открыли приложение',    description: 'Пользователь загрузил Mini App' },
  share_clicked: { emoji: '📤', label: 'Нажали «Отправить»',   description: 'Нажали кнопку шаринга в Telegram' },
  mic_allowed:   { emoji: '🎙️', label: 'Разрешили микрофон',   description: 'Успешно выдан доступ к микрофону' },
  guest_joined:  { emoji: '👥', label: 'Гость перешёл',        description: 'Собеседник открыл ссылку-инвайт' },
  call_started:  { emoji: '📞', label: 'Звонок состоялся',     description: 'WebRTC-соединение установлено' },
  call_failed:   { emoji: '❌', label: 'Звонок сорвался',      description: 'ICE_FAILED или SERVER_BUSY после установки', isError: true },
};

// Фиксированный порядок воронки
const FUNNEL_ORDER = ['app_opened', 'share_clicked', 'mic_allowed', 'guest_joined', 'call_started', 'call_failed'];

function calcConversion(current: number, base: number): string {
  if (base === 0) return '—';
  return `${((current / base) * 100).toFixed(1)}%`;
}

export default function StatisticPage() {
  const [stats, setStats] = useState<EventStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) {
        setError(`Ошибка ${res.status}: ${res.statusText}`);
        return;
      }
      const data: EventStat[] = await res.json();
      // Сортируем по воронке
      const sorted = FUNNEL_ORDER.map(
        (name) => data.find((d) => d.event_name === name) ?? { event_name: name, count: 0, updated_at: '' },
      );
      setStats(sorted);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const topCount = stats[0]?.count ?? 0;
  // Воронка без call_failed (он отображается отдельно)
  const funnelStats = stats.filter(s => s.event_name !== 'call_failed');
  const failedStat = stats.find(s => s.event_name === 'call_failed');

  return (
    <div className="h-full overflow-y-auto bg-zinc-50 dark:bg-zinc-950">
    <div className="flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-lg space-y-6">

        {/* Header */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">📊 Аналитика воронки</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">P2P Calls · Конверсия по шагам</p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-2xl px-5 py-4 text-sm">
            {error}
          </div>
        )}

        {/* Funnel cards */}
        <div className="space-y-3">
          {loading && stats.length === 0
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-20 bg-zinc-100 dark:bg-zinc-800 rounded-2xl animate-pulse" />
              ))
            : funnelStats.map((stat, idx) => {
                const meta = EVENT_META[stat.event_name];
                const prevCount = idx > 0 ? funnelStats[idx - 1].count : stat.count;
                const stepConversion = calcConversion(stat.count, prevCount);
                const totalConversion = calcConversion(stat.count, topCount);
                const barWidth = topCount > 0 ? Math.round((stat.count / topCount) * 100) : 0;

                return (
                  <div
                    key={stat.event_name}
                    className="bg-white dark:bg-zinc-900 rounded-2xl p-5 shadow-sm border border-zinc-100 dark:border-zinc-800 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{meta?.emoji ?? '📌'}</span>
                        <div>
                          <div className="font-semibold text-zinc-900 dark:text-zinc-50 text-sm leading-tight">
                            {meta?.label ?? stat.event_name}
                          </div>
                          <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                            {meta?.description}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
                          {stat.count.toLocaleString()}
                        </div>
                        <div className="text-xs text-zinc-400 mt-0.5">событий</div>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-700"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>

                    {/* Conversion row */}
                    <div className="flex justify-between text-xs text-zinc-400 dark:text-zinc-500">
                      <span>
                        {idx > 0 ? (
                          <>Конверсия из пред. шага: <span className="font-semibold text-zinc-600 dark:text-zinc-300">{stepConversion}</span></>
                        ) : (
                          'Верх воронки'
                        )}
                      </span>
                      <span>
                        От старта: <span className="font-semibold text-zinc-600 dark:text-zinc-300">{totalConversion}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
        </div>

        {/* call_failed — отдельная карточка вне воронки */}
        {!loading && failedStat && (
          <div className="bg-red-50 dark:bg-red-950/30 rounded-2xl p-5 shadow-sm border border-red-200 dark:border-red-800 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl">❌</span>
                <div>
                  <div className="font-semibold text-red-700 dark:text-red-400 text-sm leading-tight">
                    Звонок сорвался
                  </div>
                  <div className="text-xs text-red-400 dark:text-red-500 mt-0.5">
                    ICE_FAILED или SERVER_BUSY — P2P не установился
                  </div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold text-red-700 dark:text-red-400 tabular-nums">
                  {failedStat.count.toLocaleString()}
                </div>
                <div className="text-xs text-red-400 mt-0.5">событий</div>
              </div>
            </div>
            <div className="text-xs text-red-400 dark:text-red-500">
              Доля от успешных звонков:{' '}
              <span className="font-semibold text-red-600 dark:text-red-300">
                {calcConversion(failedStat.count, funnelStats.find(s => s.event_name === 'call_started')?.count ?? 0)}
              </span>
            </div>
          </div>
        )}

        {/* Summary */}
        {!loading && funnelStats.length > 0 && (
          <div className="bg-primary/5 dark:bg-primary/10 rounded-2xl p-5 border border-primary/20 space-y-1">
            <div className="text-xs font-bold uppercase tracking-wider text-primary/70">Итог воронки</div>
            <div className="text-sm text-zinc-700 dark:text-zinc-300">
              Из <span className="font-bold">{funnelStats[0]?.count.toLocaleString()}</span> открытий до звонка дошло{' '}
              <span className="font-bold">{funnelStats[4]?.count.toLocaleString()}</span> — конверсия{' '}
              <span className="font-bold text-primary">{calcConversion(funnelStats[4]?.count ?? 0, funnelStats[0]?.count ?? 0)}</span>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center space-y-3">
          {lastUpdated && (
            <p className="text-xs text-zinc-400">
              Обновлено: {lastUpdated.toLocaleTimeString('ru-RU')}
            </p>
          )}
          <button
            onClick={fetchStats}
            disabled={loading}
            className="text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Загрузка...' : '↻ Обновить'}
          </button>
        </div>

      </div>
    </div>
    </div>
  );
}
