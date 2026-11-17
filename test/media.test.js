import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isHidden, mediaInfo } from '../src/media.js';

describe('isHidden', () => {
  it('hides dot files and Office lock files', () => {
    assert.equal(isHidden('.git'), true);
    assert.equal(isHidden('.DS_Store'), true);
    assert.equal(isHidden('~$report.docx'), true);
  });

  it('hides Windows and NAS system entries, ignoring case', () => {
    for (const name of ['$RECYCLE.BIN', 'System Volume Information', 'Thumbs.db', 'desktop.ini', '@eaDir']) {
      assert.equal(isHidden(name), true, name);
    }
  });

  it('shows ordinary names', () => {
    for (const name of ['Holidays', 'IMG_0001.JPG', 'my.photo.jpg', 'thumbs', '~notes']) {
      assert.equal(isHidden(name), false, name);
    }
  });
});

describe('mediaInfo', () => {
  it('recognises browser-friendly images, ignoring extension case', () => {
    assert.deepEqual(mediaInfo('a.jpg'), { type: 'image', mime: 'image/jpeg', web: true });
    assert.deepEqual(mediaInfo('B.JPEG'), { type: 'image', mime: 'image/jpeg', web: true });
    assert.deepEqual(mediaInfo('c.Png'), { type: 'image', mime: 'image/png', web: true });
  });

  it('marks HEIC and TIFF as images browsers cannot show', () => {
    assert.deepEqual(mediaInfo('IMG_1.HEIC'), { type: 'image', mime: 'image/heic', web: false });
    assert.deepEqual(mediaInfo('scan.tif'), { type: 'image', mime: 'image/tiff', web: false });
  });

  it('tells playable video containers from others', () => {
    assert.deepEqual(mediaInfo('clip.mp4'), { type: 'video', mime: 'video/mp4', web: true });
    assert.deepEqual(mediaInfo('clip.MOV'), { type: 'video', mime: 'video/quicktime', web: true });
    assert.deepEqual(mediaInfo('clip.avi'), { type: 'video', mime: 'video/x-msvideo', web: false });
  });

  it('works on full paths', () => {
    assert.equal(mediaInfo('D:/Photos/2024/a.webp').mime, 'image/webp');
  });

  it('returns null for anything else', () => {
    for (const name of ['notes.txt', 'README', 'archive.zip', 'jpg', '.jpg']) {
      assert.equal(mediaInfo(name), null, name);
    }
  });
});
