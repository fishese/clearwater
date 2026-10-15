import type { Recipe } from './types';
import type { CameraQualityProfile } from './camera-quality';

const DEFAULT_PREVIEW_LIMITS = { maxWidth: 1280, maxHeight: 720 } as const;
type CameraPreviewSource = Exclude<CanvasImageSource, SVGImageElement>;

export function getCameraPreviewSize(
  width: number,
  height: number,
  limits: Pick<CameraQualityProfile, 'maxWidth' | 'maxHeight'> = DEFAULT_PREVIEW_LIMITS,
): [number, number] {
  // CameraX and some mobile browsers report portrait buffers in sensor
  // orientation. Apply the same long/short edge budget after orientation so
  // a 608 × 1080 frame is not squeezed into a landscape 1280 × 720 box.
  const portrait = height > width;
  const maxWidth = portrait ? limits.maxHeight : limits.maxWidth;
  const maxHeight = portrait ? limits.maxWidth : limits.maxHeight;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** Convert row-wise RGB affine coefficients to WebGL's column-major mat4 form. */
export function cameraColourMatrixForWebGl(matrix: readonly number[]): Float32Array {
  if (matrix.length !== 12 || !matrix.every(Number.isFinite)) throw new Error('Invalid camera colour matrix.');
  return new Float32Array([
    matrix[0], matrix[4], matrix[8], 0,
    matrix[1], matrix[5], matrix[9], 0,
    matrix[2], matrix[6], matrix[10], 0,
    matrix[3], matrix[7], matrix[11], 1,
  ]);
}

const VERTEX_SHADER = `
attribute vec2 a_position;
attribute vec2 a_uv;
varying vec2 v_uv;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); v_uv = a_uv; }
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform sampler2D u_image;
uniform vec3 u_autoGains;
uniform mat4 u_cameraColour;
uniform float u_hasCameraColour;
uniform vec3 u_manualGains;
uniform float u_redMix;
uniform float u_strength;
uniform float u_haze;
uniform float u_highlights;
uniform float u_exposure;
uniform float u_shadows;
uniform float u_contrast;
uniform float u_vibrance;
varying vec2 v_uv;
float linearChannel(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float srgbChannel(float c) { c = max(c, 0.0); return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec3 original = texture2D(u_image, v_uv).rgb;
  float peak = max(original.r, max(original.g, original.b));
  float red = clamp(original.r * u_autoGains.r + u_redMix * max(0.0, original.g - 0.3 * original.b) * (1.0 - 0.45 * smoothstep(0.65, 1.0, peak)), 0.0, 1.0);
  vec3 balanced = vec3(red, original.g * u_autoGains.g, original.b * u_autoGains.b);
  // Five A+ is sampled off-thread and fitted to a global affine RGB transform.
  // Keeping this transform in the live shader avoids transferring full frames
  // across the worker boundary and keeps still capture and video preview alike.
  vec3 aiColour = (u_cameraColour * vec4(original, 1.0)).rgb;
  vec3 restored = clamp(mix(balanced, aiColour, u_hasCameraColour), 0.0, 1.0);
  vec3 blended = vec3(
    srgbChannel(linearChannel(original.r) * (1.0 - u_strength) + linearChannel(restored.r) * u_strength),
    srgbChannel(linearChannel(original.g) * (1.0 - u_strength) + linearChannel(restored.g) * u_strength),
    srgbChannel(linearChannel(original.b) * (1.0 - u_strength) + linearChannel(restored.b) * u_strength)
  );
  vec3 color = clamp(blended * u_manualGains, 0.0, 1.0);
  vec3 linearColor = vec3(linearChannel(color.r), linearChannel(color.g), linearChannel(color.b)) * u_exposure;
  float l = lum(linearColor);
  float adjusted = l * (1.0 + u_highlights * 0.65 * smoothstep(0.18, 0.95, l)) + u_shadows * 0.16 * (1.0 - smoothstep(0.0, 0.5, l));
  linearColor *= adjusted / max(l, 0.00001);
  color = vec3(srgbChannel(linearColor.r), srgbChannel(linearColor.g), srgbChannel(linearColor.b));
  color = clamp(((color - vec3(u_haze)) / (1.0 - u_haze) - 0.5) * u_contrast + 0.5, 0.0, 1.0);
  float y = lum(color);
  float saturation = max(color.r, max(color.g, color.b)) - min(color.r, min(color.g, color.b));
  color = clamp(vec3(y) + (color - vec3(y)) * (1.0 + u_vibrance * 0.8 * (1.0 - saturation)), 0.0, 1.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create the live correction shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader error.';
    gl.deleteShader(shader);
    throw new Error(`Could not compile the live correction shader: ${message}`);
  }
  return shader;
}

export function createCameraPreview(
  canvas: HTMLCanvasElement,
  limits: Pick<CameraQualityProfile, 'maxWidth' | 'maxHeight'> = DEFAULT_PREVIEW_LIMITS,
): {
  render(source: CameraPreviewSource, width: number, height: number, recipe: Recipe): void;
  dispose(): void;
} {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false });
  if (!gl) throw new Error('Live correction needs WebGL on this device.');

  let vertex: WebGLShader | null = null;
  let fragment: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  try {
    vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    program = gl.createProgram();
    if (!program) throw new Error('Could not create the live correction program.');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Could not link the live correction program: ${gl.getProgramInfoLog(program) || 'Unknown program error.'}`);
    }
    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) throw new Error('Could not allocate live correction resources.');
  } catch (error) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    throw error;
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1,
  ]), gl.STATIC_DRAW);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const position = gl.getAttribLocation(program, 'a_position');
  const uv = gl.getAttribLocation(program, 'a_uv');
  gl.useProgram(program);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(uv);
  gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
  const uniforms = Object.fromEntries([
    'u_image', 'u_autoGains', 'u_cameraColour', 'u_hasCameraColour', 'u_manualGains', 'u_redMix', 'u_strength', 'u_haze',
    'u_highlights', 'u_exposure', 'u_shadows', 'u_contrast', 'u_vibrance',
  ].map(name => [name, gl.getUniformLocation(program, name)]));
  const uploadCanvas = document.createElement('canvas');
  const uploadContext = uploadCanvas.getContext('2d');
  if (!uploadContext) {
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    throw new Error('Could not create the live correction upload surface.');
  }
  let disposed = false;
  let contextLost = false;
  const onContextLost = (event: Event) => { event.preventDefault(); contextLost = true; };
  canvas.addEventListener('webglcontextlost', onContextLost);

  return {
    render(source, width, height, recipe) {
      if (disposed) throw new Error('Live correction preview has been disposed.');
      if (contextLost || gl.isContextLost()) throw new Error('Live correction WebGL context was lost.');
      const [w, h] = getCameraPreviewSize(width, height, limits);
      const downscaling = w !== width || h !== height;
      if (downscaling) {
        if (uploadCanvas.width !== w) uploadCanvas.width = w;
        if (uploadCanvas.height !== h) uploadCanvas.height = h;
        uploadContext.drawImage(source, 0, 0, w, h);
      }
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      gl.viewport(0, 0, w, h);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      const uploadSource: TexImageSource = downscaling ? uploadCanvas as TexImageSource : source as TexImageSource;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, uploadSource);

      const { auto, manual, strength } = recipe;
      const warmth = manual.warmth / 100;
      const red = manual.red / 100;
      const tint = manual.tint / 100;
      const manualGains: [number, number, number] = [
        manual.neutral[0] * 2 ** (warmth * 0.45 + red * 0.8),
        manual.neutral[1] * 2 ** (-tint * 0.4),
        manual.neutral[2] * 2 ** (-warmth * 0.45),
      ];
      const haze = Math.max(-0.1, Math.min(0.18, auto.haze * strength + manual.haze / 100 * 0.12));
      const highlights = Math.max(-1, Math.min(1, manual.highlights / 100 + auto.highlights * strength));
      const set1f = (name: string, value: number) => gl.uniform1f(uniforms[name], value);
      gl.uniform1i(uniforms.u_image, 0);
      gl.uniform3fv(uniforms.u_autoGains, auto.gains);
      const cameraColour = recipe.cameraColour?.matrix;
      if (cameraColour?.length === 12) {
        // GLSL matrices are column-major; mat4's last row/column below supplies
        // the affine offset while retaining a simple vec4 multiply.
        gl.uniformMatrix4fv(uniforms.u_cameraColour, false, cameraColourMatrixForWebGl(cameraColour));
        set1f('u_hasCameraColour', 1);
      } else {
        gl.uniformMatrix4fv(uniforms.u_cameraColour, false, new Float32Array([
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        ]));
        set1f('u_hasCameraColour', 0);
      }
      gl.uniform3fv(uniforms.u_manualGains, manualGains);
      set1f('u_redMix', auto.redMix);
      set1f('u_strength', strength);
      set1f('u_haze', haze);
      set1f('u_highlights', highlights);
      set1f('u_exposure', 2 ** manual.exposure);
      set1f('u_shadows', manual.shadows / 100);
      set1f('u_contrast', 1 + manual.contrast / 100 * 0.65);
      set1f('u_vibrance', manual.vibrance / 100);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      uploadCanvas.width = 1;
      uploadCanvas.height = 1;
    },
  };
}
