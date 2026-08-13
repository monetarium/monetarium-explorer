# API: `/miners/active` и `/verify-message` (требования)

## 0. Контекст

HTTP API обозревателя (`/api/...`, роутер [apirouter.go](../../../cmd/dcrdata/internal/api/apirouter.go)) отдаёт данные для интерфейса и внешних интеграций. Два запроса, которые уже решаются внутри, не имеют машинно-читаемых аналогов:

1. **Счётчик активных майнеров** — число майнеров, добывших блок за последние 7 дней. Значение считается на главной странице обозревателя ([explorer.go:531](../../../cmd/dcrdata/internal/explorer/explorer.go)) из `GetHeightByTimestamp` + `ActiveMiners` и нигде больше не доступно.
2. **Проверка подписи сообщения** — страница [`/verify-message`](../../../cmd/dcrdata/views/verify_message.tmpl) подтверждает, что сообщение подписано приватным ключом указанного адреса, но отдаёт только HTML-разметку.

**Зачем.** Обе операции нужны автоматизации: оператору ноды и валидатору — получать текущее число активных майнеров без парсинга HTML, а участникам промо-программ — программно подтверждать владение адресом (подписывая запрос) и проверять ответ. Это базовые, уже существующие в системе вычисления, которым не хватает API-обёртки.

Инварианты Monetarium, на которые опирается документ:

- **Активный майнер определяется последней активностью.** `ActiveMiners` считает строки таблицы `miners`, у которых `last_used` новее переданной высоты-границы ([minerstmts.go:20](../../../db/dcrpg/internal/minerstmts.go)).
- **Таблица `miners` не привязана к типу монеты.** В ней только `address`, `first_seen`, `last_used`, `blocks_mined` — ни VAR, ни SKA в учёт не входят. Счётчик — это просто число активных майнинговых адресов (§1 критерий 3).
- **Подпись сообщений — за пределами консенсуса.** `dcrutil.VerifyMessage` восстанавливает публичный ключ из подписи и сравнивает адрес; ошибки имеют заранее известные тексты, по которым результат классифицируется (§3.3).

### 0.1. Принятые решения

| Вопрос | Решение |
| --- | --- |
| Параметр окна для `/miners/active`? | **Нет.** Окно фиксированное — 7 дней, как на главной странице. В ответе возвращается `window_days: 7` и вычисленная граница `since_height`, чтобы потребителю не приходилось повторять расчёт |
| Ограничение частоты запросов к `/verify-message`? | **Нет, неограниченно — осознанное отклонение от прецедента HTML-страницы.** HTML-маршрут `POST /verify-message` ограничен 5 req/s-per-IP через `mw.Tollbooth(limiter)` ([main.go:766](../../../cmd/dcrdata/main.go)), а API-роутер в принципе не применяет rate-limit — только лимит размера тела 2 MiB ([apirouter.go:327](../../../cmd/dcrdata/internal/api/apirouter.go)). Решение намеренное: операция CPU-лёгкая (одна проверка ECDSA, микросекунды — на порядки дешевле DB-эндпоинтов вроде charts/address), а добавление точечного лимитера в API стало бы новым паттерном, которого в `apiMux` нет ни для одного маршрута. Отклонение задокументировано и пересматриваемо: если API начнёт использоваться в публичном сценарии с угрозой DoS, лимитер добавится тем же `mw.Tollbooth` способом |
| Возвращать ли классифицированную причину ошибки в `/verify-message` | **Да.** `result: "error"` + человекочитаемое `error` (§3.3). Потребитель отличает «подпись не та» от «подпись испорчена» |
| HTTP-статус для ошибки проверки | **200.** Проверка выполнилась, и её исход — это данные ответа (`match` / `mismatch` / `error`), а не сбой маршрута. `4xx`/`5xx` — только для невалидного запроса к API в целом (§3.3) |
| SKA-специфика | **Нет.** Ни счётчик майнеров, ни проверка подписи не зависят от типа монеты |

---

## 1. User story и критерии приёмки

**Как** оператор ноды и интегратор,
**я хочу** получать по HTTP текущее число активных майнеров и машинно проверять подписи сообщений,
**чтобы** автоматизировать мониторинг и верификацию без парсинга HTML-страниц.

