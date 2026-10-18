import test from 'node:test';
import assert from 'node:assert/strict';
import { runSeries, argMax, baseName } from '../src/utils/runCurves.js';
test('in-app curves win over scalars', () => {
  const s = runSeries({ lossCurve: [1, 0.5], accCurve: [0.6, 0.8], scalars: { 'val/accuracy': [{ step: 0, value: 0.1 }] } });
  assert.deepEqual(s.trainLoss, [1, 0.5]); assert.deepEqual(s.valAcc, [0.6, 0.8]); assert.deepEqual(s.valLoss, []);
});
test('synced runs fall back to scalar tags, ordered and deduped by step', () => {
  const s = runSeries({ scalars: {
    'val/acc': [{ step: 1, value: 0.7 }, { step: 0, value: 0.5 }, { step: 1, value: 0.75 }],
    'val/loss': [{ step: 0, value: 0.9 }],
    'train/loss': [{ step: 0, value: 1.2 }, { step: 1, value: null }],
  } });
  assert.deepEqual(s.valAcc, [0.5, 0.75]); assert.deepEqual(s.valLoss, [0.9]); assert.deepEqual(s.trainLoss, [1.2]);
});
test('missing data yields empty series', () => {
  assert.deepEqual(runSeries(null), { trainLoss: [], valLoss: [], valAcc: [] });
  assert.deepEqual(runSeries({}), { trainLoss: [], valLoss: [], valAcc: [] });
});
test('argMax and baseName', () => {
  assert.equal(argMax([]), -1); assert.equal(argMax([0.2, 0.9, 0.9, 0.1]), 1);
  assert.equal(baseName('/datasets/wildlife/'), 'wildlife'); assert.equal(baseName('C:\\data\\train.csv'), 'train.csv'); assert.equal(baseName(''), '');
});
