# Address Summary Card — Multi-Coin Spec

Левая верхняя карточка на странице `/address/{address}` (`cmd/dcrdata/views/address.tmpl:21-112`). Контент: адрес + QR, тип адреса, три суммарные числа (Balance / Received / Spent), Unconfirmed, Stake spending / income, dummy-уведомление.

Этот документ — продолжение [address-overview/spec.md](../address-overview/spec.md). Технический разбор изменяемых файлов: `wiki/code-analysis/address/summary.impact.md`.

---

## 1. Цель и охват

### Входит

- Перевод Balance / Received / Spent на пер-монетный разрез
- Удаление fiat-строки в этом редизайне
- Перевод Unconfirmed на пер-монетный разрез
- Stake spending / Stake income — оставить только VAR-секцию, считать корректно
- Замена жёстких `DCR`-меток на `coinSymbol`
- Empty-state «No activity» для пустого адреса
- Удаление атрибута `data-address-balance`

### Не входит

- Адресная строка, QR-код, тип адреса, dummy-уведомление — **без изменений** (coin-agnostic).
- Live-обновление балансов (только SSR; см. address-overview §5).
- Любая работа с fiat-курсами (ни для VAR, ни для SKA): монеты сети ещё нигде не торгуются, поэтому fiat-блок убирается целиком (см. §3.7).
- `?coin=` URL-ключ — карточка summary его игнорирует.

---

## 2. Текущее поведение

Карточка читает единственный `dbtypes.AddressBalance` (`db/dbtypes/types.go:2350`) и рендерит:

- **Balance** — `Balance.TotalUnspent` через `amountAsDecimalParts` + жёстко зашитая метка `DCR` (`address.tmpl:48`).
- **Fiat** — `xcBot.Conversion(dcrutil.Amount(addrData.Balance.TotalUnspent).ToCoin())` (`explorerroutes.go:1617`), показывается под Balance.
- **Received** — `add Balance.TotalSpent Balance.TotalUnspent` + `DCR`; ниже — `intComma (add NumSpent NumUnspent)` outputs (`address.tmpl:62-71`).
- **Spent** — `Balance.TotalSpent` + `DCR`; ниже — `intComma NumSpent` inputs.
- **Unconfirmed** — единственное число `NumUnconfirmed`, без разреза по монете.
- **Stake spending** — `printf "%.1f" (x100 .Balance.FromStake)`, гейтится `HasStakeOutputs()`.
- **Stake income** — `printf "%.1f" (x100 .Balance.ToStake)`, гейтится `HasStakeInputs()`.
- **Dummy address notice** — текст по `IsDummyAddress`.

Все денежные значения проходят через `dcrutil.Amount.ToCoin() float64`. Для адресов с SKA это нарушает [C1](../../core/constraints.md): 18 десятичных знаков SKA не помещаются в `float64`.

---

## 3. Требуемое поведение

### 3.1 Общая структура карточки

Карточка остаётся в той же DOM-сетке (адрес-блок слева, три суммарных числа в ряду, ниже — Unconfirmed / Stake-метрики, dummy-уведомление). Меняется содержимое числовых ячеек: каждая получает **вертикальный пер-монетный список**.

### 3.2 Balance

**Правила отображения:**

- VAR показывается всегда (даже при нулевом балансе, если у адреса есть VAR-история).
- SKA-строки показываются только для монет из `ActiveCoins` (см. address-overview §3).
- Порядок: VAR → SKA1 → SKA{n} (по `ActiveCoins`).
- VAR — 8 знаков после запятой через существующие хелперы (`amountAsDecimalParts`).
- SKA — 18 знаков после запятой, атомы как строка через `formatAtomsAsCoinString` / `skaDecimalParts`.
- Метка монеты — только через `{{coinSymbol .CoinType}}`.

**Пример:**

```
Balance
VAR    4,973.98183244
SKA1   123.000000000000000001
SKA2   0.000000000000000123
```

### 3.3 Received

**Источник данных:** для каждой монеты значение `Received` **предсчитывается на бэкенде** (поле `TotalReceived` на `CoinBalance` — атомы по типу монеты: VAR `int64`, SKA `string`). В шаблоне **никакого** `{{add .TotalSpent .TotalUnspent}}` — для VAR это сработало бы, для SKA пришлось бы вводить отдельный template-хелпер `addSkaAtoms`, что лишняя точка отказа.

Семантически `TotalReceived = TotalSpent + TotalUnspent`, но сложение делает Go-слой при заполнении `CoinBalance`.

