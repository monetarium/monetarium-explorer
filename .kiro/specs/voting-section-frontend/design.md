# Design Document — voting-section-frontend

## Overview

This feature updates the Voting card on the Monetarium Explorer home page to reflect the dual-coin reward model. The work is entirely frontend: two Go `html/template` files and one SCSS file are modified. No new Go packages and no new Stimulus controllers are introduced. The existing homepage Stimulus controller already handles SKA reward live updates via the `skaVoteRewards` WebSocket target.

**Scope of changes:**

| File                                                       | Change                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `cmd/dcrdata/views/home.tmpl`                              | Remove the voting card HTML; replace with `{{template "voting-card" .}}`                                                                |
| `cmd/dcrdata/views/home_voting.tmpl`                       | New file — defines the `voting-card` template with the full rewritten voting card HTML                                                  |
| `cmd/dcrdata/public/scss/home.scss`                        | Add dark-theme overrides for the new SKA subsection                                                                                     |
| `cmd/dcrdata/public/js/controllers/homepage_controller.js` | No changes required — SKA reward rendering logic (decimal split + `opacity-50` trailing span) is already implemented in `_processBlock` |

The backend already exposes `HomeInfo.VoteVARReward` (`VoteVARReward` struct) and `HomeInfo.SKAVoteRewards` (`[]SKAVoteReward`) in the template context as `$.Info.VoteVARReward` and `$.Info.SKAVoteRewards`.

---

## Architecture

The feature sits entirely in the presentation layer. There is no new data flow to design — the backend already populates the required fields. The template consumes them read-only.

```
┌──────────────────────────────────────────────────────────────┐
│  explorerroutes.go  →  HomeInfo  →  home.tmpl (SSR)          │
│                                                              │
│  HomeInfo.VoteVARReward   ──►  Vote VAR Reward block         │
│  HomeInfo.SKAVoteRewards  ──►  Vote SKA Reward container     │
│                                                              │
│  WebSocket BLOCK_RECEIVED event (on each new block):         │
│  ex.ska_vote_rewards  ──►  skaVoteRewards target innerHTML   │
└──────────────────────────────────────────────────────────────┘
```

The Stimulus `homepage` controller handles WebSocket updates for all `data-homepage-target` elements. VAR reward spans keep their existing targets (`bsubsidyPos`, `ticketReward`). The SKA reward container carries `data-homepage-target="skaVoteRewards"` — the controller's `_processBlock` method already replaces its `innerHTML` on every new block using `ex.ska_vote_rewards` from the block payload. No new JavaScript is needed.

The voting card HTML is extracted from `home.tmpl` into a dedicated partial template file `home_voting.tmpl`. This follows the existing pattern used by `mempoolCard` and `home_latest_blocks` in `home.tmpl`. The new file defines a `{{define "voting-card"}}` block; `home.tmpl` includes it with `{{template "voting-card" .}}`. The template loader already picks up all `*.tmpl` files in the `views/` directory, so no loader changes are needed.

---

## Components and Interfaces

### 0. Template extraction: `home_voting.tmpl` (new file)

The entire voting card — currently the `<div class="bg-white mb-1 py-2 px-3 mx-1">` block bounded by `<!-- end voting card -->` in `home.tmpl` — is moved verbatim into a new file `cmd/dcrdata/views/home_voting.tmpl`, then modified as described in Components 1 and 2.

**`home_voting.tmpl` structure:**

```
{{define "voting-card"}}
{{- $page := . -}}
{{- $conv := $page.Conversions -}}
{{with $page.Info -}}
<div class="bg-white mb-1 py-2 px-3 mx-1">
  ... (full voting card content) ...
</div>
{{- end}}
{{end}}
```

**Template scoping note:** Inside `{{with .Info}}`, Go's `.` is rebound to `.Info`. The `$` variable always refers to the data passed to the outermost template invocation (the full page struct). To make scoping unambiguous and safe, bind `$page := .` at the top of the `voting-card` definition, then use `$page.Info.*` for all root-level field accesses. This avoids any confusion between `.` inside `{{with}}` or `{{range}}` blocks and the page root.

**`home.tmpl` change** — replace the voting card block with a single include:

```html
{{template "voting-card" .}}
```

The `$conv` variable reference inside the voting card requires passing the full page data (`.`) rather than just `.Info`, so the template call passes `.` and the partial re-declares `$conv` and `{{with .Info}}` internally — identical to the current structure.

---

### 1. Vote VAR Reward block (modified)

Replaces the existing block at lines 95–107 of `home.tmpl`.

**Changes:**

