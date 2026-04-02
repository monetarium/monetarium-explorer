# Requirements Document

## Introduction

This feature replaces the home page "Latest Blocks" table with a redesigned 13-column table
partitioned into three logical groups (Overview, VAR, SKA), adds an interactive accordion
for per-SKA-type breakdowns, and enforces a "Rule of Three" formatting convention for all
monetary amounts. SKA group data and accordion sub-rows are mocked until the backend is
fully implemented. The table must support horizontal scrolling for responsiveness.

## Glossary

- **Explorer**: The Monetarium block explorer web application.
- **Block_Table**: The "Latest Blocks" table rendered on the home page.
- **Block_Row**: A single row in Block_Table representing one block.
- **Sub_Row**: A collapsible row rendered as a sibling of a Block_Row, containing
  per-SKA-type breakdown data aligned under the SKA group columns.
- **Overview_Group**: Columns 1–7 of Block_Table: Height, Transactions, Voters, Tickets,
  Revokers, Size, Age.
- **VAR_Group**: Columns 8–10 of Block_Table: VAR Transactions, VAR Amount, VAR Size.
- **SKA_Group**: Columns 11–13 of Block_Table: SKA Transactions, SKA Amount, SKA Size.
- **SKA_Accordion**: The interactive component responsible for toggling Sub_Row visibility.
- **Amount_Formatter**: The server-side utility that formats monetary amounts to 3
  significant digits with an appropriate scale suffix (k/M/B).
- **View_Model**: The server-side data structure passed to the home page template that
  carries all data for Block_Table rendering.

---

## Requirements

### Requirement 1: Structured Data Model for the 13-Column Table

**User Story:** As a backend developer, I want a well-defined data model for the 13-column
block table, so that the template has a single, typed source of truth for all column data.

#### Acceptance Criteria

1. THE View_Model SHALL contain a field for each of the 13 columns partitioned into three
   named groups: Overview_Group (7 fields), VAR_Group (3 fields), and SKA_Group (3 fields).
2. THE View_Model SHALL contain a list of Sub_Row entries per block, where each Sub_Row
   carries the SKA token type identifier and its three SKA_Group values.
3. WHEN the SKA backend is not yet available, THE View_Model SHALL populate SKA_Group fields
   and Sub_Row entries with static mock values so that the page renders without errors.
4. THE View_Model SHALL expose all monetary amounts as pre-formatted strings produced by
   Amount_Formatter, so the template performs no numeric formatting itself.

---

### Requirement 2: Amount Formatting (Rule of Three)

**User Story:** As a product owner, I want all monetary amounts on the home page to display
with exactly 3 significant digits and a scale suffix, so that the table remains compact and
readable regardless of value magnitude.

#### Acceptance Criteria

1. THE Amount_Formatter SHALL accept a monetary amount and return a string with exactly 3
   significant digits followed by an appropriate scale suffix (k for thousands, M for
   millions, B for billions).
2. WHEN the input amount is less than 1,000, THE Amount_Formatter SHALL return the value
   formatted to 3 significant digits with no suffix.
3. THE Amount_Formatter SHALL be applied to all VAR and SKA amounts before they are passed
   to the template.
4. Mock SKA amounts SHALL be static values chosen to exercise the formatter across a range
   of magnitudes (e.g. values in the thousands, millions, and billions range).

---

### Requirement 3: Grouped Table Header

**User Story:** As a user, I want the block table header to visually group the 13 columns
into Overview, VAR, and SKA sections, so that I can immediately understand the data layout.

#### Acceptance Criteria

1. THE Block_Table header SHALL contain two rows: a group label row and a column label row.
2. THE group label row SHALL display three group labels — "Overview" spanning 7 columns,
   "VAR" spanning 3 columns, and "SKA" spanning 3 columns.
3. THE column label row SHALL contain exactly 13 column labels in the order: Height,
   Transactions, Voters, Tickets, Revokers, Size, Age, Transactions, VAR, Size,
   Transactions, SKA, Size.
4. THE Block_Table SHALL apply a clear visual boundary between the three groups in both
   header rows.

---

### Requirement 4: Block Row Data Rendering

**User Story:** As a user, I want each block row to display all 13 columns of data, so that
I can see Overview, VAR, and SKA information at a glance.

