import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildManifest, parseManifest, materializeImport, nextProjectId, importName,
  scrubPaths, looksLikePath, suggestFileName, describeManifest, FORMAT_VERSION,
  datasetSources, datasetFields, portablePath, bundledDatasetPaths,
} from '../src/utils/transfer.js';

const project = {
  id: '3', name: 'Retail Shelf', taskType: 'Object Detection', connectionType: 'remote',
  sshCommand: 'ssh -i /Users/me/.ssh/gpu -o IdentitiesOnly=yes ubuntu@gpu', projectPath: '~/nightflow/projects/retail/',
  folderPath: '/data/shelves/', trainPath: '', maxEpochs: 20, syncMetadata: { last: 1 },
};
const runs = [
  { id: 'r-1', projectId: '3', name: 'brave-otter-1', dataset: '/data/shelves/', scalars: { 'val/map': [{ step: 1, value: 0.5 }] },
    fileHparams: { data: { train_dir: '/data/shelves/train', note: 'not a path' } } },
  { id: 'r-2', projectId: '3', name: 'calm-yak-2', dataset: '/data/shelves/' },
];
const now = new Date('2026-11-09T10:00:00Z');

test('lite keeps settings only, standard keeps runs', () => {
  const lite = buildManifest({ level: 'lite', project, runs, includeConnection: true, now });
  assert.equal(lite.format, 'nightflow');
  assert.equal(lite.version, FORMAT_VERSION);
  assert.equal(lite.runs.length, 0);
  assert.equal(lite.project.maxEpochs, 20);
  assert.equal('syncMetadata' in lite.project, false);
  const std = buildManifest({ level: 'standard', project, runs, includeConnection: true, now });
  assert.equal(std.runs.length, 2);
  assert.deepEqual(std.runs[0].scalars, runs[0].scalars);
});

test('without connection details, SSH and paths are removed everywhere', () => {
  const m = buildManifest({ level: 'standard', project, runs, includeConnection: false, now });
  const { project: p, runs: rs, strippedFields } = m;
  assert.equal(m.includesConnection, false);
  assert.equal(p.sshCommand, '');
  assert.equal(p.projectPath, '');
  assert.equal(p.folderPath, '');
  assert.equal(p.connectionType, 'remote'); // where it runs isn't sensitive
  assert.deepEqual(strippedFields.sort(), ['folderPath', 'projectPath', 'sshCommand']);
  assert.equal(rs[0].dataset, 'shelves');
  assert.equal(rs[0].fileHparams.data.train_dir, 'train');
  assert.equal(rs[0].fileHparams.data.note, 'not a path');
  const json = JSON.stringify(m);
  assert.ok(!json.includes('/data/') && !json.includes('ubuntu@gpu') && !json.includes('.ssh'));
});

test('local projects keep "localhost" as their command when stripped', () => {
  const local = { ...project, connectionType: 'localhost', sshCommand: 'localhost' };
  const m = buildManifest({ level: 'lite', project: local, includeConnection: false, now });
  assert.equal(m.project.sshCommand, 'localhost');
  assert.ok(!m.strippedFields.includes('sshCommand'));
});

test('unknown levels are refused', () => {
  assert.throws(() => buildManifest({ level: 'huge', project, includeConnection: true }));
});

test('path detection', () => {
  for (const p of ['/data/x', '~/x/y', 'C:\\data\\x', 'D:/x', '\\\\server\\share']) assert.ok(looksLikePath(p), p);
  for (const p of ['val/map', 'hello', '', 'a/b', 42, null]) assert.equal(looksLikePath(p), false, String(p));
  assert.deepEqual(scrubPaths({ a: ['/x/y/z.png', 'k'], b: 1 }), { a: ['z.png', 'k'], b: 1 });
});

