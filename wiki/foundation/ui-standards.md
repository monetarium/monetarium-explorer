# UI Standards

The frontend for the Monetarium Explorer adheres to specific data-display paradigms, particularly regarding token values across different domains of the application. 

### Global Design Constraints
- **Adaptivity:** The interface must be built using a **mobile-first** approach. 
- **Theming:** **Dark mode** support is strictly mandatory across all views.

### Display Precision Rules

The scale of values in the VAR and SKA dual-token system requires context-dependent precision rendering.

#### 1. The "Three Digits Rule" (Homepage)
For VAR and SKA tokens rendered on the aggregate views of the index homepage (e.g., Mempool, Latest Blocks), amounts must be truncated to **exactly three significant digits** and appended with alphabetical scale suffixes (`K`, `M`, `B`, `T`).
*Example: instead of `1,234,567.89 SKA-1`, display `1.23M SKA-1`.*

#### 2. Absolute Exactness (Supply Metrics)
There is a strict exception to the Three Digits Rule: **SKA Coins Supply**.
Numerical values indicating the `In Circulation`, `Issued`, and `Burned` supply amounts for SKA tokens must reflect true accounting accuracy. 
These values must be displayed **exactly down to a single token unit**, without any rounding, truncation, or alphabetical suffixes.
*Example: `900,000,000,000,000 SKA-1`*

#### 3. Full Value Rendering (Details Pages)
Individual entity views (Block Details, Transaction Details) must surface the underlying database precision. All digits after the decimal point must be rendered.
- **VAR:** 8 fractional digits.
- **SKA:** 18 fractional digits.
