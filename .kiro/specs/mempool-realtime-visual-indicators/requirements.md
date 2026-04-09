# Requirements Document

## Introduction

The Mempool Real-time Visual Indicators feature adds per-coin fill-bar indicators to the home page mempool section of the Monetarium Explorer. Each indicator represents one coin type present in the mempool (VAR or a SKA token type) and reflects its current block-space utilisation as a proportional fill level, a quota boundary marker, and a status colour. A summary indicator reflects the total mempool load against the block capacity. Indicators update in real time via the existing WebSocket connection whenever the mempool changes. New SKA token types that appear in the mempool after the page has loaded are accommodated without a page reload.

## Glossary

- **Mempool_Controller**: The Stimulus controller responsible for managing the mempool section of the home page, including WebSocket event handling and DOM updates.
- **Home_Template**: The Go HTML template that renders the initial state of the home page, including the mempool section.
- **Fill_Bar**: A single visual indicator element representing one coin type's block-space utilisation. It contains a GQ_Segment, optionally an Extra_Segment, optionally an Overflow_Segment, and a GQ_Marker.
- **GQ_Segment**: The portion of a Fill_Bar representing utilisation within the coin's Guaranteed Quota.
- **Extra_Segment**: The portion of a Fill_Bar representing utilisation beyond the coin's Guaranteed Quota, consumed from free space left by other coins. Present only when status is `borrowing`.
- **Overflow_Segment**: The portion of a Fill_Bar representing utilisation that cannot fit in the block. Present only when status is `full`. Rendered with a distinct cross-hatch pattern in addition to the status colour.
- **GQ_Marker**: A fixed vertical line on a Fill_Bar indicating the boundary of the coin's Guaranteed Quota. Its position is determined by the coin's quota share and does not move with fill changes.
- **Total_Bar**: A summary indicator showing the ratio of total mempool size to the maximum block capacity (TC). It is distinct from any Fill_Bar and reflects the aggregate load across all coin types.
- **CoinFills**: The ordered list of per-coin fill data delivered by the server, each entry containing a coin symbol, a GQ fill ratio (0.0–1.0), an extra fill ratio (0.0–1.0), an overflow fill ratio (0.0–1.0), a GQ position ratio (0.0–1.0), and a status value.
- **GQ_Fill_Ratio**: A normalised value between 0.0 and 1.0 representing how much of a coin's Guaranteed Quota is consumed.
- **Extra_Fill_Ratio**: A normalised value between 0.0 and 1.0 representing how much extra block space beyond the quota is consumed by this coin, expressed as a fraction of TC.
- **Overflow_Fill_Ratio**: A normalised value between 0.0 and 1.0 representing how much of this coin's load cannot fit in the block, expressed as a fraction of TC.
- **GQ_Position_Ratio**: A normalised value between 0.0 and 1.0 representing where the GQ_Marker sits within the Fill_Bar, expressed as a fraction of TC.
- **Total_Fill_Ratio**: A normalised value between 0.0 and 1.0 representing the ratio of total mempool size to TC. Values above 1.0 are clamped to 1.0 for display purposes.
- **Status**: A categorical value assigned to each Fill_Bar. Valid values are `ok`, `borrowing`, and `full`.
- **TC**: Total Capacity — the maximum block size in bytes (393 216 B). The hard boundary against which all fill ratios are measured.
- **VAR**: The primary coin of the Monetarium blockchain. VAR is always allocated 10% of TC as its Guaranteed Quota.
- **SKA_Token**: Any of up to 255 secondary token types (SKA-1 through SKA-255). All active SKA types share 90% of TC, divided equally among the number of active SKA types present in the current mempool.
- **Active_SKA_Count**: The number of distinct SKA token types present in the current CoinFills list. Determines the Guaranteed Quota of each SKA type.
- **WebSocket**: The persistent connection between the browser and the server used to push real-time mempool updates.
- **CoinStats_Payload**: The mempool update message sent over the WebSocket that includes the updated CoinFills list, the Total_Fill_Ratio, and the Active_SKA_Count.
- **Indicator_List**: The container element in the home page mempool section that holds all Fill_Bar elements.

---

## Requirements

### Requirement 1: Status Colour and Pattern Definitions

**User Story:** As a user, I want each fill bar to display a colour and visual pattern that reflects the coin's mempool pressure, so that I can immediately understand whether a coin's block-space quota is under pressure regardless of my ability to distinguish colours.

#### Acceptance Criteria

