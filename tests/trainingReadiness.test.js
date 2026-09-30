import test from 'node:test';
import assert from 'node:assert/strict';
import { getTrainingReadiness } from '../src/utils/trainingReadiness.js';
const project = { datasetFormat: 'Folder', folderPath: '/dataset' };
const ready = (overrides = {}) => getTrainingReadiness({ project, ...overrides });
test('unknown checks do not block or claim dataset validation', () => {
  const r = ready(); assert.equal(r.blocked, false); assert.doesNotMatch(r.detail, /dataset validated/);
});
test('dataset failure explains the blocker', () => {
  const r = ready({ validation: { valid: false, errors: ['No classes found'] } });
  assert.equal(r.blocked, true); assert.equal(r.detail, 'No classes found');
});
test('only configured paths for the selected format block launch', () => {
  assert.equal(ready({ pathStatus: { trainPath: false } }).blocked, false);
  assert.equal(ready({ pathStatus: { folderPath: false } }).blocked, true);
  const csv = { datasetFormat: 'CSV', trainPath: '/train.csv', valPath: '/val.csv' };
  const r = ready({ project: csv, pathStatus: { trainPath: true, valPath: false, testPath: false } });
  assert.equal(r.blocked, true); assert.match(r.detail, /validation file/); assert.doesNotMatch(r.detail, /test file/);
});
test('environment errors and active runs prevent launch', () => {
  const r = ready({ environment: { status: 'error', message: 'Python missing' } });
  assert.equal(r.blocked, true); assert.equal(r.detail, 'Python missing'); assert.equal(ready({ active: true }).blocked, true);
});
test('successful validation produces a ready message', () => {
  const r = ready({ validation: { valid: true }, pathStatus: { folderPath: true }, environment: { status: 'exists' } });
  assert.equal(r.blocked, false); assert.match(r.detail, /dataset validated/);
});
