import humanize from './humanize_helper'

/**
 * formatSKAAmountCell renders the aggregate SKA-amount table cell shared by
 * the Latest Blocks (home) and Blocks listing tables. The rule is:
 *
 *   subRows.length === 0  → '—'                           (no SKA issued)
 *   subRows.length === 1  → formatted amount (zero → '0')
 *   subRows.length >= 2   → 'Σ K' where K = SKA types with txCount > 0
 *
 * Mirrors the Go-side helper of the same name (cmd/dcrdata/internal/explorer
 * /templates.go). Both helpers must produce identical strings — they back the
 * server-rendered initial page and the WebSocket live update of the same row.
 *
 * @param {Array<{txCount: string, amount: string}>} subRows - SKA sub-rows from coinRowsToSKAData
 * @returns {string} the cell text content
 */
export function formatSKAAmountCell(subRows) {
  if (subRows.length >= 2) {
    let active = 0
    for (const r of subRows) {
      if (Number(r.txCount) > 0) active++
    }
    return `Σ ${active}`
  }
  if (subRows.length === 1) return subRows[0].amount
  return '—'
}

/**
 * coinRowsToSKAData extracts VAR and SKA display data from a block's
 * coin_rows array.
 *
 * Returns { totalTxCount, varTxCount, varAmount, varSize, skaAmount, subRows }
 * where skaAmount is the rendered aggregate-cell string (see
 * formatSKAAmountCell).
 *
 * @param {object} block - block data from the BLOCK_RECEIVED event
 * @returns {{ totalTxCount: number, varTxCount: number, varAmount: string,
 *             varSize: string, skaAmount: string, subRows: Array }}
 */
export function coinRowsToSKAData(block) {
  const coinRows = block.coin_rows
  if (!coinRows || coinRows.length === 0) {
    // VAR-only fallback
    return {
      totalTxCount: block.tx,
      varTxCount: block.tx,
      varAmount: humanize.threeSigFigs(block.total),
      varSize: humanize.bytes(block.size),
      skaAmount: formatSKAAmountCell([]),
      subRows: []
    }
  }

  let varTxCount = block.tx
  let varAmount = humanize.threeSigFigs(block.total)
  let varSize = humanize.bytes(block.size)
  const subRows = []
  let totalTxCount = 0

  for (const cr of coinRows) {
    totalTxCount += cr.tx_count
    if (cr.coin_type === 0) {
      varTxCount =
        cr.tx_count - (block.votes || 0) - (block.tickets || 0) - (block.revocations || 0)
      if (varTxCount < 0) varTxCount = 0
      varAmount = humanize.formatCoinAtoms(cr.amount, cr.coin_type)
      varSize = humanize.bytes(cr.size)
    } else {
      subRows.push({
        tokenType: cr.symbol,
        txCount: String(cr.tx_count),
        amount: humanize.formatCoinAtoms(cr.amount, cr.coin_type),
        size: humanize.bytes(cr.size)
      })
    }
  }

  totalTxCount -= (block.votes || 0) + (block.tickets || 0) + (block.revocations || 0)
  if (totalTxCount < 0) totalTxCount = 0

  const skaAmount = formatSKAAmountCell(subRows)
  return { totalTxCount, varTxCount, varAmount, varSize, skaAmount, subRows }
}

/**
 * insertVARSubRow clones the named template and inserts a VAR sub-row
 * immediately after newRow in tbody.
 *
 * @param {HTMLElement} tbody
 * @param {HTMLElement} newRow
 * @param {number}      varTxCount
 * @param {string}      varAmount
 * @param {string}      varSize
 * @param {string}      templateId - id of the <template> element to clone
 * @returns {HTMLElement|null} the inserted <tr>, or null if template missing
 */
export function insertVARSubRow(tbody, newRow, varTxCount, varAmount, varSize, templateId) {
  const tmpl = document.getElementById(templateId)
  if (!tmpl) return null
  const clone = document.importNode(tmpl.content, true)
  const tr = clone.querySelector('tr')
  tr.dataset.blockId = newRow.dataset.blockId

  clone.querySelector('[data-type="tx"]').textContent = varTxCount > 0 ? String(varTxCount) : '—'
  clone.querySelector('[data-type="var-amount"]').textContent = varAmount
  clone.querySelector('[data-type="size"]').textContent = varSize

  tbody.insertBefore(clone, newRow.nextSibling)
  return tr
}

/**
 * insertSKASubRows clones the named template for each SKA sub-row and inserts
 * them after insertRef in tbody.
 *
 * @param {HTMLElement}   tbody
 * @param {HTMLElement}   insertRef
 * @param {Array}         subRows
 * @param {number}        blockHeight
 * @param {string}        templateId - id of the <template> element to clone
 */
export function insertSKASubRows(tbody, insertRef, subRows, blockHeight, templateId) {
  const tmpl = document.getElementById(templateId)
  if (!tmpl || !insertRef) return
  const ref = insertRef.nextSibling
  for (const sub of subRows) {
    const clone = document.importNode(tmpl.content, true)
    const tr = clone.querySelector('tr')
    tr.dataset.blockId = String(blockHeight)

    clone.querySelector('.coin-label--ska').textContent = sub.tokenType
    clone.querySelector('[data-type="tx"]').textContent = sub.txCount
    clone.querySelector('[data-type="ska-amount"]').textContent = sub.amount
    clone.querySelector('[data-type="size"]').textContent = sub.size

    tbody.insertBefore(clone, ref)
  }
}
