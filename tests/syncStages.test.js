import test from 'node:test';
import assert from 'node:assert/strict';
import { stageOf, buildSyncSteps, cleanMessage, formatElapsed } from '../src/utils/syncStages.js';

const log = (message, type = 'info') => ({ message, type, timestamp: '' });

test('stageOf maps the real sync messages to their stage', () => {
  assert.equal(stageOf('Starting sync...'), -1);
  assert.equal(stageOf('Local mode'), 0);
  assert.equal(stageOf('Creating project directory locally...'), 0);
  assert.equal(stageOf('conda not found, falling back to uv'), 0);
  assert.equal(stageOf('uv ready (0.4.18)'), 0);
  assert.equal(stageOf('Setting up Python 3.12 environment with latest autotimm...'), 1);
  assert.equal(stageOf('Python environment ready (uv · Python 3.12.4)'), 1);
  assert.equal(stageOf('Reinstalled autotimm 0.7.34 (was 0.7.30)'), 1);
  assert.equal(stageOf('Could not reinstall autotimm, so the existing 0.7.30 is still in use: offline'), 1);
  assert.equal(stageOf('Checking dataset paths...'), 2);
  assert.equal(stageOf('✓ folderPath: /datasets/wildlife'), 2);
  assert.equal(stageOf("✗ Class folder 'zebra' is empty"), 2);
  assert.equal(stageOf('Loading runs...'), 3);
  assert.equal(stageOf('Synced metrics for 3 of 5 run(s)'), 3);
  assert.equal(stageOf('Sync completed successfully ✓'), -1);
});

test('buildSyncSteps marks earlier stages done and the furthest one active', () => {
  const logs = [log('Starting sync...'), log('Local mode'), log('Local directory ready', 'success'), log('Setting up Python 3.12 environment with latest autotimm...')];
  const steps = buildSyncSteps(logs, 'syncing');
  assert.deepEqual(steps.map((s) => s.state), ['done', 'active', 'pending', 'pending']);
  assert.equal(steps[1].detail, 'Setting up Python 3.12 environment with latest autotimm…');
  assert.equal(steps[0].detail, 'Local directory ready');
});

test('buildSyncSteps surfaces errors and warnings', () => {
  const logs = [log('Local mode'), log('Python environment ready', 'success'), log('Checking dataset paths...'), log('✗ zebra is empty', 'error'), log('Loading runs...')];
  assert.deepEqual(buildSyncSteps(logs, 'complete').map((s) => s.state), ['done', 'done', 'error', 'done']);
  const failed = buildSyncSteps([log('Local mode'), log('Python env setup failed: boom', 'error')], 'failed');
  assert.deepEqual(failed.map((s) => s.state), ['done', 'error', 'pending', 'pending']);
  assert.deepEqual(buildSyncSteps([], 'idle').map((s) => s.state), ['pending', 'pending', 'pending', 'pending']);
});

test('helpers', () => {
  assert.equal(cleanMessage('✓ Dataset structure valid'), 'Dataset structure valid');
  assert.equal(formatElapsed(45_000), '45s');
  assert.equal(formatElapsed(125_000), '2m 05s');
});
