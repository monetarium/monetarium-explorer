# Mempool Indicator Design Specification

> Architecture, data models, and testing strategy are in [`design.md`](./design.md).

## 1. Visual Architecture

The mempool section features a vertical list of indicators, one for the primary coin (VAR) and one for each active token type (SKA-n).

### 1.1 Indicator Components

- **Symbol Label:** The coin identifier (e.g., VAR, SKA-1).
- **Track:** A neutral, low-contrast background representing the total potential block space.
  - _Implementation:_ Use the theme’s surface-variant token (e.g., `var(--bs-gray-800)` or equivalent neutral muted background).
- **QC (Quota Capacity) Marker:** A vertical high-contrast line indicating the guaranteed block space for that specific coin.
- **Value Label:** A percentage string on the right representing the coin's consumption of the **Total Block Capacity**.

## 2. Quota Logic

The system uses a dynamic quota system to determine the position of the QC markers:

- **VAR Quota:** Fixed at **10%** of the total block space.
- **SKA Quotas:** The remaining **90%** is divided equally among all SKA token types currently present in the mempool.
  - _Example (2 SKAs active):_ SKA-1 QC = 45%, SKA-2 QC = 45%.

## 3. Dynamic State Coloring & Semantic Logic

Indicator bars must dynamically update their visual state based on demand and aggregate mempool pressure. **Do not use hardcoded HEX values;** refer to the project's functional color tokens.

| State         | Logic                                | Visual Role          | Token Reference                |
| :------------ | :----------------------------------- | :------------------- | :----------------------------- |
| **Optimal**   | `Demand <= QC`                       | Safe/Guaranteed      | `var(--status-success)`        |
| **Borrowing** | `Demand > QC` AND `Total < 100%`     | Warning/Overflowing  | `var(--status-warning)`        |
| **Congested** | `Demand > QC` AND `Total >= 100%`    | Critical/Dropped     | `var(--status-danger)`         |
| **Overflow**  | Exceeding segment of a Congested bar | At-risk Transactions | `var(--status-danger-hatched)` |

## 4. Visual Implementation Guidelines

### 4.1 Color Harmonization

To maintain professional UI consistency:

- **System Integration:** All colors must be derived from the global SCSS/CSS variable system.
- **Theming:** Colors must automatically adapt to Light and Dark modes. In Dark Mode, saturation should be reduced to prevent visual vibration against dark backgrounds.
- **Brand Alignment:** It is recommended to "tint" functional colors by mixing ~10% of the Primary Brand hue into the success/warning/danger tokens to ensure they feel integrated into the Monetarium ecosystem.

### 4.2 Pattern-Based Encoding (Accessibility)

Following **WCAG 2.1** standards, color must not be the only indicator of status.

- **Hatching Implementation:** The `.overflow-hatch` pattern (using a `repeating-linear-gradient` at 45°) must be applied _only_ to the segment of the bar exceeding the QC marker during Congestion. The portion within the QC remains solid to signal guaranteed inclusion.

## 5. Technical Implementation Notes

### 5.1 Style Mapping

| Component     | Class               | Property                                            |
| :------------ | :------------------ | :-------------------------------------------------- |
| **Container** | `.mempool-track`    | `background-color: var(--track-bg);`                |
| **Optimal**   | `.status-ok`        | `background-color: var(--status-success);`          |
| **Warning**   | `.status-borrowing` | `background-color: var(--status-warning);`          |
| **Critical**  | `.status-full`      | `background-color: var(--status-danger);`           |
| **Pattern**   | `.overflow-hatch`   | `background-image: repeating-linear-gradient(...);` |

### 5.2 Dynamic Behavior

- **Server-Side:** Initial state rendered via Go templates. QC positions are calculated server-side based on active SKA counts.
- **Client-Side:** The Stimulus controller updates widths and colors in real-time. If a new SKA appears, use a `<template>` to inject the new row without a page reload.

---

**Design Note:** All percentage values displayed refer to the **Total Block Size**, not the percentage of an individual quota. (e.g., "45%" means 45% of the total block).
