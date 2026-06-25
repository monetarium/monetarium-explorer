// Bar-mode-aware purchases chart definition. `ticketpoolPurchases(barMode)` returns a
// definition whose bar paths close over `barMode` (so a bars change is a new def → a
// ChartPanel rebuild with correct geometry — the adapter fixes a series' paths at
// construction) and whose toColumns appends the period-end boundary point in bucketed modes.

// Granularity-aware bar paths: bucketed modes draw full-width left-aligned bars at the
// bucket start (date_trunc boundary); blocks/fallback draws centered capped bars.
function granularBarPaths(UPlot, s, barMode) {
  const defaultSize = s.barSize || [0.6, 100, 4]
  const defaultAlign = s.barAlign ?? 0
  return (u, seriesIdx, idx0, idx1) => {
    switch (barMode) {
      case 'day':
      case 'wk':
      case 'mo':
        return UPlot.paths.bars({ size: [1], align: 1 })(u, seriesIdx, idx0, idx1)
      default:
        return UPlot.paths.bars({ size: defaultSize, align: defaultAlign })(
          u,
          seriesIdx,
          idx0,
          idx1
        )
    }
  }
}

// For bucketed modes, append a period-end point after the last data point so the line
// extends to the period boundary. The point has null bar values (no extra bar) and carries
// the last line value forward (horizontal segment). No-op for blocks/fallback.
function extendToPeriodEnd(cols, barMode) {
  if (barMode !== 'day' && barMode !== 'wk' && barMode !== 'mo') return
  if (!cols[0].length) return
  const lastTs = cols[0][cols[0].length - 1]
  let endTs
  if (barMode === 'day') {
    endTs = lastTs + 86400
  } else if (barMode === 'wk') {
    endTs = lastTs + 604800
  } else {
    const d = new Date(lastTs * 1000)
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth()
    endTs = m === 11 ? Date.UTC(y + 1, 0, 1) / 1000 : Date.UTC(y, m + 1, 1) / 1000
  }
  if (endTs <= lastTs) return
  cols[0].push(endTs)
  cols[1].push(null)
  cols[2].push(null)
  cols[3].push(null)
  cols[4].push(cols[4][cols[4].length - 1])
  cols[5].push(null)
}

export function ticketpoolPurchases(barMode) {
  const barPaths = (UPlot, s) => granularBarPaths(UPlot, s, barMode)
  return {
    name: 'ticketpool-purchases',
    label: 'Tickets Purchase Distribution',
    axes: [
      { label: 'Number of Tickets', scale: 'y' },
      { label: 'Avg Ticket Value (VAR)', scale: 'y2' }
    ],
    series: [
      { label: 'Mempool Tickets', scale: 'y', kind: 'bars', colorIndex: 0, paths: barPaths },
      { label: 'Immature Tickets', scale: 'y', kind: 'bars', colorIndex: 1, paths: barPaths },
      { label: 'Live Tickets', scale: 'y', kind: 'bars', colorIndex: 2, paths: barPaths },
      { label: 'Ticket Value', scale: 'y2', kind: 'line', colorIndex: 3, width: 2 },
      {
        label: '',
        scale: 'y',
        kind: 'line',
        colorIndex: 0,
        width: 0,
        points: { show: true, size: 7 },
        spanGaps: true
      }
    ],
    toColumns: (data, settings = {}) => {
      const mempool = settings.mempool
      const n = data.time.length
      const xs = data.time.map((t) => new Date(t).getTime() / 1000)
      const mem = data.mempool ? data.mempool.slice() : new Array(n).fill(0)
      const imm = data.immature ? data.immature.slice() : new Array(n).fill(0)
      const live = data.live ? data.live.slice() : new Array(n).fill(0)
      const price = data.price ? data.price.slice() : new Array(n).fill(0)
      const pts = new Array(n).fill(null)
      const cols = [xs, mem, imm, live, price, pts]
      // Anchor the bucketed period-end boundary to the last HISTORICAL point, BEFORE appending
      // any live mempool point — otherwise extendToPeriodEnd would read the mempool timestamp as
      // its anchor and compute the wrong boundary. Today the two never co-occur (mempool is only
      // passed in 'all' mode, which is not a bucketed barMode, so extend is a no-op there), but
      // ordering it this way keeps the boundary correct independent of that controller invariant.
      extendToPeriodEnd(cols, barMode)
      if (mempool) {
        const lastTs = xs.length ? xs[xs.length - 1] : 0
        let memTs = new Date(mempool.time).getTime() / 1000
        if (memTs <= lastTs + 1) memTs = lastTs + 1
        xs.push(memTs)
        mem.push(mempool.count)
        imm.push(0)
        live.push(0)
        price.push(mempool.price)
        pts.push(mempool.count)
      }
      return cols
    },
    formatValue: (seriesIdx, datum) => {
      if (!Number.isFinite(datum.value)) return 'n/a'
      if (seriesIdx === 4) return ''
      if (seriesIdx === 5) return ''
      if (seriesIdx === 3) {
        return `${datum.value.toLocaleString('en-US', { maximumFractionDigits: 8 })} VAR`
      }
      return datum.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
    }
  }
}
