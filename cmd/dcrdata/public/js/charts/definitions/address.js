// Address-page chart definitions (Balance / Tx Type / Sent-Received) for the uPlot
// adapter. Unlike /charts definitions these are NOT registered globally — the address
// controller imports the factories directly. SKA precision firewall: formatValue reads
// the raw atom STRING from the payload, never the lossy plotted number.

import { intComma, formatSkaAtomsExact } from '../format'
import { renderCoinType } from '../../helpers/ska_helper'

const SKA_ATOMS_TO_COIN = 1e-18

// Histogram bar geometry for the time-bucketed count/amount charts. The backend stamps each
// bucket at its START (date_trunc), so bars are LEFT-aligned (left edge at the bucket x) and
// sized to fill the whole bin (size:[1] = 100% width, uncapped) — each bar visually spans its
// period. Contrast the adapter default (centered, 60%, capped 100px) used by the /charts bars.
const HISTOGRAM_BAR_ALIGN = 1
const HISTOGRAM_BAR_SIZE = [1]

// RFC3339 strings (TimeDef.MarshalJSON) -> integer UNIX seconds for the uPlot x-axis.
export function secondsFromTimes(times) {
  return times.map((t) => Math.floor(Date.parse(t) / 1000))
}

// Left-aligned histogram bars are stamped at the bucket START, so the last (current) period's
// bar extends one bin to the right of the final data x. Append a trailing x one bin past the
// last — with null y for every series (no bar is drawn there) — so the x-domain reaches the end
// of the current period and that last bar is fully visible. binSize is in seconds
// (settings.binSize); 0/absent leaves the columns untouched (callers without settings, e.g.
// unit tests). Mutates in place and returns the same array. The leading edge needs no pad: a
// left-aligned bar at the first bucket already starts at the domain's left edge.
function padTrailingBin(cols, settings) {
  const binSize = (settings && settings.binSize) || 0
  const xs = cols[0]
  if (binSize > 0 && xs.length) {
    xs.push(xs[xs.length - 1] + binSize)
    for (let i = 1; i < cols.length; i++) cols[i].push(null)
  }
  return cols
}

// Tx-type counts (coin-independent). Stacked bars matching the legacy Dygraphs
// stackedGraph + sizedBarPlotter. Each series' raw count is read for the tooltip.
const TYPE_SERIES = [
  { label: 'Sending (regular)', field: 'sentRtx' },
  { label: 'Receiving (regular)', field: 'receivedRtx' },
  { label: 'Tickets', field: 'tickets' },
  { label: 'Votes', field: 'votes' },
  { label: 'Revocations', field: 'revokeTx' }
]

export function typesDef() {
  return {
    name: 'types',
    label: 'Tx Count',
    stacked: true,
    skipZeroRows: true, // stacked: drop the many 0-count series rows from the tooltip
    axes: [{ label: '', scale: 'y', intTicks: true }],
    series: TYPE_SERIES.map((s, i) => ({
      label: s.label,
      scale: 'y',
      kind: 'bars',
      colorIndex: i,
      barAlign: HISTOGRAM_BAR_ALIGN,
      barSize: HISTOGRAM_BAR_SIZE
    })),
    toColumns: (raw, settings) =>
      padTrailingBin(
        [secondsFromTimes(raw.time), ...TYPE_SERIES.map((s) => (raw[s.field] || []).slice())],
        settings
      ),
    formatValue: (seriesIdx, datum) =>
      intComma(datum.payload[TYPE_SERIES[seriesIdx].field][datum.idx])
  }
}

export function balanceDef(coinType) {
  const isSKA = coinType > 0
  const coinLabel = renderCoinType(coinType)
  return {
    name: 'balance',
    label: `Balance (${coinLabel})`,
    stacked: false,
    axes: [{ label: '', scale: 'y' }],
    series: [{ label: 'Balance', scale: 'y', kind: 'stepped', colorIndex: 0, fill: true }],
    toColumns: (raw, settings) => {
      const xs = secondsFromTimes(raw.time)
      const ys = isSKA
        ? (raw.balance_atoms || []).map((s) => Number(s) * SKA_ATOMS_TO_COIN) // lossy — geometry only
        : (raw.balance || []).slice()
      // Dygraphs padPoints(sustain=true): a leading 0-balance point (the address held no balance
      // before its first tx) plus a trailing point sustaining the last balance to ~the current
      // period. The stepped area then shows the full 0 -> balance history and reaches "now".
      const binSize = (settings && settings.binSize) || 0
      if (binSize > 0 && xs.length) {
        const firstX = xs[0]
        const lastX = xs[xs.length - 1]
        const lastY = ys[ys.length - 1]
        let pad = binSize / 2
        const duration = lastX - firstX
        if (duration < binSize) pad = Math.max(pad, (binSize - duration) / 2)
        xs.unshift(firstX - pad)
        ys.unshift(0)
        xs.push(lastX + pad)
        ys.push(lastY)
      }
      return [xs, ys]
    },
    formatValue: (seriesIdx, datum) => {
      if (!isSKA) return `${datum.value} ${coinLabel}`
      // toColumns brackets the real series with a leading 0-balance point and a trailing sustain
      // point, so the real atom for uPlot index `idx` sits at payload index `idx - 1` (clamped).
      // A 0 plot value (the leading pad, or a genuine 0 balance) renders as a literal 0.
      if (!datum.value) return `0 ${coinLabel}`
      const atoms = datum.payload.balance_atoms || []
      const i = Math.min(Math.max(datum.idx - 1, 0), atoms.length - 1)
      return `${formatSkaAtomsExact(atoms[i])} ${coinLabel}`
    }
  }
}

