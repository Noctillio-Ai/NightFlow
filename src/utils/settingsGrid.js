// Layout for a group of setting tiles, so every row is filled.
//
// A group's tiles are split into runs by "wide" tiles (which take a full row
// of their own). The column count comes from the longest run: 1 → 1, 2 → 2,
// 3 → 3, 4 → 2 (a 2×2 block), 5+ → 3. In every run, the last tile of an
// incomplete row stretches to the end of that row. A second layout with at
// most 2 columns is computed for narrower panels.

/** Columns for a group whose longest run has `n` tiles. */
export function columnsFor(n) {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n === 3) return 3;
  if (n === 4) return 2;
  return 3;
}

function spansFor(items, cols) {
  const spans = new Array(items.length).fill(1);
  let run = [];
  const flush = () => {
    const rest = run.length % cols;
    if (run.length && rest) spans[run[run.length - 1]] = cols - rest + 1;
    run = [];
  };
  items.forEach((it, i) => {
    if (it.wide) flush();
    else run.push(i);
  });
  flush();
  return spans;
}

/**
 * items: [{ wide }] in display order.
 * → { cols, cols2, spans: [n], spans2: [n] } (wide items keep span 1; their
 *   CSS already spans the full row).
 */
export function layoutTiles(items) {
  let longest = 0;
  let current = 0;
  for (const it of items) {
    current = it.wide ? 0 : current + 1;
    longest = Math.max(longest, current);
  }
  const cols = columnsFor(longest);
  const cols2 = Math.min(cols, 2);
  return { cols, cols2, spans: spansFor(items, cols), spans2: spansFor(items, cols2) };
}
