import test from 'node:test';
import assert from 'node:assert/strict';
import { classificationStats, confusedPairs } from '../src/utils/classificationStats.js';

// rows actual, cols predicted
const M = [
  [8, 2, 0],
  [1, 9, 0],
  [0, 5, 5],
];

test('classificationStats computes accuracy, per-class metrics, support and flags', () => {
  // fox is mostly predicted as dog: F1 ≈ 0.46 vs a macro average ≈ 0.65 → flagged
  const W = [[8, 2, 0], [1, 9, 0], [0, 7, 3]];
  const s = classificationStats(W, ['cat', 'dog', 'fox']);
  assert.equal(s.total, 30);
  assert.equal(s.accuracy, 20 / 30);
  assert.deepEqual(s.classes.map((c) => c.support), [10, 10, 10]);
  const dog = s.classes[1];
  assert.equal(dog.precision, 9 / 18);
  assert.equal(dog.recall, 0.9);
  assert.equal(s.best.label, 'cat');
  assert.equal(s.worst.label, 'fox');
  assert.ok(s.flagged.has(2) && !s.flagged.has(0));
});

test('classificationStats prefers the logged per-class numbers', () => {
  const s = classificationStats(M, [], [{ class_index: 0, precision: 0.5, recall: 0.5, f1: 0.5 }]);
  assert.equal(s.classes[0].f1, 0.5);
  assert.equal(s.classes[0].label, 'Class 0');
  assert.equal(classificationStats([], []), null);
});

test('confusedPairs ranks off-diagonal cells with their share of the actual class', () => {
  const p = confusedPairs(M, 2);
  assert.deepEqual(p, [
    { actual: 2, predicted: 1, count: 5, share: 0.5 },
    { actual: 0, predicted: 1, count: 2, share: 0.2 },
  ]);
});
