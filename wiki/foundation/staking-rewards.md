# Staking and Reward Mechanics

The Monetarium network implements a hybrid PoW/PoS (Proof-of-Work / Proof-of-Stake) distribution model. This document details how block subsidies and transaction fees are calculated and distributed across miners and voters.

## 1. Block Reward Structure (VAR)

The total VAR reward generated in a specific block is composed of two pools:
1. **Subsidy (Emission):** The newly minted core VAR coins (e.g., 32 VAR).
2. **VAR Fees:** The summation of all transaction fees paid in VAR within that block.

### Distribution Ratio
The entire VAR pool (both Subsidy + Fees) is split perfectly in half:
*   **50%** routes to the Miner (PoW Reward).
*   **50%** routes to the Voters (divided equally among active tickets).

## 2. Voter Payout Mechanics (VAR)

For every ticket that successfully casts a vote in a block, the network issues a payout consisting of three components:
1.  **Ticket Return:** A complete refund of the original VAR cost used to purchase the ticket constraint limit.
2.  **Subsidy Cut:** A proportionate share of the 50% voter subsidy (e.g., if 5 tickets voted, the ticket earns 1/5th of the 50%).
3.  **Fee Cut:** A proportionate share of the 50% voter VAR fee pool.

*Note: The transaction fee paid to originally purchase the ticket rests with the network and is not refunded to the voter.*

## 3. Voter Payout Mechanics (SKA)

Unlike VAR, SKA tokens are **not emitted via mining subsidies**. SKA compensation pools are generated entirely from transaction movement operations.

The routing constraints mirror the VAR logic:
*   **50%** of the total SKA-n transaction fees in the block route to the Miner.
*   **50%** of the total SKA-n transaction fees route to the Voters (divided equally among active tickets).

## 4. Yield Calculations (Aggregated Metrics)

To visualize macroeconomic yield potential for stakeholders, the platform computes time-series averages:

*   **Per Last Block (VAR/VAR):** The sum reward of the previous block for a single ticket, divided by the active ticket price.
*   **Per 30 Days:** The cumulative rolling reward over 30 days averaged against block iteration, re-calculated strictly against the *current* network ticket price constraint (ignoring historic ticket cost fluxes).
*   **Per Year:** Extrapolated directly from the 30-day accumulation metric to a 365-day scale. (If genesis occurred <365 days ago, the actual runtime divides the coefficient).
