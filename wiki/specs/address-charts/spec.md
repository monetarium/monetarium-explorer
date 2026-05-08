# Address Charts Card — Multi-Coin Spec

Правая верхняя карточка на странице `/address/{address}` (`cmd/dcrdata/views/address.tmpl:113-183`). Контент: селектор вида графика (Balance / Tx Type / Sent-Received), кнопки Zoom, Group By, Flow-чекбоксы, Dygraphs canvas + полноэкранный режим.

Этот документ — продолжение [address-overview/spec.md](../address-overview/spec.md). Технический разбор изменяемых файлов: `wiki/code-analysis/address/charts.impact.md`. Pattern reference для пер-монетных эндпоинтов: [chart-ska-coin-supply](../chart-ska-coin-supply/spec.md) и `wiki/code-analysis/charts/`.

---

## 1. Цель и охват

### Входит

- Введение **селектора монеты** в карточку графика (`?coin=` URL-ключ, общий с таблицей).
- Перевод эндпоинта `amountflow` на пер-монетную выборку (включая SKA с строковыми атомами).
- Поведение **Tx Type** chart: 5 серий для VAR, 2 серии (SentRtx / ReceivedRtx) для SKA.
- Поведение **Balance** chart: накопление с правильной точностью (BigInt для SKA).
- Замена жёстких `DCR`-меток в контроллере на `renderCoinType`.
- Кеш `db/cache/addresscache.go` расширяется ключом `coin_type`.

### Не входит

- Live-обновление графиков (только refetch при смене параметров).
- Изменение визуального дизайна Dygraph’а (цвета, легенда) — только метки и точность.
- Per-coin lines на одном графике / one-chart-per-coin small multiples — выбран селекторный подход (см. §3).

---

## 2. Текущее поведение

### 2.1 Backend

- Маршруты: `/api/address/{address}/types/{chartgrouping}` и `/api/address/{address}/amountflow/{chartgrouping}` (`apirouter.go:185-186`). `balance` — псевдо-вид: фронт сам перепишет URL на `amountflow` (`address_controller.js:519`) и накопит сумму на JS-стороне.
- Хендлеры: `getAddressTxTypesData`, `getAddressTxAmountFlowData` (`apiroutes.go:1777, 1813`).
- Точка входа в БД: `(*ChainDB).TxHistoryData(ctx, address, addrChart, chartGroupings)` (`pgblockchain.go:3114-3115`). **Параметра `coinType` нет.**
- SQL:
  - `selectAddressTxTypesByAddress` (`addrstmts.go:312-321`) — без фильтра по `coin_type`; стейк-серии всегда VAR (по консенсусу).
  - `selectAddressAmountFlowByAddress` (`addrstmts.go:323-329`) — `SUM(value)`, где `value` это `INT8` VAR-атомы; `ska_value TEXT` **игнорируется**.
- Результат: для SKA-only адреса все серии `Sent`/`Received`/`Net` тождественно нулевые.
- Кеш: `AddressCacheItem.history` — 2D-массив `[NumIntervals]*ChartsData` без разреза по монете (`addresscache.go:471-481, 1156-1163`).

### 2.2 Frontend

- TurboQuery-ключи карточки: `chart`, `zoom`, `bin`, `flow` (`address_controller.js:211-219`).
- Селектор `<select>` с тремя опциями (`balance` / `types` / `amountflow`); `name`-атрибут используется `validChartType`.
- Метки `DCR`:
  - `address_controller.js:84` — `customizedFormatter` legend: `${series.y} DCR`.
  - `address_controller.js:130` — `amountFlowGraphOptions.ylabel = 'Total (DCR)'`.
  - `address_controller.js:140` — `balanceGraphOptions.ylabel = 'Balance (DCR)'`.
  - `address_controller.js:120` — `typesGraphOptions.ylabel = 'Tx Count'` (без монеты — ОК).
- `amountFlowProcessor` (`address_controller.js:30-53`) накапливает баланс на `Number` (`balance += v`) — для SKA это catastrophic.

---

## 3. Требуемое поведение

### 3.1 Селектор монеты

