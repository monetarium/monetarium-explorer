# Requirements Document

## Introduction

This feature defines the Latest Blocks table on the Monetarium Explorer home page. The table displays a list of blocks with aggregated values for VAR and SKA tokens, with the ability to expand each row to reveal per-token transaction breakdowns. The design prioritizes a simplified, flat two-level hierarchy with no deeper nesting.

## Glossary

- **Table**: The Latest Blocks table component on the home page
- **Block_Row**: A primary-level row representing one block, identified by its Height
- **Height**: The sequential block number, unique per block
- **VAR**: The primary coin of the Monetarium blockchain (8 integer digits, 8 decimal places)
- **SKA**: A secondary token type; up to 255 distinct SKA-n variants exist per block (15 integer digits, 18 decimal places — requires big-number arithmetic)
- **SKA-n**: A specific SKA token variant identified by index n (1 ≤ n ≤ 255)
- **VAR_Row**: The expanded sub-row showing VAR transaction details for a block
- **SKA_Row**: An expanded sub-row showing transaction details for one SKA-n variant
- **Expanded_Row**: A sub-row shown beneath a Block_Row when it is expanded
- **Placeholder**: An explicit visual indicator shown when a data value is absent

---

## Requirements

### Requirement 1: Primary Row Display

**User Story:** As a user, I want to see key metrics for each block in a single row, so that I can quickly scan recent chain activity.

#### Acceptance Criteria

1. THE Table SHALL display one Block_Row per block.
2. THE Block_Row SHALL contain the following columns in order: Height, Txn, VAR, SKA, Size, Vote, Tkt, Rev, Age.
3. THE Block_Row SHALL display Height as the sequential block number with a tooltip "block height".
4. THE Block_Row SHALL display Txn as the total number of transactions with a tooltip "number of transactions".
5. THE Block_Row SHALL display VAR as the total amount of VAR coins transferred with a tooltip "total VAR amount".
6. THE Block_Row SHALL display SKA as the total amount of SKA coins transferred with a tooltip "total SKA amount".
7. THE Block_Row SHALL display Size as the total aggregate block size with a tooltip "total block size".
8. THE Block_Row SHALL display Vote as the number of tickets that voted to include the block with a tooltip "tickets voted".
9. THE Block_Row SHALL display Tkt as the number of tickets purchased for voting with a tooltip "tickets purchased".
10. THE Block_Row SHALL display Rev as the number of revoked tickets with a tooltip "tickets revoked".
11. THE Block_Row SHALL display Age as the time elapsed since the block was included in the blockchain with a tooltip "block age".

---

### Requirement 2: Aggregated Value Calculation

**User Story:** As a user, I want the primary row to show correct aggregate totals, so that I can understand overall block activity at a glance.

#### Acceptance Criteria

1. THE Table SHALL calculate the Txn value of a Block_Row as the sum of VAR transaction count and all SKA-n transaction counts for that block.
2. THE Table SHALL calculate the VAR value of a Block_Row as the sum of all VAR coin transfer amounts in that block.
3. THE Table SHALL calculate the SKA value of a Block_Row as the sum of all SKA-n coin transfer amounts across all SKA variants in that block.

---

### Requirement 3: Expanded Row Structure

**User Story:** As a user, I want to expand a block row to see per-token breakdowns, so that I can investigate VAR and SKA activity in detail.

#### Acceptance Criteria

1. THE Table SHALL display Expanded_Rows using the same columns as the Block_Row, with no separate column headers.
2. WHEN a Block_Row is expanded, THE Table SHALL display exactly one VAR_Row for that block.
3. WHEN a Block_Row is expanded, THE Table SHALL display one SKA_Row for each SKA-n variant present in that block.
4. THE Table SHALL NOT display an aggregate SKA row among the Expanded_Rows.
5. THE Table SHALL NOT support nesting deeper than one level below a Block_Row.

---

### Requirement 4: VAR Row Content

**User Story:** As a user, I want the VAR expanded row to show VAR-specific metrics, so that I can see VAR transfer activity separately.

#### Acceptance Criteria

1. THE VAR_Row SHALL display Txn as the number of simple VAR coin transfer transactions.
2. THE VAR_Row SHALL display VAR as the total amount of VAR coins transferred.
3. THE VAR_Row SHALL display Size as the total size of VAR transactions.

---

### Requirement 5: SKA Row Content

