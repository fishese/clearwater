import {changeLanguage,readLanguage} from './settings-helpers.mjs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const editorDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const screenshotDir = path.resolve(editorDir, '../analysis');
await mkdir(screenshotDir, { recursive: true });
const baseUrl = process.env.CHECK_URL || 'http://127.0.0.1:4178/';
let server;
if (!process.env.CHECK_URL) {
  server = spawn(process.execPath, [path.join(editorDir, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '4178', '--strictPort'], { cwd: editorDir, stdio: 'ignore' });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(baseUrl); if (response.ok) { ready = true; break; } } catch {}
    await delay(250);
  }
  if (!ready) { server.kill(); throw new Error('Vite did not start at ' + baseUrl); }
}

const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const results = [];
const failures = [];
try {
  for (const folderMode of [false, true]) {
    for (const language of ['en', 'zh-HK', 'ja']) {
      for (const width of [320, 390, 1280]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        await page.addInitScript((hasFolderPicker) => Object.defineProperty(window, 'showDirectoryPicker', { value: hasFolderPicker ? async () => ({}) : undefined }), folderMode);
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        await changeLanguage(page,language);
        const imageData = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 48; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#28778c'; ctx.fillRect(0, 0, canvas.width, canvas.height); return canvas.toDataURL().split(',')[1]; });
        const uploadLabel = { en: 'Choose photos', 'zh-HK': '選擇相片', ja: '写真を選択' }[language];
        await page.getByLabel(uploadLabel, { exact: true }).setInputFiles({ name: 'touch-target.png', mimeType: 'image/png', buffer: Buffer.from(imageData, 'base64') });
        await page.waitForFunction(() => document.querySelector('.top-actions .primary')?.disabled === false);
        if (width <= 650) {
          await page.locator('[data-control-tab="enhancement"]').click();
          await page.locator('[data-control-subtab="light"]').click();
        }
        const stressLongCount = width === 320;
        if (stressLongCount) await page.locator('.photo-navigation span').evaluate(element => { element.textContent = '1000 / 1000'; });
        await page.waitForTimeout(60);
        const result = await page.evaluate(({ folderMode, language, width, stressLongCount }) => {
          const rect = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
          const toolbar = document.querySelector('.canvas-toolbar');
          const nav = document.querySelector('.photo-navigation');
          const tools = document.querySelector('.canvas-tools');
          const panelIds = width <= 650 ? ['light'] : ['wide'];
          const faderPanels = panelIds.map(name => {
            const panel = name === 'wide' ? document.querySelector('.light-clarity-group') : document.querySelector(`#control-subpanel-${name}`);
            const grid = name === 'wide' ? panel?.querySelector(':scope > .group-content') : panel?.querySelector('.light-clarity-grid');
            const sliders = [...(panel?.querySelectorAll('.light-clarity-grid .vertical-range input') ?? [])].map(rect);
            const gridRect = grid ? rect(grid) : null;
            return { name, count: sliders.length, minWidth: sliders.length ? Math.min(...sliders.map(x => x.width)) : 0,
              withinGrid: !!gridRect && sliders.every(x => x.left >= gridRect.left - 1 && x.right <= gridRect.right + 1),
              singleRow: sliders.length > 0 && sliders.every(x => Math.abs(x.top - sliders[0].top) < 1),
              overlap: sliders.some((x, i) => sliders.slice(i + 1).some(y => Math.min(x.right, y.right) - Math.max(x.left, y.left) > 0.5)) };
          });
          const touchTargets = [...document.querySelectorAll('.settings-group>summary,.control-tabs button')].map(rect).filter(x => x.width > 0 && x.height > 0);
          const enhancement = document.querySelector('.enhancement-group');
          const color = enhancement ? getComputedStyle(enhancement.querySelector('summary')).color : '';
          const saveButtons = document.querySelectorAll('.save-destination>.text-button').length;
          const toolbarButtons = [...(tools?.querySelectorAll('button') ?? [])].map(rect);
          const toolbarRect = rect(toolbar);
          const navRect = nav ? rect(nav) : null;
          const toolsRect = tools ? rect(tools) : null;
          const verticallyOverlapping = !!navRect && !!toolsRect && navRect.top < toolsRect.bottom && toolsRect.top < navRect.bottom;
          return {
            folderMode, language, width,
            overflow: document.documentElement.scrollWidth > innerWidth || document.body.scrollWidth > innerWidth,
            toolbarOverlap: verticallyOverlapping && navRect.right > toolsRect.left,
            toolbarContainsControls: !!navRect && !!toolsRect && navRect.left >= toolbarRect.left && navRect.right <= toolbarRect.right && toolsRect.left >= toolbarRect.left && toolsRect.right <= toolbarRect.right,
            toolbarHeight: toolbarRect.height,
            longCountWrapped: stressLongCount && !!navRect && !!toolsRect && toolsRect.top >= navRect.bottom - 0.5,
            faderPanels,
            settingsTargetMinHeight: touchTargets.length ? Math.min(...touchTargets.map(x => x.height)) : 0,
            toolbarButtonMinWidth: toolbarButtons.length ? Math.min(...toolbarButtons.map(x => x.width)) : 0,
            toolbarButtonMinHeight: toolbarButtons.length ? Math.min(...toolbarButtons.map(x => x.height)) : 0,
            enhancementColor: color,
            folderActionsPresent: saveButtons > 0,
            toolbar: toolbarRect
          };
        }, { folderMode, language, width, stressLongCount });
        if (width <= 650) {
          await page.locator('[data-control-subtab="clarity"]').click();
          result.faderPanels.push(await page.evaluate(() => {
            const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
            const grid = document.querySelector('#control-subpanel-clarity .light-clarity-grid');
            const sliders = [...(grid?.querySelectorAll('.vertical-range input') ?? [])].map(rect);
            const bounds = grid ? rect(grid) : null;
            return { name: 'clarity', count: sliders.length, minWidth: sliders.length ? Math.min(...sliders.map(x => x.width)) : 0,
              withinGrid: !!bounds && sliders.every(x => x.left >= bounds.left - 1 && x.right <= bounds.right + 1),
              singleRow: sliders.length > 0 && sliders.every(x => Math.abs(x.top - sliders[0].top) < 1),
              overlap: sliders.some((x, i) => sliders.slice(i + 1).some(y => Math.min(x.right, y.right) - Math.max(x.left, y.left) > 0.5)) };
          }));
        }
        const expectedSmallToolbar = width <= 370 ? 36 : 40;
        const errors = [];
        if (result.overflow) errors.push('horizontal overflow');
        if (result.toolbarOverlap) errors.push('toolbar controls overlap');
        if (!result.toolbarContainsControls) errors.push('toolbar controls escape the toolbar bounds');
        if (result.toolbarHeight < 44) errors.push('toolbar is shorter than 44px');
        if (stressLongCount && !result.longCountWrapped) errors.push('long photo count did not move toolbar controls to a second row');
        const expectedFaders = { wide: 5, light: 3, clarity: 2 };
        for (const panel of result.faderPanels) {
          if (panel.count !== expectedFaders[panel.name]) errors.push(`expected ${expectedFaders[panel.name]} ${panel.name} sliders, got ${panel.count}`);
          if (panel.minWidth < 40) errors.push(`${panel.name} slider hit area narrower than 40px: ${panel.minWidth}`);
          if (!panel.withinGrid || panel.overlap) errors.push(`${panel.name} slider hit areas escape or overlap their grid`);
          if (!panel.singleRow) errors.push(`${panel.name} sliders are not arranged in one row`);
        }
        if (result.settingsTargetMinHeight < 44) errors.push('visible settings/tab target shorter than 44px');
        if (result.toolbarButtonMinWidth < expectedSmallToolbar || result.toolbarButtonMinHeight < 40) errors.push('toolbar button target too small');
        if (result.folderActionsPresent !== folderMode) errors.push('folder mode action mismatch');
        if (!result.enhancementColor) errors.push('missing enhancement group/accent');
        if (errors.length) failures.push({ ...result, errors });
        results.push(result);
        if (!folderMode && language === 'en' && [320, 390, 1280].includes(width)) {
          if (width <= 650) await page.locator('[data-control-subtab="effects"]').click();
          if (width !== 320) await page.locator('.enhancement-group').scrollIntoViewIfNeeded();
          await page.screenshot({ path: path.join(screenshotDir, `touch-layout-${width}.png`) });
        }
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
  if (server) server.kill();
}
console.log(JSON.stringify({ checked: results.length, failures, screenshots: ['analysis/touch-layout-320.png', 'analysis/touch-layout-390.png', 'analysis/touch-layout-1280.png'] }, null, 2));
if (failures.length) process.exitCode = 1;