test('parses v2 and rejects newer or broken files', () => {
  const m = buildManifest({ level: 'standard', project, runs, includeConnection: true, now });
  assert.equal(parseManifest(JSON.stringify(m)).manifest.runs.length, 2);
  assert.match(parseManifest(JSON.stringify({ ...m, version: 99 })).error, /newer version/);
  assert.match(parseManifest('{nope').error, /valid JSON/);
  assert.match(parseManifest('{"hello":1}').error, /isn't a NightFlow export/);
  assert.match(parseManifest(JSON.stringify({ ...m, project: null })).error, /no valid project/);
});

test('reads older exports', () => {
  const v1 = parseManifest(JSON.stringify({ project, runs })).manifest;
  assert.equal(v1.legacy, true);
  assert.equal(v1.level, 'standard');
  assert.equal(v1.runs.length, 2);
  // The old multi-project backup isn't a single project.
  assert.match(parseManifest(JSON.stringify({ projects: [project], runs })).error, /several projects/);
  const bare = parseManifest(JSON.stringify(project)).manifest;
  assert.equal(bare.level, 'lite');
});

test('import gives runs fresh ids and maps the old ones', () => {
  let n = 0;
  const { project: p, runs: rs, runIdMap } = materializeImport(
    { project, runs },
    { projectId: '9', name: 'Retail Shelf (imported)', overrides: { projectPath: '~/p/' }, newId: () => `new-${++n}` },
  );
  assert.equal(p.id, '9');
  assert.equal(p.name, 'Retail Shelf (imported)');
  assert.equal(p.projectPath, '~/p/');
  assert.equal('syncMetadata' in p, false);
  assert.deepEqual(rs.map((r) => [r.id, r.projectId]), [['new-1', '9'], ['new-2', '9']]);
  assert.deepEqual(runIdMap, { 'r-1': 'new-1', 'r-2': 'new-2' });
  // The source records are untouched.
  assert.equal(runs[0].id, 'r-1');
});

test('ids and names for imported projects', () => {
  assert.equal(nextProjectId(['1', '7', 'x']), '8');
  assert.equal(nextProjectId([]), '1');
  const names = new Set(['A', 'A (imported)']);
  assert.equal(importName('B', names), 'B');
  assert.equal(importName('A', names), 'A (imported 2)');
});

test('file names and summaries', () => {
  assert.equal(suggestFileName({ level: 'full', name: 'Retail Shelf!', now }), 'Retail-Shelf-full-2026-11-09.nightflow');
  assert.equal(suggestFileName({ level: 'lite', name: 'x', now }), 'x-lite-2026-11-09.json');
  const m = buildManifest({ level: 'standard', project, runs, includeConnection: true, now });
  assert.equal(describeManifest(m), 'Retail Shelf · 2 runs');
});

test('dataset sources follow the format', () => {
  assert.deepEqual(datasetSources({ datasetFormat: 'Folder', folderPath: '/d/flowers/' }), [{ key: 'folder', field: 'folderPath', path: '/d/flowers/', kind: 'dir' }]);
  assert.deepEqual(
    datasetSources({ datasetFormat: 'CSV', trainPath: '/d/train.csv', testPath: '', imageFolderPath: '/d/img' }).map((s) => [s.key, s.kind]),
    [['train', 'file'], ['images', 'dir']],
  );
  assert.deepEqual(datasetSources({ datasetFormat: 'COCO JSON', folderPath: '' }), []);
  assert.deepEqual(datasetFields('JSONL'), ['trainPath', 'valPath', 'testPath', 'imageFolderPath']);
});

test('home paths become portable ~ paths', () => {
  assert.equal(portablePath('/Users/vanka/data/coco/', '/Users/vanka'), '~/data/coco/');
  assert.equal(portablePath('/Users/vanka', '/Users/vanka/'), '~');
  assert.equal(portablePath('/Users/vankax/data', '/Users/vanka'), '/Users/vankax/data');
  assert.equal(portablePath('C:\\Users\\ana\\data', 'C:\\Users\\ana'), '~\\data');
  assert.equal(portablePath('/data/x', '/Users/vanka'), '/data/x');
});

test('local exports with connection details use ~ paths; remote ones keep server paths', () => {
  const local = { ...project, connectionType: 'localhost', sshCommand: 'localhost', projectPath: '/Users/me/p/', folderPath: '/Users/me/data/' };
  const m = buildManifest({ level: 'standard', project: local, runs: [{ id: 'r', dataset: '/Users/me/data/' }], includeConnection: true, home: '/Users/me', now });
  assert.equal(m.project.projectPath, '~/p/');
  assert.equal(m.project.folderPath, '~/data/');
  assert.equal(m.runs[0].dataset, '~/data/');
  const remote = buildManifest({ level: 'lite', project: { ...project, folderPath: '/Users/me/data/' }, includeConnection: true, home: '/Users/me', now });
  assert.equal(remote.project.folderPath, '/Users/me/data/');
});

test('bundled dataset paths point into the imported project folder', () => {
  const manifest = { archive: { dataset: [{ key: 'folder', kind: 'dir', path: '/x/flowers' }, { key: 'train', kind: 'file', path: '/x/csv/train.csv' }, { key: 'bogus', kind: 'dir', path: '/y' }] } };
  assert.deepEqual(bundledDatasetPaths(manifest, '~/.nightflow/projects/p/', 'macos'), {
    folderPath: '~/.nightflow/projects/p/dataset/folder/',
    trainPath: '~/.nightflow/projects/p/dataset/train/train.csv',
  });
  assert.deepEqual(bundledDatasetPaths(manifest, '~\\nf\\p\\', 'windows').folderPath, '~\\nf\\p\\dataset\\folder\\');
  assert.deepEqual(bundledDatasetPaths({}, '~/p/', 'macos'), {});
});
