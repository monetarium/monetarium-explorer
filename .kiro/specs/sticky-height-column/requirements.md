# Requirements Document

## Introduction

This feature makes the Height column in the Latest Blocks table on the home page remain visible while a user scrolls the table horizontally. A visual indicator appears on the column's right edge whenever content is hidden behind it, helping users maintain context about which block row they are viewing.

## Glossary

- **Height_Column**: The column in the Latest_Blocks_Table that displays the block height value and link, appearing as the first column in every row.
- **Latest_Blocks_Table**: The table on the home page that lists recent blocks with their associated data.
- **Scroll_Container**: The scrollable area that wraps the Latest_Blocks_Table and enables horizontal scrolling when the table is wider than the viewport.
- **Scrolled_State**: The condition where the Scroll_Container has been scrolled horizontally so that content is hidden to the left of the visible area.
- **Sticky_Shadow**: A visual shadow on the right edge of the Height_Column that signals content is scrolled behind it.

## Requirements

### Requirement 1: Sticky Height Column

**User Story:** As a user, I want the Height column to remain visible while scrolling the block table horizontally, so that I always know which block row I am looking at.

#### Acceptance Criteria

1. WHILE the Latest_Blocks_Table is rendered, THE Height_Column SHALL remain pinned to the left edge of the visible table area during horizontal scrolling.
2. THE Height_Column SHALL visually cover any content that scrolls behind it, so that overlapping content is not visible through the column.
3. THE Height_Column sticky behavior SHALL apply to all row types in the Latest_Blocks_Table, including regular block rows and SKA sub-rows.

### Requirement 2: Shadow on Scroll

**User Story:** As a user, I want a visual indicator when the table is scrolled horizontally, so that I know content is hidden behind the sticky Height column.

#### Acceptance Criteria

1. WHEN the Scroll_Container enters the Scrolled_State, THE Height_Column SHALL display the Sticky_Shadow on its right edge.
2. WHEN the Scroll_Container returns to its initial (non-scrolled) position, THE Sticky_Shadow SHALL no longer be visible.
3. THE Sticky_Shadow SHALL not obscure the content in adjacent columns.
4. IF the Latest_Blocks_Table does not overflow the Scroll_Container horizontally, THEN THE Sticky_Shadow SHALL not be visible.

### Requirement 3: Theme Compatibility

**User Story:** As a user, I want the sticky column and its shadow to look correct in both light and dark themes, so that the feature does not break the visual design.

#### Acceptance Criteria

1. THE Height_Column background in sticky position SHALL be visually consistent with the surrounding table row background in the light theme.
2. WHERE the dark theme is active, THE Height_Column background in sticky position SHALL be visually consistent with the surrounding table row background in the dark theme.
3. WHERE the dark theme is active, THE Sticky_Shadow SHALL remain subtle and visually consistent with the dark theme palette.