// Sent/Received amount flow. Stacked bars; 4 series. VAR uses float columns; SKA
// uses lossy Number(atom) columns for geometry while formatValue reads exact strings.
// Net is sign-split into "Net Received" (net > 0) and "Net Spent" (net < 0, magnitude).
const FLOW_SERIES = ['Received', 'Spent', 'Net Received', 'Net Spent']

// Strip a leading '-' on an atom string (magnitude) without BigInt arithmetic.
function absAtom(atomStr) {
  return atomStr && atomStr.charAt(0) === '-' ? atomStr.slice(1) : atomStr
}

export function amountflowDef(coinType) {
  const isSKA = coinType > 0
  const coinLabel = renderCoinType(coinType)
  return {
    name: 'amountflow',
    label: `Total (${coinLabel})`,
    stacked: true,
    skipZeroRows: true, // stacked: drop 0-flow series rows from the tooltip
    axes: [{ label: '', scale: 'y' }],
    series: FLOW_SERIES.map((label, i) => ({
      label: label,
      scale: 'y',
      kind: 'bars',
      colorIndex: i,
      barAlign: HISTOGRAM_BAR_ALIGN,
      barSize: HISTOGRAM_BAR_SIZE
    })),
    toColumns: (raw, settings) => {
      const xs = secondsFromTimes(raw.time)
      let cols
      if (!isSKA) {
        const received = (raw.received || []).slice()
        const sent = (raw.sent || []).slice()
        const net = raw.net || []
        const netReceived = net.map((v) => (v > 0 ? v : 0))
        const netSent = net.map((v) => (v < 0 ? -v : 0))
        cols = [xs, received, sent, netReceived, netSent]
      } else {
        const toNum = (arr) => (arr || []).map((s) => Number(s) * SKA_ATOMS_TO_COIN)
        const received = toNum(raw.received_atoms)
        const sent = toNum(raw.sent_atoms)
        const netA = raw.net_atoms || []
        const netReceived = netA.map((s) =>
          s.charAt(0) === '-' ? 0 : Number(s) * SKA_ATOMS_TO_COIN
        )
        const netSent = netA.map((s) =>
          s.charAt(0) === '-' ? Number(s.slice(1)) * SKA_ATOMS_TO_COIN : 0
        )
        cols = [xs, received, sent, netReceived, netSent]
      }
      return padTrailingBin(cols, settings)
    },
    formatValue: (seriesIdx, datum) => {
      const p = datum.payload
      const i = datum.idx
      if (!isSKA) {
        // Read raw payload fields — datum.value is the stacked cumulative total
        // and must NOT be used here (stacking-immune; VAR floats are display-safe).
        let v
        if (seriesIdx === 0) v = p.received[i]
        else if (seriesIdx === 1) v = p.sent[i]
        else {
          const net = p.net[i]
          // seriesIdx 2: Net Received (net > 0); seriesIdx 3: Net Spent (magnitude).
          v = seriesIdx === 2 ? (net > 0 ? net : 0) : net < 0 ? -net : 0
        }
        return `${v} ${coinLabel}`
      }
      // SKA: exact strings, sign-split for the two net series.
      let atomStr
      if (seriesIdx === 0) atomStr = p.received_atoms[i]
      else if (seriesIdx === 1) atomStr = p.sent_atoms[i]
      else {
        const net = p.net_atoms[i]
        const isNeg = net.charAt(0) === '-'
        // seriesIdx === 2: Net Received; seriesIdx === 3: Net Spent (magnitude).
        atomStr = seriesIdx === 2 ? (isNeg ? '0' : net) : isNeg ? absAtom(net) : '0'
      }
      return `${formatSkaAtomsExact(atomStr)} ${coinLabel}`
    }
  }
}
