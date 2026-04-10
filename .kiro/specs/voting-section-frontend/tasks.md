# Implementation Plan: voting-section-frontend

## Overview

Implement the dual-coin voting reward section on the home page. The work is purely frontend: extract the voting card into a dedicated partial template, rewrite it to use `VoteVARReward` and `SKAVoteRewards` fields, add SCSS dark-theme overrides, and write Go template tests (example-based + property-based).

## Tasks

- [x] 1. Add `$dark-text-primary` SCSS variable
  - Open `cmd/dcrdata/public/scss/_variables.scss`
  - In the `// colors` section, add `$dark-text-primary: #fdfdfd;` following the existing naming convention
  - Do not introduce any colour literals elsewhere; all subsequent SCSS rules reference this variable
  - _Requirements: 5.1, 5.2, 5.4_

- [x] 2. Extract voting card into `home_voting.tmpl` and rewrite VAR reward block
  - [x] 2.1 Create `cmd/dcrdata/views/home_voting.tmpl`
    - Define `{{define "voting-card"}}` block
    - Bind `$page := .` and `$conv := $page.Conversions` at the top; use `{{with $page.Info}}` for the card body
    - Move the full voting card HTML (the `<div class="bg-white mb-1 py-2 px-3 mx-1">` block) verbatim from `home.tmpl` into this file as the starting point
    - _Requirements: 1.1_
  - [x] 2.2 Rewrite the Vote VAR Reward block inside `home_voting.tmpl`
    - Replace the per-block value source with `$page.Info.VoteVARReward.PerBlock` rendered via `{{template "decimalParts" (float64AsDecimalParts $page.Info.VoteVARReward.PerBlock 8 false)}}`
    - Keep `data-homepage-target="bsubsidyPos"` on the value span
    - Change the unit label to `VAR/VAR`
    - Replace the 30-day row with `{{printf "%.2f" $page.Info.VoteVARReward.Per30Days}}%` followed by `per 30 days`; keep `data-homepage-target="ticketReward"` on the span
    - Replace the annual row with `{{printf "%.2f" $page.Info.VoteVARReward.PerYear}}%` followed by `per year`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.3_
  - [x] 2.3 Update `cmd/dcrdata/views/home.tmpl`
    - Remove the voting card HTML block (bounded by `<!-- end voting card -->`)
    - Replace it with `{{template "voting-card" .}}`
    - _Requirements: 1.1_

- [x] 3. Add Vote SKA Reward subsection to `home_voting.tmpl`
  - [x] 3.1 Add the section heading and `skaVoteRewards` container
    - Immediately after the Vote VAR Reward block, add a `<div class="col-12 ...">` heading row with label `Vote SKA Reward`
    - Wrap all SKA content in `<div data-homepage-target="skaVoteRewards">`
    - _Requirements: 2.1, 2.10, 8.1_
  - [x] 3.2 Implement the `{{if}}` / `{{range}}` / `{{else}}` SKA block
    - Inside the container: `{{if $page.Info.SKAVoteRewards}}` → `{{range $page.Info.SKAVoteRewards}}` → render one `<div class="col-12 col-md-6 ... vote-ska-reward-block">` per entry
    - Each block: heading row with `{{.Symbol}}`, per-block row with `{{.PerBlock}}` + unit `{{.Symbol}}/VAR per last block`, per-30-days row with `{{.Per30Days}}` + unit `{{.Symbol}}/VAR per 30 days`, per-year row with `{{.PerYear}}` + unit `{{.Symbol}}/VAR per year`
    - Apply `text-break` to all SKA value spans
    - `{{else}}` branch: single `col-12` block with `No SKA rewards available`
    - Do NOT pass SKA strings through any numeric template helper
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.2, 3.4, 4.1, 4.3, 4.4, 4.5, 6.1, 6.3, 7.1, 7.2, 7.3_

- [x] 4. Add dark-theme SCSS overrides in `home.scss`
  - Append to `cmd/dcrdata/public/scss/home.scss`:

    ```scss
    // Vote SKA Reward subsection — dark theme overrides
    body.darkBG .vote-ska-reward-block .text-secondary {
      color: $dark-text-primary;
    }

    body.darkBG .vote-ska-reward-block {
      background-color: $inverse-bg-white;
    }
    ```

  - Verify `$inverse-bg-white` is already defined in `_variables.scss`; if not, add it following the same convention
  - No colour literals; no new Bootstrap overrides beyond what is listed
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 4.2_

