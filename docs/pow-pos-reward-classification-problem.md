# Explorer ignores the SSFee SF/MF marker → PoW vs PoS fee rewards mis-attributed

> **Status:** problem statement + fix spec
> **Owner:** monetarium-explorer
> **Node-side work required:** none (see "Why the earlier 'node bug' framing was wrong")
> **Related:** `txhelpers/ssfee.go` · `cmd/dcrdata/internal/explorer/explorer.go` · `pubsub/pubsubhub.go` · `REWARDS_LOGIC.md` · node-side corrected analysis: `monetarium-node/ssfee-classification-analysis.md`

## Summary

When SKA outputs are spent in a block, monetarium-node redistributes the
collected fees via **SSFee transactions (`TxType = 7`)**. The node already makes
the PoW-vs-PoS purpose **deterministic on-chain**: every SSFee carries an
`OP_RETURN` marker — **`"SF"` = staker fee (PoS reward)**, **`"MF"` = miner fee
(PoW reward)** — and the split is the consensus constant `SSVMonetarium` (50%
PoW / 50% PoS), applied per coin type.

The explorer **never reads this marker**. Instead it:

- divides total SKA fees by 2 as a heuristic (`divideByTwoSKAFees`) to guess the
  PoW portion, and
- attributes VAR vote rewards from SSGen-only / net-redistribution math that
  omits SSFee `"SF"` staker payouts, and
- carries `TODO(monetarium-node)` comments asking for a node fix that, per the
  node code and the corrected node-side analysis, **is not needed and must not
  be made**.

Net effect: PoW vs PoS reward attribution is a heuristic, not derived from the
authoritative on-chain signal that already exists. This is an **explorer-only
defect with an explorer-only fix** — `stake.HasSSFeeMarker` is already exported
from the `blockchain/stake` package the explorer imports today.

## Background: how the node actually splits fees (ground truth)

(Node code, for reference — do not change it.)

- SKA rewards come exclusively from transaction fees, redistributed within the
  same block via SSFee transactions (`TxType = 7`). See `REWARDS_LOGIC.md`.
- Each SSFee carries an `OP_RETURN` marker created by
  `CreateStakerSSFeeMarker` (node `blockchain/stake/ssfee.go:82`):
  `OP_RETURN + OP_DATA_8 + "SF"/"MF" + height(4) + voter_seq(2)`.
- Classification helper, **already exported and importable**:
  `stake.HasSSFeeMarker(script []byte) SSFeeMarkerType` →
  `SSFeeMarkerStaker` (`"SF"`, PoS) or `SSFeeMarkerMiner` (`"MF"`, PoW)
  (node `blockchain/stake/ssfee.go:41,59,64`). The node itself routes on this
  (`staketx.go:1390`: `HasSSFeeMarker(out.PkScript) == SSFeeMarkerMiner`).
- The split ratio is the consensus constant `SSVMonetarium` →
  `GetSubsidyProportions = (50, 50, 0, 100)` (node
  `blockchain/standalone/subsidy.go:613`), applied to fee redistribution per
  coin type via `CalcFeeSplitByCoinType` (node
  `internal/blockchain/validate.go:2609`). It is **not** a verbal convention and
  **not** explorer-specific knowledge — it is enforced consensus, identical
  across all coin types.

So the PoW/PoS attribution the explorer needs is not ambiguous on-chain. The
`"SF"`/`"MF"` marker on each SSFee output is the authoritative discriminator.

## The actual problem (explorer-side)

1. **No marker decoding anywhere.** The explorer has zero SSFee-marker code.
   `txhelpers/ssfee.go` classifies solely via `stake.DetermineTxType` and never
   inspects the `OP_RETURN` payload. There is no `HasSSFeeMarker` call, no
   `"SF"`/`"MF"` handling.

