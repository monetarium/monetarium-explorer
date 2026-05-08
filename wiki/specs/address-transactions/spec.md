# Address Transactions Section — Multi-Coin Spec

Нижняя секция страницы `/address/{address}` (`cmd/dcrdata/views/address.tmpl:185-298`): шапка с диапазоном/пагинацией, таблица транзакций (`addressTable` из `extras.tmpl:210-315`, обёртка `addresstable.tmpl`), мерж-вью, селекторы Type / Page-size, CSV-выгрузка, постраничная навигация.

Этот документ — продолжение [address-overview/spec.md](../address-overview/spec.md). Технический разбор изменяемых файлов: `wiki/code-analysis/address/transactions.impact.md`.

---

## 1. Цель и охват

### Входит

- Добавить колонку **Coin** в таблицу транзакций (per-row coin label).
- Переименовать колонки **Credit VAR** / **Debit VAR** → **Credit** / **Debit** (метка монеты переезжает в строку).
- Перевести amount-форматирование на пер-монетный путь: VAR через существующие хелперы; SKA — через `skaDecimalParts` / `formatAtomsAsCoinString` (атомы как строка).
- Заменить float-эвристику `{{if eq .SentTotal 0.0}} sstxcommitment` на coin-aware условие (`.CoinType == 0` гейт).
- Добавить **фильтр по монете** рядом с `txntype` selector (`<select>`, default "All").
- Завести URL-ключ `?coin=` (общий с charts, см. address-overview §4) — смена сбрасывает `?start=0`.
- CSV download: схема меняется — единая колонка `amount` (string) + новая `coin_type` колонка.
- Mempool-overlay (`UnconfirmedTxnsForAddress`) выдаёт пер-монетные строки с правильными атомами.

### Не входит

- Графический внешний вид строк (стили, размеры) — только содержимое.
- Поведение `pageNumberLink` / `prevPage` / `nextPage` под существующие URL-ключи (`?start=`, `?n=`) — без изменений, кроме сброса `?start=0` при смене `?coin=`.
- Изменение `txntype` фильтра — без изменений (только мерж-вью теперь работают пер-монетно по умолчанию).
- Live-обновление amount-значений — выходит за рамки скоупа.

---

## 2. Текущее поведение

### 2.1 Таблица

`addressTable` (`extras.tmpl:210-315`) рендерит разные наборы колонок в зависимости от `$txType`:

| `$txType`        | Колонки                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| `merged_debit`   | Tx Type, I/O, Cnt(Inputs), **Debit VAR**, Time, Age, Confirms, Size           |
| `merged_credit`  | Tx Type, I/O, Cnt(Outputs), **Credit VAR**, Time, Age, Confirms, Size         |
| `merged`         | Tx Type, I/O, I/O Count, **Credit VAR**, **Debit VAR**, Time, Age, Confirms, Size |
| `unspent`        | Tx Type, I/O, **Credit VAR**, Time, Age, Confirms, Size                       |
| `credit` / `all` (funding) | Tx Type, I/O, **Credit VAR**, MatchedTx, Time, Age, Confirms, Size  |
| `debit` / `all` (spending) | Tx Type, I/O, MatchedTx, **Debit VAR**, Time, Age, Confirms, Size   |

Все денежные ячейки рендерятся через `float64AsDecimalParts .ReceivedTotal 8 false` или `.SentTotal`. Для SKA-строк (где `CoinType != 0`) backend сегодня заполняет `ReceivedTotal`/`SentTotal` нулём (`db/dbtypes/types.go:2412-2414, 2425-2427`), и шаблон рендерит `0.00000000`.

`CoinType` и `SKAValue` уже есть на `dbtypes.AddressTx`, но **не читаются ни одним шаблоном**.

### 2.2 sstxcommitment heuristic

В шаблоне `extras.tmpl:277` есть особый случай рендеринга для одной разновидности выходов — **sstx commitment output**.

**Что это вообще такое.**

