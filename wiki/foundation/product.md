# Product Overview

Monetarium Explorer operates as the primary block explorer for the Monetarium blockchain. Engineered on top of `dcrdata` v8 (the core Decred block explorer toolkit), the product maintains the full inherited REST, WebSocket, and Mempool features as a monolithic foundation. There is no active upstream synchronicity with Decred; Monetarium-specific logic sits strictly atop the initial `dcrdata` fork.

### Critical Extensions
- **Multi-Token Extensibility:** The frontend renders one primary coin (**VAR**) and up to 255 **SKA** token types natively alongside each other.
- **High-Precision Backend:** The `dcrdata` base was gutted of standard Go `float64` boundaries. Big-number logic natively drives the backend modules to prevent precision destruction for SKA calculations.
- **Interactive Metrics Expansion:** Core components like the Mempool lists and Block Home pages are modified with multi-layered token tables and specialized accordion dropdowns to display supply statistics universally.
- **Supply Logic:** The application embeds dynamic Supply widgets detailing the lifecycle state (Issued, Withdrawn, Circulating) natively across every SKA.

### Token Types & Bounds Rules
| Token    | Integer Digits | Decimal Digits |
| -------- | -------------- | -------------- |
| **VAR**  | 8              | 8              |
| **SKA**  | 15             | 18             |

### Runtime Prerequisites
* Monetarium Node running active `--txindex`
* PostgreSQL 11+
* Reverse Proxy (Nginx) over Port `7777` domain limits
