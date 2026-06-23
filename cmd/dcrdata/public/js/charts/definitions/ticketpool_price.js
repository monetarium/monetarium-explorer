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
    const mem = data.mempool ? data.mempool.slice() : []
    const imm = data.immature ? data.immature.slice() : []
    const live = data.live ? data.live.slice() : []
    if (mempool) {
      const lastPrice = prices.length ? prices[prices.length - 1] : -1
      if (mempool.price !== lastPrice) {
        prices.push(mempool.price)
        mem.push(mempool.count)
        imm.push(0)
        live.push(0)
      } else {
        mem[mem.length - 1] += mempool.count
      }
    }
    return [prices, mem, imm, live]
  },
  formatValue: (seriesIdx, datum) => {
    if (!Number.isFinite(datum.value)) return 'n/a'
    return datum.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
}
