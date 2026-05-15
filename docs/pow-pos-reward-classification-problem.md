# Problem: PoW vs PoS fee-reward transactions are indistinguishable on-chain

> **Status:** problem statement / draft for discussion
> **Audience:** monetarium-node developers (primary), monetarium-explorer maintainers (secondary)
> **Related:** `txhelpers/ssfee.go` · `cmd/dcrdata/internal/explorer/explorer.go` · `REWARDS_LOGIC.md`

## Summary

When SKA outputs are spent in a block, the collected fees are redistributed via
special stake transactions. Part of that redistribution is the **PoW reward to
the block's miner**; the rest is the **PoS reward split among the voters
(stakers)**. The explorer needs to attribute each portion correctly.

The problem: **monetarium-node classifies the PoW-reward transaction and the
PoS-reward transactions with the same transaction type**, so the explorer cannot
tell programmatically which is which. Today the explorer works around this by
**hardcoding a 50/50 PoW/PoS split** — a number known only verbally (from
Mihail), not derivable from on-chain data. Without that assumption the explorer
would attribute 100% of the fees to staking.

We believe the root cause is node-side (`stake.DetermineTxType` collapsing
distinct reward transactions into one type, and the related SSRtx→SSFee
misclassification). A node-side fix that exposes a distinct, reliable type would
let the explorer compute the split from data instead of a constant.

## Background: how SKA fee rewards are distributed

(See `REWARDS_LOGIC.md` for the full model.)

- SKA coins are not mined. SKA rewards come **exclusively from transaction
  fees**, generated when SKA outputs are spent in a block.
- The collected SKA fees in a block are redistributed within that same block via
  special stake transactions (`TxTypeSSFee` and friends).
- That redistribution has **two distinct purposes**:
  1. **PoW portion** — paid to the block's miner.
  2. **PoS portion** — split among the tickets that voted in the block.
- For VAR, the protocol split is **50% PoW / 50% PoS** (`REWARDS_LOGIC.md`,
  "Distribution Split"). The same 50/50 ratio is *assumed* for the SKA fee
  redistribution, but this is an external assumption, not something the explorer
  reads from the chain.

## The problem

A fee-redistribution transaction that pays the **PoW reward** and one that pays
a **PoS reward** are reported by the node with the **same transaction type**.
There is no field on the transaction that says "this one is PoW" vs "this one is
PoS".

Consequences:

1. **The split is hardcoded, not derived.** `divideByTwoSKAFees`
   (`cmd/dcrdata/internal/explorer/explorer.go`) divides total fees by 2 to get
   the PoW portion. If the protocol ratio ever differs from 50/50, or differs
   per coin, the explorer is silently wrong.
2. **Fragile provenance.** The 50/50 number came from a verbal statement, not
   from spec or chain data. If nobody had said "it's 50/50", the explorer would
   have attributed **100% to staking** and shown PoW SKA reward as zero.
3. **Manual disambiguation only.** Today a human can guess which transaction is
   PoW by cross-referencing the home-page PoW figure and by the ratio between
   staker payouts (e.g. one staker with 2 tickets vs another with 3). There is
   no deterministic on-chain signal — `decoded` output differs in many ways but
   none of them authoritatively marks PoW vs PoS.
4. **Related node misclassification.** `txhelpers/ssfee.go` already carries
   `TODO(monetarium-node)` workarounds: SSRtx (`type=3`) transactions are
   sometimes classified as SSFee (`type=7`) by `stake.DetermineTxType`, so the
   fee-summation code defensively accepts **both** types. This is the same class
   of "the node collapses types we need separated" bug.

## Worked example (from the call)

A single fee-distribution transaction distributed fees across **three
addresses**:

