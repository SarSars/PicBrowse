import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { recentFolders } from '../src/recent.js';
import { linkDir, makeCfg, makeTree, removeTree } from './helpers.js';

const DAY = 86_400_000;
const paths = (list) => list.map((r) => r.path).sort();

describe('recentFolders', () => {
  const roots = [];
  afterEach(async () => {
    while (roots.length) await removeTree(roots.pop());
  });
  // Every test gets its own root, so the module's cache never leaks between tests.
  async function setup(tree, overrides) {
    const root = await makeTree(tree);
    roots.push(root);
    return makeCfg(root, overrides);
  }

  it('returns nothing when the feature is off', async () => {
    for (const recentDays of [0, -1, NaN]) {
      const cfg = await setup({ New: { 'a.jpg': 'x' } }, { recentDays });
      assert.deepEqual(await recentFolders(cfg), []);
    }
  });

  it('lists newly created top-level folders with their creation time', async () => {
    const before = Date.now() - 5_000;
    const cfg = await setup({ A: { 'a.jpg': 'x' }, B: {} , 'loose.jpg': 'x' });
    const list = await recentFolders(cfg);
    assert.deepEqual(paths(list), ['A', 'B']);
    for (const r of list) {
      assert.equal(r.name, r.path);
      assert.ok(r.added >= before && r.added <= Date.now() + 5_000, `added=${r.added}`);
    }
  });

  it('does not descend into a folder that is itself recent', async () => {
    const cfg = await setup({ Trip: { Day1: { 'a.jpg': 'x' }, Day2: {} } });
    assert.deepEqual(paths(await recentFolders(cfg)), ['Trip']);
  });

  it('skips hidden and system folders', async () => {
    const cfg = await setup({ Visible: {}, '.hidden': {}, '@eaDir': {}, '$RECYCLE.BIN': {} });
    assert.deepEqual(paths(await recentFolders(cfg)), ['Visible']);
  });

  it('treats folders older than the cutoff as not recent', async () => {
    const cfg = await setup({ A: { Inner: {} } }, { recentDays: 30 });
    // Pretend it is 31 days from now: everything just created is too old.
    assert.deepEqual(await recentFolders(cfg, { now: Date.now() + 31 * DAY }), []);
    // ...but still inside the window 29 days from now.
    assert.deepEqual(paths(await recentFolders(cfg, { now: Date.now() + 29 * DAY })), ['A']);
  });

  it('sorts newest first', async () => {
    const cfg = await setup({});
    for (const name of ['First', 'Second', 'Third']) {
      await fs.mkdir(path.join(cfg.mediaRoot, name));
      await new Promise((r) => setTimeout(r, 30));
    }
    const list = await recentFolders(cfg);
    assert.deepEqual(list.map((r) => r.name), ['Third', 'Second', 'First']);
    assert.ok(list[0].added >= list[1].added && list[1].added >= list[2].added);
  });

  it('caches results for a minute and shares a scan between concurrent callers', async () => {
    const cfg = await setup({ A: {} });
    const [x, y] = await Promise.all([recentFolders(cfg), recentFolders(cfg)]);
    assert.equal(x, y);
    await fs.mkdir(path.join(cfg.mediaRoot, 'B'));
    assert.deepEqual(paths(await recentFolders(cfg)), ['A'], 'cached result');
    assert.deepEqual(paths(await recentFolders(cfg, { now: Date.now() + 61_000 })), ['A', 'B'], 'after expiry');
  });

  it('follows links inside the media folder but not outside it', async (t) => {
    const cfg = await setup({ Old: { Inner: {} } });
    const outside = await makeTree({ Elsewhere: {} });
    roots.push(outside);
    if (!await linkDir(path.join(cfg.mediaRoot, 'Old'), path.join(cfg.mediaRoot, 'InLink'))
      || !await linkDir(outside, path.join(cfg.mediaRoot, 'OutLink'))) return t.skip('cannot create links here');
    const found = paths(await recentFolders(cfg));
    assert.ok(found.includes('Old'));
    assert.ok(!found.some((p) => p.startsWith('OutLink')), `outside link listed: ${found}`);
  });
});
