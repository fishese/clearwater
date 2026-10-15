// Deterministically generate synthetic-only parity vectors from the shared TypeScript engine.
// Run with: node scripts/generate-ios-native-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const compile = (file, replacements = []) => {
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const [from, to] of replacements) source = source.replaceAll(from, to);
  return ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 });
};
const stripImports = (file) => compile(file).replace(/^import .*?;\s*$/gm, '');
const shared = await import(`data:text/javascript;base64,${Buffer.from([
  stripImports('src/core/types.ts'), stripImports('src/core/engine.ts'), stripImports('src/core/white-balance.ts'), stripImports('src/core/camera-capture.ts'),
].join('\n')).toString('base64')}`);
const engine = shared, wb = shared, types = shared;

function image(kind, width = 64, height = 48) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const wave = ((x * 17 + y * 29 + (x * y) % 31) % 47) / 47;
    let r = 30 + wave * 80, g = 55 + wave * 100, b = 90 + wave * 120, a = 255;
    if (kind === 'filter-cast') { r = 170 + wave * 65; g = 70 + wave * 60; b = 92 + wave * 80; }
    if (kind === 'weak-red') { r = 8 + wave * 20; g = 65 + wave * 90; b = 115 + wave * 100; }
    if (kind === 'haze') { r = 115 + wave * 18; g = 132 + wave * 18; b = 146 + wave * 18; }
    if (kind === 'highlights') { r = x < 15 ? 255 : 35 + wave * 150; g = x < 15 ? 252 : 55 + wave * 130; b = x < 15 ? 251 : 70 + wave * 140; }
    if (kind === 'transparent-wb') { r = 60 + wave * 80; g = 90 + wave * 90; b = 120 + wave * 90; a = (x + y) % 7 === 0 ? 0 : 255; }
    out[i] = Math.round(r); out[i+1] = Math.round(g); out[i+2] = Math.round(b); out[i+3] = a;
  }
  return out;
}

const cases = [
  { name: 'filter-cast', kind: 'filter-cast', hints: { ...types.DEFAULT_HINTS } },
  { name: 'weak-red', kind: 'weak-red', hints: { ...types.DEFAULT_HINTS } },
  { name: 'weak-red-depth-zero', kind: 'weak-red', hints: { ...types.DEFAULT_HINTS, scene: 'underwater', depth: 0 } },
  { name: 'haze', kind: 'haze', hints: { ...types.DEFAULT_HINTS, scene: 'underwater' } },
  { name: 'clipped-highlights', kind: 'highlights', hints: { ...types.DEFAULT_HINTS } },
  { name: 'transparent-replacement-clipped-old-neutral', kind: 'transparent-wb', hints: { ...types.DEFAULT_HINTS } },
];
const result = cases.map(({ name, kind, hints }) => {
  const input = image(kind), analysis = engine.analyse(input, 64, 48), auto = engine.suggest(analysis, hints);
  const recipe = { version: 1, engine: 'balanced', strength: 0.8, hints, auto, manual: structuredClone(types.DEFAULT_MANUAL) };
  if (name === 'transparent-replacement-clipped-old-neutral') {
    recipe.manual = { ...recipe.manual, warmth: 12, tint: -8, red: 6, neutral: [4, 4, 4] };
  }
  const rendered = engine.renderPixels(input, recipe);
  const patch = input.slice(0, 20 * 4);
  const picked = wb.pickNeutralFromPixels(patch, recipe);
  const previous = structuredClone(recipe);
  previous.hints = { scene:'surface', water:'green', filter:'no', depth:23 };
  previous.auto = { ...previous.auto, gains:[0.7,1.1,1.3], redMix:0.4, haze:0.02, highlights:-0.4 };
  previous.manual = { ...previous.manual, warmth:9, tint:-6, red:4, neutral:[1.2,0.8,1.4] };
  const smoothed = shared.makeCameraRecipe(analysis, 0.6, previous);
  return { name, width: 64, height: 48, input: Buffer.from(input).toString('base64'), analysis, auto, recipe,
    rendered: Buffer.from(rendered).toString('base64'), replacementPatch: Buffer.from(patch).toString('base64'),
    replacementNeutral: picked?.manual.neutral ?? null,
    smoothing: { previous, strength:smoothed.strength, hints:smoothed.hints, manual:smoothed.manual, auto:smoothed.auto } };
});
const target = path.join(root, 'ios', 'App', 'AppTests', 'balanced-parity-fixtures.json');
fs.writeFileSync(target, `${JSON.stringify({ generatedFrom: 'src/core/engine.ts', cases: result }, null, 2)}\n`);
console.log(`Wrote ${result.length} synthetic parity fixtures to ${path.relative(root, target)}`);
