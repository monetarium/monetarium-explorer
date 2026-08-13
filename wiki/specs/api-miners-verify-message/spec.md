# API: `/miners/active` и `/verify-message` (требования)

## 0. Контекст

HTTP API обозревателя (`/api/...`, роутер [apirouter.go](../../../cmd/dcrdata/internal/api/apirouter.go)) отдаёт данные для интерфейса и внешних интеграций. Два запроса, которые уже решаются внутри, не имеют машинно-читаемых аналогов:

1. **Счётчик активных майнеров** — число майнеров, добывших блок за последние 7 дней. Значение считается на главной странице обозревателя ([explorer.go:531](../../../cmd/dcrdata/internal/explorer/explorer.go)) из `GetHeightByTimestamp` + `ActiveMiners` и нигде больше как самостоятельный запрос не доступно (появляется в составе общего состояния страницы и в websocket-сообщениях, см. ниже).
2. **Проверка подписи сообщения** — страница [`/verify-message`](../../../cmd/dcrdata/views/verify_message.tmpl) подтверждает, что сообщение подписано приватным ключом указанного адреса, но отдаёт только HTML-разметку.

**Зачем.** Обе операции нужны автоматизации: оператору ноды и валидатору — получать текущее число активных майнеров без парсинга HTML, а участникам промо-программ — программно подтверждать владение адресом (подписывая запрос) и проверять ответ. Это базовые, уже существующие в системе вычисления, которым не хватает API-обёртки.

> **Оговорка про websocket.** Тот же счётчик уже рассылается pubsub: [pubsubhub.go:695-711](../../../pubsub/pubsubhub.go) считает `lookback := newBlockData.BlockTime.T.Add(-7*24h)` (время блока, не настенное) → `GetHeightByTimestamp` → `ActiveMiners` и кладёт результат в `GeneralInfo.ActiveMiners` (JSON-поле `active_miners`, [pubsubhub.go:755](../../../pubsub/pubsubhub.go)). Новый эндпоинт не добавляет вычисления — он делает уже существующее доступным по запросу без постоянного websocket-соединения и без получения всего состояния главной страницы.

Инварианты Monetarium, на которые опирается документ:

- **Активный майнер определяется последней активностью.** `ActiveMiners` считает строки таблицы `miners`, у которых `last_used` новее переданной высоты-границы ([minerstmts.go:20](../../../db/dcrpg/internal/minerstmts.go)).
- **Таблица `miners` не привязана к типу монеты.** В ней только `address`, `first_seen`, `last_used`, `blocks_mined` — ни VAR, ни SKA в учёт не входят. Счётчик — это просто число активных майнинговых адресов (§1 критерий 3).
- **Подпись сообщений — за пределами консенсуса.** `dcrutil.VerifyMessage` восстанавливает публичный ключ из подписи и сравнивает адрес; ошибки имеют заранее известные тексты, по которым результат классифицируется (§3.3). Классификация вынесена в общий пакет [`verifymessage`](../../../cmd/dcrdata/internal/verifymessage/), чтобы HTML и API не разъезжались.

### 0.1. Принятые решения