При покупке тикета (SSTx-транзакция, часть Decred-style стейк-механизма) часть выходов записывает адрес и сумму, которые получат награду, когда тикет проголосует. Эти выходы называются *commitment outputs*: они **не тратятся напрямую** — их «раскрывают» только в момент голосования (SSGen) или revocation (SSRtx). На странице адреса такая запись отображается как debit-строка с **нулевой потраченной суммой** (логически — пометка о будущей награде, а не реальный расход).

**Что делает текущий код.**

```
{{- if eq .SentTotal 0.0}}
<td class="text-end">sstxcommitment</td>
```

Шаблон ловит «debit-строка с `SentTotal == 0`» через float-сравнение и подставляет лейбл `sstxcommitment` вместо обычной ссылки `source` / `N/A`.

**Почему это концептуально VAR-only.**

SSTx, SSGen, SSRtx — стейк-механика, унаследованная от dcrd; в Monetarium-сети она существует только для VAR (см. `CLAUDE.md`). У SKA-транзакций commitment-выходов нет в принципе.

**Почему это тихо ломается под мульти-монету.**

Backend сегодня **не заполняет** `SentTotal float64` для SKA-строк — оно всегда `0`, независимо от настоящей потраченной суммы (которая лежит в `SKAValue` строкой по [C1](../../core/constraints.md)). Float-сравнение `eq .SentTotal 0.0` будет ложно-положительно срабатывать на **каждой** SKA-debit-строке, и пользователь увидит лейбл `sstxcommitment` там, где никакого commitment’а быть не может.

Исправление — см. §3.3.

### 2.3 Селекторы и фильтры

`address.tmpl:256-294` — два `<select>` справа под таблицей:

- **Type** (`txntype`) — `all` / `unspent` / `credit` / `debit` / `merged` / `merged_credit` / `merged_debit`.
- **Page size** — `20` / `40` / `80` / `160` (или меньшие варианты для маленьких адресов).

URL-ключи: `?txntype=`, `?n=`, `?start=`. **Нет** ключа `?pagesize=` — размер страницы берётся через `?n=`.

### 2.4 CSV download

Маршрут `/download/address/io/{addr}` (опц. суффикс `/win` для CRLF). Хендлер строит CSV из `AddressRowsCompact` через `AddressRowCompact` — структура **без `CoinType` / `SKAValue`**. Колонка `value` — `dcrutil.Amount(...).ToCoin() float64`, VAR-only.

### 2.5 XHR refresh

`/addresstable/{addr}` (`explorerroutes.go:1654-1690`) возвращает JSON `{tx_count, html, pages}`, где `html` — полный inner-фрагмент `addressTable`. Frontend (`address_controller.js:fetchTable`, ~361-386) делает `dompurify.sanitize(html)` и `innerHTML = ...`.

---

## 3. Требуемое поведение

### 3.1 Колонка Coin и переименование Credit/Debit

**Все варианты `$txType`** получают новую колонку **Coin** между Tx Type и Credit/Debit.

Заголовки **Credit VAR** / **Debit VAR** меняются на **Credit** / **Debit**.

Каждая строка содержит:

- `Tx Type` — без изменений (Regular / Ticket / Vote / Revocation / Mixed на VAR; на SKA только Regular).
- `Tx ID` — без изменений (обычный hashlink).
- **`Coin`** — `{{coinSymbol .CoinType}}` (`VAR` для VAR-строки, `SKA{N}` для SKA).
- `Credit` / `Debit` — сумма в атомах строки, отформатированная по типу монеты:
  - VAR: `float64AsDecimalParts (toFloat64Amount .Value) 8 false` (как сейчас, но **через `Value`** в атомах, а не через `ReceivedTotal`/`SentTotal` float).
  - SKA: `skaDecimalParts .SKAValue` или `formatAtomsAsCoinString .SKAValue 1` (атомы как строка, 18 знаков).
- Остальные колонки (Time, Age, Confirms, Size) — без изменений.

#### Таблица колонок по `$txType`

