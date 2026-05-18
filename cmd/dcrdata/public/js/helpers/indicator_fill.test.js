import * as fc from 'fast-check'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyFillBar,
  applyTotalBar,
  coinSortKey,
  computePctOfTC,
  injectFillBar,
  isOverflow,
  repositionSKAMarkers,
  zeroFillEntry
} from './indicator_fill'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// buildFillBarHTML returns markup matching what views/home_mempool.tmpl
// produces server-side, so the helpers operate on the same shape that real
// pages render. Includes both an .indicator-fill list and the
// #fill-bar-template that injectFillBar clones from.
function mountFixture() {
  document.body.innerHTML = `
    <div class="total-bar" data-homepage-target="totalBar">
      <span class="total-bar__label">TOTAL</span>
      <div class="total-bar__track">
        <div class="total-bar__fill" style="--seg-w: 0%"></div>
      </div>
      <span class="total-bar__pct">0.0%</span>
    </div>

    <div class="indicator-fill" data-homepage-target="indicatorList"></div>

    <template id="fill-bar-template">
      <div class="fill-bar" role="meter" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="0" aria-label="" data-coin="">
        <span class="fill-bar__label"></span>
        <div class="fill-bar__track" data-status="" style="--gq-pos: 0">
          <div class="gq-segment" style="--seg-w: 0%"></div>
          <div class="extra-segment" style="--seg-w: 0%"></div>
          <div class="overflow-segment overflow-hatch" style="--seg-w: 0%"></div>
          <div class="gq-marker" style="left: 0%"></div>
        </div>
        <span class="fill-bar__pct">0.0%</span>
      </div>
    </template>
  `
  return {
    list: document.querySelector('[data-homepage-target="indicatorList"]'),
    totalBar: document.querySelector('[data-homepage-target="totalBar"]')
  }
}

// segWidth reads the --seg-w CSS variable as a Number percentage.
function segWidth(el) {
  if (!el) return null
  const v = el.style.getPropertyValue('--seg-w').trim()
  return v.endsWith('%') ? parseFloat(v.slice(0, -1)) : parseFloat(v)
}

// pctText reads the percentage label as a Number.
function pctText(el) {
  return parseFloat(el.querySelector('.fill-bar__pct, .total-bar__pct').textContent)
}

// ok / borrowing / full entry builders parameterised by VAR-only, by-quota math.
// gqPos: VAR=0.10, single-SKA=0.90, etc.
function entryOk({ symbol = 'VAR', gqPos = 0.1, blockFrac = 0.05 }) {
  // size is below quota, so all goes into gq segment.
  const gqFill = blockFrac / gqPos // fraction of own quota consumed
  return {
    symbol: symbol,
    gq_fill_ratio: gqFill,
    extra_fill_ratio: 0,
    overflow_fill_ratio: 0,
    gq_position_ratio: gqPos,
    status: 'ok'
  }
}

function entryBorrowing({ symbol = 'VAR', gqPos = 0.1, blockFrac = 0.15 }) {
  // gqFill is clamped at 1.0 (own quota full); extra carries the rest.
  return {
    symbol: symbol,
    gq_fill_ratio: 1.0,
    extra_fill_ratio: blockFrac - gqPos,
    overflow_fill_ratio: 0,
    gq_position_ratio: gqPos,
    status: 'borrowing'
  }
}

function entryFull({ symbol = 'VAR', gqPos = 0.1, blockFrac = 1.1 }) {
  // gq segment full; overflow = (size - quota) / max, clamped at 1.0.
  return {
    symbol: symbol,
    gq_fill_ratio: 1.0,
    extra_fill_ratio: 0,
    overflow_fill_ratio: Math.min(blockFrac - gqPos, 1.0),
    gq_position_ratio: gqPos,
    status: 'full'
  }
}

// ---------------------------------------------------------------------------
// Pure math helpers
// ---------------------------------------------------------------------------