#### Acceptance Criteria

1. WHEN the Explorer renders the home page, THE Block_Table SHALL display one Block_Row per
   block in the latest-blocks list.
2. THE Block_Row Overview_Group cells SHALL be populated from real chain data: Height,
   Transactions, Voters, Tickets, Revokers, Size, and Age.
3. THE Block_Row VAR_Group cells SHALL be populated from real chain data and formatted by
   Amount_Formatter.
4. THE Block_Row SKA_Group cells SHALL be populated from mock data and formatted by
   Amount_Formatter until the SKA backend is available.
5. THE Block_Row SKA_Group cells SHALL be interactive — clicking any of them SHALL trigger
   the SKA_Accordion for that row.

---

### Requirement 5: Accordion Sub-Rows

**User Story:** As a user, I want to expand a block row to see a per-SKA-type breakdown,
so that I can inspect individual SKA token activity without leaving the home page.

#### Acceptance Criteria

1. WHEN the Explorer renders the home page, THE Explorer SHALL render one Sub_Row per SKA
   token type present in the block, immediately following the corresponding Block_Row.
2. THE Sub_Row SHALL be hidden by default.
3. THE Sub_Row SHALL span all 13 columns.
4. THE Sub_Row cells for columns 1–7 (Overview_Group) SHALL be visually empty, preserving
   the column alignment of the parent row.
5. THE Sub_Row SHALL render a single cell spanning all 3 VAR_Group columns (cols 8–10)
   containing the SKA token type name (e.g. "SKA-1"), right-aligned, so that it appears
   immediately to the left of the three SKA_Group value cells.
6. THE Sub_Row cells for columns 11–13 (SKA_Group) SHALL be populated with the per-SKA-type
   Transactions, Amount, and Size values formatted by Amount_Formatter.
7. WHEN mock data is used, THE Explorer SHALL render at least two Sub_Rows per Block_Row
   (representing two distinct SKA token types) so that accordion interaction can be tested
   visually.

---

### Requirement 6: SKA Accordion Interaction

**User Story:** As a user, I want clicking any SKA group cell to toggle the visibility of
the corresponding sub-rows, so that I can expand and collapse the breakdown interactively.

#### Acceptance Criteria

1. WHEN a user clicks any cell within the SKA_Group columns of a Block_Row, THE
   SKA_Accordion SHALL toggle the visibility of all Sub_Rows associated with that Block_Row.
2. WHEN Sub_Rows are made visible, THE Block_Row SHALL be visually marked as expanded.
3. WHEN Sub_Rows are hidden, THE Block_Row SHALL no longer be marked as expanded.
4. WHEN a block contains no SKA data, THE SKA_Group cells SHALL NOT be interactive and
   SHALL NOT display any expanded state.
5. THE SKA_Accordion SHALL function correctly after client-side page navigation (i.e. it
   must not require a full page reload to initialise).

---

### Requirement 7: Sub-Row Visual Styling

**User Story:** As a user, I want sub-rows to have a distinct visual style, so that I can
clearly distinguish breakdown rows from main block rows.

#### Acceptance Criteria

1. THE Sub_Row SHALL have a distinct background tint that differentiates it from Block_Rows.
2. THE Sub_Row background tint SHALL be visible in both light and dark themes.
3. THE SKA_Group cells in a Block_Row SHALL have a visual affordance indicating they are
   interactive (e.g. a pointer cursor), but ONLY WHEN that block contains SKA data.
4. WHEN a block contains no SKA data (all SKA values are zero or absent), THE SKA_Group
   cells SHALL NOT display any interactive affordance, so as not to mislead the user into
   expecting expandable content.

---

### Requirement 8: Horizontal Scroll Responsiveness

**User Story:** As a mobile user, I want the block table to scroll horizontally on small
screens, so that all 13 columns remain accessible without breaking the layout.

#### Acceptance Criteria

1. THE Block_Table SHALL support horizontal scrolling on viewports narrower than the
   table's full width.
2. THE Block_Table SHALL have a defined minimum width so that column content does not wrap
   unexpectedly on narrow screens.
3. WHEN the viewport is narrower than the table's minimum width, a horizontal scrollbar
   SHALL be visible on the table container.