2. **`/2` heuristic for the PoW portion.** `divideByTwoSKAFees`
   (`cmd/dcrdata/internal/explorer/explorer.go:72-91`) blindly halves all SKA
   fees to approximate the PoW share. Its two fallback paths
   (`explorer.go` ≈ 838-890) apply the same `/2` to `ExtraInfo.SKAPoWRewards`
   and to a backward block search. The 50/50 *ratio* happens to match
   consensus, but the *method* is a guess: it ignores the per-tx marker, ignores
   the node's integer `CalcFeeSplitByCoinType` rounding (remainder to miner),
   and cannot attribute a specific transaction to PoW or PoS.

3. **Vote VAR Reward omits SSFee `"SF"` payouts.** `ComputeVoteVARReward`
   (`txhelpers/ssfee.go`) and its callers in
   `explorer.go` (≈ 668-708) and `pubsub/pubsubhub.go` (≈ 726-763) derive the
   vote reward from SSGen-only / net-redistribution (`Outputs − Inputs`) math.
   In this fork staker VAR rewards are delivered via SSFee `"SF"` transactions
   by design; not reading the marker is why the regression test
   `TestComputeVoteVARReward` (block 36354) currently *expects to fail* at
   `Fee == 0`.

4. **`explorer.go` and `pubsubhub.go` have drifted.** The SKA vote-reward path
   in `explorer.go` divides totals by 2; the equivalent in
   `pubsub/pubsubhub.go` (≈ 806-812) does **not**. The same logical quantity is
   computed two different ways on the HTTP vs WebSocket paths — a live
   inconsistency independent of the marker issue, and exactly the kind of
   duplicate-calc drift `CLAUDE.md` warns about for `pubsubhub.go`.

5. **Workaround comments rest on a debunked premise.** Two
   `TODO(monetarium-node)` comments in `txhelpers/ssfee.go` (≈ 142-144 and
   181-182) state that SSRtx with an `"SF"` marker should be classified as
   `type=3` not `type=7`, and defensively accept both. That premise is false
   (next section). These comments and the dual-type acceptance should be removed
   as part of the fix, not deferred to a node release.

### Worked example (from the call) — re-read with ground truth

A fee-distribution transaction spread fees over three addresses; a human had to
cross-reference the home-page PoW figure (≈ 0.9) and infer staker ratios
(2 tickets vs 3) to guess *which* transaction was PoW. That manual guessing was
necessary **only because the explorer discards the `"MF"`/`"SF"` marker**. With
the marker decoded, the PoW transaction (`"MF"`) and the staker transactions
(`"SF"`) are identified directly, per-coin, with no inference and no `/2`.

The reward also isn't surfaced on the tx detail page (`GetExplorerTx` /
`TxInfo` populate no reward fields). The amount is computable
(`outputs − inputs`, net of self-consolidated coins). Whether to display it is a
separate, optional product question — noted, not in scope for the core fix.

## Why the earlier "node bug" framing was wrong

The original mental model (a node defect collapsing PoW/PoS, SSRtx
misclassified as SSFee) is contradicted by both the node code and the
project's own corrected analysis (`monetarium-node/ssfee-classification-analysis.md`,
which supersedes `ssrtx-detection-issue.md`):

- `CheckSSRtx` requires **every** output to be `OP_SSRTX`-tagged
  (`staketx.go:1285-1296`); `CheckSSFee` requires an `OP_RETURN` `"SF"`/`"MF"`
  marker. These are mutually exclusive — an SSFee can never be a
  misclassified SSRtx, regardless of detection order.
- The transaction in question is a legitimate node-generated staker SSFee
  (`TxType = 7`), working as designed.
- **No node code change is warranted.** The only optional node follow-up is a
  documentation fix: the stale comment at `staketx.go:38`
  (`TxTypeSSFee // Stake fee distribution for non-VAR coin types`) contradicts
  `CheckSSFee`, which explicitly permits staker `"SF"` SSFee to distribute VAR.
  That is a non-consensus comment cleanup, not a prerequisite for this fix.