**Правила отображения:** те же, что у Balance.

Под пер-монетным списком — **одна общая строка-итог** с количеством outputs:

```
Received
VAR    12,000.00000000
SKA1   500.000000000000000000
--------
8,921 outputs
```

Значение `outputs` — **предсчитанное** скалярное поле `TotalOutputs int64` на `AddressBalance` (счёт coin-agnostic, сумма `NumSpent + NumUnspent` по всем монетам). Шаблон не выполняет `{{add ...}}` — просто рендерит `intComma .Balance.TotalOutputs`. Строка отображается всегда, когда есть хотя бы одна монета в `ActiveCoins`.

### 3.4 Spent

Аналогично Received: пер-монетные суммы + один общий итог inputs:

```
Spent
VAR    7,026.01816756
--------
3,412 inputs
```

Значение `inputs` — **предсчитанное** скалярное поле `TotalInputs int64` на `AddressBalance` (`NumSpent` по всем монетам). Шаблон рендерит `intComma .Balance.TotalInputs`.

### 3.5 Unconfirmed

**Текущее поведение:** одно число под label `Unconfirmed`.

**Требуемое поведение:** пер-монетный разрез.

```
Unconfirmed:
VAR    1
SKA1   2
```

**Правила отображения:**

- Раздел показывается, если суммарное `NumUnconfirmed > 0`.
- Каждая строка — монета из `ActiveCoins` с ненулевым unconfirmed-счётом для этой монеты.
- Порядок монет — общий: VAR → SKA1 → ….
- Формат — целое число (без дробной части), `intComma`-разделитель тысяч.

**Backend:** `pgb.mp.UnconfirmedTxnsForAddress(address)` (`db/dcrpg/pgblockchain.go:2587-2592`) сегодня возвращает один `int64`. Расширить до `map[uint8]int64` (или эквивалент). На `AddressInfo.NumUnconfirmed` оставить агрегатное число (для существующих потребителей вроде `txn-count` атрибута), плюс ввести `NumUnconfirmedByCoin map[uint8]int64`.

**Frontend live update:** `_confirmMempoolTxs` (`address_controller.js:774-806`) сейчас инкрементирует `txnCount` и декрементирует один `numUnconfirmed`-target. Расширяется на N targets — по одному на монету, каждый помечен `data-coin-type="N"`.

**Источник `coinType` на confirm-событии:** payload `BLOCK_RECEIVED` сегодня **не несёт** per-tx coin-type, и расширять его не нужно. Поток такой:

1. `BLOCK_RECEIVED` приходит со списком confirmed txids.
2. Контроллер находит pending-строки в DOM по существующему `data-txid` matching’у (как и сейчас).
3. На каждой найденной строке читает `data-coin-type` — атрибут, добавленный в SSR-разметку при рендеринге Coin-колонки (см. address-transactions §6.4).
4. Декрементирует `numUnconfirmed`-target с тем же `data-coin-type`. Если счётчик дошёл до 0 — строка скрывается (как сегодня).

Это соответствует [C3](../../core/constraints.md) (template ↔ websocket parity): живой апдейт меняет только числа, не вводит новых DOM-узлов; вся coin-info уже отрендерена SSR. Расширения websocket payload не требуется.

**Out of scope:** live-инкремент `numUnconfirmed` при появлении **нового** mempool-tx (без блока). Сейчас адресная страница не подписана на такие события — новые unconfirmed строки появляются только при reload / XHR-refresh. Если в будущем понадобится — отдельный спек, который должен решить, как на frontend появляются новые DOM-строки (по C6 — через `<template>`-cloning, не через innerHTML конкатенацию).

### 3.6 Stake spending / Stake income

**Концептуально:** stake-механизм существует только для VAR (consensus inheritance из dcrd). Для SKA эти метрики не определены.

**Правила отображения:**

- Строки `Stake spending` / `Stake income` показываются **только если у адреса есть VAR-активность** (т.е. `0 ∈ ActiveCoins`).
- Числители и знаменатели рассчитываются строго в VAR-разрезе:
  - `FromStake = (VAR atoms сошедшие со stake-выходов) / (VAR atoms total spent)`.
  - `ToStake = (VAR atoms пришедшие со stake-выходов) / (VAR atoms total received)`.
- Если у адреса нет VAR-активности, обе строки скрыты.
- Если VAR-активность есть, но `HasStakeOutputs()` / `HasStakeInputs()` ложны — строки скрыты (как сегодня).