```
all / credit (funding)
Tx Type | Tx ID | Coin | Credit | Spent? | Time | Age | Confirms | Size

all / debit (spending)
Tx Type | Tx ID | Coin | Source | Debit | Time | Age | Confirms | Size

unspent
Tx Type | Tx ID | Coin | Credit | Time | Age | Confirms | Size

merged_credit
Tx Type | Tx ID | Coin | Cnt(Outputs) | Credit | Time | Age | Confirms | Size

merged_debit
Tx Type | Tx ID | Coin | Cnt(Inputs)  | Debit  | Time | Age | Confirms | Size

merged
Tx Type | Tx ID | Coin | I/O Count | Credit | Debit | Time | Age | Confirms | Size
```

**Важно:** в мерж-вью каждая строка по-прежнему происходит из одной транзакции (которая односмонетная по chain invariant) — у строки есть один well-defined `coin_type`. Колонка Coin содержит метку этой монеты.

### 3.2 Точность

- VAR amount → 8 знаков после запятой, `float64AsDecimalParts`.
- SKA amount → 18 знаков, **строка**, через `skaDecimalParts` или `formatAtomsAsCoinString`.
- Метка монеты в колонке Coin → `{{coinSymbol .CoinType}}`.

### 3.3 sstxcommitment heuristic

`extras.tmpl:277` меняется на:

```
{{- if and (eq .CoinType 0) (eq .SentTotal 0.0)}}
<td class="text-end">sstxcommitment</td>
```

Гейт `eq .CoinType 0` означает «эвристика применяется только к VAR-строкам». SKA-строки никогда не считаются sstxcommitment (они и не могут им быть — sstx это VAR-only стейк-объект). Float-сравнение `eq .SentTotal 0.0` остаётся, но теперь оно безопасно: для VAR-строк `.SentTotal` всё ещё `float64`, и нулевое значение здесь корректно.

### 3.4 Coin filter (`<select>`)

В строке селекторов (`address.tmpl:256-294`) появляется новый `<select>`:

```
[Type: All ▾]   [Coin: All ▾]   [Page size: 20 ▾]
```

**Опции селектора Coin:**

- `value="" → "All"` (default; означает «без фильтра, все монеты»).
- `value="0" → coinSymbol 0 ("VAR")` — только если `0 ∈ ActiveCoins`.
- `value="N" → coinSymbol N ("SKA{N}")` — для каждого `N ∈ ActiveCoins`, `N != 0`.
- Селектор скрыт, если `len(ActiveCoins) <= 1` (только один coin → нечего выбирать).

**Поведение:**

- `<select data-address-target="coinFilter" data-action="change->address#changeCoin">`.
- Изменение пишет `settings.coin = e.target.value` (или `delete settings.coin` если выбран «All»), сбрасывает `?start=0` (см. address-overview §4), делает refetch таблицы (`fetchTable`).
- Текущее значение читается из URL в `connect()` и нормализуется (если значение не из `ActiveCoins` или не пустое — нормализуется к "All").

### 3.5 Server-side фильтр

`parseAddressParams` (`explorerroutes.go:1774-1789`) расширяется:

- Парсит `?coin=` query parameter.
- Валидирует против `0..255`.
- Если значение не принадлежит `ActiveCoins` (или само поле отсутствует/пусто) — фильтр отсутствует.

`AddressListData` (`explorerroutes.go:1877`) пробрасывает `coinType *uint8` в `dataSource.AddressData`. SQL `AddressHistory` (или его coin-aware вариант) добавляет `WHERE coin_type = $K` при заданном фильтре.

**Эта же логика применяется к XHR `AddressTable` handler’у** (`explorerroutes.go:1654-1690`) — fetched `tx_count` и `pages` пересчитываются под текущий фильтр.

### 3.6 Pagination

URL-ключи `?n=` и `?start=` остаются без изменений. **Изменение `?coin=` сбрасывает `?start=0`** (см. address-overview §4).

Существующие потоки (Previous/Next, numbered pages, page-size change) — без изменений.

### 3.7 CSV download

Схема **меняется** для всех адресов (не только SKA):