- Label stays "Vote VAR Reward" (already renamed in the current file).
- Per-block value: replace `(toFloat64Amount (divide .NBlockSubsidy.PoS 5))` with `$page.Info.VoteVARReward.PerBlock`. Keep `data-homepage-target="bsubsidyPos"` on the span.
- Unit label: change `VAR/vote` → `VAR/VAR`.
- 30-day row: replace `.TicketReward` / `.RewardPeriod` with `$page.Info.VoteVARReward.Per30Days` formatted as `{{printf "%.2f" $page.Info.VoteVARReward.Per30Days}}%` followed by `per 30 days`. Keep `data-homepage-target="ticketReward"` on the span.
- Annual row: replace `.ASR` with `$page.Info.VoteVARReward.PerYear` formatted as `{{printf "%.2f" $page.Info.VoteVARReward.PerYear}}%` followed by `per year`.

**Template sketch:**

```html
<div class="col-12 mb-3 mb-sm-2 mb-md-3 mb-lg-3">
  <div class="fs13 text-secondary">Vote VAR Reward</div>
  <div
    class="mono lh1rem fs14-decimal fs24 pt-1 pb-1 d-flex align-items-baseline"
  >
    <span data-homepage-target="bsubsidyPos">
      {{template "decimalParts" (float64AsDecimalParts
      $page.Info.VoteVARReward.PerBlock 8 false)}}
    </span>
    <span class="ps-1 unit lh15rem fs13">VAR/VAR</span>
  </div>
  <div class="fs12 lh1rem text-black-50">
    <span data-homepage-target="ticketReward"
      >{{printf "%.2f" $page.Info.VoteVARReward.Per30Days}}%</span
    >
    per 30 days
  </div>
  <div class="fs12 lh1rem text-black-50">
    {{printf "%.2f" $page.Info.VoteVARReward.PerYear}}% per year
  </div>
</div>
```

### 2. Vote SKA Reward subsection (new)

Inserted immediately after the Vote VAR Reward block, before the "Total Staked VAR" block, still inside the `{{with .Info}}` scope.

**Structure:**

- Outer container: `<div data-homepage-target="skaVoteRewards">` wrapping all SKA content (both the populated range and the empty-state placeholder). This is the element the Stimulus controller replaces on block events.
- Section heading: `<div class="fs13 text-secondary">Vote SKA Reward</div>`
- `{{if $.Info.SKAVoteRewards}}` branch: `range` over the slice, one `col-12 col-md-6` block per entry.
- `{{else}}` branch: single `col-12` block with placeholder text "No SKA rewards available".

Each SKA reward block contains:

1. Heading row: `Symbol` field (e.g. "SKA-1") in `fs13 text-secondary`.
2. Per-block row: `PerBlock` string + unit label `Symbol/VAR` in `fs12 lh1rem`.
3. Per-30-days row: `Per30Days` string + unit label `Symbol/VAR per 30 days` in `fs12 lh1rem text-black-50`.
4. Per-year row: `PerYear` string + unit label `Symbol/VAR per year` in `fs12 lh1rem text-black-50`.

All SKA value spans carry `class="text-break"` to prevent horizontal overflow of 18-decimal-place strings at narrow viewports. The outer container carries `data-homepage-target="skaVoteRewards"` for WebSocket live updates.

**Template sketch:**

```html
<!-- Vote SKA Reward subsection -->
<div class="col-12 mb-3 mb-sm-2 mb-md-3 mb-lg-3">
  <div class="fs13 text-secondary">Vote SKA Reward</div>
</div>
<div data-homepage-target="skaVoteRewards">
  {{if $page.Info.SKAVoteRewards}} {{range $page.Info.SKAVoteRewards}}
  <div
    class="col-12 col-md-6 mb-3 mb-sm-2 mb-md-3 mb-lg-3 vote-ska-reward-block"
  >
    <div class="fs13 text-secondary">{{.Symbol}}</div>
    <div
      class="mono lh1rem fs14-decimal fs24 pt-1 pb-1 d-flex align-items-baseline"
    >
      <span class="text-break">{{.PerBlock}}</span>
      <span class="ps-1 unit lh15rem fs13">{{.Symbol}}/VAR per last block</span>
    </div>
    <div class="fs12 lh1rem text-black-50 text-break">
      {{.Per30Days}} <span class="unit">{{.Symbol}}/VAR per 30 days</span>
    </div>
    <div class="fs12 lh1rem text-black-50 text-break">
      {{.PerYear}} <span class="unit">{{.Symbol}}/VAR per year</span>
    </div>
  </div>
  {{end}} {{else}}
  <div class="col-12 mb-3 mb-sm-2 mb-md-3 mb-lg-3">
    <div class="fs12 lh1rem text-black-50">No SKA rewards available</div>
  </div>
  {{end}}
</div>
```

Note: `fs13` is a utility class defined in `utils.scss` (`.fs13 { font-size: 13px }`). Use it in place of any `style="font-size:13px;"` inline style, per project-rules.md.

