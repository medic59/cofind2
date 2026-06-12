# Наблюдаемость Cofind 2

Что подключено: Sentry (фронт + бэк, DSN-driven), health-проба `/health/live` + `/health/ready`
с проверками зависимостей, структурные JSON-логи запросов с request-id, счётчики ошибок
WebSocket. Ниже — как включить Sentry и какие алерты настроить.

## 1. Health-эндпоинты

- `GET /api/v1/health/live` — liveness. Всегда `200 {ok:true}`, если процесс жив. Используется
  healthcheck'ом контейнера. Из логов исключён (не шумит).
- `GET /api/v1/health/ready` — readiness. Проверяет **БД** (`SELECT 1`), **Meilisearch** (`/health`)
  и **realtime-чат** (`ChatRealtimeService.status()`). Возвращает `200`, когда всё ок, и **HTTP 503**,
  если хоть одна зависимость недоступна — мониторинг детектит по коду, а не только по телу.

Пример тела `ready`:

```json
{
  "ok": true,
  "dependencies": {
    "database": { "ok": true },
    "meilisearch": { "ok": true },
    "realtime": {
      "ok": true, "path": "/ws/chat", "clients": 3, "redis": "connected",
      "metrics": { "connections": 120, "disconnects": 117, "errorFrames": 4,
                   "socketErrors": 0, "droppedBackpressure": 0, "rejectedOverload": 0 }
    }
  }
}
```

## 2. Структурные логи + request-id

Каждый запрос получает заголовок `X-Request-Id` (входящий проксируется, иначе генерируется UUID),
он же возвращается в ответе и в теле 5xx-ошибки (`requestId`). На каждый ответ пишется одна
JSON-строка в stdout:

```json
{"level":"info","time":"2026-06-12T10:00:00.000Z","msg":"http_request","requestId":"…",
 "method":"GET","path":"/api/v1/listings","status":200,"durationMs":12.4,"ip":"…"}
```

`level` = `error` при 5xx, `warn` при 4xx, иначе `info`. Сбор: `docker logs` / драйвер логов
(json-file/journald) → агрегатор (Loki, ELK, CloudWatch). Корреляция инцидента: по `requestId`
из ответа находится строка лога и событие в Sentry (тег `request_id`).

## 3. Sentry (включение)

Всё DSN-driven: без `SENTRY_DSN` SDK не инициализируется (полный no-op). Чтобы включить:

Бэкенд и фронтенд — **разные Sentry-проекты** (Node и Browser), поэтому два DSN. Добавить в
`deploy/.env.production` на сервере:

```
SENTRY_DSN=https://<key>@<host>/<api-project>          # бэкенд (cofind-api, Node)
SENTRY_DSN_WEB=https://<key>@<host>/<web-project>      # фронтенд (cofind2-web, Browser)
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0        # 0 = только ошибки; 0.1 = 10% трейсов производительности
```

- API читает `SENTRY_DSN` из `env_file` (`.env.production`).
- Web читает `SENTRY_DSN_WEB` как build-arg при пересборке (compose интерполирует из `--env-file`);
  фронт-SDK самохостится в `apps/web/vendor/sentry.min.js` (CSP `script-src 'self'` запрещает CDN),
  инициализация в `sentry-init.js` по `<meta>`-тегам, которые `build.js` вставляет только при заданном
  `SENTRY_DSN_WEB`.

После правки `.env.production` — пересобрать: `docker compose … -p deploy up -d --build web api`.

**Release + sourcemaps из CI:** добавить repo-секреты GitHub:

| Секрет | Назначение |
|---|---|
| `SENTRY_AUTH_TOKEN` | токен с правами `project:releases` (включает шаг релиза в CI) |
| `SENTRY_ORG` | слаг организации |
| `SENTRY_PROJECT` | слаг проекта |
| `SENTRY_URL` | только для self-hosted/GlitchTip (URL инстанса) |

Шаг `Sentry release & sourcemaps` в job `build` создаёт релиз = `github.sha`, грузит sourcemaps
(`apps/api/dist`, `apps/web/dist`) и финализирует его. Job `deploy` пробрасывает тот же `SENTRY_RELEASE`
в сборку на сервере (build-arg web + env api), поэтому события тегируются тем же релизом, что и карты.

> Примечание: сборка идёт на сервере, поэтому sourcemaps ассоциируются по релизу+пути (line-based),
> а не по debug-id. Бэкенд-`dist` собирается с `sourceMap: true`; фронтовый `app.js` не минифицируется,
> поэтому трейсы и так читаемы. Для точного debug-id-матчинга нужно собирать артефакт в CI и
> деплоить именно его.

## 4. Алерты

Настраиваются в Sentry (Alerts → Create Alert) и в внешнем uptime-мониторе. Рекомендованные
пороги (подстроить под трафик):

### 4.1. Рост 5xx (server error rate)
- **Сигнал:** доля ответов 5xx. Источник: Sentry (issues с тегом `http_status:5xx`) и/или
  лог-метрика `status>=500`.
- **Порог:** > 1% запросов за 5 минут **или** > 10 событий 5xx за 5 минут. Critical при > 5%.
- **Sentry:** Metric Alert по `event.type:error` с фильтром на необработанные 5xx; либо Issue Alert
  «more than 10 events in 5 minutes».

### 4.2. p95 латентность
- **Сигнал:** p95 времени ответа. Источник: поле `durationMs` из логов (лог-агрегатор) или Sentry
  Performance при `SENTRY_TRACES_SAMPLE_RATE>0`.
- **Порог:** p95 > 800 мс за 10 минут (warning), > 1500 мс (critical). Отдельно следить за
  `/api/v1/listings` и `/listings/*/og.png` (рендер картинки тяжелее).

### 4.3. Падение health
- **Сигнал:** `GET /api/v1/health/ready` ≠ 200 (стало 503) или недоступность `/health/live`.
- **Порог:** 2 подряд неуспешные проверки с интервалом 30–60 с → critical. Тело покажет, какая
  зависимость упала (`database` / `meilisearch` / `realtime`).
- **Как:** внешний uptime-монитор (UptimeRobot, Better Uptime, Grafana Synthetic) на `…/health/ready`,
  проверка кода 200 и подстроки `"ok":true`.

### 4.4. Рост ошибок WebSocket
- **Сигнал:** прирост счётчиков из `realtime.metrics` в `/health/ready`:
  `errorFrames` (chat.error клиентам), `socketErrors` (ошибки транспорта), `droppedBackpressure`
  (отключены за переполнение буфера), `rejectedOverload` (отказ по лимиту соединений).
- **Порог:** прирост `errorFrames`+`socketErrors` > 50/5 мин (warning), > 200/5 мин (critical);
  любой `droppedBackpressure`/`rejectedOverload` > 0 за 5 мин → warning (перегрузка/медленные клиенты).
- **Как:** скрейпить `/health/ready` (например, vmagent/Prometheus blackbox с парсингом JSON, или
  простой cron, пишущий метрики), считать дельту монотонных счётчиков.

### Минимум для старта
1. Uptime-монитор на `/api/v1/health/ready` (покрывает 4.3 и косвенно БД/meili/realtime).
2. Sentry Issue Alert на новые/растущие 5xx (4.1).
3. Лог-алерт на p95 `durationMs` (4.2) и периодический скрейп `realtime.metrics` (4.4).