## The fix (explorer-only)

No node release or node code change is required. `stake.HasSSFeeMarker` is
already exported from `github.com/monetarium/monetarium-node/blockchain/stake`,
which the explorer already imports (`txhelpers/ssfee.go:10`).

1. **Decode the marker in `txhelpers`.** For each `TxType=7` transaction,
   classify outputs with `stake.HasSSFeeMarker(out.PkScript)` →
   `SSFeeMarkerStaker` (PoS) vs `SSFeeMarkerMiner` (PoW).
2. **Make `BlockSSFeeTotals` return a split.** Replace the single per-coin map
   with a PoW/PoS-split result per coin type. VAR net-redistribution stays as
   is where already correct; SKA totals are summed by marker, not halved.
3. **Delete the `/2` heuristic.** Remove `divideByTwoSKAFees` and its fallback
   call sites in `explorer.go`; derive the PoW portion from `"MF"`-marked
   outputs (optionally cross-check against the node's
   `GetSubsidyProportions`/`CalcFeeSplitByCoinType` rounding for parity).
4. **Include `"SF"` SSFee payouts in Vote VAR Reward** so
   `ComputeVoteVARReward` no longer caps at 0 for SSFee-delivered staker
   rewards.
5. **Reconcile `explorer.go` ↔ `pubsubhub.go`.** Both paths must use the same
   marker-based split; eliminate the divide-by-2 vs no-divide drift.
6. **Remove the two `TODO(monetarium-node)` workarounds** and the dual
   `type=3`/`type=7` acceptance in `txhelpers/ssfee.go`.

### Files to change

| File | Area | Change |
|------|------|--------|
| `txhelpers/ssfee.go` | `ComputeTxFeeData`, `BlockSSFeeTotals` | Decode `HasSSFeeMarker`; return PoW/PoS split per coin; drop dual-type workaround + TODOs |
| `cmd/dcrdata/internal/explorer/explorer.go` | `divideByTwoSKAFees` + call sites (~72-91, ~838-890), Vote VAR Reward (~668-708) | Remove `/2`; use marker split; include `"SF"` payouts |
| `pubsub/pubsubhub.go` | reward calc (~726-763, ~806-812) | Align with marker-based split; remove drift |
| `txhelpers/ssfee_test.go` | see below | Update expectations to marker-based behavior |

### Tests impacted

- `TestComputeVoteVARReward` (block 36354) — currently asserts the *broken*
  capped-at-0 behavior; flip to expect the marker-derived non-zero fee.
- `TestBlockSSFeeTotals_WithType7` / `TestFullPipelineWithType7` (block 36600) —
  currently assert `type=7` is treated identically to SSRtx; must assert
  marker-based PoW/PoS split instead.
- `TestBlockSSFeeTotals*`, `TestFullPipelineWithSSRtx`,
  `TestComputeVoteVARReward_NegativeFee` — re-verify against the split return
  type.
- Add cases with explicit `"SF"` and `"MF"` `OP_RETURN` outputs asserting PoW
  and PoS totals match marker content.

## Open questions

1. **Return shape.** Should `BlockSSFeeTotals` return `{PoW, PoS}` per coin, or
   should callers classify? (Affects how many call sites change.)
2. **VAR side.** Does VAR vote-reward attribution also need the `"SF"`/`"MF"`
   split, or is net-redistribution (`Outputs − Inputs`) sufficient for VAR while
   only SKA needs the marker? Confirm against block 36354 expectations.
3. **Rounding parity.** Should the explorer mirror the node's exact integer
   `CalcFeeSplitByCoinType` (remainder-to-miner) for displayed PoW/PoS amounts,
   or is summing marked outputs inherently exact?
4. **Optional node follow-up.** File a separate, low-priority node issue for the
   stale `staketx.go:38` comment only — not blocking this fix.
