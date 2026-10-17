import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 640 }, isMobile: true, hasTouch: true });
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
      ...Array.from({ length: 8 }, (_, index) => ({ id: `rear-extra-${index}`, label: `Rear lens ${index + 1}`, facing: 'environment', intrinsicZoom: 1 })),
    ];
    window.nativeCameraInfo = () => ({ width: 390, height: 844, photoWidth: 1600, photoHeight: 1200, sessionGeneration: window.nativeCameraState.starts, lenses, lensId: window.nativeCameraState.lensId, zoom: window.nativeCameraState.zoom, minZoom: 1, maxZoom: 10 });
    const cameraMethods = ['getLaunchMode', 'startSession', 'setPreviewBounds', 'setCorrection', 'listLenses', 'setLens', 'setZoom', 'sampleFrame', 'capturePhoto', 'releaseCapture', 'startRecording', 'stopRecording', 'stopSession'];
    const filesMethods = ['getRememberedModel', 'drainShares', 'releaseShare', 'probeAndroidSources', 'createCapture', 'copyCameraCapture', 'beginWrite', 'writeChunk', 'finishWrite', 'deleteCameraCapture'];
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
          if (method === 'setZoom') { state.zoom = Math.max(1, Math.min(10, options.ratio)); return { zoom: state.zoom }; }
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
          if (method === 'copyCameraCapture') {
            if (window.nativeCameraState.failVideoCopy) { delete window.gallery[options.uri]; throw new Error('Gallery copy failed'); }
            if (options.sourceUri !== 'mock-native://video' || !window.gallery[options.uri]) throw new Error('Unowned video source');
            window.gallery[options.uri].bytes = window.nativeVideoBytes;
            return {};
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
  const photoInfoGeneration = await page.evaluate(() => window.nativeCameraInfo().sessionGeneration);
  await page.evaluate(() => window.emitNative('ClearWaterCamera', 'cameraError', { message: 'camera interruption detail', recoverable: true }));
  await page.waitForFunction(() => document.querySelector('.camera-error[role="alert"]')?.textContent === 'Camera interrupted.');
  assert.equal(await page.locator('.camera-photo').isDisabled(), true, 'transient interruption disables capture while native frames are stopped');
  assert.equal(await page.getByRole('button', { name: 'Retry camera' }).count(), 0, 'transient interruption waits for the same native session to recover');
  await page.evaluate(generation => window.emitNative('ClearWaterCamera', 'cameraInfoChanged', { sessionGeneration: generation, photoWidth: 1200, photoHeight: 1600 }), photoInfoGeneration);
  await page.waitForFunction(() => document.querySelector('.camera-error[role="alert"]') === null && document.querySelector('.camera-photo')?.disabled === false);
  await page.evaluate(generation => window.emitNative('ClearWaterCamera', 'cameraInfoChanged', { sessionGeneration: generation, photoWidth: 1200, photoHeight: 1600 }), photoInfoGeneration);
  await page.waitForFunction(() => document.querySelector('.camera-resolution')?.textContent === 'Photo resolution: 1200 × 1600');
  await page.evaluate(generation => window.emitNative('ClearWaterCamera', 'cameraInfoChanged', { sessionGeneration: generation - 1, photoWidth: 1920, photoHeight: 1080 }), photoInfoGeneration);
  await page.waitForTimeout(50);
  assert.equal(await page.locator('.camera-resolution').innerText(), 'Photo resolution: 1200 × 1600', 'stale photo dimensions from an older session are ignored');

  const zoom = page.locator('.camera-zoom-button');
  await zoom.click();
  assert.equal(await zoom.innerText(), '2×', 'native zoom tap uses the next standard CameraX stop');
  const touch = await context.newCDPSession(page);
  const zoomBounds = await zoom.boundingBox();
  const zoomTouch = { x: zoomBounds.x + zoomBounds.width / 2, y: zoomBounds.y + zoomBounds.height / 2, id: 1 };
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [zoomTouch] });
  await page.waitForTimeout(600);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.locator('#camera-zoom-chooser').waitFor();
  assert.equal(await zoom.innerText(), '2×', 'long press opens the chooser without cycling zoom');
  for (const [language, frontLabel] of [['en', 'Front camera'], ['zh-HK', '前置鏡頭'], ['ja', '前面カメラ']]) {
    await page.evaluate(language => {
      localStorage.setItem('clearwater-language', language);
      window.dispatchEvent(new StorageEvent('storage', { key: 'clearwater-language' }));
    }, language);
    const lensLabels = await page.locator('.camera-lens-choice span').allTextContents();
    assert.deepEqual(lensLabels.slice(0, 3), ['Rear ultra wide · 0.5×', 'Rear wide · 1×', `${frontLabel} · 1×`], `${language} front camera label`);
  }
  await page.evaluate(() => {
    localStorage.setItem('clearwater-language', 'en');
    window.dispatchEvent(new StorageEvent('storage', { key: 'clearwater-language' }));
  });
  assert.deepEqual(await page.locator('.camera-zoom-preset').allTextContents(), ['1×', '2×', '3×', '5×', '10×'], 'chooser exposes every cycling zoom stop, including 5× and 10×');
  assert.equal(await page.locator('.camera-zoom-preset[aria-pressed="true"]').innerText(), '2×', 'active zoom preset is marked');
  const scrollArea = page.locator('#camera-zoom-chooser');
  const scrollGeometry = await scrollArea.evaluate(element => {
    const stage = element.closest('.camera-stage');
    const bounds = element.getBoundingClientRect();
    return { stageBottom: stage.getBoundingClientRect().bottom, chooserBottom: bounds.bottom, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
  });
  assert.ok(scrollGeometry.scrollHeight > scrollGeometry.clientHeight, 'extra native lenses overflow the chooser');
  assert.ok(scrollGeometry.chooserBottom <= scrollGeometry.stageBottom + 1, 'chooser fits inside the touchable camera stage');
  const zoomAndLensCalls = () => page.evaluate(() => window.nativeMockCalls.filter(call => call.plugin === 'ClearWaterCamera' && ['setZoom', 'setLens'].includes(call.method)).length);
  const callsBeforePan = await zoomAndLensCalls();
  const swipeChooser = async (reset = true) => {
    const bounds = await scrollArea.boundingBox();
    const x = bounds.x + bounds.width / 2;
    const startY = bounds.y + bounds.height - 30;
    if (reset) await scrollArea.evaluate(element => { element.scrollTop = 0; });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: startY, id: 1 }] });
    for (let distance = 25; distance <= 180; distance += 25) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: startY - distance, id: 1 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => document.querySelector('#camera-zoom-chooser')?.scrollTop > 20);
  };
  await swipeChooser();
  assert.ok(await scrollArea.evaluate(element => element.scrollTop > 20), 'a native Chromium touch swipe scrolls the portrait lens chooser');
  assert.equal(await zoomAndLensCalls(), callsBeforePan, 'panning over chooser buttons does not activate zoom or a lens');
  for (let index = 0; index < 4; index++) await swipeChooser(false);
  const lastLensVisible = await scrollArea.evaluate(element => {
    const last = element.querySelector('.camera-lens-choice:last-child');
    return last.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom && element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
  });
  assert.ok(lastLensVisible, 'repeated native touch swipes reveal the final lens choice');
  assert.equal(await zoomAndLensCalls(), callsBeforePan, 'scrolling to the last lens does not select a lens');
  await page.setViewportSize({ width: 844, height: 390 });
  const landscapeGeometry = await scrollArea.evaluate(element => ({ chooser: element.getBoundingClientRect(), viewportHeight: window.innerHeight, scroll: element.scrollHeight, client: element.clientHeight }));
  assert.ok(landscapeGeometry.chooser.height > 180 && landscapeGeometry.chooser.bottom <= landscapeGeometry.viewportHeight, 'landscape chooser uses the available screen height');
  assert.ok(landscapeGeometry.scroll > landscapeGeometry.client, 'landscape chooser remains scrollable');
  await swipeChooser();
  assert.ok(await scrollArea.evaluate(element => element.scrollTop > 20), 'a native Chromium touch swipe scrolls the landscape lens chooser');
  await page.setViewportSize({ width: 390, height: 640 });
  await scrollArea.evaluate(element => { element.scrollTop = 0; });
  const sliderBounds = await page.locator('.camera-zoom-slider input').boundingBox();
  const sliderY = sliderBounds.y + sliderBounds.height / 2;
  const sliderStartX = sliderBounds.x + sliderBounds.width * 0.25;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sliderStartX, y: sliderY, id: 1 }] });
  for (let fraction = 0.35; fraction <= 0.85; fraction += 0.1) {
    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sliderBounds.x + sliderBounds.width * fraction, y: sliderY, id: 1 }] });
  }
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(() => window.nativeCameraState.zoom > 2.5);
  assert.ok(await page.evaluate(() => window.nativeCameraState.zoom > 2.5), 'horizontal touch drag still changes the zoom slider');
  await page.locator('.camera-zoom-preset').filter({ hasText: '10×' }).click();
  assert.equal(await zoom.innerText(), '10×', '10× preset updates the displayed magnification');
  assert.equal(await page.evaluate(() => window.nativeMockCalls.filter(call => call.plugin === 'ClearWaterCamera' && call.method === 'setZoom').at(-1).options.ratio), 10, '10× preset applies native CameraX zoom');
  assert.equal(await scrollArea.count(), 0, 'selecting a zoom preset closes the chooser');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [zoomTouch] });
  await page.waitForTimeout(600);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await scrollArea.waitFor();
  await page.locator('.camera-zoom-preset').filter({ hasText: '5×' }).click();
  assert.equal(await zoom.innerText(), '5×', '5× preset updates the displayed magnification');
  assert.equal(await page.evaluate(() => window.nativeMockCalls.filter(call => call.plugin === 'ClearWaterCamera' && call.method === 'setZoom').at(-1).options.ratio), 5, '5× preset applies native CameraX zoom');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [zoomTouch] });
  await page.waitForTimeout(600);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await scrollArea.waitFor();
  await page.getByRole('button', { name: /Rear ultra wide/ }).click();
  assert.equal(await zoom.innerText(), '0.5×', 'displayed magnification uses the reported native lens factor');
  assert.ok(await page.evaluate(() => window.nativeMockCalls.some(call => call.plugin === 'ClearWaterCamera' && call.method === 'setLens')));
  await page.getByRole('button', { name: 'White balance', exact: true }).click();
  const previewHit = await page.evaluate(() => {
    const button = document.querySelector('.camera-zoom-button').getBoundingClientRect();
    const tools = document.querySelector('.camera-zoom-tools').getBoundingClientRect();
    const preview = document.querySelector('.camera-preview');
    const rect = preview.getBoundingClientRect();
    const x = Math.max(tools.left + 4, rect.left + 4);
    const y = button.bottom + 20;
    return { hitPreview: document.elementFromPoint(x, y) === preview, insideTools: x < tools.right && y < tools.bottom, insidePreview: x < rect.right && y < rect.bottom };
  });
  assert.ok(previewHit.insideTools && previewHit.insidePreview && previewHit.hitPreview, 'closed zoom overlay passes picker touches through to the preview');
  await page.getByRole('button', { name: 'Cancel picker' }).click();
  assert.equal(await page.getByRole('button',{name:/Five A\+ assist/}).getAttribute('aria-pressed'),'false','AI assist is off for the live Balanced check');
  await page.waitForFunction(() => {const calls=window.nativeMockCalls.filter(call=>call.plugin==='ClearWaterCamera');const sample=calls.findIndex(call=>call.method==='sampleFrame');return sample>=0&&calls.slice(sample+1).some(call=>call.method==='setCorrection');});
  const liveCorrection = await page.evaluate(() => window.nativeMockCalls.filter(call=>call.plugin==='ClearWaterCamera'&&call.method==='setCorrection').at(-1).options.recipe);
  assert.equal(liveCorrection.engine,'balanced','sampled native frames continue Balanced correction with AI assist off');
  assert.equal(liveCorrection.auto.gains.length,3,'sampled native frames continue automatic white balance with AI assist off');
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
  await page.evaluate(generation => window.emitNative('ClearWaterCamera', 'cameraInfoChanged', { sessionGeneration: generation, photoWidth: 9999, photoHeight: 8888 }), photoInfoGeneration);
  assert.match(await page.locator('.camera-resolution').innerText(), /^Video target: /, 'photo dimension events do not replace the video target chip');
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

  const chunksBeforeVideo = await page.evaluate(() => window.nativeMockCalls.filter(call=>call.plugin==='ClearWaterFiles'&&call.method==='writeChunk').length);
  await page.evaluate(() => {
    window.nativeVideoBytes = [0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109];
    window.nativeFiles['mock-native://video'] = `data:video/mp4;base64,${btoa(String.fromCharCode(...window.nativeVideoBytes))}`;
    window.emitNative('ClearWaterCamera', 'recordingFinished', {uri:'mock-native://video',name:'clearwater-camera-00000000-0000-4000-8000-000000000002.mp4',type:'video/mp4',width:390,height:844});
  });
  await page.waitForFunction(() => window.nativeCameraState.released === 'mock-native://video');
  const videoSave = await page.evaluate(() => ({copy:window.nativeMockCalls.filter(call=>call.plugin==='ClearWaterFiles'&&call.method==='copyCameraCapture'),chunks:window.nativeMockCalls.filter(call=>call.plugin==='ClearWaterFiles'&&call.method==='writeChunk').length,gallery:Object.values(window.gallery).filter(item=>item.type==='video/mp4')}));
  assert.equal(videoSave.copy.length,1,'native copy publishes the recorded video');
  assert.equal(videoSave.copy[0].options.sourceUri,'mock-native://video','copy uses the exact camera-owned temporary URI');
  assert.deepEqual(videoSave.gallery[0].bytes,[0,0,0,20,102,116,121,112,105,115,111,109]);
  assert.equal(videoSave.chunks,chunksBeforeVideo,'video bytes are not uploaded back through JavaScript');

  await page.evaluate(() => {
    window.nativeCameraState.failVideoCopy = true;
    window.nativeFiles['mock-native://video-failure'] = window.nativeFiles['mock-native://video'];
    window.emitNative('ClearWaterCamera', 'recordingFinished', {uri:'mock-native://video-failure',name:'clearwater-camera-00000000-0000-4000-8000-000000000003.mp4',type:'video/mp4',width:390,height:844});
  });
  await page.getByRole('alert').filter({hasText:'Saved in collection. Could not save on phone.'}).waitFor();
  assert.equal(await page.evaluate(() => Object.values(window.gallery).filter(item=>item.type==='video/mp4').length),1,'failed native copy removes its new gallery destination');
  await page.waitForFunction(() => window.nativeMockCalls.some(call=>call.plugin==='ClearWaterCamera'&&call.method==='releaseCapture'&&call.options.uri==='mock-native://video-failure'));
  const archivedAfterFailure = await page.evaluate(async () => {
    const opened=indexedDB.open('clearwater-library',2);
    const db=await new Promise((resolve,reject)=>{opened.onsuccess=()=>resolve(opened.result);opened.onerror=()=>reject(opened.error);});
    const tx=db.transaction('camera-originals');const request=tx.objectStore('camera-originals').getAll();
    const originals=await new Promise(resolve=>{request.onsuccess=()=>resolve(request.result);});db.close();
    return originals.filter(item=>item.file?.type==='video/mp4').length;
  });
  assert.equal(archivedAfterFailure,2,'both videos retain their editable private source after gallery failure');
  assert.equal(await page.evaluate(() => window.nativeMockCalls.filter(call=>call.plugin==='ClearWaterCamera'&&call.method==='releaseCapture'&&call.options.uri==='mock-native://video-failure').length),1,'failed gallery video temp is released only after the private archive survives');

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
  console.log('PASS mocked CameraX launch, Balanced correction with AI off, native zoom/lens, corrected photo save, direct video copy and rollback, finalize errors and serialized resume lifecycle');
} finally {
  await browser.close();
}
