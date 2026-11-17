import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { sendFile } from '../src/stream.js';
import { makeTree, removeTree } from './helpers.js';

const BODY = '0123456789abcdefghij'; // 20 bytes

describe('sendFile', () => {
  let root;
  let server;
  let base;
  let stat;

  before(async () => {
    root = await makeTree({ 'file.bin': BODY, 'empty.bin': '', 'Café;x.jpg': 'img' });
    stat = await fs.stat(path.join(root, 'file.bin'));
    // /<name>?download serves that file from the temp folder.
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      const abs = path.join(root, decodeURIComponent(url.pathname.slice(1)));
      await sendFile(req, res, abs, await fs.stat(abs), 'application/test', {
        download: url.searchParams.has('download'),
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    await removeTree(root);
  });

  const get = (name, headers = {}, method = 'GET') => fetch(`${base}/${name}`, { headers, method });

  it('sends the whole file with caching headers', async () => {
    const res = await get('file.bin');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), BODY);
    assert.equal(res.headers.get('content-type'), 'application/test');
    assert.equal(res.headers.get('content-length'), '20');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('cache-control'), 'private, max-age=3600');
    assert.equal(res.headers.get('last-modified'), new Date(stat.mtimeMs).toUTCString());
  });

  it('answers HEAD with headers only', async () => {
    const res = await get('file.bin', {}, 'HEAD');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '20');
    assert.equal(await res.text(), '');
  });

  it('serves byte ranges', async () => {
    const cases = [
      ['bytes=0-4', '01234', 'bytes 0-4/20'],
      ['bytes=10-', 'abcdefghij', 'bytes 10-19/20'],
      ['bytes=-3', 'hij', 'bytes 17-19/20'],
      ['bytes=15-999', 'fghij', 'bytes 15-19/20'], // end clamped to the file size
      ['bytes=-50', BODY, 'bytes 0-19/20'],        // suffix longer than the file
    ];
    for (const [range, body, contentRange] of cases) {
      const res = await get('file.bin', { Range: range });
      assert.equal(res.status, 206, range);
      assert.equal(await res.text(), body, range);
      assert.equal(res.headers.get('content-range'), contentRange, range);
      assert.equal(res.headers.get('content-length'), String(body.length), range);
    }
  });

  it('rejects ranges it cannot satisfy', async () => {
    for (const range of ['bytes=20-', 'bytes=5-2', 'bytes=-', 'bytes=0-1,4-5', 'items=0-1']) {
      const res = await get('file.bin', { Range: range });
      assert.equal(res.status, 416, range);
      assert.equal(res.headers.get('content-range'), 'bytes */20', range);
      await res.arrayBuffer();
    }
  });

  it('answers 304 when the file has not changed', async () => {
    const res = await get('file.bin', { 'If-Modified-Since': new Date(stat.mtimeMs + 1000).toUTCString() });
    assert.equal(res.status, 304);
  });

  it('sends the file again when it is newer than If-Modified-Since', async () => {
    const res = await get('file.bin', { 'If-Modified-Since': new Date(stat.mtimeMs - 10_000).toUTCString() });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), BODY);
  });

  it('sends empty files', async () => {
    const res = await get('empty.bin');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-length'), '0');
    assert.equal(await res.text(), '');
  });

  it('adds a safe Content-Disposition for downloads', async () => {
    // Quotes can't be tested here: Windows file names can't contain them.
    const res = await get(`${encodeURIComponent('Café;x.jpg')}?download`);
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get('content-disposition'),
      `attachment; filename="Caf_;x.jpg"; filename*=UTF-8''${encodeURIComponent('Café;x.jpg')}`,
    );
    await res.arrayBuffer();
  });
});
