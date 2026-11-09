import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutTiles, columnsFor } from '../src/utils/settingsGrid.js';

const tiles = (n) => Array.from({ length: n }, () => ({ wide: false }));

test('column count follows the number of tiles', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 11].map(columnsFor), [1, 2, 3, 2, 3, 3, 3, 3]);
});

test('a lone tile spans the row; pairs and triples fill exactly', () => {
  assert.deepEqual(layoutTiles(tiles(1)), { cols: 1, cols2: 1, spans: [1], spans2: [1] });
  assert.deepEqual(layoutTiles(tiles(2)).spans, [1, 1]);
  assert.deepEqual(layoutTiles(tiles(3)).spans, [1, 1, 1]);
});

test('four tiles form a 2×2 block', () => {
  const l = layoutTiles(tiles(4));
  assert.equal(l.cols, 2);
  assert.deepEqual(l.spans, [1, 1, 1, 1]);
});

test('the last tile of an incomplete row stretches to its end', () => {
  // 5 in 3 columns: 3 + 2 → last spans 2. In 2 columns: 2 + 2 + 1 → last spans 2.
  const five = layoutTiles(tiles(5));
  assert.deepEqual(five.spans, [1, 1, 1, 1, 2]);
  assert.deepEqual(five.spans2, [1, 1, 1, 1, 2]);
  // 7 in 3 columns: 3 + 3 + 1 → last spans 3.
  assert.deepEqual(layoutTiles(tiles(7)).spans, [1, 1, 1, 1, 1, 1, 3]);
});

test('wide tiles split runs; each run fills on its own', () => {
  // [a b c] [WIDE] [d] → 3 columns; d alone spans 3.
  const l = layoutTiles([{}, {}, {}, { wide: true }, {}].map((t) => ({ wide: !!t.wide })));
  assert.equal(l.cols, 3);
  assert.deepEqual(l.spans, [1, 1, 1, 1, 3]);
  assert.deepEqual(l.spans2, [1, 1, 2, 1, 2]);
});

test('only wide tiles: one column', () => {
  assert.deepEqual(layoutTiles([{ wide: true }, { wide: true }]).cols, 1);
});
