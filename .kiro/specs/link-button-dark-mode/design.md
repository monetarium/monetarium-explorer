# link-button-dark-mode Bugfix Design

## Overview

The `.link-button` class in `cmd/dcrdata/public/scss/typography.scss` is meant to style a
`<button>` as an inline, text-like interactive element — not as a hyperlink. The current
implementation incorrectly borrows Bootstrap's link color variables (`--bs-link-color`,
`--bs-link-hover-color`), making the element visually indistinguishable from an `<a>` tag and
breaking dark-mode appearance because `body.darkBG` only overrides `a` elements.

The fix replaces all link-variable references with:

- `inherit` for at-rest text color (body text, not link blue)
- `--bs-primary` for light-mode hover text color
- A `body.darkBG .link-button:hover` override using `$dark-link-hover-color` for dark-mode hover
- `border-bottom: 1px dotted` with semi-transparent `currentColor` at rest (replaces `text-decoration`)
- `border-bottom` switching to `solid` + full-opacity `currentColor` on hover

No hardcoded color literals are introduced anywhere in the SCSS.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a `.link-button` element is rendered
  using Bootstrap link color variables instead of inheriting body text color
- **Property (P)**: The desired behavior — at rest the text color is inherited; on hover it uses the
  theme-aware primary color; the underline is a dotted `border-bottom` using `currentColor`
- **Preservation**: Existing button-reset styles (no background, border, padding), focus/active/
  disabled states, and font/display inheritance that must remain unchanged by the fix
- **`$dark-link-hover-color`**: SCSS variable defined in `themes.scss`; the primary link color for
  `body.darkBG` contexts (e.g. `#94ffca`)
- **`--bs-primary`**: Bootstrap 5 CSS custom property resolving to the primary brand color in light
  mode; used as the hover text color for `.link-button` in light mode
- **`currentColor`**: CSS keyword that inherits the element's current `color` value; used for all
  underline color values so no explicit color literal is needed

## Bug Details

### Bug Condition

The bug manifests whenever an element carries the `.link-button` class. The class sets `color` to
`var(--bs-link-color)` and on hover to `var(--bs-link-hover-color)`. Because `body.darkBG` only
overrides `a` elements (not arbitrary classes), these Bootstrap variables never resolve to the dark
theme's primary color, so the element looks wrong in dark mode and always looks like a hyperlink
regardless of theme.

**Formal Specification:**

```
FUNCTION isBugCondition(element)
  INPUT: element — a DOM element
  OUTPUT: boolean

  RETURN element.classList.contains('link-button')
         AND computedStyle(element).color == resolve('--bs-link-color')
         AND computedStyle(element).textDecoration != 'none'  // uses link decoration, not border-bottom
END FUNCTION
```

### Examples

- Light mode, at rest: `.link-button` text renders in Bootstrap's blue link color instead of the
  surrounding body text color
- Light mode, hover: text changes to `--bs-link-hover-color` (darker blue) instead of `--bs-primary`
  with a dotted→solid border-bottom transition
- Dark mode, at rest: text still renders in the light-mode link blue because `body.darkBG` has no
  `.link-button` override
- Dark mode, hover: hover color is the light-mode hover blue, not `$dark-link-hover-color`
- Edge case — nested inside colored text: because `color` is hardcoded to a CSS var rather than
  `inherit`, the element ignores the parent's text color entirely

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- The button must continue to render without a visible background, non-bottom border, or padding
  (reset styles from requirements 3.1)
- Focus ring (`:focus-visible` box-shadow), `:active` color, and `:disabled` styles must remain
  exactly as currently defined (requirement 3.2)
- `font: inherit`, `line-height: inherit`, and `display: inline` must continue to apply (requirement 3.3)
- The dotted underline color must update automatically on theme switch without a page reload,
  because it uses `currentColor` (requirement 3.4)
- The hover text color must update automatically on theme switch without a page reload, because it
  uses a CSS custom property (requirement 3.5)