Критерии приёмки:

1. `GET /api/miners/active` возвращает `200` и JSON вида `{ "active_miners": 7, "window_days": 7, "since_height": 18687 }`.
2. `since_height` — высота блока, предшествующего границе «7 дней назад», полученная через `GetHeightByTimestamp`.
3. Счётчик не привязан к типу монеты: считается по таблице `miners` без coin-фильтра (§0).
4. `POST /api/verify-message` принимает JSON `{ "address", "message", "signature" }` и возвращает `200` и `{ "result": "match" }` для корректной подписи.
5. Подпись, сделанная другим ключом, даёт `{ "result": "mismatch" }` без ошибки.
6. Испорченная подпись (не base64, повреждённые данные) даёт `{ "result": "error", "error": "invalid signature encoding" }`.
7. Пустые поля дают `{ "result": "error", "error": "form values cannot be empty" }`; невалидный JSON — `{ "result": "error", "error": "malformed JSON request" }`.
8. Обе ручки проверены юнит-тестами с известными векторами (§6).

---

## 2. Текущее состояние

| Что | Где |
| --- | --- |
| Роутер API, монтирование `/api` | `cmd/dcrdata/internal/api/apirouter.go` (`NewAPIRouter`), подключён в `main.go:708` |
| Интерфейс источника данных | `cmd/dcrdata/internal/api/apiroutes.go` — `DataSource` (методы `GetBestBlockSummary`, `GetHeightByTimestamp`, `ActiveMiners`) |
| Расчёт счётчика на главной | `cmd/dcrdata/internal/explorer/explorer.go:531` — `lookback := tipTime.Add(-7 * 24h)` → `GetHeightByTimestamp` → `ActiveMiners` |
| SQL счётчика | `db/dcrpg/internal/minerstmts.go:20` — `SELECT COUNT(*) FROM miners WHERE last_used > $1` |
| Реализация на `ChainDB` | `db/dcrpg/pgblockchain.go` — `GetHeightByTimestamp` (≈1330), `ActiveMiners` (≈5317) |
| Проверка подписи | `monetarium-node/dcrutil` — `VerifyMessage(address, signature, message, params)` |
| Публичная HTML-страница | `views/verify_message.tmpl`, обработчик `cmd/dcrdata/internal/explorer/explorerroutes.go:2744` |

Чего нет: API-эндпоинтов `/miners/active` и `/verify-message`, документации и тестов для них.

---

## 3. Спецификация эндпоинтов

### 3.1. `GET /api/miners/active`

Ответ — `200 OK`, `Content-Type: application/json`:

```json
{
  "active_miners": 7,
  "window_days": 7,
  "since_height": 18687
}
```

| Поле | Тип | Смысл |
| --- | --- | --- |
| `active_miners` | целое ≥ 0 | Число майнеров, добывших хотя бы один блок за окно |
| `window_days` | целое, всегда `7` | Длина окна в днях (фиксированная, §0.1) |
| `since_height` | целое | Высота блока на границе «7 дней назад» — от неё считается окно |

Логика обработчика (`getActiveMiners`):

1. `best := DataSource.GetBestBlockSummary(ctx)`; если `best == nil` — `422` (`http.StatusText(422)`).
2. `windowDays = 7`; `sinceTime := best.Time.S.T.Add(-windowDays * 24 * time.Hour)`.
3. `sinceHeight, err := DataSource.GetHeightByTimestamp(ctx, sinceTime)`; при ошибке — `sinceHeight = 0` и предупреждение в лог (тот же fallback, что на главной).
4. `n, err := DataSource.ActiveMiners(ctx, sinceHeight)`; при ошибке — `422`.
5. Ответ сериализуется через `writeJSON` с учётом `?indent=true`.

### 3.2. `POST /api/verify-message`

Запрос — `Content-Type: application/json`, тело:

```json
{ "address": "TsmfmUitQApgnNxQypdGd2x36djCCpDpERU", "message": "verifymessage test", "signature": "IGSi87UVYcVLgXTEel3W93+ygvWweHR5rXzSZan1OVegZuHEg9DI+k9AlttbrelA3D5DaHYLwg9cTOcxrPv2AhI=" }
```

