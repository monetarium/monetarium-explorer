# Address Page — Multi-Coin Overview (cross-feature contract)

Документ описывает кросс-страничные правила перевода `/address/{address}` на мульти-монетную модель **VAR + SKA{n}**. Он определяет общую модель адреса, URL-контракт, общие приёмы отображения и backend-изменения, которые затрагивают сразу несколько разделов страницы.

Конкретные UI-правила вынесены в три отдельных спецификации:

- [address-summary](../address-summary/spec.md) — левая верхняя карточка (Balance / Received / Spent / Unconfirmed / Stake %)
- [address-charts](../address-charts/spec.md) — правая верхняя карточка (графики Balance / Tx Type / Sent-Received)
- [address-transactions](../address-transactions/spec.md) — нижняя секция (таблица транзакций, фильтры, CSV-скачивание)

Сопровождающий технический разбор находится в `wiki/code-analysis/address/`:

- `flow.compact.md`, `flow.full.md` — общий поток данных
- `summary.impact.md`, `charts.impact.md`, `transactions.impact.md` — пофичевые change-surface заметки

---

## 1. Контекст и цель

Страница `/address/{address}` сегодня собрана под одно-монетную модель `dcrdata`:

- `dbtypes.AddressInfo.Balance` — единственный `AddressBalance` без разреза по монете
- Все суммы проходят через `dcrutil.Amount.ToCoin() float64` и в шаблоне снабжаются жёстко зашитой меткой `DCR`
- Backend-эндпоинты графиков и SQL для `amountflow` агрегируют только по столбцу `addresses.value` (VAR-атомы), полностью игнорируя `addresses.ska_value`
- Колонки таблицы транзакций называются `Credit VAR` / `Debit VAR`, суммы — `float64`

Это нарушает инварианты [`wiki/core/constraints.md` C1, C7](../../core/constraints.md): SKA-значения не помещаются в `float64` (18 десятичных знаков), а метки монет должны рендериться через канонические хелперы.

Цель редизайна — сделать страницу адекватной мульти-монетной природе сети при сохранении существующего UX-каркаса (TurboQuery URL state, пагинация, мерж-вью, CSV-выгрузка).

---

## 2. Модель адреса (multi-coin)

**Адрес может содержать любые монеты одновременно.**

Формально: один адрес-скрипт может являться получателем выходов любого `coin_type` (VAR `0`, SKA `1..255`). Хотя отдельная транзакция всегда одномонетная (см. `CLAUDE.md`), отдельный адрес — нет: на нём могут лежать VAR + произвольный набор `SKA{n}`.

### Правила отображения монет (общие)

Эти правила едины для всех трёх разделов страницы и совпадают с уже принятыми соглашениями в [block-details](../block-details/spec.md) и [mempool](../mempool/spec.md).

- **Условное отображение:** VAR показывается всегда; SKA — только если присутствует на адресе (см. §3 `ActiveCoins`).
- **Порядок:** `VAR → SKA1 → SKA2 → … → SKA{N}` по возрастанию `coin_type`.
- **Точность:**
  - VAR — до 8 знаков после запятой (формат через `dcrutil.Amount` / `float64AsDecimalParts`).
  - SKA — до 18 знаков после запятой; **значения проходят через все слои строкой** (DB `TEXT`, REST/JSON, WebSocket, шаблоны). Никакой `ToCoin()` для SKA, никакого `Number(s)` без `BigInt` в JS.
- **Метки монет:**
  - Server-side: только через `coinSymbol(ct uint8) string` (`cmd/dcrdata/internal/explorer/templates.go`, FuncMap `coinSymbol`).
  - Client-side: только через `renderCoinType(coinType)` (`cmd/dcrdata/public/js/helpers/ska_helper.js`).
  - Никаких inline-литералов `DCR`, `VAR`, `` `SKA${n}` `` в шаблонах или контроллерах.

---

## 3. Активные монеты адреса (`ActiveCoins`)

Чтобы карточки и фильтры показывали только релевантные адресу монеты, на `AddressInfo` добавляется поле:

```go
ActiveCoins []uint8 // отсортированный по возрастанию набор coin_type, под которые у адреса есть строки в `addresses`
```

Источник данных — новый запрос в `db/dcrpg/queries.go` рядом с `retrieveAddressBalance`:

```sql
SELECT DISTINCT coin_type
FROM addresses
WHERE address = $1
ORDER BY coin_type
```

Заполнение происходит в `pgblockchain.go:AddressData` (или внутри `AddressHistory`) и кешируется так же, как остальные части `AddressBalance` (через `AddressCache`).

