// Address-page chart definitions (Balance / Tx Type / Sent-Received) for the uPlot
// adapter. Unlike /charts definitions these are NOT registered globally — the address
// controller imports the factories directly. SKA precision firewall: formatValue reads
// the raw atom STRING from the payload, never the lossy plotted number.

import { intComma, formatSkaAtomsExact } from '../format'
import { renderCoinType } from '../../helpers/ska_helper'

const SKA_ATOMS_TO_COIN = 1e-18

// RFC3339 strings (TimeDef.MarshalJSON) -> integer UNIX seconds for the uPlot x-axis.
export function secondsFromTimes(times) {
  return times.map((t) => Math.floor(Date.parse(t) / 1000))
}

// VAR float -> display; SKA exact string from the atom payload.
function varOrSkaValue(coinType, value, atomStr, coinLabel) {
  if (coinType === 0) return `${value} ${coinLabel}`
  return `${formatSkaAtomsExact(atomStr)} ${coinLabel}`
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
    axes: [{ label: 'Tx Count', scale: 'y', intTicks: true }],
    series: TYPE_SERIES.map((s, i) => ({
      label: s.label,
      scale: 'y',
      kind: 'bars',
      colorIndex: i
    })),
    toColumns: (raw) => [
      secondsFromTimes(raw.time),
      ...TYPE_SERIES.map((s) => (raw[s.field] || []).slice())
    ],
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
    axes: [{ label: `Balance (${coinLabel})`, scale: 'y' }],
    series: [{ label: 'Balance', scale: 'y', kind: 'stepped', colorIndex: 0 }],
    toColumns: (raw) => {
      const xs = secondsFromTimes(raw.time)
      const ys = isSKA
        ? (raw.balance_atoms || []).map((s) => Number(s) * SKA_ATOMS_TO_COIN) // lossy — geometry only
        : (raw.balance || []).slice()
      return [xs, ys]
    },
    formatValue: (seriesIdx, datum) =>
      varOrSkaValue(
        coinType,
        datum.value,
        isSKA ? datum.payload.balance_atoms[datum.idx] : null,
        coinLabel
      )
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
    axes: [{ label: `Total (${coinLabel})`, scale: 'y' }],
    series: FLOW_SERIES.map((label, i) => ({
      label: label,
      scale: 'y',
      kind: 'bars',
      colorIndex: i
    })),
    toColumns: (raw) => {
      const xs = secondsFromTimes(raw.time)
      if (!isSKA) {
        const received = (raw.received || []).slice()
        const sent = (raw.sent || []).slice()
        const net = raw.net || []
        const netReceived = net.map((v) => (v > 0 ? v : 0))
        const netSent = net.map((v) => (v < 0 ? -v : 0))
        return [xs, received, sent, netReceived, netSent]
      }
      const toNum = (arr) => (arr || []).map((s) => Number(s) * SKA_ATOMS_TO_COIN)
      const received = toNum(raw.received_atoms)
      const sent = toNum(raw.sent_atoms)
      const netA = raw.net_atoms || []
      const netReceived = netA.map((s) => (s.charAt(0) === '-' ? 0 : Number(s) * SKA_ATOMS_TO_COIN))
      const netSent = netA.map((s) =>
        s.charAt(0) === '-' ? Number(s.slice(1)) * SKA_ATOMS_TO_COIN : 0
      )
      return [xs, received, sent, netReceived, netSent]
    },
    formatValue: (seriesIdx, datum) => {
      const p = datum.payload
      const i = datum.idx
      if (!isSKA) return `${datum.value} ${coinLabel}`
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