**Scope:**
All inputs that do NOT involve the `.link-button` class are completely unaffected by this fix. This
includes:

- All `<a>` element styles (unchanged in both `typography.scss` and `themes.scss`)
- All other typography classes (`.hash`, `.elidedhash`, `.unstyled-link`, etc.)
- All Bootstrap utility classes and variables

## Hypothesized Root Cause

1. **Wrong color source**: `color: var(--bs-link-color)` was copied from Bootstrap's link styles.
   Bootstrap's `body.darkBG` override targets `a` elements only, so `.link-button` never picks up
   the dark-mode primary color.

2. **Wrong underline mechanism**: `text-decoration: var(--bs-link-decoration)` is used instead of
   `border-bottom`. This prevents the dotted/solid transition and ties the underline color to the
   link color variable rather than `currentColor`.

3. **No dark-mode selector**: There is no `body.darkBG .link-button` rule in `themes.scss`, so the
   dark theme has no way to override the hover color.

4. **Bootstrap variable scope**: `--bs-link-color` and `--bs-link-hover-color` are set on `:root`
   and are not re-declared under `body.darkBG`, confirming they will always resolve to light-mode
   values in this project's theming approach.

## Correctness Properties

Property 1: Bug Condition - At-Rest Color Inheritance

_For any_ element with the `.link-button` class, the fixed styles SHALL set `color` to `inherit`
so the rendered text color equals the surrounding body text color, not a Bootstrap link color
variable, in both light and dark mode.

**Validates: Requirements 2.1, 2.7**

Property 2: Preservation - Button Reset Styles Unchanged

_For any_ element with the `.link-button` class, the fixed styles SHALL continue to apply
`background: none`, `border: none` (for non-bottom borders), `padding: 0`, `margin: 0`, and
`display: inline`, preserving all button-reset behavior that existed before the fix.

**Validates: Requirements 3.1, 3.2, 3.3**

## Fix Implementation

### Changes Required

**File**: `cmd/dcrdata/public/scss/typography.scss`

**Selector**: `.link-button`

**Specific Changes**:

1. **Remove link color variables**: Replace `color: var(--bs-link-color)` with `color: inherit`
   so the element inherits body text color from its parent.

2. **Replace text-decoration with border-bottom**: Remove `text-decoration: var(--bs-link-decoration)`
   and add `border-bottom: 1px dotted rgba(currentColor, 0.5)` (or `color-mix` equivalent) at rest.
   Set `text-decoration: none` explicitly to suppress any inherited underline.

3. **Update hover styles**: In `&:hover`, replace `color: var(--bs-link-hover-color)` with
   `color: var(--bs-primary)` and change `border-bottom` to `1px solid currentColor`.
   Ensure `cursor: pointer` is present.

4. **Update active state**: In `&:active`, replace `color: var(--bs-link-hover-color)` with
   `color: var(--bs-primary)` to match hover.

5. **Update focus state**: In `&:focus`, replace `text-decoration: var(--bs-link-hover-decoration)`
   with `border-bottom: 1px solid currentColor` to stay consistent with the new underline approach.

**File**: `cmd/dcrdata/public/scss/themes.scss` (or end of `typography.scss` inside `body.darkBG`)

**Specific Changes**:

6. **Add dark-mode hover override**: Add a `body.darkBG .link-button:hover` (and `:active`) rule
   that sets `color: $dark-link-hover-color`, overriding `--bs-primary` for dark contexts.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate
the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or
refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Render a `.link-button` element in both light and dark mode contexts and assert that
the computed `color` equals the body text color (not a link color). Run these checks on the UNFIXED
code to observe failures and confirm the root cause.

**Test Cases**:

1. **Light mode at-rest color**: Assert `computedStyle('.link-button').color == bodyTextColor`
   (will fail on unfixed code — resolves to `--bs-link-color` blue instead)
