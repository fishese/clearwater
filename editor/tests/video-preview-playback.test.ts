import { describe, expect, it } from 'vitest';
import { videoPreviewPlayhead } from '../src/core/video-preview-playback';

describe('serial video preview playhead', () => {
  it('advances from wall clock so a slow render skips time instead of queuing frames', () => {
    expect(videoPreviewPlayhead(2, 10_000, 10_500, 20)).toEqual({ time: 2.5, ended: false });
    expect(videoPreviewPlayhead(2, 10_000, 12_000, 20)).toEqual({ time: 4, ended: false });
  });

  it('stops at the final displayable moment and handles an empty duration', () => {
    expect(videoPreviewPlayhead(9, 1_000, 3_000, 10)).toEqual({ time: 9.999, ended: true });
    expect(videoPreviewPlayhead(0, 1_000, 1_000, 0)).toEqual({ time: 0, ended: true });
  });
});
