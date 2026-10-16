import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.androidBridge = {};
    window.shareMock = { calls: [], chunks: [], failChunk: false, platform: 'android' };
    window.Capacitor = {
      getPlatform: () => window.shareMock.platform,
      isPluginAvailable: name => name === 'ClearWaterShare',
      PluginHeaders: [{ name: 'ClearWaterShare', methods: ['beginShare', 'writeShareChunk', 'finishShare', 'cancelShare'].map(name => ({ name, rtype: 'promise' })) }],
      nativePromise: async (plugin, method, options = {}) => {
        const mock = window.shareMock;
        mock.calls.push({ method, options: structuredClone(options) });
        if (method === 'beginShare') return { id: 'share-stage-1' };
        if (method === 'writeShareChunk') {
          if (mock.failChunk) throw new Error('mock write failure');
          mock.chunks.push({ id: options.id, data: options.data }); return {};
        }
        return {};
      },
    };
  });
  await page.goto(process.env.CHECK_URL || 'http://127.0.0.1:4176/');
  const result = await page.evaluate(async () => {
    const { supportsFileShare, shareExport } = await import('/src/export-share.ts');
    const bytes = Uint8Array.from({ length: 700_123 }, (_, i) => i % 251);
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const supported = supportsFileShare();
    await shareExport(blob, 'restored-photo.jpg');
    let badNameRejected = false;
    try { await shareExport(blob, '../private.jpg'); } catch { badNameRejected = true; }
    window.shareMock.failChunk = true;
    let failedShareRejected = false;
    try { await shareExport(new Blob([bytes], { type: 'image/png' }), 'restored.png'); } catch { failedShareRejected = true; }
    window.shareMock.failChunk = false;
    window.shareMock.platform = 'web';
    delete window.androidBridge;
    const sharedOnWeb = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: data => data.files?.length === 1 });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { sharedOnWeb.push({ name: data.files[0].name, type: data.files[0].type, size: data.files[0].size }); } });
    const webSupported = supportsFileShare();
    await shareExport(blob, 'restored-photo.jpg');
    return { supported, webSupported, sharedOnWeb, badNameRejected, failedShareRejected, calls: window.shareMock.calls, chunks: window.shareMock.chunks };
  });
  assert.equal(result.supported, true);
  assert.equal(result.webSupported, true);
  assert.deepEqual(result.sharedOnWeb, [{ name: 'restored-photo.jpg', type: 'image/jpeg', size: 700_123 }]);
  assert.equal(result.badNameRejected, true, 'path-like names fail before staging');
  assert.equal(result.failedShareRejected, true, 'bridge write errors reject and cancel staging');
  const nativeCalls = result.calls.filter(call => call.method !== '');
  assert.equal(nativeCalls[0].method, 'beginShare');
  assert.equal(nativeCalls[0].options.size, 700_123);
  assert.ok(nativeCalls.some(call => call.method === 'finishShare'));
  assert.ok(nativeCalls.some(call => call.method === 'cancelShare'));
  const successfulChunks = result.chunks.slice(0, 3).map(chunk => atob(chunk.data).length);
  assert.deepEqual(successfulChunks, [262_144, 262_144, 175_835], 'Android bridge streams bounded 256 KiB chunks');
  const reconstructed = result.chunks.slice(0, 3).flatMap(chunk => Array.from(atob(chunk.data), char => char.charCodeAt(0)));
  assert.equal(reconstructed.length, 700_123);
  assert.ok(reconstructed.every((value, index) => value === index % 251), 'chunk order and bytes remain intact');
  console.log('PASS native/web share wrapper, staged chunk bounds, filename validation and failed-transfer cancellation');
} finally {
  await browser.close();
}