Над/в линию с селектором вида графика добавляется второй `<select>` — селектор монеты:

```
Chart  [Balance ▾]   Coin  [VAR ▾]
Zoom   [All|Y|M|W|D]
Group  [Y|M|W|D|Block]
```

**Правила отображения:**

- Опции селектора монеты строятся по `AddressInfo.ActiveCoins` (см. address-overview §3).
- Текстовые метки опций — через `coinSymbol` server-side; в `<option value>` — числовое `coin_type` (`0` для VAR, `1..255` для SKA{n}).
- Опция "All" в этом селекторе **отсутствует**: график рисует один coin за раз (для разных порядков величины VAR и SKA общая ось не имеет смысла).
- Если `?coin=` пуст или его значение не входит в `ActiveCoins` — используется первый элемент `ActiveCoins` (обычно VAR `0`).
- Селектор скрыт, если в `ActiveCoins` ровно одна монета.

**Selector binding:**

- `data-address-target="coin"` (новый target).
- `data-action="change->address#changeCoin"` (новое действие).

`changeCoin` пишет `settings.coin = e.target.value` и вызывает общий помощник смены `?coin=` (см. address-overview §4), который **сбрасывает `?start=0`** перед `query.replace`.

### 3.2 URL-ключ `coin`

См. address-overview §4.

В `address_controller.js:211-219` к `nullTemplate` добавляется ключ `'coin'`. На загрузке (`connect()`) значение нормализуется: если URL не содержит `?coin=`, либо `coin` ∉ `ActiveCoins`, фронт подставляет первую монету из `ActiveCoins`.

### 3.3 Виды графиков под мульти-монету

#### 3.3.1 Balance

**Принципиальное изменение по сравнению с сегодняшним кодом:** кумулятивная сумма (running balance) **вычисляется на бэкенде**, а не на JS. Это:

- снимает с фронта `BigInt`-арифметику для SKA (точность теперь — забота Go-слоя через `*big.Int.Add`, как уже сделано в `coin-supply/{N}` pipeline);
- даёт серверному кешу хранить балансовый ряд в готовом виде;
- мирится с принятым решением «1 fetch — 2 view» (см. ниже): балансовая серия едет дополнительным полем в том же `amountflow`-ответе.

**Контракт:**

- Fetch: тот же URL, что и `amountflow` (см. §3.3.3) — фронт по-прежнему рассматривает `balance` как «view» поверх ответа `amountflow`. URL-rewrite `chart === 'balance' → amountflow` (`address_controller.js:519`) сохраняется.
- Backend в `amountflow`-ответе возвращает **дополнительный ряд** `balance` (для VAR — `[]float64`) или `balance_atoms` (для SKA — `[]string`), уже накопленный по `time`. Net-ряд уже есть; balance — это `cumsum(net)` посчитанный сервером.
- Рендеринг: одна линия (Balance в выбранной монете) — фронт берёт серию **как есть** из ответа, никакой `balance += v` в JS.
- ylabel: `Balance (${renderCoinType(coin)})`.
- Легенда: для VAR — `formatAtomsAsCoinString(atoms, 0)` (8 знаков); для SKA — `splitSkaAtomsNoTrailing(atoms)`. **Никакой накопительной арифметики** на JS — `customizedFormatter` читает значение Y-ряда напрямую.

**Backend:** в `parseRowsSentReceived` (`db/dcrpg/queries.go:4139-4163`) или в новом coin-aware варианте — после построения `received` / `sent` / `net` массивов добавить кумулятивный проход:

- VAR: `balance[i] = balance[i-1] + net[i]` в `int64` атомах, затем `[]float64` через `toCoin` (как и `received`/`sent`/`net`).
- SKA: `balance[i] = balance[i-1] + net[i]` через `*big.Int.Add` в атом-домене, transport как `[]string`.

#### 3.3.2 Tx Type

VAR-выбор:

- Все 5 серий как сегодня: `SentRtx`, `ReceivedRtx`, `Tickets`, `Votes`, `RevokeTx`.
- ylabel: `Tx Count`.

