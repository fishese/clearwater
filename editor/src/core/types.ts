import type { AIEngine } from './bundled-models';

export type Scene = 'auto' | 'underwater' | 'surface';
export type Water = 'auto' | 'blue' | 'green';
export type Filter = 'auto' | 'yes' | 'no';
export interface Hints { scene: Scene; water: Water; filter: Filter; depth: number | null }
export interface Analysis {
  mean: [number, number, number];
  neutral: [number, number, number];
  p05: number; p50: number; p95: number;
  clipping: number; redRatio: number; magenta: number;
  confidence: 'low' | 'medium';
}
export interface Suggestion {
  gains: [number, number, number];
  redMix: number; haze: number; highlights: number;
  mode: 'restore' | 'filter' | 'gentle';
  explanation: string;
}
export interface Adjustments {
  warmth: number; tint: number; red: number; exposure: number;
  highlights: number; shadows: number; contrast: number; haze: number; vibrance: number;
  neutral: [number, number, number];
}
export interface Recipe {
  version: 1; engine: 'balanced' | 'baseline' | AIEngine; strength: number;
  hints: Hints; auto: Suggestion; manual: Adjustments;
  customModel?: CustomModel;
  enhancement?: PhotoEnhancement;
  /** Optional follow-up Balanced pass for AI photo results. Omitted means disabled. */
  balancedAfterAI?: { strength: number };
  videoCorrection?: {mode:'sampled'|'fixed';interval:2|5|10;referenceTime:number};
}
export interface PhotoEnhancement {contrast:number;clarity:number;sharpness:number;black:number;white:number;brightness?:number;autoApplied?:boolean}
export const DEFAULT_ENHANCEMENT:PhotoEnhancement={contrast:0,clarity:0,sharpness:0,black:0,white:1,brightness:0};
// 'wave' remains the on-disk engine ID for compatibility with earlier recipes.
export interface CustomModel {sha256:string;name:string;inputRange:'unit'|'signed';outputRange:'unit'|'signed'}
export const DEFAULT_HINTS: Hints = { scene: 'auto', water: 'auto', filter: 'auto', depth: null };
export const DEFAULT_MANUAL: Adjustments = {
  warmth: 0, tint: 0, red: 0, exposure: 0, highlights: 0,
  shadows: 0, contrast: 0, haze: 0, vibrance: 0, neutral: [1, 1, 1],
};
