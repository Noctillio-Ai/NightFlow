import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectsBase, defaultProjectPath, projectSlug, pathPlatform, isDefaultProjectPath, normalizeProjectPath,
} from '../src/utils/projectPaths.js';

test('new projects default to a hidden ~/.nightflow folder', () => {
  assert.equal(projectsBase('macos'), '~/.nightflow/projects/');
  assert.equal(projectsBase('linux'), '~/.nightflow/projects/');
  assert.equal(projectsBase('windows'), '~\\.nightflow\\projects\\');
});

test('remote projects use forward slashes even from Windows', () => {
  assert.equal(pathPlatform('remote', 'windows'), 'remote');
  assert.equal(pathPlatform('localhost', 'windows'), 'windows');
  assert.equal(defaultProjectPath('GPU Run', pathPlatform('remote', 'windows')), '~/.nightflow/projects/gpu-run/');
  assert.equal(defaultProjectPath('GPU Run', pathPlatform('localhost', 'windows')), '~\\.nightflow\\projects\\gpu-run\\');
});

test('default project folder per name', () => {
  assert.equal(defaultProjectPath('Retail Shelf!', 'macos'), '~/.nightflow/projects/retail-shelf/');
  assert.equal(defaultProjectPath('', 'linux'), '~/.nightflow/projects/project/');
  assert.equal(projectSlug('  --A_b c--  '), 'a-b-c');
});

test('recognises defaults in either style, with or without a trailing separator', () => {
  assert.ok(isDefaultProjectPath('', 'x'));
  assert.ok(isDefaultProjectPath('~\\.nightflow\\projects\\gpu-run', 'GPU Run'));
  assert.ok(isDefaultProjectPath('~/.nightflow/projects/gpu-run/', 'GPU Run'));
  assert.ok(isDefaultProjectPath('~/.nightflow/projects/', 'anything'));
  assert.ok(!isDefaultProjectPath('~/work/gpu-run/', 'GPU Run'));
  assert.ok(!isDefaultProjectPath('~/.nightflow/projects/other/', 'GPU Run'));
});

test('one trailing separator of the right style', () => {
  assert.equal(normalizeProjectPath('~/a/b', 'macos'), '~/a/b/');
  assert.equal(normalizeProjectPath('~/a/b///', 'linux'), '~/a/b/');
  assert.equal(normalizeProjectPath('~\\a\\b', 'windows'), '~\\a\\b\\');
  assert.equal(normalizeProjectPath('C:\\x\\', 'windows'), 'C:\\x\\');
  // The old bug: "~\\a\\b\\" gained a "/" after the backslash.
  assert.notEqual(normalizeProjectPath('~\\a\\b\\', 'windows'), '~\\a\\b\\/');
  assert.equal(normalizeProjectPath('~\\.nightflow\\projects\\gpu\\', 'remote'), '~/.nightflow/projects/gpu/');
  assert.equal(normalizeProjectPath('', 'remote'), '');
});