| Вопрос | Решение |
| --- | --- |
| Почему эндпоинты в `/api`, а не на web-роутере? | API-роутер применяет `cors.Default()` на весь мьютекс ([apirouter.go:323](../../../cmd/dcrdata/internal/api/apirouter.go)); основной web-роутер таких заголовков не ставит (cors есть только у legacy-редиректа `/explorer`, [explorer.go:973](../../../cmd/dcrdata/internal/explorer/explorer.go)). Чтобы внешний JS/интеграции могли делать кросс-доменные запросы, обе ручки живут в `/api`. (Обратная сторона — на API-роутере нет ограничения частоты, см. ниже.) |
| Параметр окна для `/miners/active`? | **Нет.** Окно фиксированное — 7 дней, как на главной странице. В ответе возвращается `window_days: 7` и вычисленная граница `since_height`, чтобы потребителю не приходилось повторять расчёт |
| Ограничение частоты запросов к `/verify-message`? | **Нет, неограниченно — осознанное отклонение от прецедента HTML-страницы.** HTML-маршрут `POST /verify-message` ограничен 5 req/s-per-IP через `mw.Tollbooth(limiter)` ([main.go:766](../../../cmd/dcrdata/main.go)), а API-роутер в принципе не применяет rate-limit — только лимит размера тела 2 MiB ([apirouter.go:327](../../../cmd/dcrdata/internal/api/apirouter.go)). Следствие, которое надо держать в голове: существующий HTML-контроль обходится простой сменой URL на `/api/verify-message`, поэтому это решение пересматриваемо — если API начнёт использоваться в публичном сценарии с угрозой DoS, лимитер добавится тем же `mw.Tollbooth` способом |
| Возвращать ли классифицированную причину ошибки в `/verify-message` | **Да.** `result: "error"` + человекочитаемое `error` (§3.3). Потребитель отличает «подпись не та» от «подпись испорчена». Контракт ответа опирается только на фиксированный словарь `verifymessage`, а не на тексты ошибок нижележащих пакетов (§3.3) |
| HTTP-статус для ошибки проверки | **200.** Проверка выполнилась, и её исход — это данные ответа (`match` / `mismatch` / `error`), а не сбой маршрута. `4xx`/`5xx` — только для невалидного запроса к API в целом (§3.3) |
| Пустое `message` в `/verify-message` | **Отклоняется** (`"form values cannot be empty"`), как и в HTML-форме: пустое сообщение — подпись под пустой строкой, которую может проверить кто угодно, смысла в ней нет; при этом она легитимно подписываема (консенсус не участвует). Решение зафиксировано для паритета с HTML |
| Кэширование `/miners/active` | **Да.** `Cache-Control: max-age=20` (счётчик меняется на масштабе дней; привязка к времени выполнения запроса) — тем же middleware `m.CacheControl`, что и остальной кэш API-роутера |
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
6. Испорченная подпись даёт `{ "result": "error", "error": "invalid signature encoding" }`: не-base64 текст, либо валидное base64 не длины 65 байт (усечённая подпись) — обе формы ловятся предварительной проверкой кодирования (§3.3), до восстановления ключа.
7. Пустые поля дают `{ "result": "error", "error": "form values cannot be empty" }`; невалидный JSON — `{ "result": "error", "error": "malformed JSON request" }`.
8. Обе ручки проверены юнит-тестами с известными векторами (§6).

---

## 2. Текущее состояние

| Что | Где |
| --- | --- |
| Роутер API, монтирование `/api` | `cmd/dcrdata/internal/api/apirouter.go` (`NewAPIRouter`), подключён в `main.go:708`; только на нём `cors.Default()` |
| Интерфейс источника данных | `cmd/dcrdata/internal/api/apiroutes.go` — `DataSource` (`GetBestBlockSummary`, `GetHeightByTimestamp`, `ActiveMiners` — все три уже реализованы на `*dcrpg.ChainDB`) |
| Расчёт счётчика на главной | `cmd/dcrdata/internal/explorer/explorer.go:531` — `lookback := tipTime.Add(-7 * 24h)` → `GetHeightByTimestamp` → `ActiveMiners` |
| Дублирующийся расчёт в pubsub | [pubsubhub.go:695-711](../../../pubsub/pubsubhub.go) — тот же `-7*24h` от времени нового блока → `GetHeightByTimestamp` → `ActiveMiners`, результат в `GeneralInfo.ActiveMiners` (`json:"active_miners"`) |
| SQL счётчика | `db/dcrpg/internal/minerstmts.go:20` — `SELECT COUNT(*) FROM miners WHERE last_used > $1` |
| Реализация на `ChainDB` | `db/dcrpg/pgblockchain.go` — `GetHeightByTimestamp` (≈1330), `ActiveMiners` (≈5317) |
| Проверка подписи | `monetarium-node/dcrutil` — `VerifyMessage(address, signature, message, params)`; обёртка-классификатор `cmd/dcrdata/internal/verifymessage/` |
| Публичная HTML-страница | `views/verify_message.tmpl`, обработчик `cmd/dcrdata/internal/explorer/explorerroutes.go:2744` (использует тот же `verifymessage`) |

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
3. `sinceHeight, err := DataSource.GetHeightByTimestamp(ctx, sinceTime)`; при ошибке запроса — `422` (ошибка БД не должна молча превращаться в «всё время», это вводит в заблуждение).
4. `n, err := DataSource.ActiveMiners(ctx, sinceHeight)`; при ошибке — `422`.
5. Ответ сериализуется через `writeJSON` с учётом `?indent=true`; заголовок `Cache-Control: max-age=20`.

