# Rewards Logic Documentation

This document describes how PoW and PoS rewards are calculated and distributed for VAR and SKA coins in the Monetarium network, as well as how these values are prepared for the Explorer UI.

## Network Distribution Logic
(This section describes the actual protocol distribution)

### VAR Rewards
VAR coins are produced through a combination of Proof-of-Work (PoW) and Proof-of-Stake (PoS).

#### Distribution Split
The newly mined VAR coins for each block are split as follows:
- **PoW Miner**: Receives 50% of the block subsidy.
- **PoS Voters**: The remaining 50% is distributed among the tickets that voted in that block.

#### Calculation
The calculation is handled by the `standalone` package (accessed via `txhelpers.RewardsAtBlock`).
- **PoW Reward**: Calculated as `CalcWorkSubsidyV3`.
- **PoS Reward (per vote)**: Calculated as `CalcStakeVoteSubsidyV3`.
- **Total PoS Reward**: `PoS reward per vote * number of voters`.

*Note: The Explorer UI displays the absolute reward per vote (`NextBlockSubsidy.PoS / TicketsPerBlock`) rather than the profitability ratio.*

---

### SKA Rewards
SKA coins are not mined. They are issued once and then distributed.

#### Reward Source
Rewards for SKA coins are derived exclusively from transaction fees. These fees are generated when SKA outputs are spent in a block. The collected fees are then distributed to PoS voters via special transactions of type `TxTypeSSFee` (Stake Submission Fee) included in the same block.

#### Distribution
The SKA fees collected in a block are distributed among the PoS voters. Miners also receive a portion of these fees as standard transaction fees.

#### Calculation logic
1. **Collect Fees**: The system sums the `SKAValue` of all `TxTypeSSFee` transactions in a block.
2. **Per-Vote Reward**: The total SKA fee for a specific coin type is divided by the number of voters in that block.
   - $\text{Reward per Vote} = \frac{\text{Total SKA Fees in Block}}{\text{Number of Voters}}$
3. **Historical Averages**: For 30-day and yearly projections, the reward is computed by dividing each block's fees by the maximum possible voters (`TicketsPerBlock`) rather than actual voters, ensuring a consistent theoretical maximum.
4. **No Reward Condition**: `TxTypeSSFee` transactions are only created if SKA outputs are spent in the block. If no SKA outputs are spent, no fees are generated, no `TxTypeSSFee` transaction is created, and no SKA rewards are distributed for that block.

#### Implementation Details
- **Fee Summation**: Performed by `txhelpers.BlockSSFeeTotals`.
- **Average Rate**: The `txhelpers.AvgSSFeeRate` function computes the average reward rate over a period by averaging the per-vote rewards (using `TicketsPerBlock`) across blocks that had SKA fees.

---

## Explorer UI Calculation Logic
(This section describes how data is prepared for the Home Page "Mining" and "Voting" cards)

### Mining Section
- **PoW VAR Reward**: Displays the subsidy for the *next* block (`NBlockSubsidy.PoW`).
- **PoW SKA Reward**: Displays the actual SKA amounts awarded in the *last* block's coinbase transaction.
- **VAR Reward Reduction**: A progress bar showing the current block's position within the subsidy reduction window (`IdxInRewardWindow` / `RewardWindowSize`).

### Voting Section
- **Vote VAR Reward (most recent)**: Displays the total reward per vote for the most recent block, broken down by Subsidy and Fee.
    - **Per Block**: The total amount of VAR earned per vote.
    - **Subsidy**: The PoS subsidy portion per vote.
    - **Fee**: The stake fee portion per vote.
    - **ROI**: The extrapolated annual return percentage, calculated by averaging the individual ROI of all tickets that voted in the most recent block.

- **Vote SKA Reward**:
    - **Per Block**: Based on **Actuals**. The total SKA fees in the *last* block divided by the *actual* number of voters in that block, displayed as `SKA-n / Vote`.
    - **Per 30 Days / Per Year**: Based on **Theoretical Maximums**. The average SKA coins distributed per staked VAR over the period, computed by `txhelpers.AvgSSFeeRate` using `TicketsPerBlock` as the divisor.
- **Ticket Price**: Displays the current stake difficulty and the predicted difficulty for the next window.

### Formatting & Implementation
- **Precision**: VAR values are displayed with 8 decimal places; SKA values with 18 decimal places.
- **Formatting Helpers**:
    - `float64AsDecimalParts`: Used for most UI decimal displays.
    - `FormatSKAPerVAR`: Formats the SKA/VAR profitability ratio.
    - `FormatSKAAtoms`: Formats raw SKA atoms into a human-readable decimal string.
- **Live Updates**: The same calculation logic is performed in `pubsub/pubsubhub.go` to provide real-time updates via websockets.

---

## Verification Steps
To verify the accuracy of the reward calculations, the following steps were performed using `dlv` debugger and direct PostgreSQL queries.

### 1. SKA Reward Verification
The average SKA/VAR reward was verified by manually calculating the ratio over the last 30 days (~43,200 blocks) using the following PostgreSQL query:

```sql
SELECT 
    SUM(( (ssfee_totals->>'1')::numeric / (5 * sbits * 1e10) )) / COUNT(*) as avg_ratio
FROM blocks 
WHERE ssfee_totals IS NOT NULL 
AND ssfee_totals ? '1'
AND height > (SELECT max(height) FROM blocks) - 43200;
```

**Verification Process**:
1. **Query**: Retrieved `ssfee_totals`, `voters`, and `sbits` from the `blocks` table for blocks with SKA rewards.
2. **Per-Block Calculation**: For each block, computed the ratio:
   $$\text{Ratio} = \frac{(\text{Total SKA Fees} / \text{TicketsPerBlock}) \times 10^8}{\text{Sbits}}$$
3. **Averaging**: Averaged these ratios over the window.
4. **Result**: The manual calculation (approx. `0.05077`) matched the UI output (approx. `0.05064`), confirming the `AvgSSFeeRate` logic is correct.

### 2. VAR Reward Verification
Verified using `dlv` breakpoints in `txhelpers.RewardsAtBlock` and `explorer.go`:
- Confirmed that `work` (PoW) and `stake * votes` (PoS) follow the 50/50 split logic defined by the network parameters.
- Verified that `HomeInfo.VoteVARReward.PerBlock` correctly stores the absolute value `posSubsPerVote` rather than the profitability ratio.

### 3. Vote VAR Reward ROI Calculation
Verified the ROI calculation logic for the most recent block:
- For each ticket that voted in the block, ROI is calculated as:
  `ROI = (RewardPerVote / TicketPrice) * (BlocksPerYear / (VoteHeight - PurchaseHeight + CoinbaseMaturity)) * 100`
- The final displayed ROI is the average of these individual ROIs across all voters in the block.