SKA-выбор:

- Только 2 серии: `SentRtx`, `ReceivedRtx`.
- Stake-серии (`Tickets`, `Votes`, `RevokeTx`) **не отображаются** — они структурно VAR-only.
- ylabel: `Tx Count`.
- DB-запрос для SKA фильтруется по `coin_type = N` и не считает `tx_type IN (1,2,3)`.

#### 3.3.3 Sent/Received (`amountflow`)

- Fetch: per coin (`?coin=N`).
- VAR: SQL агрегирует `SUM(value)` фильтруя `coin_type = 0`. Транспорт — `[]float64` через JSON (как сейчас).
- SKA: SQL агрегирует `SUM(ska_value::numeric)` для `coin_type = N`, **transport как `[]string`**. JSON shape (включая балансовый ряд для view `balance`, см. §3.3.1):
  ```json
  {
    "time": [...],
    "received_atoms": ["1234...", "5678..."],
    "sent_atoms": ["...", "..."],
    "net_atoms": ["...", "..."],
    "balance_atoms": ["...", "..."]
  }
  ```
  Для VAR соответствующие поля — существующие `received` / `sent` / `net` `[]float64` плюс новое `balance` `[]float64`. SKA получает параллельные поля с суффиксом `_atoms` (или эквивалент — окончательная форма решается в импл-фазе при изменении `dbtypes.ChartsData`).
- ylabel: `Total (${renderCoinType(coin)})`.
- Flow-чекбоксы (Sent / Received / Net) работают как сегодня: переключают видимость серий.

### 3.4 Endpoint contract

**Решение:** `?coin=N` как **query parameter**, не path segment. Это отклонение от прецедента `coin-supply/{N}`; обоснование — отсутствие необходимости менять router и middleware (`m.AddressPathCtxN(1)`, `m.ChartGroupingCtx`).

```
GET /api/address/{addr}/types/{chartgrouping}?coin=N
GET /api/address/{addr}/amountflow/{chartgrouping}?coin=N
```

Где `N ∈ {0, 1..255}`. `coin=0` (или отсутствует) — VAR (текущее поведение).

**Backend:**

- `TxHistoryData(ctx, address, addrChart, chartGroupings)` → `TxHistoryData(ctx, address, addrChart, chartGroupings, coinType uint8)`.
- Хендлеры (`apiroutes.go:1777, 1813`) парсят `coin` query parameter (default `0`), валидируют против `0..255`.
- SQL: новые версии `selectAddressTxTypesByAddress` / `selectAddressAmountFlowByAddress` принимают `coin_type` как параметр и фильтруют. Стейк-секции (`tx_type IN (1,2,3)`) добавляются только для VAR.
- Cache: ключ `AddressCacheItem.history` расширяется на `coin_type` — становится 3D `[CoinType][NumIntervals]*ChartsData` (или эквивалентная map‘а). Singleflight-лок (`CacheLocks.bal.TryLock(address)`) остаётся per-address (можно расширить до `(address, coin)` в будущем для параллелизации, но это вне скоупа).
- Mock: `cmd/dcrdata/internal/api/noop_ds_test.go:40-42` обновляется под новую сигнатуру.

### 3.5 Frontend URL build

`address_controller.js:fetchGraphData` (~496-527):

- `chart === 'balance'` всё ещё переписывается в URL-сегмент `amountflow` (балансовая серия — производная от `amountflow`).
- К URL добавляется `?coin=${this.settings.coin || 0}`.
- Кеш `retrievedData` ключуется по `${chart}-${bin}-${coin}` (а не только `${chart}-${bin}`) — добавление монеты в ключ предотвращает кросс-монетную сериал-перекрёстку.

### 3.6 SKA precision в JS

**Принцип:** никакой `BigInt`-арифметики на JS. Любая накопительная сумма (running balance, totals и т.п.) считается на бэкенде; фронт получает уже готовые ряды атомных строк и **только форматирует их к показу**.

