import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { HttpError, isInside, relFromUrlPath, resolveSafe } from '../src/paths.js';
import { linkDir, makeCfg, makeTree, removeTree } from './helpers.js';

describe('isInside', () => {
  const root = path.resolve('/media/photos');

  it('accepts the folder itself and anything below it', () => {
    assert.equal(isInside(root, root), true);
    assert.equal(isInside(root, path.join(root, 'a.jpg')), true);
    assert.equal(isInside(root, path.join(root, 'x', 'y', 'z.jpg')), true);
  });

  it('rejects parents, siblings and look-alike prefixes', () => {
    assert.equal(isInside(root, path.dirname(root)), false);
    assert.equal(isInside(root, path.resolve('/media/other')), false);
    assert.equal(isInside(root, path.resolve('/media/photos-private/a.jpg')), false);
  });

  it('allows names that merely start with two dots', () => {
    assert.equal(isInside(root, path.join(root, '..hidden-ish')), true);
  });
});

describe('relFromUrlPath', () => {
  it('strips the prefix and decodes each segment', () => {
    assert.equal(relFromUrlPath('/thumb/Holidays/My%20Trip/a.jpg', '/thumb/'), 'Holidays/My Trip/a.jpg');
    assert.equal(relFromUrlPath('/media/caf%C3%A9.jpg', '/media/'), 'café.jpg');
  });

  it('keeps an encoded slash inside its segment', () => {
    // resolveSafe splits on "/" later, so "a%2Fb" ends up as two segments.
    assert.equal(relFromUrlPath('/media/a%2Fb.jpg', '/media/'), 'a/b.jpg');
  });

  it('throws 400 on broken encoding', () => {
    assert.throws(() => relFromUrlPath('/media/%E0%A4%A.jpg', '/media/'), (err) => err instanceof HttpError && err.status === 400);
  });
});

describe('resolveSafe', () => {
  let root;
  let outside;
  let cfg;

  before(async () => {
    root = await makeTree({
      'top.jpg': 'x',
      Holidays: { '2024': { 'beach.jpg': 'x' } },
      '.secret': { 'hidden.jpg': 'x' },
    });
    outside = await makeTree({ 'private.jpg': 'x' });
    cfg = makeCfg(root);
  });

  after(async () => {
    await removeTree(root);
    await removeTree(outside);
  });

  const rejects = (rel, status) => assert.rejects(
    resolveSafe(cfg, rel),
    (err) => err instanceof HttpError && err.status === status,
    `expected ${status} for ${JSON.stringify(rel)}`,
  );

  it('resolves the root for an empty or missing path', async () => {
    for (const rel of ['', undefined, null, '/', './']) {
      const safe = await resolveSafe(cfg, rel);
      assert.equal(safe.abs, cfg.mediaRootReal);
      assert.equal(safe.rel, '');
      assert.equal(safe.stat.isDirectory(), true);
    }
  });

  it('resolves files and folders inside the root', async () => {
    const file = await resolveSafe(cfg, 'Holidays/2024/beach.jpg');
    assert.equal(file.abs, path.join(root, 'Holidays', '2024', 'beach.jpg'));
    assert.equal(file.rel, 'Holidays/2024/beach.jpg');
    assert.equal(file.stat.isFile(), true);

    const dir = await resolveSafe(cfg, 'Holidays');
    assert.equal(dir.stat.isDirectory(), true);
  });

  it('normalises empty and "." segments', async () => {
    const safe = await resolveSafe(cfg, '/Holidays//./2024/');
    assert.equal(safe.rel, 'Holidays/2024');
  });

  it('rejects parent references', async () => {
    await rejects('..', 400);
    await rejects('../outside.jpg', 400);
    await rejects('Holidays/../../x', 400);
  });

  it('rejects backslashes, drive letters and other illegal characters', async () => {
    await rejects('Holidays\\2024', 400);
    await rejects('..\\..\\Windows', 400);
    await rejects('C:/Windows', 400);
    for (const ch of ['*', '?', '"', '<', '>', '|']) await rejects(`a${ch}b.jpg`, 400);
  });

  it('rejects NUL bytes', async () => {
    await rejects('top.jpg\0.png', 400);
  });

  it('never serves hidden entries', async () => {
    await rejects('.secret', 404);
    await rejects('.secret/hidden.jpg', 404);
    await rejects('Thumbs.db', 404);
  });

  it('returns 404 for missing files', async () => {
    await rejects('nope.jpg', 404);
    await rejects('Holidays/nope/beach.jpg', 404);
  });

  it('follows links that stay inside the root', async (t) => {
    if (!await linkDir(path.join(root, 'Holidays'), path.join(root, 'Shortcut'))) return t.skip('cannot create links here');
    const safe = await resolveSafe(cfg, 'Shortcut/2024/beach.jpg');
    assert.equal(safe.abs, path.join(root, 'Holidays', '2024', 'beach.jpg'));
  });

  it('refuses links that lead outside the root', async (t) => {
    if (!await linkDir(outside, path.join(root, 'Escape'))) return t.skip('cannot create links here');
    await rejects('Escape', 403);
    await rejects('Escape/private.jpg', 403);
  });
});
