import test from 'node:test';
import assert from 'node:assert/strict';
import {
  metricsBySplit,
  compareSplits,
  leader,
  headlineMetrics,
  configRows,
  formatDelta,
  formatMs,
  comparisonMarkdown,
} from '../src/utils/compareRuns.js';
import { spreadLabels } from '../src/utils/chartLayout.js';

const pts = (values) => values.map((value, epoch) => ({ epoch, value }));

test('metricsBySplit groups by split, drops step series and structured tags', () => {
  const s = metricsBySplit({
    'train/loss_epoch': pts([2, 1]),
    'train/loss_step': pts([9, 9, 9]),
    'val/accuracy': pts([0.5, 0.7]),
    'test/accuracy': pts([0.68]),
    'test/confusion_matrix': [[1]],
    'lr-AdamW': pts([0.1, 0.01]),
  });
  assert.deepEqual(s.train, { loss: [2, 1] });
  assert.deepEqual(s.val, { accuracy: [0.5, 0.7] });
  assert.deepEqual(s.test, { accuracy: [0.68] });
  assert.deepEqual(s.other, { 'lr-AdamW': [0.1, 0.01] });
});

test('compareSplits unions metrics across runs in a stable order', () => {
  const splits = compareSplits([
    { val: { accuracy: [1] }, custom: { x: [1] } },
    { train: { f1: [1], loss: [1] }, val: { loss: [1] } },
  ]);
  assert.deepEqual(splits.map((s) => s.id), ['train', 'val', 'custom']);
  assert.deepEqual(splits[0].metrics, ['loss', 'f1']);
  assert.deepEqual(splits[1].metrics, ['loss', 'accuracy']);
  assert.equal(splits[1].label, 'Validation');
});

test('leader picks the best value and its margin over the runner-up', () => {
  assert.deepEqual(leader([0.9, 0.93, undefined], false), { index: 1, value: 0.93, runnerUp: 0, runnerUpValue: 0.9, delta: 0.93 - 0.9 });
  assert.equal(leader([0.3, 0.25], true).index, 1);
  assert.ok(leader([0.3, 0.25], true).delta < 0);
  assert.equal(leader([0.5, undefined], false), null);
});

test('headlineMetrics only keeps numbers at least two runs share', () => {
  const runs = [
    { created: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:10:00Z', testAcc: 0.8 },
    { created: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:12:00Z', bestAcc: 0.7 },
  ];
  const h = headlineMetrics(runs, [{ val: { accuracy: [0.6, 0.75], loss: [1, 0.5] } }, {}]);
  assert.deepEqual(h.map((m) => m.id), ['val_acc', 'time']);
  assert.equal(h[0].lead.index, 0);
  assert.equal(h[1].lead.index, 0);
  assert.equal(h[1].lead.delta, -120000);
});

test('configRows merges camelCase and snake_case settings and marks differences', () => {
  const rows = configRows([
    { backbone: 'resnet50', hyperparameters: { lr: 0.001, batchSize: 32 }, fileHparams: { batch_size: 32, seed: 1 } },
    { backbone: 'resnet50', hyperparameters: { learningRate: 0.0003 }, fileHparams: { batch_size: 64 } },
  ]);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(rows.slice(0, 3).map((r) => r.key), ['backbone', 'lr', 'batchsize']);
  assert.equal(byKey.backbone.differs, false);
  assert.deepEqual(byKey.lr.values, ['1.0e-3', '3.0e-4']);
  assert.equal(byKey.lr.label, 'Learning rate');
  assert.deepEqual(byKey.batchsize.values, ['32', '64']);
  assert.deepEqual(byKey.seed.values, ['1', '—']);
  assert.ok(byKey.seed.differs);
});

test('formatting helpers', () => {
  assert.equal(formatDelta('score', 0.0104), '+1.0 pts');
  assert.equal(formatDelta('number', -0.053), '−0.0530');
  assert.equal(formatDelta('duration', -207000), '−3m 27s');
  assert.equal(formatMs(734000), '12m 14s');
  assert.equal(formatMs(3_900_000), '1h 05m');
});

test('comparisonMarkdown renders headline and differing settings', () => {
  const runs = [{ name: 'a' }, { name: 'b|c' }];
  const md = comparisonMarkdown(
    runs,
    [{ label: 'Validation accuracy', kind: 'score', values: [0.9, 0.8], lead: { index: 0 } }],
    [{ label: 'Batch size', values: ['32', '64'], differs: true }, { label: 'Seed', values: ['1', '1'], differs: false }],
  );
  assert.match(md, /\| Validation accuracy \| 90\.0% \*\*best\*\* \| 80\.0% \|/);
  assert.match(md, /b\\\|c/);
  assert.match(md, /\| Batch size \| 32 \| 64 \|/);
  assert.doesNotMatch(md, /Seed/);
});

test('spreadLabels keeps labels apart and inside the bounds', () => {
  assert.deepEqual(spreadLabels([50, 52], 20, 0, 100), [50, 70]);
  assert.deepEqual(spreadLabels([98, 99], 20, 0, 100), [80, 100]);
  assert.deepEqual(spreadLabels([10, 60], 20, 0, 100), [10, 60]);
});
