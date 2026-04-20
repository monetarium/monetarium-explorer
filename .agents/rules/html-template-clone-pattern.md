---
trigger: always_on
---

# HTML `<template>` Clone Pattern for Live DOM Updates

## Why this pattern exists

We replaced ad-hoc HTML string generation in JavaScript (innerHTML concatenation,
template literals building markup) with the native `<template>` element approach.
The reasons:

- **No XSS surface** — `document.importNode` never parses untrusted strings as HTML.
- **Separation of concerns** — markup lives in the Go template (`.tmpl`), not scattered
  across JS strings. Designers can edit it without touching controllers.
- **Consistent styling** — the cloned fragment uses the same CSS classes as the
  server-rendered initial state, so light/dark themes and responsive breakpoints
  work identically on first load and after live updates.
- **Performance** — `<template>` content is parsed once by the browser and cloned
  cheaply; no repeated HTML parsing on every block event.

## How it works

### 1. Declare the template in the Go `.tmpl` file

Place a `<template id="…">` element inside the relevant card template. It is
inert on page load (not rendered, not in the live DOM tree) but available to JS
via `document.getElementById`.

```html
{{/* Template for JS live-update cloning */}}
<template id="pow-ska-reward-template">
  <div class="mono lh1rem fs14-decimal fs24 d-flex align-items-baseline">
    <div class="decimal-parts d-inline-block">
      <span class="int"></span>
      <span class="decimal"></span>
      <span class="decimal trailing-zeroes"></span>
    </div>
    <span class="ps-1 unit lh15rem">
      <span class="symbol"></span>
    </span>
  </div>
</template>
```

Provide an empty-state template when the list can be empty:

```html
<template id="pow-ska-empty-template">
  <div class="fs12 lh1rem text-black-50">No SKA rewards available</div>
</template>
```

### 2. Clone and populate in the Stimulus controller

```js
_renderPoWSkaRewards(rewards) {
  if (!this.hasPowSkaRewardsTarget) return
  const tmpl = document.getElementById('pow-ska-reward-template')
  if (!tmpl) return

  const container = this.powSkaRewardsTarget
  container.innerHTML = ''                          // clear previous live content

  if (!Array.isArray(rewards) || rewards.length === 0) {
    const emptyTmpl = document.getElementById('pow-ska-empty-template')
    if (emptyTmpl) container.appendChild(document.importNode(emptyTmpl.content, true))
    return
  }

  rewards.forEach((r) => {
    const clone = document.importNode(tmpl.content, true)  // deep clone

    // Populate named slots by CSS class / data-field attribute
    clone.querySelector('.int').textContent = r.intPart
    clone.querySelector('.decimal:not(.trailing-zeroes)').textContent = r.rest
    clone.querySelector('.trailing-zeroes').textContent = r.trailingZeros
    clone.querySelectorAll('.symbol').forEach((el) => { el.textContent = r.symbol })

    container.appendChild(clone)
  })
}
```

Key API: `document.importNode(templateEl.content, true)` — the second argument
`true` means deep clone (always use `true`).

### 3. Wire the container target in the template

The container that receives cloned rows must be a Stimulus target:

```html
<div data-mining-target="powSkaRewards">
  {{/* server-rendered initial rows go here */}} {{range
  .PoWSKARewards}}…{{end}}
</div>
```

On each new block event the controller clears `container.innerHTML` and
re-populates from the WebSocket payload, so the server-rendered rows are
replaced seamlessly.

## Existing usages in this codebase

| Template id                    | Declared in         | Consumed by              | Purpose                                      |
| ------------------------------ | ------------------- | ------------------------ | -------------------------------------------- |
| `pow-ska-reward-template`      | `home_mining.tmpl`  | `mining_controller.js`   | PoW SKA reward rows per block                |
| `pow-ska-empty-template`       | `home_mining.tmpl`  | `mining_controller.js`   | Empty state when no SKA rewards              |
| `ska-reward-block-template`    | `home_voting.tmpl`  | `voting_controller.js`   | Staking SKA reward rows per block            |
| `fill-bar-template`            | `home_mempool.tmpl` | `homepage_controller.js` | Mempool fill-bar rows per coin               |
| `home-mempool-tx-row-template` | `home_mempool.tmpl` | `homepage_controller.js` | Latest transaction rows in home mempool card |

## Rules

- **Always use `document.importNode(tmpl.content, true)`**, never `cloneNode` on
  the `<template>` element itself (that clones the inert wrapper, not the content).
- **Never build HTML strings in JS** for repeating live-updated rows. Use this
  pattern instead.
- **Template markup must use existing SCSS utility classes** — no inline styles,
  no new CSS rules unless a variable is first defined in the global variables file.
- **One `<template>` per logical row type.** If empty state differs from the
  populated state, use a separate `<template>` for the empty state (see
  `pow-ska-empty-template`).
- **Template ids are global** — use descriptive, namespaced ids
  (`<card>-<purpose>-template`) to avoid collisions across pages.
- **Server-rendered initial state and the cloned template must be visually
  identical.** Keep their markup in sync when either changes.
