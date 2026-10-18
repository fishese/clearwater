/** Transfer a model's low-resolution RGB residual without discarding source detail.
 * The residual is an additive sRGB difference. A colour guided filter (He et al.),
 * radius 2 on the 256 grid, lifts it to full resolution. Luma of that departure
 * from bilinear is kept at 1/2; chroma is kept in full. This is colour enhancement,
 * not full-resolution neural denoising or restoration. */

export const GUIDED_RADIUS = 2;
export const GUIDED_EPS = 1e-4;
export const GUIDED_LUMA_SCALE = 0.5;
/** Per-channel cap on how far the guided field may leave the bilinear field.
 * Tuned on 1600 px previews: p99 of the departure is about 0.03–0.05 and p99.9
 * about 0.06–0.10, while a few pixels reach 0.3–0.4. 0.12 sits in the untested
 * 0.10–0.15 band and cuts those spikes without moving the bulk of the edge signal. */
export const GUIDED_DEVIATION_LIMIT = 0.12;

export type GuidedField = {
  field: Float32Array;
  /** 12 coefficients per low-res pixel: 3×3 colour matrix, then bias, after the second box filter. */
  coef: Float32Array;
  size: number;
};

const lumaR = 0.2126, lumaG = 0.7152, lumaB = 0.0722;

function reflectIndex(index: number, length: number) {
  while (index < 0 || index >= length) index = index < 0 ? -index - 1 : 2 * length - index - 1;
  return index;
}

/** Separable box mean. Reflect padding, so every window is (2r+1)², matching cv2.BORDER_REFLECT. */
function boxMean(source: Float32Array, size: number, radius: number) {
  const temp = new Float32Array(size * size), out = new Float32Array(size * size), scale = 1 / (2 * radius + 1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let delta = -radius; delta <= radius; delta++) sum += source[y * size + reflectIndex(x + delta, size)];
    temp[y * size + x] = sum * scale;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let sum = 0;
    for (let delta = -radius; delta <= radius; delta++) sum += temp[reflectIndex(y + delta, size) * size + x];
    out[y * size + x] = sum * scale;
  }
  return out;
}

/** Low-res colour guided-filter setup. Cache this with the field; it does not depend on output size or strength. */
export function prepareGuidedField(guide: Uint8ClampedArray, field: Float32Array, size = 256, radius = GUIDED_RADIUS, eps = GUIDED_EPS): GuidedField {
  const count = size * size;
  const guideChannels = [0, 1, 2].map(channel => {
    const values = new Float32Array(count);
    for (let i = 0; i < count; i++) values[i] = guide[i * 4 + channel] / 255;
    return values;
  });
  const fieldChannels = [0, 1, 2].map(channel => {
    const values = new Float32Array(count);
    for (let i = 0; i < count; i++) values[i] = field[i * 3 + channel];
    return values;
  });
  const product = (left: Float32Array, right: Float32Array) => {
    const out = new Float32Array(count);
    for (let i = 0; i < count; i++) out[i] = left[i] * right[i];
    return out;
  };
  const meanGuide = guideChannels.map(channel => boxMean(channel, size, radius));
  const covariance: Record<string, Float32Array> = {};
  for (let i = 0; i < 3; i++) for (let j = i; j < 3; j++) covariance[`${i}${j}`] = boxMean(product(guideChannels[i], guideChannels[j]), size, radius);
  const slopes = Array.from({length: 9}, () => new Float32Array(count));
  const bias = [0, 1, 2].map(() => new Float32Array(count));
  for (let channel = 0; channel < 3; channel++) {
    const meanField = boxMean(fieldChannels[channel], size, radius);
    const cross = [0, 1, 2].map(guideChannel => boxMean(product(guideChannels[guideChannel], fieldChannels[channel]), size, radius));
    for (let pixel = 0; pixel < count; pixel++) {
      const mean0 = meanGuide[0][pixel], mean1 = meanGuide[1][pixel], mean2 = meanGuide[2][pixel];
      const s00 = covariance['00'][pixel] - mean0 * mean0 + eps;
      const s01 = covariance['01'][pixel] - mean0 * mean1;
      const s02 = covariance['02'][pixel] - mean0 * mean2;
      const s11 = covariance['11'][pixel] - mean1 * mean1 + eps;
      const s12 = covariance['12'][pixel] - mean1 * mean2;
      const s22 = covariance['22'][pixel] - mean2 * mean2 + eps;
      const v0 = cross[0][pixel] - mean0 * meanField[pixel];
      const v1 = cross[1][pixel] - mean1 * meanField[pixel];
      const v2 = cross[2][pixel] - mean2 * meanField[pixel];
      const i00 = s11 * s22 - s12 * s12, i01 = s02 * s12 - s01 * s22, i02 = s01 * s12 - s02 * s11;
      const i11 = s00 * s22 - s02 * s02, i12 = s01 * s02 - s00 * s12, i22 = s00 * s11 - s01 * s01;
      const inverseDet = 1 / (s00 * i00 + s01 * i01 + s02 * i02);
      const a0 = (i00 * v0 + i01 * v1 + i02 * v2) * inverseDet;
      const a1 = (i01 * v0 + i11 * v1 + i12 * v2) * inverseDet;
      const a2 = (i02 * v0 + i12 * v1 + i22 * v2) * inverseDet;
      slopes[channel * 3][pixel] = a0;
      slopes[channel * 3 + 1][pixel] = a1;
      slopes[channel * 3 + 2][pixel] = a2;
      bias[channel][pixel] = meanField[pixel] - a0 * mean0 - a1 * mean1 - a2 * mean2;
    }
  }
  const averaged = [...slopes, ...bias].map(channel => boxMean(channel, size, radius));
  const coef = new Float32Array(count * 12);
  for (let pixel = 0; pixel < count; pixel++) for (let k = 0; k < 12; k++) coef[pixel * 12 + k] = averaged[k][pixel];
  return {field, coef, size};
}

