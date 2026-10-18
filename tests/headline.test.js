import test from 'node:test';
import assert from 'node:assert/strict';
import { headlineFor, pickTag } from '../src/utils/headline.js';
import { pickTestAcc } from '../src/utils/testMetrics.js';
import { runSeries } from '../src/utils/runCurves.js';
import { headlineMetrics, formatValue, formatDelta } from '../src/utils/compareRuns.js';
import { pairMetrics } from '../src/utils/runMetrics.js';

test('detection runs are scored by mAP, everything else by accuracy', () => {
  assert.equal(headlineFor('Object Detection').name, 'mAP');
  assert.equal(headlineFor('Object Detection').format(0.45237), '0.452');
  assert.equal(headlineFor('Classification').format(0.8123), '81.2%');
  assert.equal(headlineFor(undefined).name, 'accuracy');
  assert.equal(pickTag({ 'val/map': NaN, 'x': 1 }, ['val/map']), null);
});

test('test and validation scores follow the task', () => {
  const metrics = { 'test/accuracy': 0.9, 'test/map': 0.41 };
  assert.equal(pickTestAcc(metrics, 'Object Detection'), 0.41);
  assert.equal(pickTestAcc(metrics, 'Classification'), 0.9);
  const scalars = { 'val/map': [{ step: 0, value: 0.2 }, { step: 1, value: 0.35 }], 'val/accuracy': [{ step: 0, value: 0.7 }] };
  assert.deepEqual(runSeries({ taskType: 'Object Detection', scalars }).valAcc, [0.2, 0.35]);
  assert.deepEqual(runSeries({ scalars }).valAcc, [0.7]);
});

test('detection comparisons lead with mAP, formatted as a number', () => {
  const runs = [{ taskType: 'Object Detection', testAcc: 0.3 }, { taskType: 'Object Detection', testAcc: 0.32 }];
  const h = headlineMetrics(runs, [{ val: { map: [0.2, 0.31], map_50: [0.5] } }, { val: { map: [0.33], map_50: [0.55] } }]);
  assert.deepEqual(h.map((e) => e.id), ['val_map', 'val_map_50', 'test_map']);
  assert.equal(h[0].lead.index, 1);
  assert.equal(formatValue('map', 0.3312), '0.331');
  assert.equal(formatDelta('map', 0.02), '+0.020');
});

test('mAP charts sort before other metrics and -1 placeholders are dropped', () => {
  const m = pairMetrics({
    'train/loss': [{ step: 0, value: 1 }, { step: 1, value: 0.5 }],
    'val/mar_100': [{ step: 0, value: 0.1 }, { step: 1, value: 0.2 }],
    'val/map': [{ step: 0, value: 0.1 }, { step: 1, value: 0.2 }],
    'val/map_per_class': [{ step: 0, value: -1 }, { step: 1, value: -1 }],
  });
  assert.deepEqual(m.map((x) => x.name), ['loss', 'map', 'mar_100']);
});

test('detection metric names read as mAP/mAR labels', async () => {
  const { formatLabel } = await import('../src/utils/hparams.js');
  assert.deepEqual(['map', 'map_50', 'mar_100', 'map_small', 'batch_size'].map(formatLabel), ['mAP', 'mAP@50', 'mAR@100', 'mAP small', 'Batch Size']);
});

test('comparisons drop -1 placeholder metrics too', async () => {
  const { metricsBySplit } = await import('../src/utils/compareRuns.js');
  const by = metricsBySplit({ 'val/map': [{ step: 0, value: 0.3 }], 'val/map_per_class': [{ step: 0, value: -1 }] });
  assert.deepEqual(Object.keys(by.val), ['map']);
});