**Семантика `since_height: 0`.** `GetHeightByTimestamp` возвращает `(0, nil)`, когда запрошенное время раньше первого блока (нет ни одной строки с `time <= sinceTime`, [pgblockchain.go:1332](../../../db/dcrpg/pgblockchain.go)). В этом случае `since_height: 0` означает не «ошибка», а «граница окна достигла генезиса»: окно покрывает всю историю майнинга. Это штатный ответ, а не fallback. Ошибка запроса к БД отличима и возвращает `422` (шаг 3).

### 3.2. `POST /api/verify-message`

Запрос — `Content-Type: application/json`, тело:

```json
{ "address": "TsmfmUitQApgnNxQypdGd2x36djCCpDpERU", "message": "verifymessage test", "signature": "IGSi87UVYcVLgXTEel3W93+ygvWweHR5rXzSZan1OVegZuHEg9DI+k9AlttbrelA3D5DaHYLwg9cTOcxrPv2AhI=" }
```

Ответ — всегда `200 OK`, JSON:

| `result` | `error` | Когда |
| --- | --- | --- |
| `"match"` | — | Подпись соответствует адресу и сообщению |
| `"mismatch"` | — | Ключ восстановлен, но адрес не совпал («message not signed by address») |
| `"error"` | текст | Любая другая причина, текст из фиксированного словаря (см. ниже) |

Классификация ошибок выполняется пакетом `verifymessage.Verify` и возвращает **только** строки из фиксированного словаря (контракт ответа не зависит от текстов ошибок нижележащих пакетов):

| Условие | `error` |
| --- | --- |
| Адрес не декодируется для активной сети | `"invalid address"` |
| Не-base64 подпись ИЛИ base64 не длины 65 байт | `"invalid signature encoding"` |
| Ключ восстановлен, но не подходит к адресу | `result: "mismatch"` (без `error`) |
| Не-p2pkh адрес (декодируется, но не того типа) | `"invalid address"` |
| Любое прочее расхождение при восстановлении ключа | `"invalid signature"` |

Кроме того, обработчик до классификатора проверяет пустые поля (`"form values cannot be empty"`) и невалидный JSON тела (`"malformed JSON request"`).

> **Почему предварительная валидация.** `stdaddr.DecodeAddress` вставляет сам адрес в текст ошибки через `%q`, а нижележащие пакеты пишут свои сообщения об ошибках. Классифицировать по подстроке — значит позволять вызывающему подделать ветку результата: адрес `message not signed by address` дал бы `"mismatch"` вместо `"error"`. Поэтому ввод валидируется до вызова `dcrutil.VerifyMessage`, а несоответствие адресу ловится только по стабильному тексту `message not signed by address`.

Адрес декодируется параметрами активной сети (`appContext.Params`), поэтому эндпоинт работает на любом типе сети без перенастройки.

### 3.3. Ошибки и граничные случаи

- **`/verify-message` всегда `200`, если сам запрос дошёл и распарсился.** Исход проверки — поле `result`, а не HTTP-статус. Исключение: `422`/`400` для запроса, который нельзя интерпретировать вообще (реализация не использует такие пути для этой ручки — все случаи покрываются `result: "error"`).
- **`/miners/active`**: `422` при отсутствии лучшего блока, ошибке `GetHeightByTimestamp` или ошибке `ActiveMiners`. `since_height: 0` — это легитимное «окно достигло генезиса», а не индикатор ошибки (§3.1).
- **Классификация подписи** живёт в `verifymessage.Verify` ([verifymessage.go](../../../cmd/dcrdata/internal/verifymessage/verifymessage.go)): адрес и подпись валидируются явно до восстановления ключа, несоответствие адресу распознаётся по фиксированному тексту `message not signed by address` (стабилен в `dcrutil/util.go:93`). Все прочие исходы — из фиксированного словаря (§3.2).
- **Проверка подписи не зависит от типа монеты** и не требует доступа к БД — только к параметрам сети.

---

## 4. Влияние на существующие страницы и API

| Область | Влияние |
| --- | --- |
| Главная страница | Нет. Расчёт счётчика не трогается, дублирующийся код не выносится (ручки тонкие) |
| Публичная страница `/verify-message` | **Использует тот же классификатор.** HTML-обработчик переведён на `verifymessage.Verify` — поведение не меняется (тот же результат, но фиксированный словарь ошибок вместо сырых текстов), код выигрывает от единого источника истины |
| `DataSource` (интерфейс) | Методы `GetHeightByTimestamp` и `ActiveMiners` **добавляются этим PR** в `api.DataSource` (раньше они были только в интерфейсах главной страницы и pubsub, поэтому `api` их не имел). Реализации на `*dcrpg.ChainDB` уже существовали; моки (`noopDS` и наследники) дополнены |
| `pubsub` | Не меняется. Расчёт счётчика в pubsub остаётся как есть (дубликат, см. §0) |
| Именование и legacy-слои | Новых затронутых legacy-имён нет; существующие не переименовываются |

