# Requirements Document

## Introduction

The Voting section on the Monetarium Explorer home page must be rewritten to reflect the dual-coin reward model. The existing "Vote Reward" subsection is renamed to "Vote VAR Reward" and displays per-VAR staking yield for the last block, 30 days, and 1 year. A new "Vote SKA Reward" subsection is added below it, rendering one reward block per emitted SKA type (dynamic count), each showing three rows of SKA-n/VAR yield values at 18 decimal places. All changes are purely frontend: Go `html/template` markup in `cmd/dcrdata/views/home.tmpl` and SCSS in `cmd/dcrdata/public/scss/`. The backend data is already available in the template context via `HomeInfo.VoteVARReward` (`VoteVARReward` struct) and `HomeInfo.SKAVoteRewards` (slice of `SKAVoteReward`).

## Glossary

- **Voting_Section**: The card on the home page that displays staking/voting statistics, bounded by the `<!-- end voting card -->` comment in `home.tmpl`.
- **Vote_VAR_Reward_Subsection**: The renamed subsection (formerly "Vote Reward") that shows per-VAR staking yield in VAR.
- **Vote_SKA_Reward_Subsection**: The new subsection that shows per-VAR staking yield in SKA tokens, one block per emitted SKA type.
- **SKA_Reward_Block**: A single rendered unit inside the Vote_SKA_Reward_Subsection corresponding to one SKA type (e.g. SKA-1).
- **VoteVARReward**: The Go struct in `HomeInfo` with fields `PerBlock float64`, `Per30Days float64`, `PerYear float64`. PerBlock is typed as float64 and will never exceed float64 precision (VAR uses 8 decimal places, well within float64's ~15 significant digits). This field will not be changed to a string.
- **SKAVoteReward**: The Go struct in `HomeInfo.SKAVoteRewards` slice with fields `CoinType uint8`, `Symbol string`, `PerBlock string`, `Per30Days string`, `PerYear string` (18 dp decimal strings).
- **Template**: The Go `html/template` file `cmd/dcrdata/views/home.tmpl`.
- **SCSS_File**: `cmd/dcrdata/public/scss/home.scss` or `cmd/dcrdata/public/scss/voting.scss` as appropriate.
- **Dark_Theme**: The `body.darkBG` CSS class applied by the theme toggle, defined in `themes.scss`.
- **Bootstrap**: Bootstrap 5, the CSS framework used as the base layer.

---

## Requirements

### Requirement 1: Rename "Vote Reward" to "Vote VAR Reward"

**User Story:** As a user, I want the existing vote reward subsection to be clearly labelled "Vote VAR Reward", so that I understand it shows yield denominated in VAR.

#### Acceptance Criteria

1. THE Template SHALL display the label "Vote VAR Reward" in place of the previous "Vote Reward" label for the subsection that shows VAR staking yield.
2. WHEN the Template renders the Vote_VAR_Reward_Subsection, THE Template SHALL source the per-block value from `$.Info.VoteVARReward.PerBlock` and display it using `{{template "decimalParts" (float64AsDecimalParts $.Info.VoteVARReward.PerBlock 8 false)}}`.
3. WHEN the Template renders the Vote_VAR_Reward_Subsection, THE Template SHALL source the 30-day percentage from `$.Info.VoteVARReward.Per30Days` and display it formatted as a percentage with 2 decimal places followed by the label "per 30 days".
4. WHEN the Template renders the Vote_VAR_Reward_Subsection, THE Template SHALL source the annual percentage from `$.Info.VoteVARReward.PerYear` and display it formatted as a percentage with 2 decimal places followed by the label "per year".
5. THE Template SHALL preserve the existing `data-homepage-target` attributes on the VAR reward value spans so that the Stimulus homepage controller continues to update them via WebSocket.

### Requirement 2: Add "Vote SKA Reward" subsection

**User Story:** As a user, I want to see a "Vote SKA Reward" subsection on the home page, so that I can monitor per-VAR staking yield expressed in each emitted SKA token type.

#### Acceptance Criteria

1. THE Template SHALL render a "Vote SKA Reward" subsection immediately after the Vote_VAR_Reward_Subsection inside the Voting_Section card.
2. WHEN `$.Info.SKAVoteRewards` is non-empty, THE Template SHALL iterate over the slice using a `range` action and render one SKA_Reward_Block per entry.
3. WHEN `$.Info.SKAVoteRewards` is empty, THE Template SHALL render a single placeholder row with the text "No SKA rewards available" inside the Vote_SKA_Reward_Subsection.
4. FOR EACH SKA_Reward_Block, THE Template SHALL display the SKA type identifier (e.g. "SKA-1") as the block heading, sourced from the `Symbol` field of the corresponding `SKAVoteReward` entry.
5. FOR EACH SKA_Reward_Block, THE Template SHALL display three rows in order: `Symbol/VAR per last block`, `Symbol/VAR per 30 days`, `Symbol/VAR per year`.
6. FOR EACH SKA_Reward_Block, THE Template SHALL source the per-block value from the `PerBlock` field of the `SKAVoteReward` entry and display it with exactly 18 decimal places.
7. FOR EACH SKA_Reward_Block, THE Template SHALL source the 30-day value from the `Per30Days` field of the `SKAVoteReward` entry and display it with exactly 18 decimal places.
8. FOR EACH SKA_Reward_Block, THE Template SHALL source the annual value from the `PerYear` field of the `SKAVoteReward` entry and display it with exactly 18 decimal places.
9. THE Template SHALL NOT apply `float64` conversion or any floating-point arithmetic to SKA reward values; all SKA values are pre-formatted decimal strings and SHALL be rendered as-is.
10. THE Template SHALL wrap the Vote_SKA_Reward_Subsection content (the range-rendered SKA blocks and the empty-state placeholder) in a single container element with `data-homepage-target="skaVoteRewards"`, so that the homepage Stimulus controller can replace its innerHTML on each new block via WebSocket. The container element itself is server-rendered; its contents are replaced client-side on block events.

### Requirement 3: Decimal precision display

**User Story:** As a user, I want VAR values shown with 8 decimal places and SKA values shown with 18 decimal places, so that I can read precise reward figures without rounding errors.

#### Acceptance Criteria

1. WHEN the Template renders a VAR reward amount, THE Template SHALL use `{{template "decimalParts" (float64AsDecimalParts $.Info.VoteVARReward.PerBlock 8 false)}}` — the `decimalParts` template takes a pre-processed `[]string` slice produced by the `float64AsDecimalParts` template function (which maps to `float64Formatting` in templates.go); it does not accept a raw float or a precision argument directly.
2. WHEN the Template renders an SKA reward amount, THE Template SHALL output the pre-formatted string value directly without passing it through any numeric template helper.
3. THE Template SHALL display a unit label "VAR/VAR" adjacent to the per-block VAR reward value. The full row label pattern is: `[value] VAR/VAR per last block`.
4. FOR EACH SKA_Reward_Block, THE Template SHALL display a unit label of the form "SKA-n/VAR" (where n is the coin type number) adjacent to each reward value row.

### Requirement 4: Mobile-first responsive layout

**User Story:** As a user on a mobile device, I want the Voting section to be readable and well-structured at small screen widths, so that I can check staking rewards on my phone.

#### Acceptance Criteria

1. THE Template SHALL use Bootstrap grid column classes (`col-12` at minimum) for all rows inside the Voting_Section so that content stacks vertically on mobile viewports.
2. THE SCSS_File SHALL define layout rules for the Vote_SKA_Reward_Subsection using Bootstrap utility classes and existing SCSS variables; no hard-coded pixel or colour values SHALL be introduced.
3. WHEN the viewport width is below the Bootstrap `sm` breakpoint (540 px), THE Voting_Section SHALL display each SKA_Reward_Block as a full-width stacked column.
4. WHEN the viewport width is at or above the Bootstrap `md` breakpoint, THE Voting_Section SHALL render each SKA_Reward_Block with Bootstrap classes `col-12 col-md-6`, producing a two-column layout at the `md` breakpoint and above.
5. THE Template SHALL apply the Bootstrap utility class `text-break` (which sets `word-break: break-word; overflow-wrap: break-word`) to SKA reward value elements, preventing horizontal overflow of 18-decimal-place strings at xs/sm viewports.

### Requirement 5: Dark theme compatibility

**User Story:** As a user with the dark theme enabled, I want the Vote SKA Reward subsection to match the dark theme styling of the rest of the page, so that the UI remains visually consistent.

#### Acceptance Criteria

1. THE SCSS_File SHALL define dark-theme overrides for any new Vote_SKA_Reward_Subsection elements under the `body.darkBG` selector, using existing SCSS variables from `_variables.scss`.
2. WHEN the Dark_Theme is active, THE Vote_SKA_Reward_Subsection heading and value text SHALL use colours consistent with the existing dark-theme text colour rules (e.g. `#fdfdfd` for primary text, `#c1c1c1` for secondary text).
3. WHEN the Dark_Theme is active, THE Vote_SKA_Reward_Subsection background SHALL use the `$inverse-bg-white` variable or an equivalent existing variable, not a hard-coded colour.
4. THE SCSS_File SHALL NOT introduce any new colour literals; all colours SHALL reference existing variables defined in `_variables.scss`.

### Requirement 6: No JavaScript required

**User Story:** As a developer, I want the Vote SKA Reward subsection to render entirely server-side, so that it works without any additional Stimulus controller logic.

#### Acceptance Criteria

1. THE Template SHALL render the initial Vote_SKA_Reward_Subsection server-side using Go `html/template` directives (range, with, if, printf). The homepage Stimulus controller SHALL update the subsection's container innerHTML on each new block via the existing `skaVoteRewards` WebSocket target — no new Stimulus controller is required.
2. IF a new Stimulus controller is needed for future interactivity, THEN THE Template SHALL include the appropriate `data-controller` attribute on the subsection root element; otherwise no new `data-controller` attribute SHALL be added.
3. THE Template SHALL NOT add inline `<script>` blocks or `onclick` handlers for the Vote_SKA_Reward_Subsection.

### Requirement 7: Template correctness with mock data

**User Story:** As a developer, I want the template to render correctly with both populated and empty `SKAVoteRewards` data, so that I can verify the feature before connecting live backend data.

#### Acceptance Criteria

1. WHEN `$.Info.SKAVoteRewards` contains one entry, THE Template SHALL render exactly one SKA_Reward_Block with three value rows.
2. WHEN `$.Info.SKAVoteRewards` contains multiple entries, THE Template SHALL render one SKA_Reward_Block per entry, each with three value rows, in the same order as the slice.
3. WHEN `$.Info.SKAVoteRewards` is nil or empty, THE Template SHALL render the placeholder text and zero SKA_Reward_Blocks.
4. THE Template SHALL produce valid HTML (no unclosed tags, no duplicate IDs) for all of the above cases.

### Requirement 8: WebSocket live update for SKA rewards

**User Story:** As a user watching the home page, I want the Vote SKA Reward values to refresh automatically when a new block arrives, so that I see current reward rates without reloading the page.

#### Acceptance Criteria

1. THE Template SHALL render the Vote_SKA_Reward_Subsection inside a container `<div>` with `data-homepage-target="skaVoteRewards"`.
2. WHEN a new block arrives via WebSocket, THE homepage Stimulus controller SHALL replace the `skaVoteRewards` target's `innerHTML` with freshly rendered SKA reward rows sourced from `ex.ska_vote_rewards` in the block payload.
3. THE homepage Stimulus controller already implements this update in `_processBlock` — no new JavaScript is required; only the template container element must carry the correct `data-homepage-target` attribute.
4. THE rendered HTML injected by the controller SHALL display the per-block value with a visually distinct significant-digits span (matching the `decimalParts` styling convention used for VAR values), using the first two decimal places as the "significant" portion and the remaining 16 as dimmed trailing digits.
5. WHEN `ex.ska_vote_rewards` is absent or empty in the block payload, THE controller SHALL leave the `skaVoteRewards` target unchanged (the existing server-rendered content remains visible).
