import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.CHECK_URL || 'http://127.0.0.1:4176/');
  await page.evaluate(() => {
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async constraints => {
      const stream = await originalGetUserMedia(constraints);
      for (const track of stream.getVideoTracks()) {
        let zoom = 1;
        const getCapabilities = track.getCapabilities.bind(track);
        const getSettings = track.getSettings.bind(track);
        track.getCapabilities = () => ({ ...getCapabilities(), zoom: { min: 0.5, max: 2, step: 0.5 } });
        track.getSettings = () => ({ ...getSettings(), zoom });
        track.applyConstraints = async constraints => { zoom = constraints.advanced[0].zoom; };
      }
      return stream;
    };
    navigator.mediaDevices.enumerateDevices = async () => [
      { kind: 'videoinput', label: 'Back Camera' , deviceId: 'rear-0' },
      { kind: 'videoinput', label: 'Wide rear camera', deviceId: 'rear-1' },
      { kind: 'videoinput', label: 'Camera 2', deviceId: 'unlabeled' },
      { kind: 'audioinput', label: 'Rear microphone', deviceId: 'mic' },
    ];
    window.cameraColourUniformValues = [];
    const locations = new WeakMap();
    const getLocation = WebGLRenderingContext.prototype.getUniformLocation;
    WebGLRenderingContext.prototype.getUniformLocation = function (program, name) {
      const location = getLocation.call(this, program, name);
      if (location && name === 'u_hasCameraColour') locations.set(location, true);
      return location;
    };
    const setUniform = WebGLRenderingContext.prototype.uniform1f;
    WebGLRenderingContext.prototype.uniform1f = function (location, value) {
      if (locations.has(location)) window.cameraColourUniformValues.push(value);
      return setUniform.call(this, location, value);
    };
  });
  await page.locator('.camera-launch').click();
  await page.waitForFunction(() => document.querySelector('.camera-photo')?.disabled === false);

  const zoom = page.locator('.camera-zoom-button');
  await zoom.waitFor();
  assert.equal(await zoom.innerText(), '1×');
  await zoom.click();
  assert.equal(await zoom.innerText(), '2×', 'tap cycles to the next capability-backed zoom preset');
  const zoomBox = await zoom.boundingBox();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  await page.locator('#camera-zoom-chooser').waitFor();
  assert.equal(await zoom.innerText(), '2×', 'long press opens the chooser without cycling zoom');
  const lensNames = await page.locator('.camera-lens-choice span').allTextContents();
  assert.deepEqual(lensNames, ['Back Camera', 'Wide rear camera'], 'only labeled rear devices are offered');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#camera-zoom-chooser').count(), 0, 'Escape dismisses the chooser');

  await page.evaluate(() => {
    window.Worker = class {
      onmessage = null;
      onerror = null;
      postMessage(message) {
        setTimeout(() => this.onmessage?.({ data: { type: 'result', request: message.request, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0] } }), 25);
      }
      terminate() {}
    };
  });
  const ai = page.locator('.camera-feature-button').first();
  assert.equal(await ai.innerText(), 'AI');
  await ai.click();
  await page.waitForFunction(() => document.querySelector('.camera-feature-button')?.getAttribute('aria-label')?.endsWith('ready'));
  await page.waitForFunction(() => window.cameraColourUniformValues.includes(1));
  assert.equal(await ai.innerText(), 'AI', 'AI button keeps its compact label');
  assert.equal(await ai.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.camera-feature-button').nth(1).isDisabled(), true, 'Balanced red filter hints are disabled while Five A+ is active');
  assert.equal(await page.locator('.camera-depth-control > button').isDisabled(), true, 'Balanced depth hints are disabled while Five A+ is active');
  assert.match(await page.locator('.camera-hints-note').innerText(), /Balanced restoration/);
  assert.equal(await page.locator('.camera-record').isDisabled(), false);
  await page.locator('.camera-record').click();
  await page.locator('.camera-recording').waitFor();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.cameraColourUniformValues.at(-1)), 1, 'recording keeps the captured Five A+ matrix frozen');
  await page.locator('.camera-record').click();
  await page.getByRole('status').filter({ hasText: 'Saved in collection.' }).waitFor();
  await ai.click();
  await page.waitForFunction(() => document.querySelector('.camera-feature-button')?.getAttribute('aria-pressed') === 'false');
  await page.waitForFunction(() => window.cameraColourUniformValues.at(-1) === 0, null, { timeout: 5000 });
  assert.equal(await page.locator('.camera-feature-button').nth(1).isDisabled(), false);
  assert.equal(await page.locator('.camera-hints-note').count(), 0);
  await page.locator('.camera-depth-control > button').click();
  assert.equal(await page.locator('.camera-depth-chooser input[type=range]').getAttribute('max'), '100', 'depth hint covers the editor’s full 0–100 m range');
  await page.keyboard.press('Escape');
  await page.locator('.camera-close-button').click();
  assert.deepEqual(errors, []);
  console.log('PASS capability zoom, long-press chooser, labeled lenses, AI state and Balanced hint gating');
} finally {
  await browser.close();
}