### Правила использования `ActiveCoins`

- Если `ActiveCoins` пуст и адрес не dummy — рендерить empty-state (см. §6).
- Сортировка строк/опций монет должна следовать порядку `ActiveCoins` (он уже отсортирован).
- VAR (`0`) всегда присутствует в `ActiveCoins`, если у адреса вообще были VAR-операции; для SKA-only адресов VAR в списке отсутствует — это нормально.

---

## 4. URL-контракт (`?coin=`)

В TurboQuery-ключи (`address_controller.js:211-219`) добавляется один новый ключ — общий между картой графиков и таблицей:

| Ключ      | Значения                                                                                   | Владелец на странице          |
| --------- | ------------------------------------------------------------------------------------------ | ----------------------------- |
| `coin`    | пусто \| `0` \| `1..255`                                                                   | charts + transactions (общий) |
| `chart`   | `balance` \| `types` \| `amountflow`                                                       | charts                        |
| `zoom`    | `<startMs>-<endMs>` (base-36)                                                              | charts                        |
| `bin`     | `year` \| `month` \| `week` \| `day` \| `all`                                              | charts                        |
| `flow`    | bitmap (Sent=2, Received=1, Net=4)                                                         | charts                        |
| `n`       | размер страницы                                                                            | transactions                  |
| `start`   | смещение                                                                                   | transactions                  |
| `txntype` | `all` \| `unspent` \| `credit` \| `debit` \| `merged` \| `merged_credit` \| `merged_debit` | transactions                  |

### Семантика `?coin=`

- **`coin` отсутствует или пустой:**
  - chart-карточка → активная монета по умолчанию **VAR** (если её нет в `ActiveCoins`, то первая из `ActiveCoins`).
  - таблица → "All coins" (без фильтра, выводятся все строки).
- **`coin=N`** (где `N ∈ ActiveCoins`):
  - chart-карточка → серии графика для монеты `N`.
  - таблица → отображаются только транзакции с `coin_type = N`.
- **`coin=N`, где `N ∉ ActiveCoins`:** трактуется как отсутствующий — серверная логика тихо сбрасывает на default; на клиенте `address_controller.js` нормализует значение в `connect()`.

### Изменение `?coin=`

Любое изменение `?coin=` **сбрасывает `?start=0`** (пагинация теряет смысл при смене скоупа фильтра). Обе точки записи — селектор графика и фильтр таблицы — обязаны вызывать `setGraphQuery` / `setTableQuery` через единый помощник, делающий `delete this.settings.start` (или эквивалент) перед `query.replace`.

Карточка summary `?coin=` **игнорирует** — она всегда показывает полный пер-монетный разрез.

---

## 5. Real-time updates

Объём в этой переработке остаётся минимальным:

- `numUnconfirmed` — обновляется живьём (см. address-summary §Unconfirmed) с пер-монетным разрезом.
- `txnCount` — обновляется живьём (как сейчас, агрегатно).
- **Balance / Received / Spent / Stake % — только SSR.** Никакого pubsub-канала под балансы адреса в этой переработке не вводится.

Если в будущем понадобится живое обновление пер-монетных балансов, это будет отдельный спек: потребуется websocket-payload и BigInt-арифметика на JS-стороне (см. C1).

---

## 6. Dummy/zero address

Сокращение в `cmd/dcrdata/internal/explorer/explorerroutes.go:1592-1602` (короткое замыкание для адреса нулевых выходов нерасходуемых тикетов) **остаётся без изменений**. Удаление приведёт к таймаутам БД на адресах с большим количеством выходов.

Структурное условие: пустой `AddressInfo`, возвращаемый коротким замыканием, должен по форме совпадать с новым мульти-монетным шаблоном — то есть:

- `Balance` (см. §7) допускает пустую пер-монетную карту/набор без специальных случаев в шаблоне
- `ActiveCoins` пуст
- `NumUnconfirmed` равен нулю или отсутствует

---

## 7. Backend-изменения (cross-cutting)

### 7.1 `dbtypes.AddressBalance`

Перейти от плоской структуры к пер-монетной. Концептуально:

```go
type AddressBalance struct {
    Address string
    Coins   map[uint8]*CoinBalance // ключ — coin_type
    // Stake-метрики (FromStake, ToStake) — только для VAR; см. address-summary §Stake %
    FromStake float64
    ToStake   float64
}

type CoinBalance struct {
    CoinType    uint8
    NumSpent    int64
    NumUnspent  int64
    TotalSpent  int64  // VAR: атомы; для SKA — не используется
    TotalUnspent int64 // VAR: атомы; для SKA — не используется
    TotalSpentSKA   string // SKA-атомы как строка; для VAR — не используется
    TotalUnspentSKA string // SKA-атомы как строка; для VAR — не используется
    // Предсчитанное Received = TotalSpent + TotalUnspent в атомах своей монеты
    // (см. address-summary §3.3) — чтобы шаблон не выполнял сложение SKA-строк.
    TotalReceived    int64  // VAR-ветка
    TotalReceivedSKA string // SKA-ветка
}
```

Плюс на уровне самого `AddressBalance` (не per-coin) — **предсчитанные** скалярные счётчики, чтобы шаблон не пробегал по `Coins` map‘у с `add`:

- `TotalOutputs int64` = `Σ (NumSpent + NumUnspent)` по всем монетам.
- `TotalInputs  int64` = `Σ NumSpent` по всем монетам.

Точную форму (две числовые пары VAR/SKA в одной структуре vs. два разных типа) определяет address-summary §10. Главное правило: **никаких `int64`-атомов для SKA** и **никакой арифметики над атомами в шаблоне**.

### 7.2 `retrieveAddressBalance`, `ReduceAddressHistory`

В `db/dcrpg/queries.go:retrieveAddressBalance` (~1453-1529) и `db/dbtypes/types.go:ReduceAddressHistory` (~2380+) сейчас сворачивают по `coin_type`, складывая разные scale’ы в один `int64`. Они должны сохранять разрез: SQL `SelectAddressSpentUnspentCountAndValue` (`db/dcrpg/internal/addrstmts.go:220-232`) уже группирует по `coin_type`; нужно перестать схлопывать.

`FromStake` / `ToStake` считаются строго по VAR-секции (см. address-summary §Stake %).

### 7.3 `dbtypes.AddressTx` / `AddressRow`

`AddressRow.CoinType` и `AddressRow.SKAValue` уже несут пер-монетную информацию из БД. Нужно довести её до шаблона:

- На `AddressTx` (тип в `dbtypes`) добавить (или активировать существующее) поле `CoinType uint8` и строковое поле атомов SKA (`SKAValue string`).
- В `ReduceAddressHistory` (~`types.go:2380+`) при `addrOut.CoinType != 0` не клатать `addrOut.Value` через `ToCoin()`; передавать атомы в строковом виде.
- Поле `SentTotal float64` / `ReceivedTotal float64` остаётся для VAR; для SKA добавить параллельные `SentTotalSKA string` / `ReceivedTotalSKA string` (или эквивалент). Точную форму — см. address-transactions §Backend-изменения.

### 7.4 Мок-имплементации

Любое изменение интерфейсов задевает три места:

- `cmd/dcrdata/internal/explorer/explorer_test.go` (`mockDataSource.AddressHistory`, `AddressData`, `DevBalance`)
- `cmd/dcrdata/internal/api/noop_ds_test.go` (`noopDS.AddressHistory`, `TxHistoryData`)
- любые другие реализации в обычных тестах

При изменении сигнатур моки обновляются в одном PR с продакшеновым кодом.

---

## 8. Шаблонные хелперы и шаблоны-партизаны

### 8.1 Запрещённые конструкции на этой странице

В рамках редизайна **нельзя**:

- Вызывать `toFloat64Amount` для значений, которые могут быть SKA.
- Вызывать `amountAsDecimalParts` для значений, которые могут быть SKA.
- Вписывать в шаблон литералы `DCR`, `VAR`, `` `SKA${n}` ``.
- В JS приводить SKA-атомы к `Number`/`parseFloat` или сравнивать SKA-значения через `===`/`==`.

#### Почему `===` / `==` для SKA-атомов небезопасны

Две причины (обе — следствия [C1](../../core/constraints.md): атомы SKA живут только как строки):

**1. `==` запускает type coercion → precision loss.** Если одна сторона — `Number` (значение по умолчанию, `dataset.x`, поле другого источника), `==` приведёт строку к `Number`. У `Number` ~15 значащих цифр, у атомов SKA — 18+. Округление случается тихо, сравнение возвращает «равно» для разных значений:

```js
const atoms = "1000000000000000001";
atoms == 1000000000000000001; // true  (правый операнд уже округлился до 1e18)
BigInt(atoms) === 1000000000000000001n; // false (правильно)
```