- Атомные строки приходят с бэкенда уже накопленными (`balance_atoms`, см. §3.3.1) или поэлементно (`received_atoms` / `sent_atoms` / `net_atoms`, §3.3.3).
- Для отображения легенды и осей Y — преобразование атомов в человекочитаемую форму через `splitSkaAtomsNoTrailing` / `formatAtomsAsCoinString` из `ska_helper.js`. Это **не математика**, а string→string форматирование.
- Dygraph принимает `Number` для координат; для очень больших SKA-атомов это даёт визуально приемлемое масштабирование (потерянная точность нестрашна для пиксельной отрисовки), **но числа в легенде должны браться из исходных атомных строк**, не из значения, прошедшего через `Number`. `customizedFormatter` (`address_controller.js:55-87`) переписывается, чтобы для SKA-кейса брать данные из параллельного atoms-ряда (по индексу точки).
- `amountFlowProcessor` (`address_controller.js:30-53`) — текущая логика `balance += v` **удаляется**: для view `balance` фронт читает готовый ряд `balance` / `balance_atoms` из ответа.

### 3.7 Замена `DCR`-меток

- `address_controller.js:84` — `customizedFormatter` использует `renderCoinType(this.settings.coin)` вместо литерала `DCR`.
- `:130` — `amountFlowGraphOptions.ylabel = ...` строится динамически: `Total (${renderCoinType(coin)})`.
- `:140` — `balanceGraphOptions.ylabel = ...` динамически: `Balance (${renderCoinType(coin)})`.
- `:120` — `typesGraphOptions.ylabel = 'Tx Count'` — **не меняется** (метрика coin-agnostic).

Когда `coin` меняется (`changeCoin`), эти строки label / ylabel пересоздаются и Dygraph перерисовывается.

### 3.8 Поведение на dummy address

Карточка графиков для dummy address короткое замыкание handler’а отсекает на уровне всего блока. Никакой специальной логики на frontend стороне не нужно.

---

## 4. UI mockup карточки

```
┌──────────────────────────────────────────────────┐
│ Chart  [Balance ▾]   Coin  [SKA1 ▾]               │
│ Zoom   [All|Year|Month|Week|Day]                  │
│ Group  [Year|Month|Week|Day|Block]                │
│                                                   │
│  ┌──────────────────────────────────────────┐    │
│  │ Balance (SKA1)                            │    │
│  │  ▲                                        │    │
│  │  │     ╭───╮                              │    │
│  │  │ ╭───╯   ╰─╮                            │    │
│  │  │╱           ╰─────────                   │    │
│  │  └─────────────────────►                  │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

При выборе VAR — видны Sent/Received чекбоксы (для `amountflow`); ylabel `Balance (VAR)` или `Total (VAR)`. При выборе SKA — Tx Type chart показывает только 2 серии; остальные виды работают как для VAR с пер-монетной точностью.

---

## 5. Backend-изменения (детали)

### 5.1 Сигнатуры

```go
// db/dcrpg/pgblockchain.go
func (pgb *ChainDB) TxHistoryData(
    ctx context.Context,
    address string,
    addrChart dbtypes.HistoryChart,
    chartGroupings dbtypes.TimeBasedGrouping,
    coinType uint8,
) (cd *dbtypes.ChartsData, err error)