**WebSocket update (client-side):**

The `_processBlock` method in `homepage_controller.js` already handles the live update. When a new block arrives it replaces `skaVoteRewardsTarget.innerHTML` with HTML built from `ex.ska_vote_rewards`. The controller splits the `per_block` string at the decimal point and renders the first two decimal places in normal weight and the remaining 16 in a dimmed `opacity-50` span — matching the visual convention of `decimalParts` for VAR values. The server-rendered initial HTML uses the full string verbatim (Req 8.4 styling is client-side only).

### 3. SCSS additions (`home.scss`)

A single new rule block appended to `home.scss`:

```scss
// Vote SKA Reward subsection — dark theme overrides
body.darkBG .vote-ska-reward-block .text-secondary {
  color: $dark-text-primary;
}

body.darkBG .vote-ska-reward-block {
  background-color: $inverse-bg-white;
}
```

A new variable `$dark-text-primary: #fdfdfd` must be added to `_variables.scss` following the project naming convention, and referenced here as `$dark-text-primary`. The literal `#fdfdfd` must not appear in the SCSS rule. Secondary text (`#c1c1c1`) is already handled by the existing `body.darkBG .text-secondary` override in `themes.scss` (no new rule needed for `.text-black-50` rows). Note: `_variables.scss` must also be updated as part of this task — add `$dark-text-primary: #fdfdfd;` in the `// colors` section.

---

## Data Models

No new data models. The relevant existing types from `explorer/types/explorertypes.go`:

```go
type VoteVARReward struct {
    PerBlock  float64 // VAR/VAR ratio for the last block
    Per30Days float64 // percentage per 30 days
    PerYear   float64 // annualised percentage
}

type SKAVoteReward struct {
    CoinType  uint8
    Symbol    string // e.g. "SKA-1"
    PerBlock  string // 18dp decimal string
    Per30Days string // 18dp decimal string
    PerYear   string // 18dp decimal string
}

// HomeInfo (relevant fields only)
type HomeInfo struct {
    // ...
    VoteVARReward  VoteVARReward   `json:"vote_var_reward"`
    SKAVoteRewards []SKAVoteReward `json:"ska_vote_rewards,omitempty"`
}
```

**Why SKA values are strings:** SKA tokens use 18 decimal places (up to 15 integer digits), which exceeds `float64` precision (~15 significant digits total). The backend pre-formats them as decimal strings; the template renders them verbatim.

**Why VAR PerBlock is float64:** VAR uses 8 decimal places with at most 8 integer digits — well within `float64`'s ~15 significant digits. The `float64AsDecimalParts` template function handles the styled rendering.

---

## Correctness Properties

_A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees._

This feature is a Go `html/template` rendering function. The template is a pure function from `HomeInfo` to HTML string. Property-based testing applies: we can generate random `HomeInfo` values and assert universal properties about the rendered output.

