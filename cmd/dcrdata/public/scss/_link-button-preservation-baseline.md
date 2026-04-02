# `.link-button` Preservation Baseline

**Purpose:** Documents the styles that MUST be preserved after the dark-mode fix.
These checks were performed on the UNFIXED code in `typography.scss`.

**Source file:** `cmd/dcrdata/public/scss/typography.scss`
**Observed at:** `.link-button { … }` block (lines ~213–260)

---

## Property 2: Preservation — Button Reset Styles Unchanged

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

### Reset styles (must remain unchanged after fix)

| Check              | Present? | Exact SCSS value observed |
| ------------------ | -------- | ------------------------- |
| `background: none` | ✅ PASS  | `background: none;`       |
| `border: none`     | ✅ PASS  | `border: none;`           |
| `padding: 0`       | ✅ PASS  | `padding: 0;`             |
| `margin: 0`        | ✅ PASS  | `margin: 0;`              |
| `display: inline`  | ✅ PASS  | `display: inline;`        |

### Font/display inheritance (must remain unchanged after fix)

| Check                  | Present? | Exact SCSS value observed |
| ---------------------- | -------- | ------------------------- |
| `font: inherit`        | ✅ PASS  | `font: inherit;`          |
| `line-height: inherit` | ✅ PASS  | `line-height: inherit;`   |

### State rules (must remain structurally unchanged after fix)

| Check                              | Present? | Exact SCSS value observed                                                             |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `:focus-visible` — box-shadow rule | ✅ PASS  | `box-shadow: var(--bs-focus-ring-x, 0 0 0 0.25rem rgb(var(--bs-primary-rgb) / 25%));` |
| `:disabled` — pointer-events: none | ✅ PASS  | `pointer-events: none;`                                                               |

---

## Summary

All 9 checks PASS on unfixed code. This is the expected outcome — these are the baseline
styles that the fix must not disturb.

After the fix is applied (Task 3), Task 3.4 re-runs these same checks to confirm no
regressions were introduced.

---

## Full `.link-button` block (unfixed, for reference)

```scss
.link-button {
  // Reset button styles
  background: none;
  border: none;
  padding: 0;
  margin: 0;

  // Typography (same as Bootstrap links)
  font: inherit;
  line-height: inherit;

  // Link appearance  ← BUG: these two lines will be replaced by the fix
  color: var(--bs-link-color);
  text-decoration: var(--bs-link-decoration);
  cursor: pointer;

  // Remove default button quirks
  display: inline;

  &:hover {
    color: var(--bs-link-hover-color); // ← BUG: will become var(--bs-primary)
    text-decoration: var(--bs-link-hover-decoration);
  }

  &:focus {
    outline: 0;
    text-decoration: var(--bs-link-hover-decoration);
  }

  &:focus-visible {
    outline: 0;
    box-shadow: var(
      --bs-focus-ring-x,
      0 0 0 0.25rem rgb(var(--bs-primary-rgb) / 25%)
    );
    border-radius: 0.25rem;
  }

  &:active {
    color: var(--bs-link-hover-color); // ← BUG: will become var(--bs-primary)
  }

  &:disabled {
    color: var(--bs-link-disabled-color, #6c757d);
    pointer-events: none;
    cursor: default;
    text-decoration: none;
  }
}
```

### `themes.scss` — dark-mode check

| Check                           | Present?  | Notes                                                                                                                                                                                                     |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body.darkBG .link-button` rule | ❌ ABSENT | Confirmed — no `.link-button` override in `body.darkBG {}` block. This is the third bug symptom (Task 1). The fix will add `body.darkBG .link-button:hover, body.darkBG .link-button:active` in Task 3.2. |
