import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { browse } from '../src/browse.js';
import { HttpError, resolveSafe } from '../src/paths.js';
import { makeCfg, makeTree, removeTree } from './helpers.js';

describe('browse', () => {
  let root;
  let cfg;

  before(async () => {
    root = await makeTree({
      'img10.jpg': '1234567890',
      'img2.jpg': '12',
      'clip.mp4': 'v',
      'notes.txt': 'not media',
      'Thumbs.db': 'x',
      '.hidden.jpg': 'x',
      'Album 10': { 'a.png': 'x' },
      'Album 2': { 'b.mov': 'x', 'c.jpg': 'x' },
      Empty: {},
      Nested: { Deeper: { 'deep.jpg': 'x' } },
      '.private': { 'p.jpg': 'x' },
    });
    // recentDays: 0 keeps this test about listing; recent.test.js covers that part.
    cfg = makeCfg(root, { recentDays: 0 });
  });

  after(() => removeTree(root));

  const at = async (rel) => browse(cfg, await resolveSafe(cfg, rel));

  it('lists media files in natural order, skipping other and hidden files', async () => {
    const res = await at('');
    assert.deepEqual(res.files.map((f) => f.name), ['clip.mp4', 'img2.jpg', 'img10.jpg']);
    const img10 = res.files.find((f) => f.name === 'img10.jpg');
    assert.equal(img10.type, 'image');
    assert.equal(img10.web, true);
    assert.equal(img10.size, 10);
    assert.equal(img10.path, 'img10.jpg');
    assert.equal(typeof img10.mtime, 'number');
  });

  it('lists folders in natural order with counts, skipping hidden ones', async () => {
    const res = await at('');
    assert.deepEqual(res.folders.map((f) => f.name), ['Album 2', 'Album 10', 'Empty', 'Nested']);
    const album2 = res.folders[0];
    assert.equal(album2.path, 'Album 2');
    assert.deepEqual(album2.counts, { folders: 0, files: 2 });
  });

  it('picks an image as a folder cover, looking one level down if needed', async () => {
    const res = await at('');
    const byName = Object.fromEntries(res.folders.map((f) => [f.name, f]));
    assert.equal(byName['Album 2'].cover.path, 'Album 2/c.jpg'); // image preferred over the video
    assert.equal(byName['Album 2'].cover.type, 'image');
    assert.equal(byName.Nested.cover.path, 'Nested/Deeper/deep.jpg');
    assert.equal(byName.Empty.cover, null);
  });

  it('builds breadcrumbs and paths for subfolders', async () => {
    const res = await at('Nested/Deeper');
    assert.equal(res.path, 'Nested/Deeper');
    assert.equal(res.name, 'Deeper');
    assert.deepEqual(res.breadcrumbs.slice(1), [
      { name: 'Nested', path: 'Nested' },
      { name: 'Deeper', path: 'Nested/Deeper' },
    ]);
    assert.equal(res.breadcrumbs[0].path, '');
    assert.deepEqual(res.files.map((f) => f.path), ['Nested/Deeper/deep.jpg']);
  });

  it('only includes "recent" on the home view', async () => {
    assert.ok(Array.isArray((await at('')).recent));
    assert.equal((await at('Nested')).recent, undefined);
  });

  it('shows recently added folders on the home view, leaving out empty ones', async () => {
    const res = await browse({ ...cfg, recentDays: 60 }, await resolveSafe(cfg, ''));
    const names = res.recent.map((r) => r.name).sort();
    assert.deepEqual(names, ['Album 10', 'Album 2', 'Nested']);
    assert.equal(typeof res.recent[0].added, 'number');
  });

  it('refuses to browse a file', async () => {
    await assert.rejects(at('img2.jpg'), (err) => err instanceof HttpError && err.status === 400);
  });
});
