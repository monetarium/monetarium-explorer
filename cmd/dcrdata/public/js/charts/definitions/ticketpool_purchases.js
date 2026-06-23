export const ticketpoolPurchases = {
  name: 'ticketpool-purchases',
  label: 'Tickets Purchase Distribution',
  axes: [
    { label: 'Number of Tickets', scale: 'y' },
    { label: 'Avg Ticket Value (VAR)', scale: 'y2' }
  ],
  series: [
    { label: 'Mempool Tickets', scale: 'y', kind: 'bars', colorIndex: 0 },
    { label: 'Immature Tickets', scale: 'y', kind: 'bars', colorIndex: 1 },
    { label: 'Live Tickets', scale: 'y', kind: 'bars', colorIndex: 2 },
    { label: 'Ticket Value', scale: 'y2', kind: 'line', colorIndex: 3, width: 2 }
  ],
  toColumns: (data, mempool) => {
    const n = data.time.length
    const xs = data.time.map((t) => new Date(t).getTime() / 1000)
    const mem = data.mempool ? data.mempool.slice() : new Array(n).fill(0)
    const imm = data.immature ? data.immature.slice() : new Array(n).fill(0)
    const live = data.live ? data.live.slice() : new Array(n).fill(0)
    const price = data.price ? data.price.slice() : new Array(n).fill(0)
    if (mempool) {
      xs.push(new Date(mempool.time).getTime() / 1000)
      mem.push(mempool.count)
      imm.push(0)
      live.push(0)
      price.push(mempool.price)
    }
    return [xs, mem, imm, live, price]
  },
  formatValue: (seriesIdx, datum) => {
    if (!Number.isFinite(datum.value)) return 'n/a'
    if (seriesIdx === 3) {
      return `${datum.value.toLocaleString('en-US', { maximumFractionDigits: 8 })} VAR`
    }
    return datum.value.toLocaleString('en-US', { maximumFractionDigits: 0 })
  }
}