- [x] 5. Checkpoint — verify template parses and SCSS lints cleanly
  - Run `cd cmd/dcrdata && go build ./internal/explorer/...` to confirm the template loader picks up `home_voting.tmpl` without parse errors
  - Run `cd cmd/dcrdata && npm run lint:css` to confirm no colour literals and all variable references resolve
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Write example-based tests in `home_voting_template_test.go`
  - [x] 6.1 Create `cmd/dcrdata/internal/explorer/home_voting_template_test.go`
    - Package `explorer_test`; import `testing`, `strings`, `golang.org/x/net/html`, and the explorer package as needed
    - Write a helper that loads only the `voting-card` template (plus its dependencies: `decimalParts`, `float64AsDecimalParts`) and renders it with a given page data struct
    - _Requirements: 7.4_
  - [x] 6.2 Implement `TestVotingCardTemplate` with 7 example-based sub-cases
    - Case 1 — Label check: assert `"Vote VAR Reward"` and `"Vote SKA Reward"` appear in output
    - Case 2 — VAR unit label: assert `"VAR/VAR"` appears in output
    - Case 3 — data-homepage-target preservation: assert `data-homepage-target="bsubsidyPos"` and `data-homepage-target="ticketReward"` appear
    - Case 4 — Empty SKA slice: assert `"No SKA rewards available"` appears; assert no `vote-ska-reward-block` divs are present
    - Case 5 — Single SKA entry: assert the symbol, all three value strings, and the unit label appear exactly once
    - Case 6 — skaVoteRewards container: assert exactly one `data-homepage-target="skaVoteRewards"` appears
    - Case 7 — Bootstrap classes: assert `col-md-6` and `text-break` appear when SKA entries are present
    - _Requirements: 1.1, 1.5, 2.2, 2.3, 2.4, 2.5, 4.4, 4.5, 7.1, 7.2, 7.3, 7.4, 8.1_

- [x] 7. Write property-based tests in `home_voting_template_test.go`
  - [x] 7.1 Write property test for Property 1 — VAR PerBlock value appears in rendered output
    - Use `rapid.Float64Range(0, 1e6)` for `VoteVARReward.PerBlock`
    - Assert the integer part of the formatted value appears in the rendered output
    - Tag: `// Feature: voting-section-frontend, Property 1: VAR PerBlock value appears in rendered output`
    - _Requirements: 1.2_
  - [x]\* 7.2 Write property test for Property 2 — VAR percentage fields formatted correctly
    - Use `rapid.Float64Range(0, 100)` for `Per30Days` and `PerYear`
    - Assert `fmt.Sprintf("%.2f", Per30Days)` + `"per 30 days"` and `fmt.Sprintf("%.2f", PerYear)` + `"per year"` appear in output
    - Tag: `// Feature: voting-section-frontend, Property 2: VAR percentage fields are formatted correctly`
    - _Requirements: 1.3, 1.4_
  - [x]\* 7.3 Write property test for Property 3 — SKA slice count and order preserved
    - Draw slice length from `rapid.IntRange(1, 10)`; derive `Symbol` as `fmt.Sprintf("SKA-%d", coinType)` from `rapid.Uint8Range(1, 255)`
    - Assert each symbol appears in output and symbols appear in input slice order
    - Tag: `// Feature: voting-section-frontend, Property 3: SKA slice count and order are preserved`
    - _Requirements: 2.2, 2.4, 7.2_
  - [x]\* 7.4 Write property test for Property 4 — SKA pre-formatted strings rendered verbatim
    - Draw value strings from `rapid.StringMatching(`\d{1,15}\.\d{18}`)`
    - Assert `PerBlock`, `Per30Days`, `PerYear` strings appear verbatim in output
    - Tag: `// Feature: voting-section-frontend, Property 4: SKA pre-formatted strings are rendered verbatim`
    - _Requirements: 2.6, 2.7, 2.8, 3.2_
  - [x]\* 7.5 Write property test for Property 5 — Rendered HTML is well-formed for all inputs
    - Generate `HomeInfo` with empty, single-entry, and multi-entry `SKAVoteRewards` (draw length from `rapid.IntRange(0, 10)`)
    - Parse rendered output with `golang.org/x/net/html`; assert no parse error
    - Tag: `// Feature: voting-section-frontend, Property 5: Rendered HTML is well-formed for all inputs`
    - _Requirements: 7.4_
  - [x]\* 7.6 Write property test for Property 6 — skaVoteRewards container present exactly once
    - For any `HomeInfo` value, assert `data-homepage-target="skaVoteRewards"` appears exactly once in rendered output
    - Tag: `// Feature: voting-section-frontend, Property 6: skaVoteRewards container is present in rendered output`
    - _Requirements: 2.10, 8.1_

- [x] 8. Final checkpoint — Ensure all tests pass
  - Run `cd cmd/dcrdata && go test ./internal/explorer/...` and confirm all new tests pass
  - Ensure all tests pass, ask the user if questions arise.