describe('computePctOfTC / isOverflow', () => {
  it('VAR within quota: pct equals block fraction × 100', () => {
    const e = entryOk({ blockFrac: 0.05 })
    expect(computePctOfTC(e)).toBeCloseTo(5.0, 6)
    expect(isOverflow(e)).toBe(false)
  })

  it('VAR borrowing past quota: pct equals total block fraction × 100 (no clipping at 10)', () => {
    const e = entryBorrowing({ blockFrac: 0.15 })
    // Buggy old impl returned 10.0 here. The fix is that pct == 15.0.
    expect(computePctOfTC(e)).toBeCloseTo(15.0, 6)
    expect(isOverflow(e)).toBe(false)
  })

  it('VAR full and overflowing: pct reports actual % above 100, IsOverflow true', () => {
    // PO: indicators must surface the true magnitude, not clamp.
    const e = entryFull({ blockFrac: 1.1 })
    expect(computePctOfTC(e)).toBeCloseTo(110.0, 6)
    expect(isOverflow(e)).toBe(true)
  })

  it('handles missing/non-numeric ratios as 0', () => {
    expect(computePctOfTC(null)).toBe(0)
    expect(computePctOfTC({})).toBe(0)
    expect(
      computePctOfTC({
        gq_fill_ratio: 'oops',
        gq_position_ratio: NaN,
        extra_fill_ratio: undefined,
        overflow_fill_ratio: Infinity
      })
    ).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// applyFillBar
// ---------------------------------------------------------------------------

describe('applyFillBar', () => {
  let bar
  beforeEach(() => {
    mountFixture()
    bar = injectFillBar(document.querySelector('.indicator-fill'), entryOk({ blockFrac: 0.0 }))
  })

  it('writes gq segment width as gqFill × gqPos × 100', () => {
    applyFillBar(bar, entryOk({ blockFrac: 0.05 }))
    expect(segWidth(bar.querySelector('.gq-segment'))).toBeCloseTo(5.0, 4)
    expect(bar.querySelector('.extra-segment').hidden).toBe(true)
    expect(bar.querySelector('.overflow-segment').hidden).toBe(true)
  })

  it('writes extra segment width when borrowing, hides overflow', () => {
    applyFillBar(bar, entryBorrowing({ blockFrac: 0.15 }))
    expect(segWidth(bar.querySelector('.gq-segment'))).toBeCloseTo(10.0, 4)
    expect(segWidth(bar.querySelector('.extra-segment'))).toBeCloseTo(5.0, 4)
    expect(bar.querySelector('.extra-segment').hidden).toBe(false)
    expect(bar.querySelector('.overflow-segment').hidden).toBe(true)
  })

  it('writes overflow segment width when full, sets data-overflow', () => {
    applyFillBar(bar, entryFull({ blockFrac: 1.1 }))
    expect(segWidth(bar.querySelector('.overflow-segment'))).toBeCloseTo(100.0, 4)
    expect(bar.querySelector('.extra-segment').hidden).toBe(true)
    expect(bar.querySelector('.overflow-segment').hidden).toBe(false)
    expect(bar.dataset.overflow).toBe('true')
  })

  it('clears data-overflow when the bar fits in TC', () => {
    bar.setAttribute('data-overflow', 'true')
    applyFillBar(bar, entryOk({ blockFrac: 0.05 }))
    expect(bar.hasAttribute('data-overflow')).toBe(false)
  })

  it('updates aria-valuenow to round(pctOfTC) and aria-label includes status', () => {
    applyFillBar(bar, entryBorrowing({ blockFrac: 0.15 }))
    expect(bar.getAttribute('aria-valuenow')).toBe('15')
    expect(bar.getAttribute('aria-label')).toBe('VAR — borrowing')
  })

  it('writes pct text matching computePctOfTC at 1 decimal', () => {
    applyFillBar(bar, entryBorrowing({ blockFrac: 0.15 }))
    expect(pctText(bar)).toBeCloseTo(15.0, 4)
  })
})

// ---------------------------------------------------------------------------
// applyTotalBar
// ---------------------------------------------------------------------------

describe('applyTotalBar', () => {
  let totalBar
  beforeEach(() => {
    ;({ totalBar } = mountFixture())
  })

  it('clamps bar width to 100 but shows true % text when total > 1.0', () => {
    applyTotalBar(totalBar, 1.1)
    expect(segWidth(totalBar.querySelector('.total-bar__fill'))).toBeCloseTo(100.0, 4)
    expect(pctText(totalBar)).toBeCloseTo(110.0, 4)
    expect(totalBar.dataset.overflow).toBe('true')
  })

  it('sets data-empty on TOTAL bar when totalFillRatio is exactly 0', () => {
    applyTotalBar(totalBar, 0)
    expect(totalBar.dataset.empty).toBe('true')
    expect(pctText(totalBar)).toBe(0)
  })

  it('clears data-empty as soon as TOTAL has any fill', () => {
    applyTotalBar(totalBar, 0)
    applyTotalBar(totalBar, 0.001)
    expect(totalBar.hasAttribute('data-empty')).toBe(false)
  })

  it('clears data-overflow when total ≤ 1.0', () => {
    totalBar.setAttribute('data-overflow', 'true')
    applyTotalBar(totalBar, 0.5)
    expect(totalBar.hasAttribute('data-overflow')).toBe(false)
  })

  it('ignores non-finite values', () => {
    const before = totalBar.outerHTML
    applyTotalBar(totalBar, NaN)
    applyTotalBar(totalBar, Infinity)
    applyTotalBar(totalBar, undefined)
    expect(totalBar.outerHTML).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// Bug regression: TOTAL == VAR when no SKA active
// ---------------------------------------------------------------------------

describe('regression: no SKA, VAR pct matches TOTAL pct at every fill level', () => {
  it.each([
    { blockFrac: 0.05, label: '5% (within quota)' },
    { blockFrac: 0.1, label: '10% (at quota)' },
    { blockFrac: 0.15, label: '15% (borrowing — was the bug)' },
    { blockFrac: 0.5, label: '50% (deep borrowing)' },
    { blockFrac: 0.99, label: '99% (just under full)' }
  ])('$label: TOTAL pct text == VAR pct text', ({ blockFrac }) => {
    const { list, totalBar } = mountFixture()
    const bar = injectFillBar(list, entryOk({ blockFrac: 0.0 }))

    const entry = blockFrac <= 0.1 ? entryOk({ blockFrac }) : entryBorrowing({ blockFrac })

    applyFillBar(bar, entry)
    applyTotalBar(totalBar, blockFrac)

    expect(pctText(bar)).toBeCloseTo(pctText(totalBar), 4)
  })

  it('VAR full at 110%: both bars surface true 110% text with overflow attribute', () => {
    const { list, totalBar } = mountFixture()
    const bar = injectFillBar(list, entryOk({ blockFrac: 0.0 }))

    applyFillBar(bar, entryFull({ blockFrac: 1.1 }))
    applyTotalBar(totalBar, 1.1)

    expect(pctText(bar)).toBeCloseTo(110.0, 4)
    expect(pctText(totalBar)).toBeCloseTo(110.0, 4)
    expect(bar.dataset.overflow).toBe('true')
    expect(totalBar.dataset.overflow).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// injectFillBar / coinSortKey
// ---------------------------------------------------------------------------

describe('injectFillBar', () => {
  it('inserts VAR before any SKA', () => {
    const { list } = mountFixture()
    injectFillBar(list, entryOk({ symbol: 'SKA1', gqPos: 0.45, blockFrac: 0.1 }))
    injectFillBar(list, entryOk({ symbol: 'VAR', blockFrac: 0.05 }))
    const order = Array.from(list.querySelectorAll('[data-coin]')).map((el) => el.dataset.coin)
    expect(order).toEqual(['VAR', 'SKA1'])
  })

  it('inserts SKAs in ascending numeric order', () => {
    const { list } = mountFixture()
    injectFillBar(list, entryOk({ symbol: 'SKA3', gqPos: 0.3, blockFrac: 0.0 }))
    injectFillBar(list, entryOk({ symbol: 'SKA1', gqPos: 0.3, blockFrac: 0.0 }))
    injectFillBar(list, entryOk({ symbol: 'SKA10', gqPos: 0.3, blockFrac: 0.0 }))
    injectFillBar(list, entryOk({ symbol: 'SKA2', gqPos: 0.3, blockFrac: 0.0 }))
    const order = Array.from(list.querySelectorAll('[data-coin]')).map((el) => el.dataset.coin)
    expect(order).toEqual(['SKA1', 'SKA2', 'SKA3', 'SKA10'])
  })

  it('returns null when the template is missing', () => {
    document.body.innerHTML = '<div class="indicator-fill"></div>'
    const list = document.querySelector('.indicator-fill')
    expect(injectFillBar(list, entryOk({}))).toBe(null)
  })
})

describe('coinSortKey', () => {
  it('VAR sorts first', () => {
    expect(coinSortKey('VAR')).toBe(0)
  })
  it('SKAn returns n', () => {
    expect(coinSortKey('SKA1')).toBe(1)
    expect(coinSortKey('SKA255')).toBe(255)
  })
  it('unknown symbols sort last', () => {
    expect(coinSortKey('XYZ')).toBe(Number.MAX_SAFE_INTEGER)
    expect(coinSortKey('')).toBe(0) // empty treated like VAR (defensive)
  })
})

// ---------------------------------------------------------------------------
// repositionSKAMarkers
// ---------------------------------------------------------------------------

describe('repositionSKAMarkers', () => {
  it('repositions SKA bars to 0.9 / activeSKACount; leaves VAR alone', () => {
    const { list } = mountFixture()
    injectFillBar(list, entryOk({ symbol: 'VAR', blockFrac: 0.0 }))
    injectFillBar(list, entryOk({ symbol: 'SKA1', gqPos: 0.9, blockFrac: 0.0 }))
    injectFillBar(list, entryOk({ symbol: 'SKA2', gqPos: 0.9, blockFrac: 0.0 }))

    repositionSKAMarkers(list, 2)

    const ska1 = list.querySelector('[data-coin="SKA1"]')
    const ska2 = list.querySelector('[data-coin="SKA2"]')
    const varBar = list.querySelector('[data-coin="VAR"]')

    expect(
      parseFloat(ska1.querySelector('.fill-bar__track').style.getPropertyValue('--gq-pos'))
    ).toBeCloseTo(0.45, 4)
    expect(
      parseFloat(ska2.querySelector('.fill-bar__track').style.getPropertyValue('--gq-pos'))
    ).toBeCloseTo(0.45, 4)
    expect(
      parseFloat(varBar.querySelector('.fill-bar__track').style.getPropertyValue('--gq-pos'))
    ).toBeCloseTo(0.1, 4)
  })

  it('is a no-op for non-positive count', () => {
    const { list } = mountFixture()
    const bar = injectFillBar(list, entryOk({ symbol: 'SKA1', gqPos: 0.9, blockFrac: 0.0 }))
    const before = bar.outerHTML
    repositionSKAMarkers(list, 0)
    repositionSKAMarkers(list, -1)
    repositionSKAMarkers(list, NaN)
    expect(bar.outerHTML).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// zeroFillEntry
// ---------------------------------------------------------------------------

describe('zeroFillEntry', () => {
  it('produces an empty entry that hides all segments and clears overflow', () => {
    const { list } = mountFixture()
    const bar = injectFillBar(list, entryFull({ blockFrac: 1.1 }))
    expect(bar.dataset.overflow).toBe('true')

    applyFillBar(bar, zeroFillEntry('VAR'))

    expect(bar.querySelector('.gq-segment').hidden).toBe(true)
    expect(bar.querySelector('.extra-segment').hidden).toBe(true)
    expect(bar.querySelector('.overflow-segment').hidden).toBe(true)
    expect(bar.hasAttribute('data-overflow')).toBe(false)
    expect(pctText(bar)).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe('property: aria-valuenow == round(computePctOfTC(entry))', () => {
  it('holds for any plausible entry shape', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('VAR', 'SKA1', 'SKA2', 'SKA17'),
        fc.float({ min: Math.fround(0.0), max: Math.fround(1.0), noNaN: true }),
        fc.float({ min: Math.fround(0.05), max: Math.fround(0.9), noNaN: true }),
        fc.float({ min: Math.fround(0.0), max: Math.fround(1.0), noNaN: true }),
        fc.float({ min: Math.fround(0.0), max: Math.fround(1.0), noNaN: true }),
        fc.constantFrom('ok', 'borrowing', 'full'),
        (symbol, gqFill, gqPos, extra, overflow, status) => {
          const entry = {
            symbol: symbol,
            gq_fill_ratio: gqFill,
            gq_position_ratio: gqPos,
            extra_fill_ratio: status === 'borrowing' ? extra : 0,
            overflow_fill_ratio: status === 'full' ? overflow : 0,
            status: status
          }
          const { list } = mountFixture()
          const bar = injectFillBar(list, entry)
          const pct = computePctOfTC(entry)
          expect(parseInt(bar.getAttribute('aria-valuenow'), 10)).toBe(Math.round(pct))
          // pct text matches computePctOfTC at 1-decimal precision (may be >100 when overflow).
          const labelPct = pctText(bar)
          expect(labelPct).toBeCloseTo(parseFloat(pct.toFixed(1)), 4)
          expect(labelPct).toBeGreaterThanOrEqual(0)
        }
      ),
      { numRuns: 100 }
    )
  })
})

describe('property: no SKA → VAR pct text equals TOTAL pct text', () => {
  it('holds for VAR fractions in [0, 1]', () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(0.0), max: Math.fround(1.0), noNaN: true }),
        (blockFrac) => {
          const { list, totalBar } = mountFixture()
          const bar = injectFillBar(list, entryOk({ blockFrac: 0.0 }))

          const entry = blockFrac <= 0.1 ? entryOk({ blockFrac }) : entryBorrowing({ blockFrac })

          applyFillBar(bar, entry)
          applyTotalBar(totalBar, blockFrac)

          expect(pctText(bar)).toBeCloseTo(pctText(totalBar), 3)
        }
      ),
      { numRuns: 100 }
    )
  })
})
