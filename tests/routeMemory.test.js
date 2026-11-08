import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteMemory } from '../src/state/routeMemory.js';

// Tiny harness: mirrors the app's effect, which re-runs after every navigate().
function setup() {
  const s = { project: null, page: 'dashboard', params: {}, ready: new Map() };
  const always = new Set(['dashboard', 'settings']);
  let mem;
  const run = () => {
    for (let i = 0; i < 10; i++) {
      const before = [s.project, s.page, s.params];
      mem.update(s.project, s.page, s.params);
      if (before[0] === s.project && before[1] === s.page && before[2] === s.params) return;
    }
    throw new Error('did not settle');
  };
  mem = createRouteMemory({
    isAvailable: (page) => always.has(page) || !!s.ready.get(s.project),
    navigate: (page, params) => { s.page = page; s.params = params; },
    runScoped: new Set(['run-detail', 'deploy-model', 'compare-runs']),
  });
  const api = {
    s,
    select(id) { s.project = id; run(); },
    go(page, params = {}) { s.page = page; s.params = params; run(); },
    setReady(id, v) { s.ready.set(id, v); run(); },
  };
  return api;
}

test('returns to the last view after visiting an unconnected project', () => {
  const a = setup();
  a.setReady(1, true);
  a.select(1);
  a.go('experiments');
  a.select(2); // not connected
  assert.equal(a.s.page, 'dashboard');
  a.select(1);
  assert.equal(a.s.page, 'experiments');
});

test('keeps run-scoped params per project', () => {
  const a = setup();
  a.setReady(1, true);
  a.setReady(2, true);
  a.select(1);
  const p = { runId: 'r1' };
  a.go('deploy-model', p);
  a.select(2);
  assert.equal(a.s.page, 'experiments', 'run pages of project 1 are not shown for project 2');
  a.go('netron');
  a.select(1);
  assert.equal(a.s.page, 'deploy-model');
  assert.equal(a.s.params, p);
  a.select(2);
  assert.equal(a.s.page, 'netron');
});

test('a brief disconnect does not lose the view', () => {
  const a = setup();
  a.setReady(1, true);
  a.select(1);
  a.go('run-detail', { runId: 'r9' });
  a.setReady(1, false); // e.g. reconnecting / sync state restoring
  assert.equal(a.s.page, 'dashboard');
  a.setReady(1, true);
  assert.equal(a.s.page, 'run-detail');
  assert.deepEqual(a.s.params, { runId: 'r9' });
});

test('returning while still unavailable waits on the dashboard, then restores', () => {
  const a = setup();
  a.setReady(1, true);
  a.select(1);
  a.go('experiments');
  a.select(2);
  a.setReady(1, false); // project 1 dropped while away
  a.select(1);
  assert.equal(a.s.page, 'dashboard');
  a.setReady(1, true);
  assert.equal(a.s.page, 'experiments');
});

test('choosing a page while bumped replaces the remembered one', () => {
  const a = setup();
  a.setReady(1, true);
  a.select(1);
  a.go('experiments');
  a.setReady(1, false);
  a.go('settings'); // user picks something reachable
  a.setReady(1, true);
  assert.equal(a.s.page, 'settings');
  a.select(2);
  a.select(1);
  assert.equal(a.s.page, 'settings');
});

test('choosing the dashboard itself is remembered', () => {
  const a = setup();
  a.setReady(1, true);
  a.select(1);
  a.go('experiments');
  a.go('dashboard');
  a.select(2);
  a.select(1);
  assert.equal(a.s.page, 'dashboard');
});

test('routes from a previous session are restored and changes are reported', () => {
  const saves = [];
  const s = { project: null, page: 'dashboard', params: {} };
  const mem = createRouteMemory({
    isAvailable: () => true,
    navigate: (page, params) => { s.page = page; s.params = params; },
    runScoped: new Set(),
    initial: [[1, { page: 'run-detail', params: { runId: 'r3' } }], [2, { bogus: true }]],
    onChange: (entries) => saves.push(entries),
  });
  const run = () => { for (let i = 0; i < 5; i++) mem.update(s.project, s.page, s.params); };
  s.project = 1; run();
  assert.equal(s.page, 'run-detail');
  assert.deepEqual(s.params, { runId: 'r3' });
  assert.equal(mem.remembered.has(2), false, 'malformed entries are ignored');
  assert.equal(saves.length, 0, 'restoring is not a change');
  s.page = 'experiments'; s.params = {}; run();
  assert.deepEqual(saves.at(-1), [[1, { page: 'experiments', params: {} }]]);
  mem.forget(1);
  assert.deepEqual(saves.at(-1), []);
});

test('after a restart the saved view waits for the connection', () => {
  const s = { project: null, page: 'dashboard', params: {}, ready: false };
  const mem = createRouteMemory({
    isAvailable: (p) => p === 'dashboard' || s.ready,
    navigate: (page, params) => { s.page = page; s.params = params; },
    runScoped: new Set(),
    initial: [[1, { page: 'experiments', params: {} }]],
  });
  const run = () => { for (let i = 0; i < 5; i++) mem.update(s.project, s.page, s.params); };
  s.project = 1; run();
  assert.equal(s.page, 'dashboard');
  s.ready = true; run();
  assert.equal(s.page, 'experiments');
});