1. The Home_Template SHALL associate the `ok` status with a green colour applied to the GQ_Segment.
2. The Home_Template SHALL associate the `borrowing` status with a yellow colour applied to the GQ_Segment and Extra_Segment.
3. The Home_Template SHALL associate the `full` status with a red colour applied to the GQ_Segment and Overflow_Segment.
4. The Home_Template SHALL apply a cross-hatch pattern to the Overflow_Segment in addition to the red colour, so that the `full` status is distinguishable without relying on colour perception alone.
5. When a Fill_Bar has no known status value, the Home_Template SHALL render it with a neutral colour.
6. The Home_Template SHALL apply status colours and patterns consistently to all Fill_Bar elements regardless of coin type.

---

### Requirement 2: Fill_Bar Visual Component

**User Story:** As a user, I want to see a proportional fill bar for each coin in the mempool, so that I can compare block-space utilisation across coin types at a glance and understand how much of each coin's quota is consumed.

#### Acceptance Criteria

1. The Indicator_List SHALL contain one Fill_Bar element for each entry in CoinFills.
2. When a Fill_Bar is rendered, the Home_Template SHALL set the width of the GQ_Segment proportional to the GQ_Fill_Ratio of the corresponding CoinFills entry, where a GQ_Fill_Ratio of 1.0 corresponds to the GQ_Marker position.
3. When a Fill_Bar has status `borrowing`, the Home_Template SHALL render an Extra_Segment immediately after the GQ_Segment, with its width proportional to the Extra_Fill_Ratio.
4. When a Fill_Bar has status `full`, the Home_Template SHALL render an Overflow_Segment immediately after the GQ_Segment, with its width proportional to the Overflow_Fill_Ratio.
5. Each Fill_Bar SHALL display a GQ_Marker at the position indicated by the GQ_Position_Ratio of the corresponding CoinFills entry.
6. Each Fill_Bar SHALL display the coin symbol as a visible text label so that the coin identity is immediately apparent without additional interaction.
7. Each Fill_Bar SHALL display a numeric value expressing the current utilisation as a percentage of the coin's Guaranteed Quota, so that the fill level is conveyed without relying on the bar width alone.
8. When segment widths change, the Fill_Bar SHALL transition them smoothly.
9. When the Status changes, the Fill_Bar SHALL transition its segment colours smoothly.
10. Fill_Bar transitions SHALL NOT cause layout reflow in surrounding page elements.

---

### Requirement 3: Total_Bar Visual Component

**User Story:** As a user, I want to see an aggregate indicator of how full the block is overall, so that I can understand at a glance whether the mempool as a whole is within capacity or overflowing.

#### Acceptance Criteria

1. The Indicator_List SHALL contain one Total_Bar element, distinct from all Fill_Bar elements.
2. When the Total_Bar is rendered, the Home_Template SHALL set its filled width proportional to the Total_Fill_Ratio, where a Total_Fill_Ratio of 1.0 corresponds to 100% of the bar's available width.
3. The Total_Bar SHALL display a numeric value expressing the current total mempool size and TC in human-readable form.
4. When the Total_Fill_Ratio exceeds 1.0, the Total_Bar SHALL indicate the overflow condition visually, distinct from its within-capacity appearance.
5. When the Total_Fill_Ratio changes, the Total_Bar SHALL transition its filled width smoothly.
6. The Total_Bar transitions SHALL NOT cause layout reflow in surrounding page elements.

---

### Requirement 4: Initial Server-Side Rendering

**User Story:** As a user, I want the fill bars to be visible immediately on page load without waiting for a WebSocket message, so that the mempool section is informative even before the real-time connection is established.

#### Acceptance Criteria

1. When the home page is requested, the Home_Template SHALL render one Fill_Bar for each entry in the server-side CoinFills list.
2. When the server-side CoinFills list is empty, the Home_Template SHALL render a single Fill_Bar for VAR with all fill ratios set to 0.0 and a status of `ok`.
3. When the home page is requested, the Home_Template SHALL render the Total_Bar using the server-side Total_Fill_Ratio.
4. The Home_Template SHALL render the Indicator_List inside the existing mempool section of the home page, positioned after the existing transaction-type gauge bars.
5. When the page is rendered without JavaScript, the Indicator_List SHALL remain visible and display the server-side fill state.
6. The Home_Template SHALL embed the server-side Active_SKA_Count in the page so that the Mempool_Controller can use it as its initial state without recomputing it from the DOM.

