/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { renderCoinType, splitSkaAtomsNoTrailing } from '../helpers/ska_helper'

// Mirror of skaAmountHTML and txFeeRateHTML from mempool_controller.js. Kept in
// sync with the controller; the test guards the rendered Fee Rate cell shape
// for both VAR and SKA mempool rows. If the controller diverges, update both.
function skaAmountHTML(atomStr) {
  const { intPart, bold, rest, trailingZeros } = splitSkaAtomsNoTrailing(atomStr || '0', false)
  const intText = bold ? `${intPart}.${bold}` : intPart
  let html = `<div class="decimal-parts d-inline-block"><span class="int">${intText}</span>`
  if (bold && rest) html += `<span class="decimal">${rest}</span>`
  if (bold && trailingZeros) html += `<span class="decimal trailing-zeroes">${trailingZeros}</span>`
  html += '</div>'
  return html
}

function txFeeRateHTML(tx) {
  if (tx.ska_totals && Object.keys(tx.ska_totals).length > 0) {
    const [id] = Object.entries(tx.ska_totals)[0]
    const rateAtoms = tx.ska_fee_rates && tx.ska_fee_rates[id]
    if (!rateAtoms) return '&mdash;'
    return `${skaAmountHTML(rateAtoms)} ${renderCoinType(id)}/kB`
  }
  return `${tx.fee_rate} VAR/kB`
}

describe('mempool txFeeRateHTML', () => {
  it('VAR tx → "<rate> VAR/kB"', () => {
    const tx = { fee_rate: 0.0001 }
    expect(txFeeRateHTML(tx)).toBe('0.0001 VAR/kB')
  })

  it('SKA tx with ska_fee_rates → decimal-parts HTML and "SKA<n>/kB" suffix', () => {
    const tx = {
      ska_totals: { 1: '1230000000000000000' },
      ska_fee_rates: { 1: '4920000000000000' }
    }
    const html = txFeeRateHTML(tx)
    expect(html).toContain('class="decimal-parts d-inline-block"')
    expect(html.endsWith(' SKA1/kB')).toBe(true)
    // Never accidentally renders the VAR unit on the SKA branch.
    expect(html.includes('VAR/kB')).toBe(false)
  })

  it('SKA tx without ska_fee_rates falls back to em-dash', () => {
    const tx = { ska_totals: { 1: '1230000000000000000' } }
    expect(txFeeRateHTML(tx)).toBe('&mdash;')
  })

  it('SKA tx with empty ska_fee_rates entry falls back to em-dash', () => {
    const tx = {
      ska_totals: { 2: '1' },
      ska_fee_rates: { 2: '' }
    }
    expect(txFeeRateHTML(tx)).toBe('&mdash;')
  })
})
