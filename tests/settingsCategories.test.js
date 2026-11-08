import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDITABLE_KEYS, SETTINGS_CATEGORIES, dirtyCategories } from '../src/utils/settingsCategories.js';

test('every editable field belongs to exactly one category', () => {
  const owners = new Map();
  for (const c of SETTINGS_CATEGORIES) {
    for (const k of c.keys) {
      assert.ok(!owners.has(k), `${k} is in both ${owners.get(k)} and ${c.id}`);
      owners.set(k, c.id);
    }
  }
  for (const k of EDITABLE_KEYS) assert.ok(owners.has(k), `${k} has no category`);
  for (const k of owners.keys()) assert.ok(EDITABLE_KEYS.includes(k), `${k} is not an editable key`);
});

test('category ids are unique', () => {
  const ids = SETTINGS_CATEGORIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('dirty categories follow changed fields', () => {
  const saved = { name: 'a', maxEpochs: 10 };
  const draft = { ...Object.fromEntries(EDITABLE_KEYS.map((k) => [k, saved[k] ?? ''])) };
  assert.deepEqual([...dirtyCategories(draft, saved)], []);
  draft.maxEpochs = 20;
  draft.name = 'b';
  assert.deepEqual([...dirtyCategories(draft, saved)].sort(), ['general', 'hyperparameters']);
});
