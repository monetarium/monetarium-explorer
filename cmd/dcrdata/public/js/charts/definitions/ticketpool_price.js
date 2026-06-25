export const ticketpoolPrice = {
  name: 'ticketpool-price',
  label: 'Ticket Price Distribution',
  axes: [
    { label: 'Number of Tickets', scale: 'y' },
    { label: '\u00A0', scale: 'y2' }
  ],
  series: [
    { label: 'Mempool Tickets', scale: 'y', kind: 'bars', colorIndex: 0 },
    { label: 'Immature Tickets', scale: 'y', kind: 'bars', colorIndex: 1 },
    { label: 'Live Tickets', scale: 'y', kind: 'bars', colorIndex: 2 },
    { label: '', scale: 'y2', kind: 'line', colorIndex: 2, width: 0, show: false },
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
    const prices = data.price ? data.price.slice() : []
    const n = prices.length
    const mem = new Array(n).fill(0)
    const imm = data.immature ? data.immature.slice() : new Array(n).fill(0)
    const live = data.live ? data.live.slice() : new Array(n).fill(0)
    const pts = new Array(n).fill(null)
    if (mempool) {
      const idx = prices.indexOf(mempool.price)
      if (idx >= 0) {
        mem[idx] += mempool.count
        pts[idx] = mem[idx]
      } else {
        const insertAt = prices.findIndex((p) => p > mempool.price)
        if (insertAt >= 0) {
          prices.splice(insertAt, 0, mempool.price)
          mem.splice(insertAt, 0, mempool.count)
          imm.splice(insertAt, 0, 0)
          live.splice(insertAt, 0, 0)
          pts.splice(insertAt, 0, mempool.count)
        } else {
          prices.push(mempool.price)
          mem.push(mempool.count)
          imm.push(0)
          live.push(0)
          pts.push(mempool.count)
        }
      }
    }
    return [prices, mem, imm, live, live, pts]
  },
  formatValue: (seriesIdx, datum) => {
    if (!Number.isFinite(datum.value)) return 'n/a'
    if (seriesIdx === 4) return ''
    return datum.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
}