2. **Dark mode at-rest color**: Assert color equals dark body text (`#fdfdfd`) not link blue
   (will fail on unfixed code)
3. **Light mode hover color**: Assert hover color equals `--bs-primary`, not `--bs-link-hover-color`
   (will fail on unfixed code)
4. **Dark mode hover color**: Assert hover color equals `$dark-link-hover-color`
   (will fail on unfixed code — no `body.darkBG .link-button` rule exists)
5. **Underline mechanism**: Assert `border-bottom-style` is `dotted` at rest and `solid` on hover;
   assert `text-decoration` is `none` (will fail on unfixed code)

**Expected Counterexamples**:

- Computed color is Bootstrap's link blue (`#2e75ff` or similar) instead of body text color
- Possible causes: `color: var(--bs-link-color)` not overridden by `body.darkBG`, no `.link-button`
  rule in dark theme, `text-decoration` used instead of `border-bottom`

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed styles produce the
expected behavior.

**Pseudocode:**

```
FOR ALL element WHERE isBugCondition(element) DO
  result := computedStyle(element_with_fixed_css)
  ASSERT result.color == inheritedBodyTextColor
  ASSERT result.borderBottomStyle == 'dotted'
  ASSERT result.borderBottomColor is semi-transparent currentColor
  ASSERT result.textDecoration == 'none'
END FOR

FOR ALL element WHERE isBugCondition(element) AND isHovered(element) DO
  result := computedStyle(element_with_fixed_css)
  ASSERT result.color == resolvedPrimaryColor(currentTheme)
  ASSERT result.borderBottomStyle == 'solid'
  ASSERT result.cursor == 'pointer'
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed styles produce
the same result as the original styles.

**Pseudocode:**

```
FOR ALL element WHERE NOT isBugCondition(element) DO
  ASSERT originalStyles(element) == fixedStyles(element)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:

- It generates many element/theme combinations automatically
- It catches edge cases (nested color contexts, mixed states) that manual tests might miss
- It provides strong guarantees that reset styles are unchanged across all configurations

**Test Plan**: Observe button-reset styles on UNFIXED code first, then write property-based tests
capturing that behavior.

**Test Cases**:

1. **Reset styles preservation**: Verify `background`, `border` (non-bottom), `padding`, `margin`
   are unchanged after fix across many element configurations
2. **Focus state preservation**: Verify `:focus-visible` box-shadow and `:disabled` pointer-events
   are unchanged
3. **Font/display preservation**: Verify `font: inherit`, `line-height: inherit`, `display: inline`
   are unchanged

### Unit Tests

- Test at-rest color is `inherit` (not a link variable) in light mode
- Test at-rest color is `inherit` in dark mode (`body.darkBG` context)
- Test hover color resolves to `--bs-primary` in light mode
- Test hover color resolves to `$dark-link-hover-color` in dark mode
- Test `border-bottom-style` is `dotted` at rest and `solid` on hover
- Test `text-decoration` is `none`
- Test edge case: no buttons present / element not in DOM

### Property-Based Tests

- Generate random theme contexts (light/dark) and assert at-rest color always equals inherited body
  text color, never a hardcoded link color
- Generate random parent text colors and assert `border-bottom-color` tracks `currentColor`
  (semi-transparent at rest, full opacity on hover)
- Generate random element states (rest, hover, focus, active, disabled) and assert button-reset
  properties (`background`, `padding`, `border` non-bottom) are always `none`/`0`

### Integration Tests

- Full page render in light mode: `.link-button` blends with surrounding text at rest, shifts to
  primary color on hover with solid underline
- Full page render in dark mode: `.link-button` blends with dark body text at rest, shifts to
  `$dark-link-hover-color` on hover
- Theme toggle (light → dark → light): verify hover color updates without page reload
- Verify no visual regression on `<a>` elements, `.unstyled-link`, and `.elidedhash` after the fix