**2. `===` на строках сравнивает лексически, а у одного значения может быть несколько канонических форм.** Атомы приходят из разных источников с разной нормализацией (`splitSkaAtomsNoTrailing` обрезает нули, шаблонные форматтеры — нет; JSON, dataset, форма поля — все могут отличаться):

```js
"100" === "0100"; // false (но численно равны)
"1.00" === "1"; // false
"1e18" === "1000000000000000000"; // false
"+1" === "1"; // false
```

**Правильный паттерн — через `BigInt`:**

```js
BigInt(a) === BigInt(b); // равенство (численное, не лексическое)
BigInt(a) > BigInt(b); // сравнение
BigInt(atoms) === 0n; // вместо `atoms === 0` или `atoms == 0`
```

То же относится к VAR-атомам, если они проходят через JSON в строковой форме (для chart-эндпоинтов VAR остаётся `float64`, см. address-charts §3.3.3 — но любая будущая миграция к атомам строкой обязана следовать тому же правилу).

### 8.2 Разрешённые / рекомендуемые хелперы

Server-side (Go templates, `cmd/dcrdata/internal/explorer/templates.go`):

- `coinSymbol(ct uint8) string` — метка монеты.
- `formatAtomsAsCoinString(atomStr, coinType)` или `skaDecimalParts` — форматирование SKA-атомов.
- `float64AsDecimalParts` / `amountAsDecimalParts` — **только** для VAR-веток.
- `intComma`, `x100`, `add`, `subtract` — для счётов и процентов (coin-agnostic).

Client-side (`cmd/dcrdata/public/js/helpers/`):

- `renderCoinType(coinType)` — метка монеты (`null`/`undefined`/out-of-range → `"-"`).
- `formatCoinAtoms(atomStr, coinType)` — three-significant-figure роутинг.
- `formatAtomsAsCoinString(atomStr, coinType)` — полная точность с обрезкой trailing zeros.
- `splitSkaAtoms(atomStr)` — `BigInt`-safe разделение атомов на цело-десятичную часть.
- `splitSkaAtomsNoTrailing(atomStr)` — то же без trailing zeros.

### 8.3 `data-address-balance`

Атрибут на корневом контейнере `address.tmpl:15` (`data-address-balance="{{toFloat64Amount .Balance.TotalUnspent}}"`) **удаляется**. Сегодня он считывается в `address_controller.js:230` (`ctrl.balance`), но больше нигде не используется. Вводить пер-монетный JSON-вариант не нужно.

### 8.4 Принцип распределения вычислений: бэкенд vs фронт

Общее правило для всей страницы (применяется ко всем трём дочерним спекам):

| Где живёт                                                        | Что считается                                                                              |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Бэкенд (Go)**                                                  | Всё, что связано с **арифметикой над атомами**: суммы, кумулятивные суммы (running balance), пер-монетные итоги. Использует `int64` для VAR, `*big.Int` для SKA. |
| **Бэкенд (Go)**                                                  | Все coin-agnostic скалярные счётчики и предсчитанные поля (`TotalOutputs`, `TotalInputs`, `TotalReceived`, `Balance []float64` / `BalanceAtoms []string` для chart-серий). |
| **Шаблон / контроллер (Go template / JS)**                       | Только string→string форматирование (`coinSymbol`, `splitSkaAtomsNoTrailing`, `formatAtomsAsCoinString`), UI-state (зум, селекторы, нормализация `?coin=`), DOM-операции на real-time события. |
| **Запрещено**                                                    | `BigInt`-арифметика на JS, `add`/`subtract`/кумсуммы атомов в Go-шаблоне (вне форматтеров), любая `Number`-конверсия SKA-атомов до точки рендера. |

**Почему это важно:**

- Точность: SKA-арифметика на `*big.Int` в Go — единственный безопасный путь (`Number` в JS теряет точность за 15-й цифрой; см. §8.1).
- Кеширование: предсчитанные поля попадают в `AddressCache` и не пересчитываются на каждом рендере.
- Симметрия с прецедентами: SKA `coin-supply/{N}` уже считается на бэкенде через `*big.Int.Add` (см. `wiki/code-analysis/charts/`), и Address charts/summary следуют тому же паттерну.
- Простота фронта: в `address_controller.js` остаётся только UI-state и форматирование — никаких накопителей и `BigInt`-обёрток.

#### Что с этим делают websocket-обновления

