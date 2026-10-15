import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    window.androidBridge = {};
    window.nativeMockCalls = [];
    window.nativeMockCallbacks = {};
    window.nativeFiles = {};
    window.gallery = {};
    window.galleryWrites = {};
    window.nativeFileReadCalls = [];
    window.nativeCameraState = { launchMode: 'camera', session: false, lensId: 'rear-wide', zoom: 1, starts: 0, stopWaiters: [], startWaiters: [] };
    const realSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, window.nativeCameraState.accelerateStartupTimeout && delay === 20000 ? 100 : delay, ...args);
    const lenses = [
      { id: 'rear-ultrawide', label: 'Rear ultra wide', facing: 'environment', intrinsicZoom: 0.5 },
      { id: 'rear-wide', label: 'Rear wide', facing: 'environment', intrinsicZoom: 1 },
      { id: 'front-main', label: 'Front camera', facing: 'user', intrinsicZoom: 1 },
    ];
    window.nativeCameraInfo = () => ({ width: 390, height: 844, photoWidth: 1600, photoHeight: 1200, lenses, lensId: window.nativeCameraState.lensId, zoom: window.nativeCameraState.zoom, minZoom: 1, maxZoom: 4 });
    const cameraMethods = ['getLaunchMode', 'startSession', 'setPreviewBounds', 'setCorrection', 'listLenses', 'setLens', 'setZoom', 'sampleFrame', 'capturePhoto', 'releaseCapture', 'startRecording', 'stopRecording', 'stopSession'];
    const filesMethods = ['getRememberedModel', 'drainShares', 'releaseShare', 'probeAndroidSources', 'createCapture', 'beginWrite', 'writeChunk', 'finishWrite', 'deleteCameraCapture'];
    const backMethods = ['setEnabled', 'exitApp'];
    const header = (name, methods, hasListener = false) => ({ name, methods: [...methods.map(method => ({ name: method, rtype: 'promise' })), ...(hasListener ? [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] : [])] });
    window.Capacitor = {
      PluginHeaders: [header('ClearWaterCamera', cameraMethods, true), header('ClearWaterFiles', filesMethods, true), header('ClearWaterBack', backMethods, true)],
      convertFileSrc: uri => { if (uri.startsWith('mock-native://')) window.nativeFileReadCalls.push(uri); return window.nativeFiles[uri] ?? uri; },
      nativeCallback: (plugin, method, options, callback) => {
        const id = `${plugin}-${options.eventName}-${crypto.randomUUID()}`;
        const key = `${plugin}:${options.eventName}`;
        (window.nativeMockCallbacks[key] ??= {})[id] = callback;
        return Promise.resolve(id);
      },
      nativePromise: async (plugin, method, options = {}) => {
        window.nativeMockCalls.push({ plugin, method, options: structuredClone(options) });
        if (method === 'removeListener') {
          delete window.nativeMockCallbacks[`${plugin}:${options.eventName}`]?.[options.callbackId];
          return {};
        }
        if (plugin === 'ClearWaterCamera') {
          const state = window.nativeCameraState;
          if (method === 'getLaunchMode') { const mode = state.launchMode; state.launchMode = null; return { mode }; }
          if (method === 'startSession') {
            state.starts++;
            if (state.deferStart) return new Promise(resolve => state.startWaiters.push(() => { state.session = true; state.startOptions = options; resolve(window.nativeCameraInfo()); }));
            state.session = true; state.startOptions = options; return window.nativeCameraInfo();
          }
          if (method === 'setPreviewBounds') { state.bounds = options; return {}; }
          if (method === 'setCorrection') { state.recipe = options.recipe; return {}; }
          if (method === 'listLenses') return { lenses };
          if (method === 'setLens') { state.lensId = options.lensId; state.zoom = 1; return window.nativeCameraInfo(); }
          if (method === 'setZoom') { state.zoom = Math.max(1, Math.min(4, options.ratio)); return { zoom: state.zoom }; }
          if (method === 'sampleFrame') return { data: window.nativeSampleData, width: 8, height: 8 };
          if (method === 'capturePhoto') return { uri: 'mock-native://photo', name: 'clearwater-camera-00000000-0000-4000-8000-000000000001.jpg', type: 'image/jpeg', width: 1600, height: 1200 };
          if (method === 'releaseCapture') { state.released = options.uri; return {}; }
          if (method === 'startRecording') { state.recording = true; state.recordingRecipe = options.recipe; return {}; }
          if (method === 'stopRecording') { state.recording = false; (state.stopCalls ??= []).push(options); return {}; }
          if (method === 'stopSession') {
            state.stops = (state.stops ?? 0) + 1; state.session = false;
            if (state.deferStop) return new Promise(resolve => state.stopWaiters.push(resolve));
            return {};
          }
        }
        if (plugin === 'ClearWaterFiles') {
          if (method === 'getRememberedModel') return { present: false, hasFile: false };
          if (method === 'drainShares') return { photos: [] };
          if (method === 'probeAndroidSources') return { states: Object.fromEntries(options.uris.map(uri => [uri, 'present'])) };
          if (method === 'createCapture') {
            const uri = `content://mock/gallery/${Object.keys(window.gallery).length + 1}`;
            window.gallery[uri] = { name: options.name, type: options.type, bytes: [] };
            return { uri, name: options.name, destination: `Pictures/ClearWater/${options.name}` };
          }
          if (method === 'beginWrite') { const id = `write-${crypto.randomUUID()}`; window.galleryWrites[id] = { uri: options.uri, chunks: [] }; return { id }; }
          if (method === 'writeChunk') { window.galleryWrites[options.id].chunks.push(options.data); return {}; }
          if (method === 'finishWrite') {
            const write = window.galleryWrites[options.id];
            if (write && !options.abort) window.gallery[write.uri].bytes = write.chunks.flatMap(chunk => Array.from(atob(chunk), character => character.charCodeAt(0)));
            delete window.galleryWrites[options.id];
            return {};
          }
          if (method === 'deleteCameraCapture') { delete window.gallery[options.uri]; return {}; }
        }
        return {};
      },
    };
    window.emitNative = (plugin, event, payload) => {
      for (const callback of Object.values(window.nativeMockCallbacks[`${plugin}:${event}`] ?? {})) callback(payload);
    };
    window.resolveNativeStops = () => window.nativeCameraState.stopWaiters.splice(0).forEach(resolve => resolve({}));
    window.resolveNativeStarts = () => window.nativeCameraState.startWaiters.splice(0).forEach(resolve => resolve());
    const sample = document.createElement('canvas'); sample.width = sample.height = 8;
    const sampleContext = sample.getContext('2d'); sampleContext.fillStyle = '#6493a2'; sampleContext.fillRect(0, 0, 8, 8);
    window.nativeSampleData = sample.toDataURL('image/jpeg').split(',')[1];
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async () => { window.nativeGetUserMediaCalls = (window.nativeGetUserMediaCalls ?? 0) + 1; throw new Error('native mode must not call getUserMedia'); } });
  });

  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.CHECK_URL || 'http://127.0.0.1:4176/');
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1200;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 1600, 1200); gradient.addColorStop(0, '#226b81'); gradient.addColorStop(1, '#b7a36b');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1600, 1200);
    ctx.fillStyle = '#d7e7dc'; ctx.fillRect(620, 300, 360, 560);
    window.nativeFiles['mock-native://photo'] = canvas.toDataURL('image/jpeg', 0.94);
  });

  await page.waitForFunction(() => document.querySelector('.camera-photo')?.disabled === false, null, { timeout: 30000 });
  assert.equal(await page.locator('.camera-page').count(), 1, 'native camera launch mode opens during startup');
  assert.equal(await page.evaluate(() => window.nativeGetUserMediaCalls ?? 0), 0, 'native mode never requests browser camera permission');
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor), 'rgba(0, 0, 0, 0)', 'root document is transparent for CameraX beneath the WebView');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.app-shell')).display), 'none', 'editor is hidden behind the native preview');
  assert.equal(await page.locator('.camera-resolution').innerText(), 'Photo resolution: 1600 × 1200', 'native chip reports photo pixels, not the 390 × 844 viewport');

  const zoom = page.locator('.camera-zoom-button');
  await zoom.click();
  assert.equal(await zoom.innerText(), '2×', 'native zoom tap uses the next standard CameraX stop');
  await page.mouse.move((await zoom.boundingBox()).x + 20, (await zoom.boundingBox()).y + 20);
  await page.mouse.down(); await page.waitForTimeout(600); await page.mouse.up();
  await page.locator('#camera-zoom-chooser').waitFor();
  assert.deepEqual(await page.locator('.camera-lens-choice span').allTextContents(), ['Rear ultra wide · 0.5×', 'Rear wide · 1×', 'Front camera · 1×']);
  await page.getByRole('button', { name: /Rear ultra wide/ }).click();
  assert.equal(await zoom.innerText(), '0.5×', 'displayed magnification uses the reported native lens factor');
  assert.ok(await page.evaluate(() => window.nativeMockCalls.some(call => call.plugin === 'ClearWaterCamera' && call.method === 'setLens')));
  await page.locator('.camera-feature-button').nth(1).click();
  await page.waitForFunction(() => window.nativeCameraState.recipe?.hints?.filter === 'yes');
  assert.ok(await page.evaluate(() => window.nativeMockCalls.some(call => call.plugin === 'ClearWaterCamera' && call.method === 'setPreviewBounds')));

  await page.locator('.camera-photo').click();
  await page.getByRole('status').filter({ hasText: 'Saved on phone.' }).waitFor({ timeout: 30000 });
  const capture = await page.evaluate(async () => {
    const opened = indexedDB.open('clearwater-library', 2);
    const db = await new Promise((resolve, reject) => { opened.onsuccess = () => resolve(opened.result); opened.onerror = () => reject(opened.error); });
    const tx = db.transaction(['photos', 'camera-originals']);
    const photosRequest = tx.objectStore('photos').getAll();
    const originalsRequest = tx.objectStore('camera-originals').getAll();
    const [photos, originals] = await Promise.all([
      new Promise(resolve => { photosRequest.onsuccess = () => resolve(photosRequest.result); }),
      new Promise(resolve => { originalsRequest.onsuccess = () => resolve(originalsRequest.result); }),
    ]);
    await new Promise(resolve => { tx.oncomplete = resolve; }); db.close();
    const original = originals[0];
    const bitmap = await createImageBitmap(original.file);
    const dimensions = [bitmap.width, bitmap.height]; bitmap.close();
    return { photos, originals, dimensions, originalBytes: Array.from(new Uint8Array(await original.file.arrayBuffer())) };
  });
  assert.equal(capture.photos.length, 1);
  assert.equal(capture.originals.length, 1, 'untouched native original is retained privately');
  assert.deepEqual(capture.dimensions, [1600, 1200], 'private original keeps the full-resolution capture');
  assert.equal(capture.originals[0].recipe.hints.filter, 'yes', 'recipe metadata reflects the selected Balanced red-filter hint');
  const gallery = await page.evaluate(() => Object.values(window.gallery)[0]);
  assert.equal(gallery.type, 'image/jpeg');
  assert.ok(gallery.bytes.length > 1000, 'native gallery bridge receives the rendered photo bytes');
  assert.notDeepEqual(gallery.bytes, capture.originalBytes, 'gallery receives corrected JPEG while private archive keeps raw source');
  assert.ok(await page.evaluate(() => window.nativeCameraState.released === 'mock-native://photo'));

  await page.getByRole('button', { name: 'Record video' }).click();
  await page.waitForFunction(() => window.nativeCameraState.recording === true);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.evaluate(() => {
    window.nativeFileReadCalls = [];
    window.emitNative('ClearWaterCamera', 'recordingFinished', {
      uri: 'mock-native://failed-video', name: 'failed.mp4', type: 'video/mp4', width: 390, height: 844,
      error: 'CameraX could not finalize the MP4.', discarded: true,
    });
  });
  await page.getByRole('alert').filter({ hasText: 'Could not save video capture.' }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.nativeFileReadCalls), [], 'failed finalized media is not read as a capture');
  assert.equal(await page.evaluate(() => Object.keys(window.gallery).length), 1, 'failed video creates no gallery entry');
  assert.equal(await page.evaluate(() => window.nativeCameraState.released), 'mock-native://photo', 'failed video leaves no temp capture to release');

  await page.locator('.camera-close-button').click();
  await page.waitForFunction(() => document.querySelector('.camera-page') === null);
  await page.evaluate(() => window.emitNative('ClearWaterCamera', 'launchMode', { mode: 'camera' }));
  await page.waitForFunction(() => document.querySelector('.camera-photo')?.disabled === false);
  await page.evaluate(() => window.emitNative('ClearWaterCamera', 'launchMode', { mode: 'edit' }));
  await page.waitForFunction(() => document.querySelector('.camera-page') === null);
  await page.locator('.settings-launch:visible').first().click();
  await page.locator('input[name="camera-recording-quality"]').nth(2).check();
  const qualityCaption = page.locator('.camera-quality-caption');
  assert.equal(await qualityCaption.innerText(), 'Target 1080p · frame rate and bitrate selected by device.');
  assert.doesNotMatch(await qualityCaption.innerText(), /12 Mbps|192 kbps/);
  await page.locator('.settings-page .language-select').selectOption('zh-HK');
  assert.equal(await qualityCaption.innerText(), '目標 1080p · 幀率及位元率由裝置選擇。');
  await page.locator('.settings-page .language-select').selectOption('ja');
  assert.equal(await qualityCaption.innerText(), '目標 1080p · フレームレートとビットレートは端末が選択します。');
  await page.locator('.settings-page .language-select').selectOption('en');
  await page.locator('.settings-close').click();

  await page.locator('.camera-launch').click();
  await page.waitForFunction(() => document.querySelector('.camera-photo')?.disabled === false);
  const baselineStarts = await page.evaluate(() => window.nativeCameraState.starts);
  await page.evaluate(() => {
    const state = window.nativeCameraState;
    state.deferStop = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.nativeCameraState.stopWaiters.length === 1);
  await page.evaluate(() => {
    const state = window.nativeCameraState;
    state.deferStop = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.nativeCameraState.starts), baselineStarts, 'resume waits for the pending native stop before starting');
  await page.evaluate(() => window.resolveNativeStops());
  await page.waitForFunction(starts => window.nativeCameraState.starts === starts + 1, baselineStarts);
  await page.waitForFunction(() => document.querySelector('.camera-photo')?.disabled === false);

  const beforeStaleStart = await page.evaluate(() => window.nativeCameraState.starts);
  await page.evaluate(() => {
    window.nativeCameraState.deferStart = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(starts => window.nativeCameraState.starts === starts + 1 && window.nativeCameraState.startWaiters.length === 1, beforeStaleStart);
  await page.evaluate(() => {
    const state = window.nativeCameraState;
    state.deferStart = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(starts => window.nativeCameraState.starts === starts + 2, beforeStaleStart);
  await page.waitForFunction(() => document.querySelector('.camera-photo')?.disabled === false);
  const stopsBeforeStaleResolution = await page.evaluate(() => window.nativeCameraState.stops);
  await page.evaluate(() => window.resolveNativeStarts());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.nativeCameraState.stops), stopsBeforeStaleResolution, 'a stale start completion cannot stop the newer active session');
  assert.equal(await page.locator('.camera-photo').isDisabled(), false, 'the newer session stays ready after stale completion');

  const beforeTimedOutStart = await page.evaluate(() => window.nativeCameraState.starts);
  await page.evaluate(() => {
    const state = window.nativeCameraState;
    state.deferStop = true;
    state.accelerateStartupTimeout = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => window.nativeCameraState.stopWaiters.length === 1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('alert').filter({ hasText: 'Could not start the camera.' }).waitFor({ timeout: 3000 });
  assert.equal(await page.evaluate(() => window.nativeCameraState.starts), beforeTimedOutStart, 'startup timeout while teardown is pending does not start a racing session');
  assert.equal(await page.locator('.camera-photo').isDisabled(), true, 'timed out teardown clears the starting state and leaves retry available');
  await page.evaluate(() => {
    const state = window.nativeCameraState;
    state.deferStop = false;
    state.accelerateStartupTimeout = false;
    window.resolveNativeStops();
  });
  assert.equal(await page.evaluate(() => window.nativeGetUserMediaCalls ?? 0), 0);
  assert.deepEqual(errors, []);
  console.log('PASS mocked CameraX launch, transparent preview, native zoom/lens, corrected photo save, finalize errors and bounded serialized resume lifecycle');
} finally {
  await browser.close();
}
