# Implementation Plan: Sticky Height Column

## Overview

Purely frontend change across three layers: template markup, a new Stimulus controller, and SCSS rules. The controller toggles `is-scrolled` on the scroll container; SCSS drives the sticky positioning and shadow from that class.

## Tasks

- [x] 1. Add sticky-col markup to home_latest_blocks.tmpl
  - Add `data-controller="sticky-col"` and class `last-blocks-table-wrap` to the `.table-responsive` wrapper div
  - Add class `sticky-col` to the Height `<th>` and to the first `<td>` in every row type (regular block rows and SKA sub-rows)
  - _Requirements: 1.1, 1.3_

- [x] 2. Create the StickyColController Stimulus controller
  - [x] 2.1 Implement `sticky_col_controller.js`
    - New file: `cmd/dcrdata/public/js/controllers/sticky_col_controller.js`
    - Implement `connect()` — bind `_onScroll` and attach as a `scroll` listener on `this.element`
    - Implement `disconnect()` — remove the `scroll` listener to prevent memory leaks on Turbolinks navigation
    - Implement `_onScroll()` — toggle class `is-scrolled` on `this.element` based on `this.element.scrollLeft > 0`
    - Controller is auto-discovered via the existing `require.context` in `index.js` — no registration change needed
    - _Requirements: 2.1, 2.2, 2.4_

  - [ ]\* 2.2 Write unit tests for StickyColController
    - New file: `cmd/dcrdata/public/js/controllers/sticky_col_controller.test.js`
    - Test: `_onScroll()` with `scrollLeft = 1` adds `is-scrolled`
    - Test: `_onScroll()` with `scrollLeft = 0` removes `is-scrolled`
    - Test: calling `_onScroll()` twice with `scrollLeft > 0` leaves `is-scrolled` present (idempotent)
    - _Requirements: 2.1, 2.2_

  - [ ]\* 2.3 Write property test — Property 3: scroll state drives shadow class (round-trip)
    - **Property 3: Scroll state drives shadow class (round-trip)**
    - **Validates: Requirements 2.1, 2.2, 2.4**
    - Use fast-check; add as a dev dependency if not already present
    - Generate random `scrollLeft` values in [0, 2000]; assert `is-scrolled` present iff `scrollLeft > 0`
    - Generate a random sequence of scroll positions ending with 0; assert class is absent after the final event

- [x] 3. Checkpoint — Ensure controller tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add sticky positioning and shadow SCSS to home.scss
  - Add `.sticky-col` rule: `position: sticky; left: 0; z-index: 1`
  - Add `::after` pseudo-element on `.sticky-col` for the right-edge shadow (hidden by default)
  - Add `.last-blocks-table-wrap.is-scrolled .sticky-col::after` rule to activate the shadow
  - Use existing SCSS variables and Bootstrap CSS custom properties for all shadow color values — no hardcoded colors
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

  - [ ]\* 4.1 Write property test — Property 1: sticky positioning applied to all Height column cells
    - **Property 1: Sticky positioning applied to all Height column cells**
    - **Validates: Requirements 1.1, 1.3**
    - Generate a random number of block rows (1–20) and SKA sub-rows per block (0–5)
    - Render table fragment into a DOM fixture; assert every `.sticky-col` cell has `position: sticky` and `left: 0px` in computed style

- [x] 5. Add background color SCSS to home.scss (ISOLATED TASK — requires user review)
  - Add light-theme background color to `.sticky-col` using existing SCSS variables or Bootstrap CSS custom properties
  - Add `body.darkBG .sticky-col` override for dark-theme background color
  - Ensure backgrounds match surrounding row backgrounds for all row types (regular rows, SKA sub-rows, hover states)
  - No hardcoded color values — use only existing SCSS variables and Bootstrap CSS custom properties
  - _Requirements: 1.2, 3.1, 3.2, 3.3_

  - [ ]\* 5.1 Write property test — Property 2: sticky cells have an opaque background
    - **Property 2: Sticky cells have an opaque background**
    - **Validates: Requirements 1.2**
    - Using the same generated table fixtures as Property 1, assert that `getComputedStyle(cell).backgroundColor` is not `rgba(0, 0, 0, 0)` for every `.sticky-col` cell

- [x] 6. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
