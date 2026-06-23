export const ticketpoolPrice = {
  name: 'ticketpool-price',
  label: 'Ticket Price Distribution',
  axes: [{ label: 'Number of Tickets', scale: 'y' }],
  series: [
    { label: 'Mempool Tickets', scale: 'y', kind: 'bars', colorIndex: 0 },
    { label: 'Immature Tickets', scale: 'y', kind: 'bars', colorIndex: 1 },
    { label: 'Live Tickets', scale: 'y', kind: 'bars', colorIndex: 2 }
  ],
  toColumns: (data, mempool) => {
    const prices = data.price ? data.price.slice() : []
    const n = prices.length
    const mem = data.mempool ? data.mempool.slice() : new Array(n).fill(0)
    const imm = data.immature ? data.immature.slice() : new Array(n).fill(0)
    const live = data.live ? data.live.slice() : new Array(n).fill(0)
    if (mempool) {
      const idx = prices.indexOf(mempool.price)
      if (idx >= 0) {
        mem[idx] += mempool.count
      } else {
        const insertAt = prices.findIndex((p) => p > mempool.price)
        if (insertAt >= 0) {
          prices.splice(insertAt, 0, mempool.price)
          mem.splice(insertAt, 0, mempool.count)
          imm.splice(insertAt, 0, 0)
          live.splice(insertAt, 0, 0)
        } else {
          prices.push(mempool.price)
          mem.push(mempool.count)
          imm.push(0)
          live.push(0)
        }
      }
    }
    return [prices, mem, imm, live]
  },
  formatValue: (seriesIdx, datum) => {
    if (!Number.isFinite(datum.value)) return 'n/a'
    return datum.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
}
