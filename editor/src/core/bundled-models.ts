/** Bundled ONNX engines. The file for each id is `models/${id}.onnx`.
 * `wave` is the user-supplied slot and is not a bundled file.
 * Recipe ids stay stable so saved edits keep working.
 */
export const BUNDLED_MODEL_IDS = ['wwe', 'fivea', 'shallow'] as const;
export type BundledModelId = typeof BUNDLED_MODEL_IDS[number];
export const AI_ENGINES = ['wwe', 'fivea', 'shallow', 'wave'] as const;
export type AIEngine = typeof AI_ENGINES[number];

export const BUNDLED_MODELS: Record<BundledModelId, {
  label: string;
  inputRange: 'unit' | 'signed';
  outputRange: 'unit' | 'signed';
}> = {
  wwe: {label: 'WWE-UIE', inputRange: 'unit', outputRange: 'unit'},
  fivea: {label: 'Five A+', inputRange: 'unit', outputRange: 'unit'},
  shallow: {label: 'Shallow-UWnet', inputRange: 'unit', outputRange: 'unit'},
};

export const isAIEngine = (engine: string): engine is AIEngine =>
  (AI_ENGINES as readonly string[]).includes(engine);

/** Worker status text. The custom slot keeps its existing English wording. */
export function aiStatusLabel(engine: AIEngine): string {
  return engine === 'wave' ? 'custom ONNX model' : BUNDLED_MODELS[engine].label;
}

/** Stored recipe explanation. Distinct from the status label for the custom slot. */
export function aiExplanationLabel(engine: AIEngine): string {
  return engine === 'wave' ? 'Custom ONNX model' : BUNDLED_MODELS[engine].label;
}