---

## 5. Известные ограничения и что намеренно не делается

- Не добавляется параметр окна в `/miners/active` — фиксированные 7 дней (§0.1).
- Не добавляется лимит запросов к `/verify-message` — осознанное отклонение от HTML-прецедента, обоснование и условие пересмотра в §0.1.
- Константа окна 7 дней продублирована в трёх местах (`explorer.go:531`, `pubsubhub.go:701`, `apiroutes.go`) — существующий код не реорганизуется, но новые места должны ссылаться на это и менять все три согласованно.
- Не возвращается публичный ключ или подписант в ответе `/verify-message` — только бинарный исход.
- Эндпоинт `/verify-message` не добавляется в insight API — он живёт в основном `/api`.
- `since_height: 0` — легитимное «окно достигло генезиса», а не индикатор ошибки; ошибки запроса к БД возвращают `422` (§3.1).
- Пустое `message` отклоняется, хотя пустая строка легитимно подписываема, — паритет с HTML (§0.1).

---

## 6. Тесты

Юнит-тесты в `cmd/dcrdata/internal/api`:

1. `TestMinersActive_Response` — стаб `DataSource` (переопределяет `GetBestBlockSummary`, `GetHeightByTimestamp`, `ActiveMiners`); проверяются `active_miners: 7`, `window_days: 7`, `since_height: 18687`, а также что переданный в `GetHeightByTimestamp` момент времени равен `tipTime - 7*24h` (окно не уезжает).
2. `TestMinersActive_NilBestBlock` — `GetBestBlockSummary → nil` → `422`.
3. `TestMinersActive_ActiveMinersError` — ошибка `ActiveMiners` → `422`.
4. `TestMinersActive_LookbackQueryError` — ошибка `GetHeightByTimestamp` → `422` (а не молчаливый `since_height: 0`).
5. `TestVerifyMessage_API` — известные векторы из `dcrutil/util_test.go` на testnet (`chaincfg.TestNet3Params()`):
   - `TsmfmUitQApgnNxQypdGd2x36djCCpDpERU` + корректная подпись → `match`;
   - тот же вектор с чужим адресом `TsWeG3TJzucZgYyMfZFC2GhBvbeNfA48LTo` → `mismatch`;
   - не-base64 подпись → `error` / `invalid signature encoding`;
   - усечённая подпись (`AAAA`, валидное base64 не длины 65) → `error` / `invalid signature encoding`;
   - невалидный адрес (`not an address`) → `error` / `invalid address`;
   - не-p2pkh адрес (testnet P2SH `TccWLgcquqvwrfBocq5mcK5kBiyw8MvyvCi`) с испорченной подписью → `error` / `invalid address` (проверка типа адреса предшествует проверке подписи);
   - регрессия спуфинга: адрес, равный фразе `message not signed by address` → `error` / `invalid address` (а не `mismatch`);
   - пустые поля → `error` / `form values cannot be empty`.

---

## 7. История версий

| Версия | Дата | Изменение |
| --- | --- | --- |
| 0.1 | 2026-08-13 | Черновик: оба эндпоинта, фиксированное окно 7 дней, классификация ошибок |
| 0.2 | 2026-08-13 | Ревью: классификатор вынесен в `verifymessage` (устранён спуфинг через текст ошибки адреса); ошибка `GetHeightByTimestamp` → `422`, `since_height: 0` = «окно достигло генезиса»; `Cache-Control: max-age=20`; HTML-страница переведена на общий классификатор; уточнены §0 (pubsub-дубликат), §0.1 (CORS/rate-limit/пустое message), §1 (крит. 6), §2, §4, §5 |
| 0.3 | 2026-08-13 | Повторное ревью: тип p2pkh проверяется до подписи (не-p2pkh адрес + испорченная подпись → `invalid address`); §4 исправлено — методы `DataSource` добавлены этим PR; ссылки на pubsub выправлены на корневой пакет `../../../pubsub/`, CORS — на `apirouter.go:323` (+ legacy `explorer.go:973`) |
