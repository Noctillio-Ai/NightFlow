import test from 'node:test';
import assert from 'node:assert/strict';
import { testSetCandidates, detectTestSet } from '../src/utils/testSet.js';

const existing = (paths) => (p) => paths.includes(p);

test('a CSV project has a test set only when a test file is set', async () => {
  assert.deepEqual(testSetCandidates({ datasetFormat: 'CSV', testPath: ' ' }), []);
  assert.equal(await detectTestSet({ datasetFormat: 'CSV', testPath: '/d/test.csv' }, existing(['/d/test.csv'])), true);
  assert.equal(await detectTestSet({ datasetFormat: 'CSV', testPath: '/d/test.csv' }, existing([])), false);
});

test('folder layouts follow where AutoTimm looks for the test split', async () => {
  const folder = { taskType: 'Classification', datasetFormat: 'Folder', folderPath: '/d/' };
  assert.equal(await detectTestSet(folder, existing(['/d/test'])), true);
  assert.equal(await detectTestSet(folder, existing(['/d/val'])), false);

  const coco = { taskType: 'Object Detection', datasetFormat: 'COCO JSON', folderPath: '/d' };
  assert.equal(await detectTestSet(coco, existing(['/d/test2017'])), false);
  assert.equal(await detectTestSet(coco, existing(['/d/test2017', '/d/annotations/instances_test2017.json'])), true);

  const instance = { taskType: 'Instance Segmentation', datasetFormat: 'COCO JSON', folderPath: '/d' };
  assert.equal(await detectTestSet(instance, existing(['/d/annotations/instances_test.json'])), true);

  const masks = { taskType: 'Semantic Segmentation', datasetFormat: 'PNG Masks', folderPath: 'C:\\d' };
  assert.deepEqual(testSetCandidates(masks), [['C:\\d\\test\\images', 'C:\\d\\test\\masks']]);
});

test('a path that cannot be checked counts as missing', async () => {
  const project = { taskType: 'Classification', datasetFormat: 'Folder', folderPath: '/d' };
  assert.equal(await detectTestSet(project, () => Promise.reject(new Error('ssh failed'))), false);
});