**User Story:** As a user, I want each SKA expanded row to show metrics for that specific SKA variant, so that I can distinguish activity across different SKA types.

#### Acceptance Criteria

1. THE SKA_Row SHALL display Txn as the number of simple SKA coin transfer transactions for SKA-n.
2. THE SKA_Row SHALL display SKA as the total amount of SKA-n coins transferred.
3. THE SKA_Row SHALL display Size as the total size of SKA-n transactions, with a tooltip "SKA block size".

---

### Requirement 6: Expand/Collapse Behavior

**User Story:** As a user, I want rows to be collapsed by default and expandable on demand, so that the table remains readable without overwhelming detail.

#### Acceptance Criteria

1. THE Table SHALL render all Block_Rows in a collapsed state by default.
2. WHEN a user expands a Block_Row, THE Table SHALL show the VAR_Row and all SKA_Row entries for that block.
3. WHEN a user collapses an expanded Block_Row, THE Table SHALL hide all associated Expanded_Rows.

---

### Requirement 7: Missing Data

**User Story:** As a user, I want absent values to be clearly indicated, so that I am not confused by empty cells.

#### Acceptance Criteria

1. IF a data value for any column is absent, THEN THE Table SHALL display a Placeholder in that cell.

---

### Requirement 8: Sorting

**User Story:** As a user, I want blocks and SKA rows to appear in a predictable order, so that I can navigate the table consistently.

#### Acceptance Criteria

1. THE Table SHALL sort Block_Rows in descending order by Height.
2. THE Table SHALL sort SKA_Row entries within an expanded block in ascending order by SKA-n index n.

---

### Requirement 9: Navigation

**User Story:** As a user, I want to navigate from a block row to the block detail page, so that I can explore a specific block further.

#### Acceptance Criteria

1. THE Table SHALL render the Height value in each Block_Row as a navigable link to the block detail page for that Height.

---

### Requirement 10: Uniqueness and Identification

**User Story:** As a developer, I want each row to be uniquely identifiable, so that expand/collapse state and data binding are unambiguous.

#### Acceptance Criteria

1. THE Table SHALL associate each Block_Row with exactly one unique Height value.
2. THE Table SHALL identify each SKA_Row by the combination of its parent block Height and its SKA-n index n.

---

### Requirement 11: Scalability

**User Story:** As a user, I want the table to remain functional under high data volumes, so that it works correctly on an active chain.

#### Acceptance Criteria

1. THE Table SHALL support rendering a large number of Block_Rows without functional degradation.
2. THE Table SHALL support up to 255 SKA_Row entries per Block_Row.

---

### Requirement 12: Live Block Updates via WebSocket

**User Story:** As a user, I want newly mined blocks to appear at the top of the table in real time, so that I always see the latest chain activity without refreshing the page.

#### Acceptance Criteria

1. WHEN a new block is received over the WebSocket, THE Table SHALL prepend a new Block_Row at the top of the table matching the same 9-column structure as server-rendered rows.
2. THE new Block_Row SHALL populate VAR columns (Txn, VAR, Size) from the block payload using the same formatting as the server-rendered output.
3. THE new Block_Row SHALL populate SKA columns (Txn, SKA) from mock SKA data computed from the block height, using the same mock logic as the server.
4. WHEN the new block has SKA data, THE new Block_Row SKA cells SHALL be interactive (clickable to expand), matching the server-rendered `HasSKAData = true` state.
5. WHEN the new block has no SKA data, THE new Block_Row SKA cells SHALL be non-interactive, matching the server-rendered `HasSKAData = false` state.
6. WHEN a new block is prepended, THE Table SHALL insert the corresponding VAR sub-row and all SKA sub-rows immediately after the new Block_Row, in the collapsed state.
7. THE prepended rows SHALL carry the correct `data-ska-accordion-target`, `data-block-id`, and CSS classes so that the accordion controller can expand/collapse them without page reload.
8. WHEN a new block is prepended, THE Table SHALL remove the oldest Block_Row (and its sub-rows) to keep the displayed count constant.

### Requirement 13: Extensibility

**User Story:** As a developer, I want the table structure to accommodate future token types and metrics, so that new features can be added without redesigning the component.

#### Acceptance Criteria

1. THE Table SHALL be structured to allow new transaction types to be added as additional Expanded_Row variants.
2. THE Table SHALL be structured to allow new metric columns to be added to both Block_Rows and Expanded_Rows.

---