В рамках текущего скоупа адресная страница реагирует только на `BLOCK_RECEIVED` ([§5](#5-real-time-updates)). Правила распределения вычислений действуют и здесь:

- **Что в payload есть сегодня:** список confirmed txids. Coin-type на per-tx уровне в событии **нет**, и расширять payload **не требуется** — необходимая для пер-монетных декрементов coin-info уже на клиенте через SSR-атрибут `data-coin-type` (см. address-summary §3.5).
- **Что обновляется живьём:** скалярные счётчики (`numUnconfirmed[N]`, `txnCount`). Это инкременты/декременты `int64` — арифметика безопасна даже на JS, никакого `BigInt` не нужно.
- **Если бы понадобилось живо обновлять SKA-балансы (out of scope):** payload **обязан** нести уже посчитанные атомные строки (новые балансы на адрес), а не дельты к старому значению. Применение дельты на клиенте требовало бы `BigInt`-арифметики и нарушало C1 ([точность через слои](../../core/constraints.md#c1-numeric-precision--bifurcation)) и [C3](../../core/constraints.md#c3-template--websocket-parity) (паритет SSR ↔ live). Это правило фиксируется здесь, чтобы будущий «live-balances» спек не возвращал нас к JS-арифметике.
- **Если бы понадобились живо появляющиеся mempool-строки (out of scope):** новые DOM-узлы создаются только через `<template>`-cloning ([C6](../../core/constraints.md#c6-in-dom-template-cloning)), не через `innerHTML` конкатенацию.

---

## 9. Связанные изменения, остающиеся вне скоупа

- **Fiat conversion** — монеты сети (ни VAR, ни SKA) сейчас нигде не торгуются, реальной цены нет. В рамках этой переработки fiat-строка убирается из карточки summary целиком (см. address-summary §3.7). Пакет `exchanges/bot.go` остаётся в репозитории — его используют другие страницы (home, mempool, tx); их перевод/чистка — вне скоупа этого спека. Когда (и если) у монет появится реальный рынок, отдельный будущий спек вернёт fiat сразу пер-монетным.
- **Live updates балансов** — выходит за пределы текущего скоупа; см. §5.

---

## 10. Чек-лист изменений на странице

| Раздел        | Файл                                                                                         | Изменения (резюме)                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Backend types | `db/dbtypes/types.go`                                                                        | `AddressBalance` пер-монетная; `AddressInfo.ActiveCoins []uint8`; SKA-поля на `AddressTx`.                  |
| Backend DB    | `db/dcrpg/queries.go`, `db/dcrpg/pgblockchain.go`, `db/dcrpg/internal/addrstmts.go`          | новый `SELECT DISTINCT coin_type`; пер-монетный разрез в `retrieveAddressBalance` / `ReduceAddressHistory`. |
| API (charts)  | `cmd/dcrdata/internal/api/apiroutes.go`, `apirouter.go`                                      | `?coin=N` query param; пер-монетная диспатч-логика в `TxHistoryData`.                                       |
| Cache         | `db/cache/addresscache.go`                                                                   | ключ кеша расширен на `coin_type`.                                                                          |
| Handler       | `cmd/dcrdata/internal/explorer/explorerroutes.go`                                            | парсинг `?coin=`, заполнение `ActiveCoins`, fiat больше не считается через `xcBot.Conversion`.              |
| Templates     | `cmd/dcrdata/views/address.tmpl`, `extras.tmpl`, `addresstable.tmpl`                         | пер-монетные ряды; удаление `DCR`-литералов; `{{coinSymbol}}`; SKA-форматирование.                          |
| Frontend      | `cmd/dcrdata/public/js/controllers/address_controller.js`                                    | новый ключ `coin` в settings; общий помощник смены `?coin=` со сбросом `?start=0`.                          |
| Mocks         | `cmd/dcrdata/internal/explorer/explorer_test.go`, `cmd/dcrdata/internal/api/noop_ds_test.go` | обновление сигнатур; пустой `ActiveCoins` по умолчанию.                                                     |

Подробные пер-разделные списки — в трёх дочерних спецификациях.

---

## 11. ⚠️ Ключевые инварианты

- Адрес — **мульти-монетный**: одна страница может одновременно отображать несколько монет одного адреса.
- VAR показывается всегда; SKA — только если в `ActiveCoins`.
- Точность не теряется: SKA-атомы передаются строкой через все слои.
- `?coin=` — единственный URL-ключ, общий между chart-карточкой и таблицей; смена сбрасывает `?start=0`.
- Пустая монета фильтра (`?coin=` отсутствует) означает: chart по умолчанию VAR; таблица показывает все монеты.
- Метки монет рендерятся только через `coinSymbol` / `renderCoinType`.

---
