# 📡 P2P-Calls

> Минималистичное веб-приложение для голосовых звонков напрямую между устройствами — без серверов, без регистрации, без посредников.

[![Vercel](https://img.shields.io/badge/Frontend-Vercel-black?logo=vercel)](https://p2p-calls.vercel.app)
[![Backend](https://img.shields.io/badge/Backend-p2p--calls.lex--project.ru-orange?logo=cloudflare)](https://p2p-calls.lex-project.ru)
[![Docker](https://img.shields.io/badge/Docker-node:20--alpine-2496ED?logo=docker)](./server)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green?logo=node.js)](./server/package.json)

---

## Как это работает

Приложение использует **WebRTC** для прямой передачи аудио между двумя браузерами. Сервер нужен только на этапе установки соединения (сигнализация) — после handshake весь трафик идёт напрямую P2P.

```
[Хост]  ──── WebSocket (сигнализация) ────┐
                                           ▼
                                  [Signaling Server]
                                           ▲
[Гость] ──── WebSocket (сигнализация) ────┘

После handshake:

[Хост]  ════════════ WebRTC (аудио P2P) ═══════════ [Гость]
```

### Компоненты системы

| Компонент | Технология | Хостинг |
|-----------|-----------|---------|
| **Frontend** | React 19 + Vite + TypeScript | Vercel (`p2p-calls.vercel.app`) |
| **Signaling Server** | Node.js + PeerJS + Express | Домашний сервер (`p2p-calls.lex-project.ru`) |
| **Cloudflare Tunnel** | cloudflared + Cloudflare Zero Trust | Cloudflare (бесплатно) |
| **P2P Transport** | WebRTC (браузер → браузер) | — |
| **NAT Traversal** | STUN (Google ×5 + Cloudflare + Mozilla + Nextcloud + FU Berlin) | Разные провайдеры |
| **TURN** | ❌ не используется | — |

---

## Структура проекта

```
P2P-Calls/
├── src/                        # Frontend (React + TypeScript)
│   ├── pages/
│   │   ├── MainScreen.tsx      # Главный экран (создание комнаты)
│   │   └── RoomScreen.tsx      # Экран звонка (подключение гостя)
│   ├── hooks/
│   │   └── usePeer.ts          # Вся логика WebRTC / PeerJS
│   ├── store/
│   │   └── useCallStore.ts     # Глобальный стейт (Zustand)
│   ├── components/
│   │   └── PermissionModal.tsx # Модалка доступа к микрофону
│   ├── App.tsx                 # Роутинг (React Router)
│   └── main.tsx                # Точка входа
│
├── server/                     # Backend (Signaling Server)
│   ├── index.js                # Express + PeerJS сервер + дашборд
│   ├── Dockerfile              # Docker образ (node:20-alpine)
│   ├── docker-compose.yml      # Запуск контейнера
│   ├── package.json
│   ├── fly.toml                # Конфиг для Fly.io (опционально)
│   └── render.yaml             # Конфиг для Render.com (опционально)
│
├── public/                     # Статика (иконки, manifest.json)
├── index.html                  # HTML-шаблон (PWA-ready)
├── vercel.json                 # SPA rewrite для Vercel
├── vite.config.ts
└── .env.example                # Пример переменных окружения
```

---

## Быстрый старт

### Требования

- Node.js ≥ 18
- Docker + Docker Compose (для сервера)

### 1. Клонировать репозиторий

```bash
git clone <repo-url>
cd P2P-Calls
```

### 2. Запустить Frontend (dev)

```bash
npm install
npm run dev
# → http://localhost:5173
```

### 3. Запустить Signaling Server (Docker)

```bash
cd server
docker compose up -d --build
# → http://localhost:9000
```

Дашборд сервера: **http://localhost:9000** — показывает Live Peers, Total Connects, лог последних событий.

---

## Переменные окружения

`.env` в корне проекта (фронтенд читает через `import.meta.env`):

| Переменная | Описание | Dev-значение | Prod-значение |
|---|---|---|---|
| `VITE_PEER_HOST` | Хост сигнального сервера | `localhost` | `p2p-calls.lex-project.ru` |
| `VITE_PEER_PORT` | Порт сигнального сервера | `9000` | `443` |
| `VITE_PEER_SECURE` | HTTPS/WSS | `false` | `true` |
| `VITE_PEER_KEY` | Ключ PeerJS (опционально) | `p2pcalls` | `p2pcalls` |

> **Важно:** Переменные окружения загружаются в `getPeerConfig()`. Для продакшена мы их задаем через Vercel Environment Variables.

---

## Флоу звонка

### Сценарий: Хост создаёт комнату

```
1. usePeer.initHost() вызывается
2. Генерируется уникальный ID (nanoid, 7 символов)
3. PeerJS подключается к сигнальному серверу по WebSocket
4. Хост получает statuses: idle → linking → waiting
5. Генерируется ссылка: https://p2p-calls.vercel.app/room/<ID>
6. Хост ждёт входящего звонка (peer.on('call'))
```

### Сценарий: Гость переходит по ссылке

```
1. React Router парсит /room/:id → RoomScreen
2. usePeer.initGuest(hostId) вызывается
3. Браузер запрашивает доступ к микрофону
4. Гость подключается к серверу, вызывает peer.call(hostId, stream)
5. Хост принимает звонок (call.answer(stream))
6. WebRTC SDP/ICE обмен через сигнальный сервер
7. Прямое P2P соединение установлено → статус 'connected'
8. Аудио идёт напрямую, сервер больше не нужен
```

### Состояния (CallStatus)

| Статус | Описание |
|--------|---------|
| `idle` | Начальное состояние |
| `linking` | Подключение к сигнальному серверу |
| `waiting` | Хост ждёт гостя |
| `connected` | P2P соединение активно |
| `error` | Ошибка (SERVER_TIMEOUT / LINK_INVALID / CONNECTION_ERROR / ICE_FAILED) |

---

## API сигнального сервера

| Метод | Путь | Описание |
|-------|------|---------|
| `GET` | `/` | HTML дашборд (аналитика) |
| `GET` | `/api/stats` | JSON: `{ online, totalConnections, status }` |
| `WS` | `/peerjs` | PeerJS WebSocket endpoint |

### Пример ответа `/api/stats`

```json
{
  "online": 2,
  "totalConnections": 14,
  "status": "ok"
}
```

---

## Деплой сигнального сервера на домашний сервер (SSH)

### Требования к серверу

- Linux (Ubuntu/Debian рекомендуется)
- Docker + Docker Compose установлены
- Открытый порт `9000` (или любой другой)
- Статический внешний IP или DDNS

### Шаги деплоя

**1. Подключиться к серверу:**
```bash
ssh user@<SERVER-IP>
```

**2. Создать директорию и скопировать файлы сервера:**
```bash
mkdir -p ~/p2p-server
```

С локальной машины:
```bash
scp -r ./server/{index.js,package.json,Dockerfile,docker-compose.yml} user@<SERVER-IP>:~/p2p-server/
```

**3. Запустить контейнер на сервере:**
```bash
ssh user@<SERVER-IP>
cd ~/p2p-server
docker compose up -d --build
docker ps  # убедиться что p2p-server запущен
```

**4. Проверить доступность:**
```bash
curl http://<SERVER-IP>:9000/api/stats
# {"online":0,"totalConnections":0,"status":"ok"}
```

**5. Обновить frontend:**

Всё, что требуется — задать переменные окружения (например, в свойствах проекта на Vercel) для продакшена:
- `VITE_PEER_HOST=p2p-calls.lex-project.ru`
- `VITE_PEER_PORT=443`
- `VITE_PEER_SECURE=true`

После этого код сам инициализирует WSS соединение к домашнему серверу.

### Управление контейнером

```bash
# Статус
docker ps

# Логи в реальном времени
docker logs -f p2p-server

# Перезапуск
docker compose restart

# Остановить
docker compose down

# Обновить (после изменений в index.js)
docker compose up -d --build
```

### Автозапуск при перезагрузке сервера

`restart: always` уже прописан в `docker-compose.yml` — контейнер автоматически поднимется после перезагрузки.

---

## Стек технологий

### Frontend
| Библиотека | Версия | Назначение |
|-----------|--------|-----------|
| React | 19 | UI фреймворк |
| TypeScript | 5.9 | Типизация |
| Vite | 7 | Сборщик |
| Tailwind CSS | 4 | Стилизация |
| React Router | 7 | Роутинг |
| Zustand | 5 | Глобальный стейт |
| PeerJS | 1.5 | WebRTC обёртка |
| Framer Motion | 12 | Анимации |
| nanoid | 5 | Генерация ID комнат |

### Backend (Signaling Server)
| Библиотека | Версия | Назначение |
|-----------|--------|-----------|
| Express | 5 | HTTP сервер |
| peer (PeerJS) | 1.0 | Сигнальный сервер |
| cors | 2.8 | CORS middleware |
| Node.js | ≥ 18 | Runtime |

---

## Известные ограничения

- **TURN сервера отсутствуют** — звонок не работает если оба пользователя за строгим Symmetric NAT (корпоративные сети, некоторые мобильные операторы). При сбое ICE отображается ошибка "Нет прямого соединения"
- **Только 1-на-1 звонки** — групповые звонки не поддерживаются
- **Только аудио** — видео не передаётся
- **Состояние в памяти** — статистика сервера сбрасывается при перезапуске контейнера

---

## Лицензия

MIT — используй свободно.