/** Bilinear residual transfer. The guided path is compared with this, and a flat residual must match it. */
export function transferFieldBilinear(input: Uint8ClampedArray, width: number, height: number, field: Float32Array, size = 256, offsetY = 0, fullHeight = height, offsetX = 0, fullWidth = width): Uint8ClampedArray {
  const out = new Uint8ClampedArray(input.length);
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(size - 1, (y + offsetY + .5) / fullHeight * size - .5)), y0 = Math.floor(fy), y1 = Math.min(size - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(size - 1, (x + offsetX + .5) / fullWidth * size - .5)), x0 = Math.floor(fx), x1 = Math.min(size - 1, x0 + 1), tx = fx - x0, i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const top = field[(y0 * size + x0) * 3 + c] * (1 - tx) + field[(y0 * size + x1) * 3 + c] * tx;
        const bottom = field[(y1 * size + x0) * 3 + c] * (1 - tx) + field[(y1 * size + x1) * 3 + c] * tx;
        out[i + c] = input[i + c] + (top * (1 - ty) + bottom * ty) * 255;
      }
      out[i + 3] = input[i + 3];
    }
  }
  return out;
}

function clampDeviation(value: number) {
  return Math.max(-GUIDED_DEVIATION_LIMIT, Math.min(GUIDED_DEVIATION_LIMIT, value));
}

/** Guided upsample of a cached field. Strips must pass the full-image width, height and origin. */
export function transferField(input: Uint8ClampedArray, width: number, height: number, guided: GuidedField, offsetY = 0, fullHeight = height, offsetX = 0, fullWidth = width): Uint8ClampedArray {
  const {field, coef, size} = guided;
  const out = new Uint8ClampedArray(input.length), sample = new Float32Array(12);
  const lumaKeep = GUIDED_LUMA_SCALE - 1;
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(size - 1, (y + offsetY + .5) / fullHeight * size - .5)), y0 = Math.floor(fy), y1 = Math.min(size - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(size - 1, (x + offsetX + .5) / fullWidth * size - .5)), x0 = Math.floor(fx), x1 = Math.min(size - 1, x0 + 1), tx = fx - x0, i = (y * width + x) * 4;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      const p00 = y0 * size + x0, p01 = y0 * size + x1, p10 = y1 * size + x0, p11 = y1 * size + x1;
      for (let k = 0; k < 12; k++) sample[k] = coef[p00 * 12 + k] * w00 + coef[p01 * 12 + k] * w01 + coef[p10 * 12 + k] * w10 + coef[p11 * 12 + k] * w11;
      const red = input[i] / 255, green = input[i + 1] / 255, blue = input[i + 2] / 255;
      const bilinear0 = field[p00 * 3] * w00 + field[p01 * 3] * w01 + field[p10 * 3] * w10 + field[p11 * 3] * w11;
      const bilinear1 = field[p00 * 3 + 1] * w00 + field[p01 * 3 + 1] * w01 + field[p10 * 3 + 1] * w10 + field[p11 * 3 + 1] * w11;
      const bilinear2 = field[p00 * 3 + 2] * w00 + field[p01 * 3 + 2] * w01 + field[p10 * 3 + 2] * w10 + field[p11 * 3 + 2] * w11;
      const guided0 = sample[0] * red + sample[1] * green + sample[2] * blue + sample[9];
      const guided1 = sample[3] * red + sample[4] * green + sample[5] * blue + sample[10];
      const guided2 = sample[6] * red + sample[7] * green + sample[8] * blue + sample[11];
      const lumaAdjust = (lumaR * (guided0 - bilinear0) + lumaG * (guided1 - bilinear1) + lumaB * (guided2 - bilinear2)) * lumaKeep;
      const mixed0 = bilinear0 + clampDeviation(guided0 + lumaAdjust - bilinear0);
      const mixed1 = bilinear1 + clampDeviation(guided1 + lumaAdjust - bilinear1);
      const mixed2 = bilinear2 + clampDeviation(guided2 + lumaAdjust - bilinear2);
      out[i] = input[i] + mixed0 * 255;
      out[i + 1] = input[i + 1] + mixed1 * 255;
      out[i + 2] = input[i + 2] + mixed2 * 255;
      out[i + 3] = input[i + 3];
    }
  }
  return out;
}
