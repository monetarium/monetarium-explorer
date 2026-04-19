# Homepage Metrics & Components

This document outlines the specific structure and behavior of aggregate metric components displayed on the Monetarium Explorer homepage.

## Mempool (Pending Transactions)

The Mempool component visualizes unconfirmed transactions and forecasts block inclusion.

### Block Occupancy Indicator
A set of horizontal indicator bars illustrates the projected fill of the next block. They represent the percent of a token's *guaranteed limit* currently absorbed by pending transactions.
*   **Total:** Overall block fill.
*   **VAR:** Guaranteed 10% of block capacity.
*   **SKA Types:** The remaining 90% is divided completely evenly across all issued SKA types (e.g., 2 types = 45% each, 3 = 30% each).

**Color Thresholds:**
| Color | Condition | Outcome |
| :--- | :--- | :--- |
| **Green** | Within guaranteed share limit | Will be included in the next block |
| **Yellow** | Exceeds guaranteed share, but free space remains globally | Will be included in the next block |
| **Red** | Exceeds share AND space is insufficient | Portion will be delayed (not included) |
| **Gray** | Unfilled guaranteed space | - |

*Note: Individual token indicators generate automatically upon token issuance and remain permanently visible.*

## Latest Blocks Table

An aggregated table of recent blocks utilizing an expandable row logic. Data must not be nested beyond one level.

### Primary Row Data
*   **Height:** Sequential block number.
*   **Transactions (Txn):** Net transaction count excluding voting and ticket operations (i.e. standard transfers, subsidies, emissions).
*   **VAR:** Total aggregated VAR transferred.
*   **SKA:** Total aggregated SKA transferred across *all* n-types.
*   **Size:** Gross block size.
*   **Votes / Tickets / Revokes:** Staking engagement metrics.

### Expanded Row Data (Per-Token Breakdown)
Upon clicking a block row, it expands to reveal:
*   **One VAR row:** Shows isolated VAR transaction count, transferred sum, and isolated VAR byte size.
*   **Multiple SKA-n rows:** Shows separated transaction counts, sums, and isolated byte sizes for each individual SKA type.
*(Expanded rows do not utilize separate column headers).*

## Supplementary Modules

### Voting (Staking Yields)
Calculates and displays retrospective yields for securing the network via tickets.
*   **Vote VAR Reward:** Highlights exact VAR subsidy per ticket alongside 30-day and 365-day APR averages.
*   **Vote SKA Reward:** For *each* issued SKA type, displays the exact SKA count per ticket, and the accumulated SKA/VAR ratio for 30-day and 365-day averages. (Falls back to the last non-zero block if the current block lacks SKA transactions).

### Mining (PoW Yields)
Calculates and displays direct block creation payouts.
*   **PoW VAR Reward:** Total VAR subsidy to the miner for the latest block.
*   **PoW SKA Reward:** List of total SKA amounts routed to the miner for the latest block (separated per emitted SKA type).

### Supply Constraints
Displays absolute total network circulation for emitted tokens.
*   **SKA Coins Supply:** Displays `In Circulation`, `Issued`, and `Burned` as massive number strings. As per accounting precision mandates, this circumvents standard abbreviation rules and exact unit totals are shown.
