import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { createServer } from '../src/app.js';
import { makeCfg, makeTree, removeTree } from './helpers.js';

describe('HTTP routes', () => {
  let root;
  let server;
  let base;

  before(async () => {
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#3366cc' } }).png().toBuffer();
    root = await makeTree({
      'photo.png': png,
      'broken.jpg': 'not really a jpeg',
      'clip.mp4': 'fake video',
      'notes.txt': 'text',
      'My Album': { 'inside.png': png },
      '.private': { 'secret.png': png },
    });
    // A made-up ffmpeg command, so nothing depends on ffmpeg being installed.
    server = createServer(makeCfg(root, { recentDays: 0 }), { ffmpeg: 'picbrowse-no-such-ffmpeg', ffmpegOk: false });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await removeTree(root);
  });

  const get = (p, init) => fetch(base + p, init);

  /** Send `p` exactly as written. fetch() would turn "%2E%2E" into ".." and resolve it first. */
  const rawStatus = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: p }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });

  async function expectError(p, status, init) {
    const res = await get(p, init);
    assert.equal(res.status, status, p);
    assert.match(res.headers.get('content-type'), /application\/json/, p);
    const body = await res.json();
    assert.equal(typeof body.error, 'string', p);
  }

  describe('/api/browse', () => {
    it('lists the root folder', async () => {
      const res = await get('/api/browse');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-cache');
      const body = await res.json();
      assert.equal(body.path, '');
      assert.deepEqual(body.folders.map((f) => f.name), ['My Album']);
      assert.deepEqual(body.files.map((f) => f.name), ['broken.jpg', 'clip.mp4', 'photo.png']);
    });

    it('lists a subfolder', async () => {
      const body = await (await get(`/api/browse?path=${encodeURIComponent('My Album')}`)).json();
      assert.equal(body.path, 'My Album');
      assert.deepEqual(body.files.map((f) => f.path), ['My Album/inside.png']);
    });

    it('rejects unsafe, hidden, missing and non-folder paths', async () => {
      await expectError('/api/browse?path=..', 400);
      await expectError('/api/browse?path=.private', 404);
      await expectError('/api/browse?path=Nope', 404);
      await expectError('/api/browse?path=photo.png', 400);
    });
  });

  describe('/media/', () => {
    it('serves a media file with its type', async () => {
      const res = await get('/media/My%20Album/inside.png');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/png');
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      assert.equal(meta.width, 200);
    });

    it('serves downloads as attachments', async () => {
      const res = await get('/media/photo.png?download');
      assert.equal(res.headers.get('content-type'), 'application/octet-stream');
      assert.match(res.headers.get('content-disposition'), /^attachment; filename="photo.png"/);
      await res.arrayBuffer();
    });

    it('supports range requests for seeking', async () => {
      const res = await get('/media/clip.mp4', { headers: { Range: 'bytes=0-3' } });
      assert.equal(res.status, 206);
      assert.equal(await res.text(), 'fake');
    });

    it('refuses non-media, hidden, folder and escaping paths', async () => {
      await expectError('/media/notes.txt', 404);
      await expectError('/media/.private/secret.png', 404);
      await expectError('/media/My%20Album', 404);
      await expectError('/media/%E0%A4%A.png', 400);
      // URL parsing resolves plain and %2E-encoded dot segments first, so these
      // become /secret.png and /package.json: unknown routes.
      assert.equal(await rawStatus('/media/%2E%2E/secret.png'), 404);
      assert.equal(await rawStatus('/media/../package.json'), 404);
      // Encoded slashes survive URL parsing and reach resolveSafe, which refuses them.
      assert.equal(await rawStatus('/media/My%20Album%2F..%2F..%2Fpackage.json'), 400);
      assert.equal(await rawStatus('/media/..%2F..%2Fpackage.json'), 400);
    });
  });

  describe('/thumb/ and /preview/', () => {
    it('makes a WebP thumbnail no bigger than thumbSize', async () => {
      const res = await get('/thumb/photo.png?v=1');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/webp');
      assert.equal(res.headers.get('cache-control'), 'private, max-age=31536000');
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, 64);
      assert.equal(meta.height, 32);
    });

    it('serves the cached thumbnail the second time', async () => {
      const a = Buffer.from(await (await get('/thumb/photo.png')).arrayBuffer());
      const b = Buffer.from(await (await get('/thumb/photo.png')).arrayBuffer());
      assert.deepEqual(a, b);
    });

    it('returns 404 for video thumbnails when ffmpeg is unavailable', async () => {
      await expectError('/thumb/clip.mp4', 404);
    });

    it('returns 404 when an image cannot be decoded', async () => {
      await expectError('/thumb/broken.jpg', 404);
    });

    it('makes JPEG previews of images', async () => {
      const res = await get('/preview/photo.png');
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/jpeg');
      const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
      assert.equal(meta.format, 'jpeg');
    });

    it('refuses previews of videos and of undecodable images', async () => {
      await expectError('/preview/clip.mp4', 400);
      await expectError('/preview/broken.jpg', 415);
    });
  });

  describe('app shell and static files', () => {
    it('serves index.html for the home page and any /browse/ path', async () => {
      for (const p of ['/', '/browse', '/browse/My%20Album/deeper']) {
        const res = await get(p);
        assert.equal(res.status, 200, p);
        assert.match(res.headers.get('content-type'), /^text\/html/, p);
        assert.match(await res.text(), /<html/i, p);
      }
    });

    it('serves static assets with their types', async () => {
      const js = await get('/static/app.js');
      assert.equal(js.status, 200);
      assert.match(js.headers.get('content-type'), /^text\/javascript/);
      await js.arrayBuffer();

      const icon = await get('/favicon.ico');
      assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
      await icon.arrayBuffer();
    });

    it('does not serve files outside the public folder', async () => {
      assert.equal(await rawStatus('/static/..%2Fsrc%2Fserver.js'), 403);
      assert.equal(await rawStatus('/static/..%2F..%2Fpackage.json'), 403);
      assert.equal(await rawStatus('/static/%2E%2E/src/server.js'), 404); // normalised to /src/server.js
      await expectError('/static/nope.js', 404);
    });
  });

  it('only allows GET and HEAD', async () => {
    await expectError('/api/browse', 405, { method: 'POST' });
    await expectError('/media/photo.png', 405, { method: 'DELETE' });
    const head = await get('/media/photo.png', { method: 'HEAD' });
    assert.equal(head.status, 200);
  });

  it('returns 404 for unknown routes', async () => {
    await expectError('/nope', 404);
    await expectError('/api/other', 404);
  });
});