- **1 address** received the **PoW reward** (the block's miner).
- **2 addresses** received **PoS rewards** — but these represent more underlying
  tickets than addresses, because one staker can hold several tickets (e.g. one
  staker with 2 tickets, another with 3; the same staker can even receive the
  whole reward, so the address count can be as low as 2).

The reward is **not displayed anywhere** on the transaction page. It is the
difference between inputs and outputs: in the example, ~1226 fee in vs ~1281
out, a difference of ~0.50-something — that delta is the reward. The
stake/reward transaction also **consolidates the address's own pre-existing SKA
coins** with the reward and sends the total back to the same address, so the
reward must be computed as `outputs − inputs` net of the consolidated
self-funds. The PoW address in this example received ~0.9 (matching the
home-page PoW figure ≈ 0.9 → confirming, by cross-reference, which transaction
was the PoW one); the two staker addresses received ~0.36 and the remainder.

This example is the empirical basis for the 50/50 assumption: full block fee
≈ 1.83…, PoW reward ≈ 0.916… (≈ half), which is why the code halves the total.

## Secondary issue: reward not surfaced in the UI

The stake/reward transaction is an **unusual transaction**: it does not *pay* a
fee, it *receives* a reward. The transaction detail page renders it like an
ordinary transaction (`GetExplorerTx` in `db/dcrpg/pgblockchain.go` populates no
reward/subsidy fields; `TxInfo` has none). The reward amount is computable
(`outputs − inputs`, net of self-consolidated coins) but is shown nowhere.
Whether and how to display it (e.g. an explicit "reward" line on the tx page) is
an open product question, separate from but adjacent to the classification
problem.

## Suspected root cause (node-side)

`txhelpers.DetermineTxType` delegates entirely to the node's
`stake.DetermineTxType(msgTx)`. The hypothesis is that the node's stake-tx
detection (`staketx.go`) does not assign a distinct type to the PoW-reward
redistribution transaction, and additionally misclassifies SSRtx (`type=3`) as
SSFee (`type=7`). The second part is already corroborated from the explorer
side: `txhelpers/ssfee.go` carries explicit `TODO(monetarium-node)` notes
stating that SSRtx transactions with the "SF" marker should be classified as
`type=3`, not `type=7`, and the fee-summation code defensively accepts both
types until the node is fixed.

Caveat: this is a **hypothesis, not a confirmed diagnosis**. The exact node-side
mechanism has not yet been independently verified by us or reviewed with the
node developers; it should be validated against `staketx.go` before being acted
on as fact.

## What a fix looks like

**Node-side (prerequisite):**

- `stake.DetermineTxType` (or an adjacent API) should assign the PoW-reward
  redistribution transaction a **distinct, stable transaction type** from the
  PoS-reward transactions, and correctly classify SSRtx as `type=3` rather than
  `type=7`.

**Explorer-side (follow-up, once the node exposes the type):**

- Replace the hardcoded `divideByTwoSKAFees` 50/50 split with attribution
  derived from the node-reported transaction type.
- Remove the dual-type `TODO(monetarium-node)` workarounds in
  `txhelpers/ssfee.go` (`ComputeTxFeeData`, `BlockSSFeeTotals`).
- Re-verify home-page Mining/Voting cards and `pubsub/pubsubhub.go` (the reward
  calc is duplicated there) against the new, data-derived split.
- (Optional, separate) surface the per-transaction reward amount on the
  transaction detail page.

## Open questions

1. Is the SKA fee split actually 50/50, or is that only true for VAR subsidy and
   merely *assumed* for SKA fees? Is it the same across all coin types?
2. Is the PoW/PoS ambiguity the *same* node defect as the SSRtx→SSFee
   misclassification, or two separate issues that happen to surface together?
3. What is the authoritative source of the split ratio — spec, node parameters,
   or computed per block? The explorer should read it, not hardcode it.
4. Should the node-side change be a new `stake.TxType`, or extra metadata on the
   existing transaction? (Affects how invasive the explorer follow-up is.)
5. Does the suspected node-side mechanism hold up against `staketx.go`? (Needs
   validation before being shared with node devs as a diagnosis.)
