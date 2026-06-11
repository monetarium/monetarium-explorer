// Live-update mechanics shared by the home "latest blocks" table
// (home_latest_blocks_controller) and the /blocks listing (blocks_controller).
// Both render a newest-first, fixed-length block table that advances on live
// BLOCK_RECEIVED events and is rebuilt from the "getlatestblocks" websocket
// command on reconnect / detected gap. The two tables differ only in their
// column layout and template ids, so the row-cell filling stays in each
// controller (passed in as an insertGroup closure); the table-mutation
// algorithm — which rows to drop, the gap/stale/placeholder guards, the
// wipe-and-rebuild loop — lives here, in one copy.

// removeGroup removes every row of one block group (the block row plus its VAR
// and SKA sub-rows, all sharing data-block-id) from tableTarget.
function removeGroup(tableTarget, blockId) {
  const toRemove = tableTarget.querySelectorAll(`tr[data-block-id="${blockId}"]`)
  toRemove.forEach((r) => tableTarget.removeChild(r))
}

// applyLiveBlock applies one live block to a newest-first block table, keeping
// the row count stable. It encapsulates the branch logic the two live tables
// share:
//   block.height === tip → replace the tip group in place (reorg / tip re-send)
//   block.height  >  tip → advance: drop the oldest group, prepend the new one
//   block.height  <  tip → ignore (stale / behind a reorg)
// Using > (not === tip+1) keeps the table live across height gaps: a skipped
// block (busy chain, stale initial render, or one missed during the connect
// window) would otherwise match neither branch and freeze updates permanently,
// because the DOM tip never advanced.
//
// insertGroup(block, referenceNode) clones and fills the per-table row template
// (caller-owned, since column layouts differ) and inserts the block group
// before referenceNode, or appends when referenceNode is null.
//
// Returns isGap: true when at least one height was skipped, so the caller should
// request an authoritative refresh to fill the missing rows. A block that was
// ignored (older than the tip, or an empty table) returns false.
export function applyLiveBlock(tableTarget, block, insertGroup) {
  const blockRows = tableTarget.querySelectorAll('tr[data-coin-accordion-target="blockRow"]')
  if (blockRows.length === 0) return false
  const lastHeight = parseInt(blockRows[0].dataset.height)

  let isGap = false
  if (block.height === lastHeight) {
    removeGroup(tableTarget, lastHeight)
  } else if (block.height > lastHeight) {
    isGap = block.height > lastHeight + 1
    removeGroup(tableTarget, blockRows[blockRows.length - 1].dataset.blockId)
  } else {
    return false
  }

  // Re-query after removals — the original first row may have been detached.
  const currentFirstBlockRow = tableTarget.querySelector(
    'tr[data-coin-accordion-target="blockRow"]'
  )
  insertGroup(block, currentFirstBlockRow)
  return isGap
}

// rebuildBlockTable rebuilds a newest-first block table from a "getlatestblocks"
// response payload (a JSON array of server BlockBasic objects, newest first).
// It parses and validates the payload, refuses to move the table backwards (a
// stale response that arrived after a newer live block already advanced the DOM
// tip), then wipes and re-inserts each block — recovering the exact window,
// including blocks missed while disconnected.
//
// insertGroup(block, referenceNode) is the caller-owned per-table inserter
// (referenceNode null → append, preserving the server's newest-first order).
// label tags the warning logged for a non-JSON payload (the server sends a
// non-JSON "Error: ..." string when the refresh fails).
export function rebuildBlockTable(tableTarget, evt, insertGroup, label) {
  let blocks
  try {
    blocks = JSON.parse(evt)
  } catch {
    console.warn(`${label}: discarding non-JSON getlatestblocks payload:`, evt)
    return
  }
  if (!Array.isArray(blocks) || blocks.length === 0) return

  // Don't let a stale refresh move the table backwards: a newer live block may
  // have advanced the DOM tip after this list was requested, and the response
  // (computed at an older server tip) would visibly regress it. The live stream
  // already has us at or ahead of this list, so drop it.
  const existing = tableTarget.querySelector('tr[data-coin-accordion-target="blockRow"]')
  if (existing) {
    const currentTip = parseInt(existing.dataset.height)
    if (!Number.isNaN(currentTip) && Number(blocks[0].height) < currentTip) return
  }

  tableTarget.innerHTML = ''
  for (const block of blocks) {
    // Skip zero-value placeholder blocks the server pads failed heights with
    // (empty hash) so we never render a /block/0 row with a year-0001 age.
    if (!block.hash) continue
    // The websocket newblock path stamps unixStamp client-side; the REST-style
    // list carries RFC3339 `time`, so derive it the same way here.
    if (block.unixStamp === undefined && block.time) {
      block.unixStamp = new Date(block.time).getTime() / 1000
    }
    insertGroup(block, null)
  }
}
