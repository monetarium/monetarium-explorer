// Agenda-page chart definitions (Cumulative Vote Choices / Vote Choices By Block) for
// the uPlot adapter. Like the address definitions these are NOT registered globally —
// the agenda controller imports the factories directly. Vote counts are plain uint64
// integers (no SKA atoms), so there is no precision firewall here; formatValue still
// reads the RAW per-series count from the payload, never the stacked cumulative plot
// value, and shows it with the share-of-total percentage the legacy Dygraphs
// legendFormatter showed.

import { intComma } from '../format'
import { secondsFromTimes } from './address'

// Yes/Abstain/No in fixed series order. Colors mirror the legacy Dygraphs
// `colors:['rgb(0,153,0)','orange','red']`, but as hex so the adapter's
// fillForStroke -> hexToRgba can derive the translucent area/bar fill (a CSS color
// name would yield NaN and no fill). Same in light + dark (Dygraphs colors were not
// theme-aware), matching develop in both themes.
export const VOTE_SERIES = [
  { label: 'Yes', field: 'yes', color: '#009900' },
  { label: 'Abstain', field: 'abstain', color: '#ffa500' },
  { label: 'No', field: 'no', color: '#ff0000' }
]

// Sum of the three displayed vote series at row i — parity with the Dygraphs
// legendFormatter's `total = data.series.reduce(...y)` (the plotted series, NOT the
// payload's separate `total[]`). Treats missing/short arrays as 0.
function voteTotal(payload, i) {
  const at = (f) => (payload[f] && payload[f][i]) || 0
  return at('yes') + at('abstain') + at('no')
}

// "<count> (<pct>%)" exactly as agendasLegendFormatter rendered it: count is the raw
// per-series value (intComma -> "1,234", and "0" for a real zero), pct is the share of
// the 3-series total to 2 decimals, or the literal 0 when the bin has no votes (the
// legacy code's `total !== 0 ? ....toFixed(2) : 0`).
export function formatVote(seriesIdx, datum) {
  const p = datum.payload
  const i = datum.idx
  const val = (p[VOTE_SERIES[seriesIdx].field] || [])[i]
  const total = voteTotal(p, i)
  const pct = total !== 0 ? ((val * 100) / total).toFixed(2) : 0
  return `${intComma(val)} (${pct}%)`
}

// Build the [xs, yes, abstain, no] plot columns. `xs` is the caller-supplied x array
// (seconds for the time chart, heights for the block chart). Empty-safe: a missing
// payload or vote array yields empty columns (the chart draws nothing).
function voteColumns(raw, xs) {
  const r = raw || {}
  return [xs, ...VOTE_SERIES.map((s) => (r[s.field] || []).slice())]
}

// Cumulative vote choices over time: stacked AREA (legacy fillGraph + stackedGraph,
// default line plotter). The API already returns cumulative yes/abstain/no, so
// toColumns only reshapes — no accumulation here; the adapter stacks the three series.
export function cumulativeVoteChoicesDef() {
  return {
    name: 'cumulative-vote-choices',
    label: 'Cumulative Vote Choices Cast',
    stacked: true,
    // No rotated y-axis title: the chart title (in the template) already names the chart, and
    // a long vertical label clips on the compact large-screen height. Matches the address page.
    axes: [{ label: '', scale: 'y', intTicks: true }],
    series: VOTE_SERIES.map((s) => ({
      label: s.label,
      scale: 'y',
      kind: 'area',
      color: s.color
    })),
    toColumns: (raw) => voteColumns(raw, secondsFromTimes((raw && raw.time) || [])),
    formatValue: formatVote
  }
}

// Vote choices per block: stacked BARS on a block-height x-axis (NOT time). Default
// adapter bar geometry (centered, 60% width) ~ the legacy barChartPlotter's centered
// bars sized to the min point separation.
export function voteChoicesByBlockDef() {
  return {
    name: 'vote-choices-by-block',
    label: 'Vote Choices Cast',
    stacked: true,
    axes: [{ label: '', scale: 'y', intTicks: true }],
    series: VOTE_SERIES.map((s) => ({
      label: s.label,
      scale: 'y',
      kind: 'bars',
      color: s.color
    })),
    toColumns: (raw) => voteColumns(raw, ((raw && raw.height) || []).slice()),
    formatValue: formatVote
  }
}
