/** Resolve a wall-clock preview playhead; slow renders skip ahead rather than queueing frames. */
export function videoPreviewPlayhead(startTime: number, startedAtMs: number, nowMs: number, duration: number): { time: number; ended: boolean } {
  const end = Math.max(0, duration);
  const raw = startTime + Math.max(0, nowMs - startedAtMs) / 1000;
  return { time: Math.min(raw, Math.max(0, end - .001)), ended: raw >= end };
}