| Колонка        | Тип         | Значение                                                                         |
| -------------- | ----------- | -------------------------------------------------------------------------------- |
| `direction`    | string      | `funding` / `spending` (как сегодня)                                             |
| `tx_hash`      | string      | tx hash                                                                          |
| `vout_index`   | int         | как сегодня                                                                      |
| `coin_type`    | string      | `VAR` / `SKA1` / `SKA2` …                                                        |
| `amount`       | string      | сумма в монете строки: VAR — 8dp, SKA — 18dp; **всегда строка**, без float       |
| `time`         | iso8601     | как сегодня                                                                      |
| `block_height` | int         | как сегодня                                                                      |
| `confirmations`| int         | как сегодня                                                                      |

(Точные имена колонок — на усмотрение импл-фазы; ключевое — единая `amount` строка + `coin_type`.)

**Filter respect:** если в URL присутствует `?coin=N`, CSV-файл содержит только строки этой монеты; это делается через тот же серверный фильтр (см. §3.5).

`/win` суффикс по-прежнему меняет CRLF — это ортогонально мульти-монетной переработке.

### 3.8 Mempool overlay (unconfirmed строки)

`pgblockchain.go:2632-2634, 2693-2695` сегодня кастует все unconfirmed суммы через `dcrutil.Amount(value).ToCoin()` без разреза по монете.

Изменения:

- Mempool-структуры (`mempool` package) обязаны нести `coin_type` и атомы для каждой unconfirmed-tx (для transactions-таблицы).
- При overlay’е в `AddressData` строки получают:
  - VAR: атомы → `Value int64` → `ReceivedTotal/SentTotal float64` (как сейчас).
  - SKA: атомы → `SKAValue string`, `CoinType = N`. `ReceivedTotal/SentTotal` остаются `float64`-нулём (для SKA-строки шаблон их не читает).

### 3.9 XHR refresh shape

JSON-ответ `/addresstable/{addr}` остаётся `{tx_count, html, pages}`. `html` теперь содержит новую колонку `Coin` и пер-монетное форматирование amount’ов. `tx_count` отражает фильтр `?coin=` (если задан).

Frontend `fetchTable` (`address_controller.js:361-386`):

- URL построения: добавить `?coin=` к параметрам (`txntype`, `start`, `n`).
- В остальном без изменений: `dompurify.sanitize` → `innerHTML = ...`.

---

## 4. UI mockup таблицы (вариант `all`)

```
Tx Type | Tx ID    | Coin | Credit       | Spent?  | Time             | Age | Conf | Size
--------+----------+------+--------------+---------+------------------+-----+------+-----
Regular | abc...12 | VAR  | 50.00000000  | spent   | 2025-01-12 10:23 | 4d  | 1,200| 234B
Regular | def...34 | SKA1 | 1.000…001    | unspent | 2025-01-11 09:14 | 5d  | 1,310| 198B
Regular | ghi...56 | VAR  | —            | source  | 2025-01-09 17:02 | 7d  | 1,500| 256B
```

Под таблицей (нижний ряд элементов):

```
[CSV Download]                         [Type: All ▾]  [Coin: All ▾]  [Page size: 20 ▾]
```

---

## 5. Backend-изменения (детали)

### 5.1 `dbtypes.AddressTx`

Поля уже частично есть; нужно довести до шаблона:

- `CoinType uint8` — coin тип строки.
- `SKAValue string` — атомы SKA как строка (для VAR — пусто; шаблон не читает).
- `ReceivedTotal float64`, `SentTotal float64` — остаются для VAR (атомы → coins).
- Дополнительно: `IsSstxCommitment bool` — **опционально**, если будет принято решение перейти от float-эвристики к явному флагу. В текущем спеке принят более лёгкий вариант (гейт `CoinType == 0`); явный флаг — out of scope, но шаблон-замена под него тривиальна.

### 5.2 `dbtypes.ReduceAddressHistory` и `FillAddressTransactions`

