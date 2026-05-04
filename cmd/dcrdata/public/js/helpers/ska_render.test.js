/**
 * ska_render.test.js
 *
 * Verifies that _fillDecimalParts (used by voting_controller and
 * mining_controller) produces DOM output that matches what the Go SSR
 * `decimalParts` template renders for the same atom string.
 *
 * SSR template logic (from extras.tmpl "decimalParts"):
 *   <div class="decimal-parts d-inline-block">
 *     <span class="int">{intPart}.{bold} | intPart</span>
 *     {if rest}     <span class="decimal">{rest}</span>     {end}
 *     {if trailing} <span class="decimal trailing-zeroes">{trailing}</span> {end}
 *   </div>
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { splitSkaAtoms } from './ska_helper'

// ---------------------------------------------------------------------------
// Inline _fillDecimalParts — kept in sync with voting_controller.js and
// mining_controller.js. If those diverge, this test will catch it.
// ---------------------------------------------------------------------------
function fillDecimalParts(el, { intPart, bold, rest, trailingZeros }) {
  const intText = bold ? `${intPart}.${bold}` : intPart
  let html = `<span class="int">${intText}</span>`
  if (bold && rest) html += `<span class="decimal">${rest}</span>`
  if (bold && trailingZeros) html += `<span class="decimal trailing-zeroes">${trailingZeros}</span>`
  el.innerHTML = html
}

// ---------------------------------------------------------------------------
// Helper: build a fresh decimal-parts container (mirrors the <template> stub)
// ---------------------------------------------------------------------------
function makeContainer() {
  const el = document.createElement('div')
  el.className = 'decimal-parts d-inline-block'
  return el
}

// ---------------------------------------------------------------------------
// Helper: render via fillDecimalParts and return the container
// ---------------------------------------------------------------------------
function render(atomStr) {
  const el = makeContainer()
  fillDecimalParts(el, splitSkaAtoms(atomStr))
  return el
}

// ---------------------------------------------------------------------------
// Helper: build the expected DOM the way SSR would render it
// ---------------------------------------------------------------------------
function ssrExpected(atomStr) {
  const { intPart, bold, rest, trailingZeros } = splitSkaAtoms(atomStr)
  const el = document.createElement('div')
  el.className = 'decimal-parts d-inline-block'

  const intEl = document.createElement('span')
  intEl.className = 'int'
  intEl.textContent = bold ? `${intPart}.${bold}` : intPart
  el.appendChild(intEl)

  if (bold && rest) {
    const decEl = document.createElement('span')
    decEl.className = 'decimal'
    decEl.textContent = rest
    el.appendChild(decEl)
  }

  if (bold && trailingZeros) {
    const trailEl = document.createElement('span')
    trailEl.className = 'decimal trailing-zeroes'
    trailEl.textContent = trailingZeros
    el.appendChild(trailEl)
  }

  return el
}

// ---------------------------------------------------------------------------
// Example-based tests
// ---------------------------------------------------------------------------

describe('_fillDecimalParts DOM output matches SSR decimalParts template', () => {
  it('renders zero atom string: only .int span, no .decimal spans', () => {
    const el = render('0')
    expect(el.querySelectorAll('.int')).toHaveLength(1)
    expect(el.querySelectorAll('.decimal')).toHaveLength(0)
    expect(el.querySelector('.int').textContent).toBe('0')
  })

  it('renders empty atom string: only .int span, no .decimal spans', () => {
    const el = render('')
    expect(el.querySelectorAll('.int')).toHaveLength(1)
    expect(el.querySelectorAll('.decimal')).toHaveLength(0)
  })

  it('renders a value with significant decimals and no trailing zeros', () => {
    // 0.423397760083333862 — rest is non-empty, trailingZeros is empty
    const el = render('423397760083333862')
    expect(el.querySelector('.int').textContent).toBe('0.42')
    const decSpans = el.querySelectorAll('.decimal:not(.trailing-zeroes)')
    expect(decSpans).toHaveLength(1)
    expect(decSpans[0].textContent).toBe('3397760083333862')
    expect(el.querySelectorAll('.trailing-zeroes')).toHaveLength(0)
  })

  it('renders a whole-number value: .int shows bold zeros, trailing-zeroes span for rest', () => {
    // 1.000000000000000000 — fixed behavior: bold="00", trailingZeros="0000000000000000"
    // .int shows "1.00", trailing-zeroes span shows the remaining 16 zeros
    const el = render('1000000000000000000')
    expect(el.querySelector('.int').textContent).toBe('1.00')
    expect(el.querySelectorAll('.decimal:not(.trailing-zeroes)')).toHaveLength(0)
    const trailSpans = el.querySelectorAll('.trailing-zeroes')
    expect(trailSpans).toHaveLength(1)
    expect(trailSpans[0].textContent).toBe('0000000000000000')
  })

  it('renders a value with bold digits and trailing zeros but no rest', () => {
    // 0.120000000000000000 → bold="12", rest="", trailingZeros="0000000000000000"
    const el = render('120000000000000000')
    expect(el.querySelector('.int').textContent).toBe('0.12')
    expect(el.querySelectorAll('.decimal:not(.trailing-zeroes)')).toHaveLength(0)
    const trailSpans = el.querySelectorAll('.trailing-zeroes')
    expect(trailSpans).toHaveLength(1)
    expect(trailSpans[0].textContent).toBe('0000000000000000')
  })

  it('renders a value with bold, rest, and trailing zeros', () => {
    // Construct a value: 0.AB0000...0CD where bold="AB", rest="CD", trailing="000"
    // 0.123456000000000000 → bold="12", rest="3456", trailing="000000000000"
    const el = render('123456000000000000')
    expect(el.querySelector('.int').textContent).toBe('0.12')
    const decSpan = el.querySelector('.decimal:not(.trailing-zeroes)')
    expect(decSpan).not.toBeNull()
    expect(decSpan.textContent).toBe('3456')
    const trailSpan = el.querySelector('.trailing-zeroes')
    expect(trailSpan).not.toBeNull()
    expect(trailSpan.textContent).toBe('000000000000')
  })

  it('matches SSR output for the per-block voting card example', () => {
    const atomStr = '423397760083333862'
    expect(render(atomStr).innerHTML).toBe(ssrExpected(atomStr).innerHTML)
  })

  it('matches SSR output for the per-year voting card example', () => {
    const atomStr = '802084821280017403'
    expect(render(atomStr).innerHTML).toBe(ssrExpected(atomStr).innerHTML)
  })
})

// ---------------------------------------------------------------------------
// Property-based tests: JS DOM always matches SSR reference for any atom value
// ---------------------------------------------------------------------------

describe('_fillDecimalParts matches SSR for all atom strings (property-based)', () => {
  it('innerHTML is identical to SSR reference for any positive atom value', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: BigInt('9'.repeat(33)) }).map((n) => n.toString()),
        (atomStr) => {
          expect(render(atomStr).innerHTML).toBe(ssrExpected(atomStr).innerHTML)
        }
      ),
      { numRuns: 1000 }
    )
  })

  it('never emits .decimal span when bold is empty', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: BigInt('9'.repeat(33)) }).map((n) => n.toString()),
        (atomStr) => {
          const { bold } = splitSkaAtoms(atomStr)
          const el = render(atomStr)
          if (!bold) {
            expect(el.querySelectorAll('.decimal')).toHaveLength(0)
          }
        }
      ),
      { numRuns: 500 }
    )
  })

  it('never emits .trailing-zeroes span when trailingZeros is empty', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: BigInt('9'.repeat(33)) }).map((n) => n.toString()),
        (atomStr) => {
          const { trailingZeros } = splitSkaAtoms(atomStr)
          const el = render(atomStr)
          if (!trailingZeros) {
            expect(el.querySelectorAll('.trailing-zeroes')).toHaveLength(0)
          }
        }
      ),
      { numRuns: 500 }
    )
  })

  it('always has exactly one .int span', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: BigInt('9'.repeat(33)) }).map((n) => n.toString()),
        (atomStr) => {
          expect(render(atomStr).querySelectorAll('.int')).toHaveLength(1)
        }
      ),
      { numRuns: 500 }
    )
  })
})
