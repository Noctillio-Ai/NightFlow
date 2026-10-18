import test from 'node:test';
import assert from 'node:assert/strict';
import { seriesOf, pairMetrics, runInsight, bestIndex, lowerIsBetter } from '../src/utils/runMetrics.js';

const pts = (values, key = 'epoch') => values.map((value, i) => ({ [key]: i, value }));

test('seriesOf orders by epoch/step and keeps the last value per step', () => {
  assert.deepEqual(seriesOf([{ epoch: 1, value: 2 }, { epoch: 0, value: 1 }, { epoch: 1, value: 3 }]), [1, 3]);
  assert.deepEqual(seriesOf([0.5, NaN, 0.4]), [0.5, 0.4]);
  assert.deepEqual(seriesOf(undefined), []);
});

test('pairMetrics pairs train/val per metric, skips test, step and structured tags', () => {
  const m = pairMetrics({
    'train/loss': pts([2, 1.5]),
    'train/loss_step': pts([9, 9, 9]),
    'val/loss': pts([1.8, 1.4]),
    'train/accuracy': pts([0.4, 0.6]),
    'val/accuracy': pts([0.5, 0.65]),
    'test/accuracy': pts([0.6]),
    'val/confusion_matrix': { matrix: [[1]] },
    'sanity_val/loss': pts([3]),
    'lr-AdamW': pts([0.001, 0.0005]),
  });
  assert.deepEqual(m.map((g) => g.name), ['loss', 'accuracy', 'lr-AdamW']);
  assert.deepEqual(m[0], { name: 'loss', train: [2, 1.5], val: [1.8, 1.4] });
  assert.deepEqual(m[2].train, [0.001, 0.0005]);
});

test('bestIndex and lowerIsBetter', () => {
  assert.equal(bestIndex([0.3, 0.1, 0.2], true), 1);
  assert.equal(bestIndex([0.3, 0.9, 0.2], false), 1);
  assert.equal(bestIndex([], false), -1);
  assert.ok(lowerIsBetter('loss') && !lowerIsBetter('f1'));
});

test('runInsight flags clear overfitting', () => {
  const metrics = pairMetrics({ 'train/loss': pts([2, 1.5, 1.2, 1.0, 0.8, 0.6]), 'val/loss': pts([1.9, 1.4, 1.1, 1.2, 1.3, 1.4]) });
  const i = runInsight(metrics);
  assert.equal(i.tone, 'warn');
  assert.match(i.title, /rose 27% after epoch 3/);
});

test('runInsight notes accuracy still climbing, and stays quiet otherwise', () => {
  const climbing = pairMetrics({ 'val/accuracy': pts([0.4, 0.5, 0.55, 0.6, 0.63, 0.66]) });
  assert.equal(runInsight(climbing).tone, 'info');
  const plateau = pairMetrics({ 'val/accuracy': pts([0.4, 0.6, 0.7, 0.7, 0.69, 0.7]), 'train/loss': pts([2, 1, 0.9, 0.8, 0.7, 0.6]), 'val/loss': pts([1.5, 1, 0.9, 0.88, 0.89, 0.9]) });
  assert.equal(runInsight(plateau), null);
});