// cmd/dcrdata/internal/api/apiroutes.go (DataSource interface)
TxHistoryData(ctx context.Context, address string,
    addrChart dbtypes.HistoryChart,
    chartGroupings dbtypes.TimeBasedGrouping,
    coinType uint8,
) (*dbtypes.ChartsData, error)
```

### 5.2 SQL

`db/dcrpg/internal/addrstmts.go`:

- `MakeSelectAddressTxTypesByAddress` / `selectAddressTxTypesByAddress`:
  - Добавить параметр `coin_type`.
  - Для `coin_type = 0` (VAR): запрос как сейчас (`SentRtx` + `ReceivedRtx` + `Tickets` + `Votes` + `RevokeTx`).
  - Для `coin_type != 0` (SKA): только `SentRtx` + `ReceivedRtx`, фильтр `WHERE coin_type = $N`.
- `MakeSelectAddressAmountFlowByAddress` / `selectAddressAmountFlowByAddress`:
  - Добавить параметр `coin_type`.
  - Для VAR: `SUM(value) WHERE coin_type = 0`.
  - Для SKA: `SUM(ska_value::numeric) WHERE coin_type = $N`, возвращать результат как строку.

### 5.3 `dbtypes.ChartsData`

`db/dbtypes/types.go:2030-2040`. Расширить так, чтобы JSON параллельно нёс VAR-`float64` и SKA-`string` поля, а также **накопленный balance-ряд** (см. §3.3.1):

- VAR: добавить `Balance []float64` рядом с существующими `Received`/`Sent`/`Net`.
- SKA: добавить `BalanceAtoms []string` рядом с `ReceivedAtoms`/`SentAtoms`/`NetAtoms`.

Точная форма (один тип с обеими ветками vs два типа vs дискриминатор) выбирается при имплементации; ключевое требование — **никаких float-полей для SKA** и **никакой накопительной арифметики на JS** — `balance`-ряд всегда приходит уже посчитанным.

`parseRowsSentReceived` (`db/dcrpg/queries.go:4139-4163`) или его coin-aware вариант: после построения per-bin Net-массива пройти кумулятивным проходом и заполнить Balance:

- VAR: `int64`-аккумулятор по атомам, `[]float64` через `toCoin`.
- SKA: `*big.Int` аккумулятор, `[]string` через `Text(10)`.

### 5.4 Кеш

`db/cache/addresscache.go`:

- `AddressCacheItem.history` — добавить разрез по `coin_type`. Конкретная форма (`map[uint8]*HistoryByInterval` или `[256]*HistoryByInterval`) — на усмотрение импл-фазы.
- `HistoryChart(address, kind, interval)` → `HistoryChart(address, kind, interval, coinType)`.
- `StoreHistoryChart(...)` — сигнатура с `coinType`.

### 5.5 Mock

`cmd/dcrdata/internal/api/noop_ds_test.go:40-42`:

```go
func (n *noopDS) TxHistoryData(ctx context.Context, address string,
    addrChart dbtypes.HistoryChart,
    chartGroupings dbtypes.TimeBasedGrouping,
    coinType uint8,
) (*dbtypes.ChartsData, error) {
    return nil, nil
}
```

---

## 6. Frontend-изменения (детали)

### 6.1 `cmd/dcrdata/views/address.tmpl`

В блоке chart-карточки (`address.tmpl:113-183`):

- Добавить второй `<select>` с `data-address-target="coin"` и `data-action="change->address#changeCoin"`. Опции — пер-цикл по `.Data.ActiveCoins` через `coinSymbol`.
- Удалить hardcoded coin labels: их в шаблоне нет, но проверить что и в новом select атрибут value содержит числовое `coin_type`, а текст — `{{coinSymbol .}}`.

### 6.2 `cmd/dcrdata/public/js/controllers/address_controller.js`

- `:153-191` — добавить target `coin`.
- `:211-219` — добавить ключ `'coin'` в `nullTemplate`.
- `:220-254` — в `connect()` нормализовать `settings.coin` против `ActiveCoins` (получаемого через новый `data-address-active-coins` атрибут, JSON-сериализованный массив `uint8`, или через initial fetch).
- `:30-53` — `amountFlowProcessor` **упрощается**: вместо `balance += v` накопления — просто маппинг ответа в Dygraph-rows. Для view `balance` фронт читает поле `balance` (VAR) / `balance_atoms` (SKA) **как есть** из ответа. Никакого `BigInt` или `Number`-аккумулятора в JS не остаётся.
- `:55-87` — `customizedFormatter`: динамическая метка (`renderCoinType(coin)`) и SKA-aware форматирование (`splitSkaAtomsNoTrailing` поверх атомной строки точки).
- `:120, :130, :140` — динамические ylabels.
- `:496-527` — `fetchGraphData`: добавить `?coin=` query, кешировать по `${chart}-${bin}-${coin}`.
- Новый метод `changeCoin` (рядом с `changeGraph`/`changeBin`): пишет `settings.coin`, вызывает помощник смены `?coin=` (см. address-overview §4) и `setGraphQuery`.

### 6.3 `address_controller.js:setGraphQuery` (`:635-637`)

Сегодня `setGraphQuery()` пишет настройки в URL без вмешательства. Новое требование: смена `?coin=` обязана сбрасывать `?start=0` (но `?start=` принадлежит таблице, а chart-card им не управляет). Поэтому общий помощник делается в виде функции, доступной обоим контроллерам логики (`changeCoin`, `changeTxType` в таблице):

```js
// псевдокод
applyCoinChange(newCoin) {
  this.settings.coin = newCoin
  delete this.settings.start    // pagination reset on coin change
  this.query.replace(this.settings)
  // Trigger refetches
  this.drawGraph()
  this.fetchTable()
}
```

Точная форма (метод на контроллере vs утилита) — на усмотрение импл-фазы.

---

## 7. Точность и форматирование

| Серия              | VAR (`coin=0`)                                          | SKA (`coin=N`)                                                                                |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `Balance` (Y axis) | `[]float64 balance` готовый с бэкенда; 8 знаков         | `[]string balance_atoms` готовый с бэкенда; 18 знаков; legend через `splitSkaAtomsNoTrailing` |
| `amountflow` поля  | `[]float64` (`received`/`sent`/`net`)                   | `[]string` атомов (`received_atoms` etc.)                                                     |
| `Tx Type` счётчики | `[]uint64`/`uint32`                                     | `[]uint64`/`uint32` (только `SentRtx`/`ReceivedRtx`)                                          |
| Метка монеты       | `renderCoinType(0)` → `"VAR"`                           | `renderCoinType(N)` → `"SKA{N}"`                                                              |

**Запрещено:**

- Передача SKA-атомов через `[]float64` или `Number`.
- Inline-литералы `DCR` / `VAR` / `` `SKA${n}` `` в контроллере или в JSON.
- Использование `1e-8` или `1e-18` в чистом виде в шаблоне или в JSON-pipeline (только в форматтерах для отображения).

---

## 8. Эффект на смежные инварианты

- **TurboQuery нулевой шаблон:** новый ключ `coin` объявлен в `nullTemplate` — иначе он не персистится.
- **Кеш бакетирования:** ключ кеша расширен на `coin_type`. Между разными монетами кеш изолирован (никакого cross-talk).
- **Singleflight lock:** `CacheLocks.bal.TryLock(address)` остаётся per-address. При одновременном запросе одного адреса для разных монет последовательно выполнятся два запроса. Параллелизация per-(address, coin) — в скоуп не входит.
- **`ChartsData` JSON-shape:** меняется. Любые внешние потребители этого endpoint’а обязаны быть переведены на новый формат. Внутри проекта: `address_controller.js`, `charts_controller.js` (если затронут — по референсу `coin-supply/{N}`).

---

## 9. Cross-reference

- Балансы и активные монеты приходят с того же handler’а `AddressData` (см. address-overview §3, §7), что и summary-карточка. Никакого отдельного API `ActiveCoins` нет.
- `?coin=` URL-ключ shared с таблицей (см. address-transactions §URL и §фильтр).
- Замена `data-address-balance` (`address.tmpl:15`) — см. address-overview §8.3 (атрибут удалён).

---

## 10. ⚠️ Ключевые инварианты

- График всегда отображает **ровно одну монету** (нет per-coin lines / small multiples).
- Селектор монеты строится по `ActiveCoins`; если у адреса одна монета — селектор скрыт.
- `?coin=` shared с таблицей; смена сбрасывает `?start=0`.
- Tx Type для SKA — только 2 серии; стейк-серии не показываются.
- SKA-атомы **никогда не проходят через `Number`** в JSON или в backend-pipeline.
- **Никакой накопительной арифметики на JS** — `balance`-ряд приходит уже посчитанным с бэкенда (как и `coin-supply/{N}` precedent). На JS остаётся только string→string форматирование для отображения.
- Метки монет — только через `renderCoinType` (JS) и `coinSymbol` (Go template).

---