**Backend:** `FromStake` / `ToStake` (поля на `AddressBalance`) сейчас считаются в `db/dcrpg/queries.go:1518-1524` поверх coin-flattened сумм. Нужно ограничить агрегацию VAR-секцией. Хелперы `HasStakeOutputs()` / `HasStakeInputs()` остаются булевыми, но их семантика — «у VAR-баланса есть stake-выходы/входы».

### 3.7 Fiat row

**Удаляется полностью.**

Удаляется блок `address.tmpl:54-56` (`if $.FiatBalance ...`) и заполнение `FiatBalance` в `explorerroutes.go:1617` (вызов `exp.xcBot.Conversion`). Поле `FiatBalance *exchanges.Conversion` со структуры `AddressPageData` удаляется.

Причина: монеты сети (ни VAR, ни SKA) сейчас нигде не торгуются — реальной цены не существует. Поэтому fiat-блок не имеет смысла даже в VAR-частном случае. `exchanges/bot.go` сам по себе **не удаляется** — его всё ещё используют другие страницы (home, mempool, tx); из них fiat-строка убирается отдельными изменениями вне этого спека (если/когда понадобится).

Когда (и если) у монет появится реальный рынок и price feed, отдельный спек вернёт fiat в карточку — но уже изначально пер-монетным.

### 3.8 Empty state

Когда `ActiveCoins` пуст (адрес не имеет ни одной транзакции), карточка показывает упрощённую версию:

```
Balance:    —
Received:   —
Spent:      —
```

**Правила отображения:**

- Без пер-монетного списка.
- Без счётчиков outputs / inputs.
- Без unconfirmed-блока.
- Без stake-метрик.
- Без fiat (его и так нет).

Адресная строка, тип, QR — **без изменений**.

### 3.9 Dummy address notice

`{{if .IsDummyAddress}}*This a is dummy address...{{end}}` (`address.tmpl:107-111`) — **без изменений**. Короткое замыкание в handler’е (см. address-overview §6) гарантирует, что эта ветка работает с пустым `AddressInfo`.

### 3.10 Атрибут `data-address-balance`

Удаляется (`address.tmpl:15`). Соответственно — удаляется `ctrl.balance = $(...).attr('data-address-balance')` в `address_controller.js:230`. Само поле было неиспользуемым.

---

## 4. UI-mockup карточки целиком

```
┌──────────────────────────────────────────────────┐
│ Address                                           │
│ DsXXXX...XXX  📋  📷                              │
│ pubkeyhash                                        │
│                                                   │
│ Balance                Received           Spent   │
│ VAR  4,973.98183244    VAR  12,000.00     VAR  7,026.01     │
│ SKA1 123.000…001       SKA1 500.000…000   --------          │
│ SKA2 0.000…000123      --------           3,412 inputs      │
│                        8,921 outputs                        │
│                                                   │
│ Unconfirmed:                                      │
│ VAR    1                                          │
│ SKA1   2                                          │
│                                                   │
│ Stake spending: 12.4%                             │
│ Stake income:    3.7%                             │
└──────────────────────────────────────────────────┘
```

Шрифт чисел — моноширинный (как сейчас), для SKA — выравнивание по точке.

---

## 5. Точность и форматирование

| Величина                     | Тип в БД                  | Формат вывода                                                          |
| ---------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| VAR Balance / Received / Spent | `int64` (атомы)           | `amountAsDecimalParts (atoms) true` → 8 знаков, разделители тысяч.    |
| SKA Balance / Received / Spent | `string` (атомы по C1)    | `formatAtomsAsCoinString` или `skaDecimalParts` → 18 знаков, строка. |
| Unconfirmed (любая монета)   | `int64` (счёт)            | `intComma`.                                                            |
| Outputs / inputs total       | `int64` (счёт)            | `intComma`.                                                            |
| Stake spending / income      | `float64` (доля)          | `printf "%.1f" (x100 ...)` → одно знач. после точки.                  |

**Запрещено:**

- `toFloat64Amount` для SKA-значений (precision loss).
- `dcrutil.Amount.ToCoin()` для SKA-значений.
- Inline-литералы `DCR` / `VAR` / `` `SKA${n}` `` в шаблоне.

---

## 6. Backend-изменения

### 6.1 `dbtypes.AddressBalance`

См. address-overview §7.1. Из перспективы summary card нужны:

- Per-coin `TotalUnspent`, `TotalSpent`, `NumUnspent`, `NumSpent` (типы по монете: VAR-атомы `int64`, SKA-атомы `string`).
- Per-coin **предсчитанное** `TotalReceived` (= `TotalSpent + TotalUnspent` в атомах своей монеты) — чтобы шаблон не выполнял сложение SKA-строк.
- На уровне всего `AddressBalance` (не per-coin) — **предсчитанные** скаляры:
  - `TotalOutputs int64` — `Σ (NumSpent + NumUnspent)` по всем монетам.
  - `TotalInputs int64` — `Σ NumSpent` по всем монетам.
- `FromStake float64`, `ToStake float64` — общие поля, считаются из VAR-сегмента.
- `HasStakeOutputs()` / `HasStakeInputs()` — методы остаются, но опираются на VAR-секцию.

**Принцип**: вся арифметика над атомами/счётчиками — в Go-слое (`retrieveAddressBalance` / `ReduceAddressHistory`). Шаблон только рендерит готовые значения через форматтеры.

### 6.2 `dbtypes.AddressInfo`

- Добавить `ActiveCoins []uint8` (см. address-overview §3).
- `NumUnconfirmed int64` — оставить агрегатным (для существующих потребителей).
- Добавить `NumUnconfirmedByCoin map[uint8]int64` (или []`{CoinType, Count}` пара — окончательное решение по форме оставлено в импл-фазу, но JSON и шаблон должны видеть пер-монетную структуру).

### 6.3 Удаление `FiatBalance`

- Поле `FiatBalance *exchanges.Conversion` удаляется из inline-структуры `AddressPageData` (`explorerroutes.go:1538-1545`).
- Вызов `exp.xcBot.Conversion(...)` (`explorerroutes.go:1617`) удаляется.
- `exchanges/bot.go` остаётся без изменений — пакет используется на других страницах (home, mempool, tx). Их перевод вне fiat-эры — отдельный скоуп.

### 6.4 Mempool API для unconfirmed

`db/dcrpg/pgblockchain.go:2587-2592` — расширить `pgb.mp.UnconfirmedTxnsForAddress(address)` до возврата map‘а. Реализация в `mempool/` пакете: проход по существующему unconfirmed списку с разрезом по `coin_type` каждой транзакции.

### 6.5 Моки

- `cmd/dcrdata/internal/explorer/explorer_test.go:50-58` — `mockDataSource.AddressHistory`/`AddressData`/`DevBalance` обновить под новый `AddressBalance`.
- `cmd/dcrdata/internal/api/noop_ds_test.go:29-31` — `noopDS.AddressHistory` обновить так же.

---

## 7. Шаблон / frontend изменения

### 7.1 `cmd/dcrdata/views/address.tmpl`

Изменяемые строки (см. summary.impact.md §3 для полной таблицы):

- `:15` — удалить `data-address-balance`.
- `:42-86` — переписать три ячейки (Balance / Received / Spent) под пер-монетные списки.
- `:54-56` — удалить блок Fiat.
- `:87-103` — переписать ряд Unconfirmed / Stake под новые правила (Unconfirmed = пер-монетный список; Stake — гейт на VAR).

Все литералы `DCR` (`:48, :50, :64, :66, :77, :79`) удаляются.

### 7.2 `cmd/dcrdata/public/js/controllers/address_controller.js`

- `:230` — удалить чтение `data-address-balance` (атрибут удалён).
- `:774-806` (`_confirmMempoolTxs`) — обновить для пер-монетных `numUnconfirmed`-targets:
  - на `event.detail` (или эквивалент) ожидать `{txid, coinType}` вместо плоского `txid`.
  - матчить `numUnconfirmedTarget[i]` по `data-coin-type`; декрементировать совпавший.
  - скрывать строку при достижении 0 (как сейчас).
  - агрегатный `txnCount` инкрементируется как и раньше.

---

## 8. ⚠️ Ключевые инварианты

- Карточка summary **никогда не теряет точность** для SKA: атомы строкой во всех слоях.
- Пер-монетные списки следуют общим правилам: VAR всегда, SKA по `ActiveCoins`, порядок VAR→SKA1→…, метки только через `coinSymbol`.
- Stake-метрики имеют смысл только для VAR; для SKA-only адресов их нет.
- `?coin=` URL-ключ карточкой **игнорируется**.
- Live updates: только пер-монетные unconfirmed-счётчики и общий txnCount.
- Empty state — единственная упрощённая ветка; dummy address — отдельная (через handler short-circuit).

---