- `ReduceAddressHistory` (`db/dbtypes/types.go:2380+`):
  - При `addrOut.CoinType == 0` (VAR) — путь как сейчас, через `dcrutil.Amount(addrOut.Value).ToCoin()`.
  - При `addrOut.CoinType != 0` (SKA) — установить `tx.SKAValue = addrOut.SKAValue`; не вызывать `ToCoin()`; `ReceivedTotal/SentTotal` оставить нулём.
  - В обоих случаях — установить `tx.CoinType = addrOut.CoinType`.
- `FillAddressTransactions` (`pgblockchain.go:2746`) — проверить, не забывает ли заполнять `CoinType` / `SKAValue` для строк, добавляемых из БД (не из mempool).

### 5.3 `parseAddressParams` и handler’ы

- `parseAddressParams` (`explorerroutes.go:1774`) парсит и валидирует `?coin=`.
- `AddressPage` и `AddressTable` пробрасывают `coinFilter *uint8` в `AddressListData`.
- `AddressListData` (`explorerroutes.go:1877`) → `dataSource.AddressData(..., coinFilter)` → `pgblockchain.go:AddressData(..., coinFilter)`.

### 5.4 SQL фильтр

`db/dcrpg/queries.go:AddressHistory` (~`pgblockchain.go:2382`) расширяется на необязательный фильтр `WHERE coin_type = $K`. Подобный фильтр нужен и для `mergedTxnCount` (`:2322`) — иначе фильтр не возвратит правильный `tx_count` для пагинации.

### 5.5 CSV handler

Найти роут `/download/address/io/{addr}[/win]` (хендлер строит CSV из `AddressRowsCompact` → `AddressRowCompact`):

- Расширить `AddressRowCompact` полями `CoinType uint8`, `Amount string` (или `AmountAtoms string`).
- В CSV-сериализаторе:
  - `coin_type` → `coinSymbol(row.CoinType)`.
  - `amount` → `formatCoinAtoms(row.Amount, row.CoinType)` (или эквивалент).
  - **Никогда** не выводить `dcrutil.Amount(...).ToCoin()` для SKA-строк.
- Поддержать фильтр `?coin=` через `parseAddressParams` или эквивалентный CSV-handler-параметр.

### 5.6 Mempool-overlay

`db/dcrpg/pgblockchain.go:2632-2634, 2693-2695` (`UnconfirmedTxnsForAddress` overlay):

- Mempool tracker (`mempool/` package) уже несёт `coin_type` для каждой tx; протащить до overlay-кода.
- Создавать `AddressTx` строки с правильными `CoinType` и `SKAValue`.
- VAR-строки — путь как сейчас через `Value` / `ToCoin()`.

### 5.7 Mocks

- `cmd/dcrdata/internal/explorer/explorer_test.go` — `mockDataSource.AddressHistory`/`AddressData` сигнатуры обновляются под `coinFilter`.
- `cmd/dcrdata/internal/api/noop_ds_test.go` — то же.

---

## 6. Frontend-изменения (детали)

### 6.1 `cmd/dcrdata/views/address.tmpl`

- `:189-219` (header пагинации) — без изменений.
- `:256-294` — добавить `<select data-address-target="coinFilter">` с опциями по `.Data.ActiveCoins` (см. §3.4).

### 6.2 `cmd/dcrdata/views/extras.tmpl`

`{{define "addressTable"}}` (~210-315):

- В каждом из 7 веток `$txType` — добавить колонку `<th>Coin</th>` сразу после Tx Type (либо после Tx ID, по визуальному предпочтению). Текущий рендер выбирает колонки кейс-за-кейсом — добавить Coin во все варианты.
- Заголовки `Credit VAR` / `Debit VAR` (`:222, :227, :230, :231, :233, :235, :236`) → `Credit` / `Debit`.
- В `<tbody>` row’е добавить `<td>{{coinSymbol .CoinType}}</td>`.
- Каждый `<td class="text-end fs15">...float64AsDecimalParts...</td>` (`:251, 254, 258, 262, 265, 267, 284`) переписать на:
  ```
  {{- if eq .CoinType 0}}
    {{template "decimalParts" (float64AsDecimalParts .ReceivedTotal 8 false)}}
  {{- else}}
    {{template "decimalParts" (skaDecimalParts .SKAValue)}}
  {{- end}}
  ```
  (или эквивалент через `formatAtomsAsCoinString`). Точные хелперы — см. address-overview §8.2.
