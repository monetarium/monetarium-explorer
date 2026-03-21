# `.link-button` Bug Condition Exploration

Static analysis of UNFIXED code in `typography.scss` and `themes.scss`.
All checks below are run against the current (unfixed) source.

---

## Check 1: Does `.link-button` use `color: var(--bs-link-color)` instead of `inherit`?

**Source** (`typography.scss`, `.link-button` block):

```scss
color: var(--bs-link-color);
```

**Result: YES — bug confirmed.**
The at-rest text color is hardcoded to Bootstrap's link color variable instead of `inherit`.
This makes the element visually identical to an `<a>` tag in light mode and breaks dark mode
because `body.darkBG` only overrides `a` elements, not arbitrary classes.

---

## Check 2: Does `.link-button` use `text-decoration: var(--bs-link-decoration)` instead of `border-bottom`?

**Source** (`typography.scss`, `.link-button` block):

```scss
text-decoration: var(--bs-link-decoration);
```

**Result: YES — bug confirmed.**
`text-decoration` is used instead of `border-bottom: 1px dotted`. This prevents the
dotted→solid underline transition and ties the underline color to the link color variable
rather than `currentColor`.

---

## Check 3: Does `body.darkBG` have NO `.link-button` rule?

**Source** (`themes.scss`, `body.darkBG` block):
Searched entire `body.darkBG { }` block — no `.link-button` selector present.

**Result: YES — bug confirmed.**
There is no `body.darkBG .link-button` rule anywhere in `themes.scss`. The dark theme
overrides `a` and `a:hover` with `$dark-link-hover-color`, but `.link-button` is never
targeted, so it always resolves to the light-mode Bootstrap link color variables.

---

## Check 4: Does `.link-button:hover` use `color: var(--bs-link-hover-color)` instead of `var(--bs-primary)`?

**Source** (`typography.scss`, `.link-button &:hover` block):

```scss
&:hover {
  color: var(--bs-link-hover-color);
  text-decoration: var(--bs-link-hover-decoration);
}
```

**Result: YES — bug confirmed.**
Hover color uses `--bs-link-hover-color` (Bootstrap's darker link blue) instead of
`--bs-primary` (the theme-aware primary brand color). Additionally, `text-decoration` is
used on hover instead of `border-bottom: 1px solid currentColor`.

---

## Counterexamples (all confirmed present in unfixed code)

| Scenario            | Expected                     | Actual (bug)                                                                       |
| ------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| Light mode, at rest | Inherited body text color    | `--bs-link-color` (Bootstrap blue)                                                 |
| Dark mode, at rest  | Dark body text (`#fdfdfd`)   | Still `--bs-link-color` (light-mode blue) — no `body.darkBG .link-button` override |
| Hover (any mode)    | `--bs-primary` (theme-aware) | `--bs-link-hover-color` (Bootstrap hover blue)                                     |
| Underline (at rest) | `border-bottom: 1px dotted`  | `text-decoration: var(--bs-link-decoration)`                                       |

---

## Summary

All 4 bug conditions are confirmed present in the unfixed code:

- **C1** `color: var(--bs-link-color)` — should be `inherit`
- **C2** `text-decoration: var(--bs-link-decoration)` — should be `border-bottom: 1px dotted`
- **C3** No `body.darkBG .link-button` rule in `themes.scss`
- **C4** `&:hover { color: var(--bs-link-hover-color) }` — should be `var(--bs-primary)`

**Validates: Requirements 1.1, 1.2, 1.3, 1.4**

This exploration document is the SUCCESS case — all 4 checks confirm the bug exists and
the root cause analysis in `design.md` is correct. The fix can now proceed.