The property-based testing library used is [`pgregory.net/rapid`](https://pkg.go.dev/pgregory.net/rapid), consistent with the existing test suite (see `home_viewmodel_test.go`).

---

### Property 1: VAR PerBlock value appears in rendered output

_For any_ valid `float64` value of `VoteVARReward.PerBlock`, the rendered home template output SHALL contain the integer part of that value's decimal representation, confirming the template reads from `$.Info.VoteVARReward.PerBlock` and not from a stale field.

**Validates: Requirements 1.2**

---

### Property 2: VAR percentage fields are formatted correctly

_For any_ valid `float64` values of `VoteVARReward.Per30Days` and `VoteVARReward.PerYear`, the rendered output SHALL contain `fmt.Sprintf("%.2f", Per30Days)` followed by `per 30 days`, and `fmt.Sprintf("%.2f", PerYear)` followed by `per year`.

**Validates: Requirements 1.3, 1.4**

---

### Property 3: SKA slice count and order are preserved

_For any_ non-empty slice of `SKAVoteReward` entries, the rendered output SHALL contain each entry's `Symbol` string, and the symbols SHALL appear in the same order as the input slice.

**Validates: Requirements 2.2, 2.4, 7.2**

---

### Property 4: SKA pre-formatted strings are rendered verbatim

_For any_ `SKAVoteReward` entry, the rendered output SHALL contain the `PerBlock`, `Per30Days`, and `PerYear` string values exactly as provided, with no numeric transformation applied.

**Validates: Requirements 2.6, 2.7, 2.8, 3.2**

---

### Property 5: Rendered HTML is well-formed for all inputs

_For any_ `HomeInfo` value (with empty, single-entry, or multi-entry `SKAVoteRewards`), the rendered template output SHALL be parseable as valid HTML with no unclosed tags.

**Validates: Requirements 7.4**

---

### Property 6: skaVoteRewards container is present in rendered output

_For any_ `HomeInfo` value, the rendered template output SHALL contain exactly one element with `data-homepage-target="skaVoteRewards"`, ensuring the Stimulus controller can always locate the update target.

**Validates: Requirements 2.10, 8.1**

---

## Error Handling

This feature has no runtime error paths of its own — it is pure template rendering. The relevant failure modes and their mitigations are:

| Scenario                                               | Mitigation                                                                                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SKAVoteRewards` is nil or empty                       | `{{if $.Info.SKAVoteRewards}}` guard renders the placeholder row                                                                                                                         |
| `VoteVARReward` fields are zero                        | `float64AsDecimalParts` and `printf "%.2f"` handle zero correctly; output is `0.00000000` and `0.00%` respectively                                                                       |
| SKA `PerBlock`/`Per30Days`/`PerYear` is empty string   | Rendered as an empty span — no crash; the unit label still appears                                                                                                                       |
| Template parse error                                   | Caught at startup by `newTemplates` / `addTemplate`; the server will not start with a broken template                                                                                    |
| `ex.ska_vote_rewards` absent or empty in block payload | Controller guard `if (this.hasSkaVoteRewardsTarget && ex.ska_vote_rewards && ex.ska_vote_rewards.length)` leaves the target unchanged; server-rendered content remains visible (Req 8.5) |

---

## Testing Strategy

### Unit / example-based tests (Go, `home_template_test.go`)

Voting-card-specific tests go in a new `home_voting_template_test.go` file, rendering the `voting-card` template directly with a constructed page data struct. Full-page integration tests remain in `home_template_test.go`. Both follow the existing pattern of rendering a named template and asserting on the output string.

New test cases in `TestVotingCardTemplate` (in `home_voting_template_test.go`):

1. **Label check** — assert "Vote VAR Reward" and "Vote SKA Reward" appear in output.
2. **VAR unit label** — assert "VAR/VAR" appears in output.
3. **data-homepage-target preservation** — assert `data-homepage-target="bsubsidyPos"` and `data-homepage-target="ticketReward"` appear in output.
4. **Empty SKA slice** — assert "No SKA rewards available" appears; assert no `vote-ska-reward-block` divs are present.
5. **Single SKA entry** — assert the symbol, all three value strings, and the unit label appear exactly once.
6. **skaVoteRewards container** — assert exactly one element with `data-homepage-target="skaVoteRewards"` appears in the rendered output.
7. **Bootstrap classes** — assert `col-md-6` and `text-break` appear in the SKA subsection when entries are present.

### Property-based tests (Go, `home_template_test.go`)

Using `pgregory.net/rapid`, in `home_voting_template_test.go`. Minimum 100 iterations per property. Each test is tagged with a comment referencing the design property.

```
// Feature: voting-section-frontend, Property 1: VAR PerBlock value appears in rendered output
// Feature: voting-section-frontend, Property 2: VAR percentage fields are formatted correctly
// Feature: voting-section-frontend, Property 3: SKA slice count and order are preserved
// Feature: voting-section-frontend, Property 4: SKA pre-formatted strings are rendered verbatim
// Feature: voting-section-frontend, Property 5: Rendered HTML is well-formed for all inputs
// Feature: voting-section-frontend, Property 6: skaVoteRewards container is present in rendered output
```

**Generators:**

- `VoteVARReward`: draw `PerBlock` from `rapid.Float64Range(0, 1e6)`, `Per30Days` and `PerYear` from `rapid.Float64Range(0, 100)`.
- `SKAVoteReward` slice: draw length from `rapid.IntRange(0, 10)`. For each entry, draw `CoinType` from `rapid.Uint8Range(1, 255)` and derive `Symbol` as `fmt.Sprintf("SKA-%d", coinType)` — do not generate `Symbol` independently, as an independent string generator can produce values inconsistent with the `uint8` range. Draw value strings from `rapid.StringMatching(`\d{1,15}\.\d{18}`)`.

**HTML well-formedness check (Property 5):** Use `golang.org/x/net/html` (`html.Parse`) — already available transitively in the module — to parse the rendered output and assert no error is returned.

### CSS / SCSS

Run `npm run lint:css` (Stylelint) to verify no new colour literals are introduced and all variable references resolve. No automated visual regression tests are added.

### Manual verification

After implementing, run the dev server and visually verify:

- Light and dark theme rendering of both subsections.
- Mobile viewport (< 540 px): SKA blocks stack full-width.
- Desktop viewport (≥ 768 px): SKA blocks render two-per-row.
- Long 18-decimal strings wrap correctly with `text-break`.
- WebSocket live update: open browser devtools, watch the `skaVoteRewards` container innerHTML replace on each new block.
