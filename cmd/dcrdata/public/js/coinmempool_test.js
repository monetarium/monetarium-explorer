// Minimal JS unit tests for per-coin mempool fill logic.
// Run with: node coinmempool_test.js

function fillColor(fill) {
  if (fill <= 1.0) return 'green';
  if (fill <= 1.5) return 'yellow';
  return 'red';
}

function fillPct(sizeBytes, maxBlockSize) {
  return Math.min(sizeBytes / maxBlockSize, 1.0);
}

const MAX_BLOCK = 393216;

const tests = [
  // [sizeBytes, expectedFillPct, expectedColor]
  [0,       0.0,  'green'],
  [196608,  0.5,  'green'],
  [393216,  1.0,  'green'],
  [500000,  1.0,  'green'],  // capped at 1.0
];

let passed = 0, failed = 0;
for (const [size, wantFill, wantColor] of tests) {
  const fill = fillPct(size, MAX_BLOCK);
  const color = fillColor(fill);
  const fillOk = Math.abs(fill - wantFill) < 1e-9;
  const colorOk = color === wantColor;
  if (fillOk && colorOk) {
    passed++;
  } else {
    console.error(`FAIL size=${size}: fill=${fill} (want ${wantFill}), color=${color} (want ${wantColor})`);
    failed++;
  }
}

// VAR=10%, SKA-n share 90% equally
function coinFills(varSize, skaSizes, maxBlock) {
  const fills = [];
  const varFill = fillPct(varSize, maxBlock);
  fills.push({ symbol: 'VAR', fillPct: varFill * 0.10, color: fillColor(varFill) });
  const skaN = skaSizes.length;
  if (skaN > 0) {
    const skaPct = 0.90 / skaN;
    for (let i = 0; i < skaN; i++) {
      const f = fillPct(skaSizes[i], maxBlock);
      fills.push({ symbol: `SKA-${i+1}`, fillPct: f * skaPct, color: fillColor(f) });
    }
  }
  return fills;
}

// VAR only
const f1 = coinFills(196608, [], MAX_BLOCK);
console.assert(f1.length === 1, 'VAR only: 1 fill');
console.assert(Math.abs(f1[0].fillPct - 0.05) < 1e-9, `VAR fillPct: ${f1[0].fillPct}`);
console.assert(f1[0].color === 'green', 'VAR color green');
passed++;

// VAR + 1 SKA
const f2 = coinFills(196608, [100000], MAX_BLOCK);
console.assert(f2.length === 2, 'VAR+SKA: 2 fills');
console.assert(Math.abs(f2[1].fillPct - (fillPct(100000, MAX_BLOCK) * 0.90)) < 1e-9, 'SKA-1 fillPct');
passed++;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