Ответ — всегда `200 OK`, JSON:

| `result` | `error` | Когда |
| --- | --- | --- |
| `"match"` | — | Подпись соответствует адресу и сообщению |
| `"mismatch"` | — | `VerifyMessage` вернул «message not signed by address» |
| `"error"` | текст | Любая другая причина, текст причины в `error` |

Классификация ошибок (§3.3): пустые поля → `"form values cannot be empty"`; невалидный JSON тела → `"malformed JSON request"`; повреждённое base64 подписи → `"invalid signature encoding"`; прочее — текст ошибки как есть.

Адрес декодируется параметрами активной сети (`appContext.Params`), поэтому эндпоинт работает на любом типе сети без перенастройки.

### 3.3. Ошибки и граничные случаи

- **`/verify-message` всегда `200`, если сам запрос дошёл и распарсился.** Исход проверки — поле `result`, а не HTTP-статус. Исключение: `422`/`400` для запроса, который нельзя интерпретировать вообще (реализация не использует такие пути для этой ручки — все случаи покрываются `result: "error"`).
- **`/miners/active`**: `422` при отсутствии лучшего блока или ошибке `ActiveMiners`. Ошибка `GetHeightByTimestamp` не фатальна — окно расширяется до всей истории (`since_height: 0`).
- **Классификация подписи** опирается на тексты ошибок `dcrutil` (стабильные, см. `util.go:49-93`): пустые аргументы, `malformed base64 encoding`, `message not signed by address`. Всё остальное отдаётся как есть.
- **Проверка подписи не зависит от типа монеты** и не требует доступа к БД — только к параметрам сети.

---

## 4. Влияние на существующие страницы и API

| Область | Влияние |
| --- | --- |
| Главная страница | Нет. Расчёт счётчика не трогается, дублирующийся код не выносится (ручки тонкие) |
| Публичная страница `/verify-message` | Нет. Эндпоинт — отдельная машиночитаемая альтернатива; HTML-страница не меняется |
| `DataSource` (интерфейс) | Добавлены `GetHeightByTimestamp` и `ActiveMiners` — уже реализованы на `*dcrpg.ChainDB`; моки (`noopDS` и наследники) дополнены |
| Именование и legacy-слои | Новых затронутых legacy-имён нет; существующие не переименовываются |

---

## 5. Известные ограничения и что намеренно не делается

- Не добавляется параметр окна в `/miners/active` — фиксированные 7 дней (§0.1).
- Не добавляется лимит запросов к `/verify-message` — осознанное отклонение от HTML-прецедента, обоснование и условие пересмотра в §0.1.
- Не возвращается публичный ключ или подписант в ответе `/verify-message` — только бинарный исход.
- Эндпоинт `/verify-message` не добавляется в insight API — он живёт в основном `/api`.
- `since_height: 0` при ошибке `GetHeightByTimestamp` — сознательный fallback, совпадающий с поведением главной страницы.

---

## 6. Тесты

Юнит-тесты в `cmd/dcrdata/internal/api`:

1. `TestMinersActive_Response` — стаб `DataSource` (переопределяет `GetBestBlockSummary`, `GetHeightByTimestamp`, `ActiveMiners`); проверяются `active_miners: 7`, `window_days: 7`, `since_height: 18687`.
2. `TestVerifyMessage_API` — известные векторы из `dcrutil/util_test.go` на testnet (`chaincfg.TestNet3Params()`):
   - `TsmfmUitQApgnNxQypdGd2x36djCCpDpERU` + корректная подпись → `match`;
   - тот же вектор с чужим адресом `TsWeG3TJzucZgYyMfZFC2GhBvbeNfA48LTo` → `mismatch`;
   - не-base64 подпись → `error` / `invalid signature encoding`;
   - пустые поля → `error` / `form values cannot be empty`.

---

## 7. История версий

| Версия | Дата | Изменение |
| --- | --- | --- |
| 0.1 | 2026-08-13 | Черновик: оба эндпоинта, фиксированное окно 7 дней, классификация ошибок |