- `:277` — гейт `{{if and (eq .CoinType 0) (eq .SentTotal 0.0)}}` (см. §3.3).

### 6.3 `cmd/dcrdata/views/addresstable.tmpl`

Без изменений (двухстрочная обёртка над `addressTable`).

### 6.4 `cmd/dcrdata/public/js/controllers/address_controller.js`

- `:153-191` — добавить target `coinFilter` (отдельно от chart-карточкого target `coin`, либо unify в один target — на усмотрение импл-фазы; имя `coin` уже зарезервировано картой графика).
- `:211-219` — в `nullTemplate` ключ `'coin'` уже добавлен (см. address-charts §3.2). Здесь не дублировать — это shared key.
- `:220-254` (`connect()`) — добавить чтение selector’а из URL и нормализацию против `ActiveCoins`.
- `:361-386` (`fetchTable`) — добавить `?coin=` к URL построения.
- Новый метод (или общий с charts-card) `changeCoin` — пишет `settings.coin`, сбрасывает `?start=0`, обновляет селектор и таблицы (`fetchTable`) **и** график (`drawGraph`).

### 6.5 Sanitize-список

`fetchTable` использует `dompurify.sanitize` (`address_controller.js:382`). Если новые HTML-конструкции (например, ` <span class="coin-badge">SKA1</span>` если будет принято решение оборачивать coin метки) добавят неподдерживаемые теги, добавить их в allowlist. Сейчас `<td>{{coinSymbol .CoinType}}</td>` — обычный текст, никаких новых тегов не требуется.

---

## 7. Точность и форматирование

| Колонка / поле  | VAR (`coin_type=0`)                             | SKA (`coin_type=N`)                                     |
| --------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Coin            | `coinSymbol 0` → `"VAR"`                        | `coinSymbol N` → `"SKA{N}"`                             |
| Credit / Debit  | `float64AsDecimalParts .ReceivedTotal 8 false`  | `skaDecimalParts .SKAValue` или эквивалент              |
| Cnt / I/O Count | `intComma .MergedTxnCount`                      | `intComma .MergedTxnCount` (count, coin-agnostic)       |
| Time / Age / Confirms / Size | без изменений                      | без изменений                                           |
| sstxcommitment | возможен по float-условию (`SentTotal == 0.0`)  | **никогда** (гейт `CoinType == 0`)                      |

**Запрещено:**

- Inline `Credit VAR` / `Debit VAR` / `Total DCR` / `DCR` в шаблоне.
- `dcrutil.Amount(...).ToCoin()` или `.ReceivedTotal`/`.SentTotal` чтение для SKA-строк.
- `eq .SentTotal 0.0` без гейта на `CoinType == 0`.

---

## 8. Server vs XHR парность

`AddressPage` (`explorerroutes.go:1534`) и `AddressTable` (`:1654`) разделяют `parseAddressParams` и `AddressListData`. Любое изменение фильтра `?coin=` обязано проявиться **в обоих** обработчиках, иначе XHR-refresh покажет другие строки, чем initial render.

Регрессионный сценарий: открытие страницы с `?coin=2`, затем переключение `?coin=1` через UI — оба render’а должны отдавать только `coin_type=1`.

---

## 9. ⚠️ Ключевые инварианты

- Каждая строка таблицы — single-coin (chain invariant); колонка **Coin** всегда определена для каждой строки.
- VAR amount — 8dp через float64-pipeline; SKA amount — 18dp атомы строкой; никогда не путать.
- Фильтр `?coin=` ортогонален `?txntype=`, `?n=`, `?start=`; смена `?coin=` сбрасывает `?start=0`.
- sstxcommitment-эвристика — VAR-only по гейту `CoinType == 0`.
- CSV-схема единая для всех монет: одна строковая `amount` + `coin_type`; нет per-coin отдельных файлов.
- XHR refresh должен быть полностью эквивалентен SSR при тех же параметрах.

---
