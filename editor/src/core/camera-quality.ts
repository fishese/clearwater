export type CameraQuality = 'auto' | 'standard' | 'high';

export interface CameraQualityProfile {
  id: 'standard' | 'high';
  label: string;
  maxWidth: number;
  maxHeight: number;
  videoBitrate: number;
  audioBitrate: number;
  jpegQuality: number;
}

const STANDARD_PROFILE: CameraQualityProfile = {
  id: 'standard',
  label: '720p · 5 Mbps',
  maxWidth: 1280,
  maxHeight: 720,
  videoBitrate: 5_000_000,
  audioBitrate: 128_000,
  jpegQuality: 0.94,
};

const HIGH_PROFILE: CameraQualityProfile = {
  id: 'high',
  label: '1080p · 12 Mbps',
  maxWidth: 1920,
  maxHeight: 1080,
  videoBitrate: 12_000_000,
  audioBitrate: 192_000,
  jpegQuality: 0.97,
};

/** Resolve automatic quality for the current platform without probing camera hardware. */
export function cameraQualityProfile(quality: CameraQuality, android: boolean): CameraQualityProfile {
  return quality === 'high' || (quality === 'auto' && android)
    ? HIGH_PROFILE
    : STANDARD_PROFILE;
}
