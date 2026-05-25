import { Controller } from '@hotwired/stimulus'
import dompurify from 'dompurify'
import globalEventBus from '../services/event_bus_service'
import ws from '../services/messagesocket_service'

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function makeNode(html) {
  const div = document.createElement('div')
  div.innerHTML = dompurify.sanitize(html, { FORBID_TAGS: ['svg', 'math'] })
  return div.firstChild
}

// Mirror of explorer/types StatsFromCoinRows symbol convention: VAR=0, SKAn=n.
function coinTypeFromSymbol(symbol) {
  if (symbol === 'VAR') return 0
  const m = /^SKA(\d+)$/.exec(symbol || '')
  return m ? parseInt(m[1], 10) : null
}

// humanize.Bytes-style formatter (SI units, lowercase 'k').
function formatBytes(bytes) {
  const n = typeof bytes === 'number' ? bytes : 0
  if (n < 0) return '0 B'
  const units = ['B', 'kB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  if (i === 0) return `${v} B`
  return `${v.toFixed(1)} ${units[i]}`
}

function regularCountForSymbol(counts, symbol) {
  if (!Array.isArray(counts)) return 0
  for (const c of counts) {
    if (c && c.symbol === symbol) return c.count || 0
  }
  return 0
}

function sumRegularCoinCounts(counts) {
  if (!Array.isArray(counts)) return 0
  let total = 0
  for (const c of counts) total += (c && c.count) || 0
  return total
}

function mempoolRegularCountForSymbol(coinStats, symbol) {
  const ct = coinTypeFromSymbol(symbol)
  if (ct === null || !coinStats) return 0
  const key = String(ct)
  const s = coinStats[key] || coinStats[ct]
  return s ? s.regular_count || 0 : 0
}

function sumMempoolRegularCounts(coinStats) {
  if (!coinStats) return 0
  let total = 0
  for (const k of Object.keys(coinStats)) {
    const s = coinStats[k]
    if (s && typeof s.regular_count === 'number') total += s.regular_count
  }
  return total
}

// Pixel-perfect copies of the homepage indicator-fill template fields. The
// CoinFillData wire shape uses snake_case, so this helper reads the same way
// the homepage controller does — no normalisation step.
function fillBarHtml(entry, txCount) {
  const symbol = entry.symbol || ''
  const status = entry.status || ''
  const pctOfTC = typeof entry.pct_of_tc === 'number' ? entry.pct_of_tc : 0
  const gqFill = entry.gq_fill_ratio || 0
  const extraFill = entry.extra_fill_ratio || 0
  const overflowFill = entry.overflow_fill_ratio || 0
  const gqPos = entry.gq_position_ratio || 0
  const isOverflow = !!entry.is_overflow

  const gqHidden = gqFill === 0 ? 'hidden' : ''
  const extraHidden = extraFill === 0 ? 'hidden' : ''
  const overflowHidden = overflowFill === 0 ? 'hidden' : ''
  const overflowAttr = isOverflow ? 'data-overflow="true"' : ''

  return `<div class="fill-bar"
    role="meter"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow="${Math.round(pctOfTC)}"
    aria-label="${symbol} — ${status}"
    data-coin="${symbol}"
    title='{"object": "FillBar", "coin": "${symbol}", "txCount": "${txCount}"}'
    data-visualBlocks-target="tooltip"
    ${overflowAttr}>
    <span class="fill-bar__label">${symbol}</span>
    <div class="fill-bar__track"
        data-status="${status}"
        style="--gq-pos: ${gqPos.toFixed(6)}">
        <div class="gq-segment" ${gqHidden}
            style="--seg-w: ${(gqFill * gqPos * 100).toFixed(4)}%"></div>
        <div class="extra-segment" ${extraHidden}
            style="--seg-w: ${(extraFill * 100).toFixed(4)}%"></div>
        <div class="overflow-segment overflow-hatch" ${overflowHidden}
            style="--seg-w: ${(overflowFill * 100).toFixed(4)}%"></div>
        <div class="gq-marker" style="left: ${(gqPos * 100).toFixed(4)}%"></div>
    </div>
    <span class="fill-bar__pct">${pctOfTC.toFixed(1)}%</span>
  </div>`
}

function totalBarHtml(totalFillRatio, totalTxCount) {
  const ratio = typeof totalFillRatio === 'number' ? totalFillRatio : 0
  const clamped = Math.min(ratio, 1.0)
  const overflowAttr = ratio > 1.0 ? 'data-overflow="true"' : ''
  const emptyAttr = ratio === 0 ? 'data-empty="true"' : ''
  return `<div class="total-bar"
    role="meter"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow="${Math.round(ratio * 100)}"
    aria-label="Total fill"
    title='{"object": "FillBar", "coin": "TOTAL", "txCount": "${totalTxCount}"}'
    data-visualBlocks-target="tooltip"
    ${overflowAttr}
    ${emptyAttr}>
    <span class="total-bar__label">TOTAL</span>
    <div class="total-bar__track">
        <div class="total-bar__fill"
            style="--seg-w: ${(clamped * 100).toFixed(4)}%"></div>
    </div>
    <span class="total-bar__pct">${(ratio * 100).toFixed(1)}%</span>
  </div>`
}

// ---------------------------------------------------------------------------
// Row builders (exported for testing)
// ---------------------------------------------------------------------------

export function makeVoteElements(votes) {
  const voteElements = (votes || []).map((vote) => {
    const cls = vote.Voted ? (vote.VoteValid ? 'vote-yes' : 'vote-no') : 'vote-skip'
    const titleJson = JSON.stringify({
      object: 'Vote',
      coin: 'VAR',
      voted: String(!!vote.Voted),
      voteValid: String(!!vote.VoteValid)
    })
    return `<span class="${cls}"
        title='${titleJson}'
        data-visualBlocks-target="tooltip">
        <a class="block-element-link" href="/tx/${vote.TxID}"></a>
    </span>`
  })
  for (let i = voteElements.length; i < 5; i++) {
    voteElements.push('<span title="Empty vote slot"></span>')
  }
  return `<div class="block-votes" style="flex-grow: 1">${voteElements.join('\n')}</div>`
}

export function makeTicketAndRevocationElements(tickets, revocations, blockHref) {
  const ticketElements = (tickets || []).map((t) => stakeTxSpan(t, 'block-ticket', 'Ticket'))
  if (ticketElements.length > 50) {
    const total = ticketElements.length
    ticketElements.splice(30)
    ticketElements.push(`<span class="block-ticket" style="flex-grow: 10; flex-basis: 50px;" title="Total of ${total} tickets">
        <a class="block-element-link" href="${blockHref}">+ ${total - 30}</a>
    </span>`)
  }
  const revocationElements = (revocations || []).map((r) =>
    stakeTxSpan(r, 'block-rev', 'Revocation')
  )

  const all = ticketElements.concat(revocationElements)
  for (let i = all.length; i < 20; i++) {
    all.push('<span title="Empty ticket slot"></span>')
  }
  return `<div class="block-tickets" style="flex-grow: 1">${all.join('\n')}</div>`
}

function stakeTxSpan(tx, className, type) {
  const titleJson = JSON.stringify({
    object: type,
    coin: 'VAR',
    total: String(tx.Total != null ? tx.Total : ''),
    vout: String(tx.VoutCount != null ? tx.VoutCount : ''),
    vin: String(tx.VinCount != null ? tx.VinCount : '')
  })
  return `<span class="${className}"
    title='${titleJson}'
    data-visualBlocks-target="tooltip">
    <a class="block-element-link" href="/tx/${tx.TxID}"></a>
  </span>`
}

export function makeIndicatorBars(totalFillRatio, coinFills, totalTxCount, countForSymbol) {
  const bars = (coinFills || []).map((entry) => fillBarHtml(entry, countForSymbol(entry.symbol)))
  return `<div class="indicator-fill block-indicator-fill" data-visualBlocks-target="indicator">
    ${totalBarHtml(totalFillRatio, totalTxCount)}
    ${bars.join('\n')}
  </div>`
}

function blockInfoHtml({ href, label, formattedBytes, totalFillRatio, maxBlockSize, age }) {
  const pctHtml =
    maxBlockSize > 0 ? `<span class="size-pct">${(totalFillRatio * 100).toFixed(0)}%</span>` : ''
  return `<div class="block-info">
    <a class="color-code" href="${href}">${label}</a>
    <div class="mono amount" style="line-height: 1;">
        <span class="size">${formattedBytes}</span>
        ${pctHtml}
    </div>
    <span class="timespan">
        <span data-time-target="age" data-age="${age}"></span>&nbsp;ago
    </span>
  </div>`
}

// ---------------------------------------------------------------------------
// Tile builders (exported for testing)
// ---------------------------------------------------------------------------

export function makeMempoolBlock(mempool) {
  if (!mempool) return null
  const totalSize = mempool.TotalSize || 0
  const maxBlockSize = mempool.MaxBlockSize || 0
  const totalFillRatio = mempool.TotalFillRatio || 0
  const totalTxCount = sumMempoolRegularCounts(mempool.CoinStats)
  const formattedBytes = mempool.FormattedBytes || formatBytes(totalSize)

  const header = blockInfoHtml({
    href: '/mempool',
    label: 'Mempool',
    formattedBytes: formattedBytes,
    totalFillRatio: totalFillRatio,
    maxBlockSize: maxBlockSize,
    age: mempool.Time
  })

  const countFor = (symbol) => mempoolRegularCountForSymbol(mempool.CoinStats, symbol)

  return makeNode(`<div class="block visible" data-visualBlocks-target="block">
    ${header}
    <div class="block-rows">
        ${makeVoteElements(mempool.Votes)}
        ${makeTicketAndRevocationElements(mempool.Tickets, mempool.Revocations, '/mempool')}
        ${makeIndicatorBars(totalFillRatio, mempool.CoinFills, totalTxCount, countFor)}
    </div>
  </div>`)
}

export function newBlockHtmlElement(block) {
  if (!block) return null
  const size = block.Size || 0
  const maxBlockSize = block.MaxBlockSize || 0
  const totalFillRatio = block.TotalFillRatio || 0
  const totalTxCount = sumRegularCoinCounts(block.RegularCoinCounts)
  const formattedBytes = block.FormattedBytes || formatBytes(size)

  const header = blockInfoHtml({
    href: `/block/${block.Height}`,
    label: String(block.Height),
    formattedBytes: formattedBytes,
    totalFillRatio: totalFillRatio,
    maxBlockSize: maxBlockSize,
    age: block.Time
  })

  const countFor = (symbol) => regularCountForSymbol(block.RegularCoinCounts, symbol)

  return makeNode(`<div class="block visible" data-visualBlocks-target="block">
    ${header}
    <div class="block-rows">
        ${makeVoteElements(block.Votes)}
        ${makeTicketAndRevocationElements(block.Tickets, block.Revocations, `/block/${block.Height}`)}
        ${makeIndicatorBars(totalFillRatio, block.CoinFills, totalTxCount, countFor)}
    </div>
  </div>`)
}

// ---------------------------------------------------------------------------
// Wire-shape normalisation
// ---------------------------------------------------------------------------

// The WS `newblock` payload carries the Go BlockInfo struct with mixed JSON
// tags: some fields are PascalCase (no tag), others snake_case (explicit
// JSON tag). The shallow-copy patch in websockethandlers.go ensures
// coin_fills / total_fill_ratio / regular_coin_counts / max_block_size /
// active_ska_count match the HTTP TrimmedBlockInfo. We normalise to a single
// PascalCase shape so the tile builders can stay decoupled from the wire
// format and tests can use a stable fixture shape.
export function normaliseWsBlock(block) {
  return {
    Height: block.height != null ? block.height : block.Height,
    Time: block.time || block.Time,
    Size: block.size != null ? block.size : block.Size,
    FormattedBytes: block.formatted_bytes || block.FormattedBytes,
    Votes: normaliseTxs(block.Votes),
    Tickets: normaliseTxs(block.Tickets),
    Revocations: normaliseTxs(block.Revs || block.Revocations),
    CoinFills: block.coin_fills || block.CoinFills || [],
    RegularCoinCounts: block.regular_coin_counts || block.RegularCoinCounts || [],
    TotalFillRatio:
      block.total_fill_ratio != null ? block.total_fill_ratio : block.TotalFillRatio || 0,
    MaxBlockSize: block.max_block_size != null ? block.max_block_size : block.MaxBlockSize || 0,
    ActiveSKACount: block.active_ska_count || block.ActiveSKACount || 0
  }
}

function normaliseMempool(mempool) {
  return {
    Time: mempool.Time,
    TotalSize: mempool.total_size != null ? mempool.total_size : mempool.TotalSize || 0,
    Votes: normaliseTxs(mempool.Votes),
    Tickets: normaliseTxs(mempool.Tickets),
    Revocations: normaliseTxs(mempool.Revocations),
    CoinFills: mempool.coin_fills || mempool.CoinFills || [],
    CoinStats: mempool.coin_stats || mempool.CoinStats || {},
    TotalFillRatio:
      mempool.total_fill_ratio != null ? mempool.total_fill_ratio : mempool.TotalFillRatio || 0,
    MaxBlockSize:
      mempool.max_block_size != null ? mempool.max_block_size : mempool.MaxBlockSize || 0,
    ActiveSKACount: mempool.active_ska_count || mempool.ActiveSKACount || 0
  }
}

// Normalise nested TrimmedTxInfo records: TxBasic fields have no JSON tags
// (PascalCase on the wire — TxID, Total) while TrimmedTxInfo's own fields
// have snake-case tags (voted, vote_valid, vin_count, vout_count). Tile
// builders consume a single PascalCase shape.
function normaliseTxs(txs) {
  return (txs || []).map((t) => ({
    TxID: t.TxID,
    Total: t.Total,
    VoutCount: t.vout_count != null ? t.vout_count : t.VoutCount,
    VinCount: t.vin_count != null ? t.vin_count : t.VinCount,
    Voted: t.voted != null ? !!t.voted : !!t.Voted,
    VoteValid: t.vote_valid != null ? !!t.vote_valid : !!t.VoteValid
  }))
}

// ---------------------------------------------------------------------------
// Stimulus controller
// ---------------------------------------------------------------------------

export default class extends Controller {
  static get targets() {
    return ['box', 'title', 'showmore', 'root', 'tooltip', 'block', 'indicator']
  }

  connect() {
    this.handleVisualBlocksUpdate = this._handleVisualBlocksUpdate.bind(this)
    globalEventBus.on('BLOCK_RECEIVED', this.handleVisualBlocksUpdate)

    ws.registerEvtHandler('getmempooltrimmedResp', (event) => {
      this.handleMempoolUpdate(event)
    })

    ws.registerEvtHandler('mempool', () => {
      ws.send('getmempooltrimmed', '')
    })

    this.refreshBlocksDisplay = this._refreshBlocksDisplay.bind(this)
    window.addEventListener('resize', this.refreshBlocksDisplay)
    setTimeout(this.refreshBlocksDisplay, 500)
  }

  disconnect() {
    ws.deregisterEvtHandlers('getmempooltrimmedResp')
    ws.deregisterEvtHandlers('mempool')
    globalEventBus.off('BLOCK_RECEIVED', this.handleVisualBlocksUpdate)
    window.removeEventListener('resize', this.refreshBlocksDisplay)
  }

  _handleVisualBlocksUpdate(newBlock) {
    const block = newBlock.block
    const tile = normaliseWsBlock(block)

    const box = this.boxTarget
    box.insertBefore(newBlockHtmlElement(tile), box.firstChild.nextSibling)
    const vis = this.visibleBlocks()
    vis[vis.length - 1].classList.remove('visible')
    box.removeChild(box.lastChild)
    this.setupTooltips()
  }

  handleMempoolUpdate(evt) {
    const raw = JSON.parse(evt)
    raw.Time = Math.round(new Date().getTime() / 1000)
    const tile = normaliseMempool(raw)
    this.boxTarget.replaceChild(makeMempoolBlock(tile), this.boxTarget.firstChild)
    this.setupTooltips()
  }

  _refreshBlocksDisplay() {
    const visibleBlockElements = this.visibleBlocks()
    const currentlyDisplayedBlockCount = visibleBlockElements.length
    const maxBlockElements = this.calculateMaximumNumberOfBlocksToDisplay(visibleBlockElements[0])
    if (currentlyDisplayedBlockCount > maxBlockElements) {
      for (let i = currentlyDisplayedBlockCount; i >= maxBlockElements; i--) {
        visibleBlockElements[i - 1].classList.remove('visible')
      }
    } else {
      const allBlockElements = this.blockTargets
      for (let i = currentlyDisplayedBlockCount; i < maxBlockElements; i++) {
        allBlockElements[i].classList.add('visible')
      }
    }
    this.setupTooltips()
  }

  calculateMaximumNumberOfBlocksToDisplay(blockElement) {
    const blocksSection = this.rootTarget.getBoundingClientRect()
    const margin = 20
    const blocksSectionFirstChildHeight = this.titleTarget.offsetHeight + margin
    const blocksSectionLastChildHeight = this.showmoreTarget.offsetHeight + margin

    const extraSpace = window.innerHeight - document.getElementById('mainContainer').offsetHeight
    const blocksSectionHeight = blocksSection.height + extraSpace

    const totalAvailableWidth = blocksSection.width
    const totalAvailableHeight =
      blocksSectionHeight - blocksSectionFirstChildHeight - blocksSectionLastChildHeight

    const rect = blockElement.getBoundingClientRect()
    const blockWidth = rect.width
    const blockHeight = rect.height + margin

    const maxBlocksPerRow = Math.floor(totalAvailableWidth / blockWidth)
    let maxBlockRows = Math.floor(totalAvailableHeight / blockHeight)
    let maxBlockElements = maxBlocksPerRow * maxBlockRows

    const totalBlocksDisplayable = this.boxTarget.childElementCount
    while (maxBlockElements > totalBlocksDisplayable) {
      maxBlockRows--
      maxBlockElements = maxBlocksPerRow * maxBlockRows
    }

    return maxBlockElements
  }

  setupTooltips() {
    this.tooltipTargets.forEach((tooltipElement) => {
      try {
        const data = JSON.parse(tooltipElement.title)
        let newContent
        if (data.object === 'Vote') {
          let label
          if (data.voted === 'true' || data.voted === true) {
            label = data.voteValid === 'true' || data.voteValid === true ? 'Voted YES' : 'Voted NO'
          } else {
            label = 'Did not vote'
          }
          newContent = `<b>Vote (${data.coin || 'VAR'})</b><br>${label}`
        } else if (data.object === 'FillBar') {
          const coin = data.coin || ''
          const n = data.txCount || '0'
          if (coin === 'TOTAL') {
            newContent = `<b>Block fill</b><br>${n} transactions`
          } else {
            newContent = `<b>${coin}</b><br>${n} ${coin}-transactions`
          }
        } else if (data.object === 'Ticket' || data.object === 'Revocation') {
          newContent = `<b>${data.object} (${data.coin || 'VAR'})</b><br>${data.total} ${data.coin || 'VAR'}`
          if (data.vin && data.vout) {
            newContent += `<br>${data.vin} Inputs, ${data.vout} Outputs`
          }
        } else {
          return
        }

        tooltipElement.title = newContent
      } catch {
        // title is not valid JSON, skip tooltip setup for this element
      }
    })

    import(/* webpackChunkName: "tippy" */ '../vendor/tippy.all')
      .then((module) => {
        const tippy = module.default
        tippy('.block-rows [title]', {
          allowTitleHTML: true,
          animation: 'shift-away',
          arrow: true,
          createPopperInstanceOnInit: true,
          dynamicTitle: true,
          performance: true,
          placement: 'top',
          size: 'small',
          sticky: true,
          theme: 'light'
        })
        return null
      })
      .catch((err) => console.error('tippy load error:', err))
  }

  visibleBlocks() {
    return this.boxTarget.querySelectorAll('.visible')
  }
}
