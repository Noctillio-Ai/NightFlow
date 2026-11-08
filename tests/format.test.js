import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime, formatDuration, formatPercent, formatBytes } from '../src/utils/format.js';
const now = Date.parse('2026-01-10T12:00:00Z');
test('relative time buckets', () => {
  assert.equal(formatRelativeTime(null, now), '—');
  assert.equal(formatRelativeTime('2026-01-10T11:59:40Z', now), 'just now');
  assert.equal(formatRelativeTime('2026-01-10T11:55:00Z', now), '5m ago');
  assert.equal(formatRelativeTime('2026-01-10T09:00:00Z', now), '3h ago');
  assert.equal(formatRelativeTime('2026-01-08T12:00:00Z', now), '2d ago');
});
test('duration formatting', () => {
  assert.equal(formatDuration('2026-01-10T12:00:00Z', null), '—');
  assert.equal(formatDuration('2026-01-10T12:00:00Z', '2026-01-10T12:00:45Z'), '45s');
  assert.equal(formatDuration('2026-01-10T12:00:00Z', '2026-01-10T12:12:00Z'), '12m');
  assert.equal(formatDuration('2026-01-10T12:00:00Z', '2026-01-10T13:05:00Z'), '1h 05m');
  assert.equal(formatDuration('2026-01-10T13:00:00Z', '2026-01-10T12:00:00Z'), '—');
});
test('percent formatting', () => {
  assert.equal(formatPercent(null), '—');
  assert.equal(formatPercent(0.92), '92.0%');
});
test('byte formatting', () => {
  assert.equal(formatBytes(undefined), '—');
  assert.equal(formatBytes(812), '812 B');
  assert.equal(formatBytes(4300), '4.20 KB');
  assert.equal(formatBytes(21.3 * 1024 * 1024), '21.3 MB');
  assert.equal(formatBytes(143 * 1024 * 1024), '143 MB');
  assert.equal(formatBytes(1.07 * 1024 ** 3), '1.07 GB');
});
