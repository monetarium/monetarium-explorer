# Bugfix Requirements Document

## Introduction

The `.link-button` CSS class in `cmd/dcrdata/public/scss/typography.scss` styles a `<button>` element as a clickable inline element. Its intended appearance is distinct from a regular hyperlink (`<a>` tag): the text color should remain the default body text color (inherited from context), and the only interactive affordance is a dotted underline (subtle at rest, more vibrant on hover) plus a pointer cursor on hover. Currently the class incorrectly uses Bootstrap link color variables (`--bs-link-color`, `--bs-link-hover-color`), making it look and behave like a standard anchor tag. The dotted underline color must be theme-aware without referencing any specific CSS custom property — it should use `currentColor` (inheriting the text color from the parent element), making it naturally adapt to both light and dark mode. No hardcoded color values may be introduced in the SCSS.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an element has the `.link-button` class THEN the system renders its text in `--bs-link-color`, making it appear identical to a hyperlink instead of using the default body text color

1.2 WHEN a `.link-button` element is hovered THEN the system changes the text color to `--bs-link-hover-color`, further reinforcing the hyperlink appearance

1.3 WHEN an element has the `.link-button` class THEN the system applies `text-decoration: var(--bs-link-decoration)` (solid underline or none) instead of a dotted underline

1.4 WHEN an element has the `.link-button` class in dark mode THEN the system uses the light-mode primary color for any underline styling, ignoring the dark-mode primary color

### Expected Behavior (Correct)

2.1 WHEN an element has the `.link-button` class THEN the system SHALL render its text in the default body text color (inherited from context), with no link-color variables applied

2.2 WHEN a `.link-button` element is hovered THEN the system SHALL change the text color to the theme-aware primary color using an existing CSS custom property (e.g. `--bs-primary`), providing a stronger visual affordance on low-resolution screens

2.3 WHEN an element has the `.link-button` class THEN the system SHALL render a dotted underline via `border-bottom: 1px dotted` using a semi-transparent version of `currentColor` (e.g. via `rgba` or `color-mix`) at rest, inheriting the text color from the parent element

2.4 WHEN a `.link-button` element is hovered THEN the system SHALL change the `border-bottom` style from `dotted` to `solid` and set the border color to full opaque `currentColor`, making the underline more prominent

2.5 WHEN a `.link-button` element is hovered THEN the system SHALL display a pointer cursor

2.6 WHEN implementing the `.link-button` styles THEN the implementation SHALL use only `currentColor` or semi-transparent variants of `currentColor` for all underline color values — no hardcoded color literals (e.g. hex values like `#94ffca`) and no specific CSS custom properties for underline color may appear in the SCSS

2.7 WHEN a `.link-button` element is hovered THEN the system SHALL use an existing theme-aware CSS custom property (not a hardcoded value) for the hover text color, so the color adapts correctly in both light and dark mode

### Unchanged Behavior (Regression Prevention)

3.1 WHEN an element has the `.link-button` class in any mode THEN the system SHALL CONTINUE TO render it without a visible button border, background, or padding (i.e. the reset styles are preserved)

3.2 WHEN an element has the `.link-button` class in any mode THEN the system SHALL CONTINUE TO apply focus, active, and disabled states as currently defined

3.3 WHEN an element has the `.link-button` class THEN the system SHALL CONTINUE TO inherit font, line-height, and display properties from its context

3.4 WHEN the theme switches between light and dark mode THEN the system SHALL CONTINUE TO apply the correct underline color to the dotted underline without requiring a page reload, by virtue of `currentColor` inheriting from the parent's text color

3.5 WHEN the theme switches between light and dark mode THEN the system SHALL CONTINUE TO apply the correct primary color to the hover text color without requiring a page reload, by virtue of the theme-aware CSS custom property resolving to the appropriate value