---

### Requirement 5: Real-time Updates via WebSocket

**User Story:** As a user, I want the fill bars to update automatically as the mempool changes, so that I always see the current block-space utilisation without refreshing the page.

#### Acceptance Criteria

1. When a `mempool` WebSocket event is received, the Mempool_Controller SHALL extract the CoinFills list, the Total_Fill_Ratio, and the Active_SKA_Count from the CoinStats_Payload.
2. When the CoinFills list is received, the Mempool_Controller SHALL update the segments, GQ_Marker position, numeric label, and status of each existing Fill_Bar whose coin symbol matches an entry in the list.
3. When the Active_SKA_Count changes, the Mempool_Controller SHALL update the GQ_Marker position of all existing SKA Fill_Bars to reflect the new quota boundary.
4. When the CoinFills list contains an entry whose coin symbol does not correspond to any existing Fill_Bar, the Mempool_Controller SHALL create a new Fill_Bar for that coin and add it to the Indicator_List.
5. When a `mempool` WebSocket event is received, the Mempool_Controller SHALL update the Total_Bar using the Total_Fill_Ratio from the payload.
6. When multiple Fill_Bar updates are applied in response to a single WebSocket event, the Mempool_Controller SHALL apply all DOM changes in a single rendering pass to avoid intermediate visual states.
7. When a WebSocket event is received while a previous update is still being applied, the Mempool_Controller SHALL not apply the new update until the current rendering pass is complete.

---

### Requirement 6: Dynamic Injection of New SKA Token Indicators

**User Story:** As a developer, I want the home page to support SKA token types that appear in the mempool after the page has loaded, so that new token activity is reflected without requiring a page reload.

#### Acceptance Criteria

1. The Home_Template SHALL provide a reusable indicator template structure that the Mempool_Controller can use to create new Fill_Bar elements at runtime.
2. When the Mempool_Controller creates a new Fill_Bar for a previously unseen SKA token, the Mempool_Controller SHALL initialise it with all segment ratios, the GQ_Marker position, the numeric label, and the Status values from the corresponding CoinFills entry.
3. When a new Fill_Bar is injected into the Indicator_List, the Mempool_Controller SHALL insert it in the same order as the corresponding entry appears in the CoinFills list.
4. When a new SKA Fill_Bar is injected, the Mempool_Controller SHALL update the GQ_Marker position of all existing SKA Fill_Bars to reflect the updated Active_SKA_Count.
5. The Mempool_Controller SHALL NOT create duplicate Fill_Bar elements for a coin symbol that already has a Fill_Bar in the Indicator_List.

---

### Requirement 7: Rendering Performance

**User Story:** As a user, I want the fill bar animations and updates to be smooth and not degrade the overall page performance, so that the real-time indicators do not interfere with my use of the explorer.

#### Acceptance Criteria

1. When applying Fill_Bar updates received from a WebSocket event, the Mempool_Controller SHALL schedule all DOM writes to occur within a single animation frame.
2. Fill_Bar and Total_Bar transitions SHALL NOT trigger layout recalculation during animation.
3. When the page has more than one active Fill_Bar, the Mempool_Controller SHALL update all Fill_Bars and the Total_Bar in the same animation frame rather than in separate frames.

---

### Requirement 8: Accessibility

**User Story:** As a user relying on assistive technology, I want the fill bar indicators to convey their meaning in a non-visual form, so that I can understand mempool utilisation without depending on colour, pattern, or animation.

#### Acceptance Criteria

1. The Home_Template SHALL include a visible text label on each Fill_Bar that identifies the coin symbol.
2. The Home_Template SHALL include an accessible attribute on each Fill_Bar that expresses the current utilisation as a numeric value between 0 and 100.
3. The Home_Template SHALL include an accessible attribute on each Fill_Bar that expresses the current Status as a human-readable string.
4. The Home_Template SHALL include an accessible attribute on the Total_Bar that expresses the Total_Fill_Ratio as a numeric value between 0 and 100.
5. When the Mempool_Controller updates a Fill_Bar, the Mempool_Controller SHALL also update the corresponding accessible attributes to reflect the new segment ratios and Status.
6. When the Mempool_Controller updates the Total_Bar, the Mempool_Controller SHALL also update its accessible attribute to reflect the new Total_Fill_Ratio.
7. The cross-hatch pattern on the Overflow_Segment SHALL be accompanied by an accessible attribute or label that identifies the `full` status independently of the visual pattern.
