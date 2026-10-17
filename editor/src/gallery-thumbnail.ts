import {photoHeader} from './photo-header';

const MAX_THUMBNAIL_EDGE = 160;
const MAX_CONCURRENT_DECODES = 2;
const MAX_BACKGROUND_PIXELS = 45_000_000;
const MAX_BACKGROUND_BYTES = 60 * 1024 * 1024;

type Job = {file: File; signal: AbortSignal; resolve: (value: string | null) => void};
const pending: Job[] = [];
let running = 0;

export function canMakeGalleryThumbnail(file: File): boolean {
  return file.size <= MAX_BACKGROUND_BYTES && (file.type === 'image/jpeg' || file.type === 'image/png' ||
    (!file.type && /\.(jpe?g|png)$/i.test(file.name)));
}

async function makeThumbnail(file: File, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return null;
  // The shared header reader applies EXIF orientation to JPEG dimensions.
  const dimensions = await photoHeader(file);
  if (signal.aborted || !dimensions) return null;
  const [width, height] = dimensions;
  if (!width || !height || width > 32768 || height > 32768 || width * height > MAX_BACKGROUND_PIXELS) return null;
  const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(width, height));
  let bitmap: ImageBitmap | null = null;
  try {
    // Resize during decode where supported, then bound either orientation on canvas.
    bitmap = await createImageBitmap(file, {resizeWidth: Math.max(1, Math.round(width * scale)), resizeHeight: Math.max(1, Math.round(height * scale)), resizeQuality: 'high'});
  } catch {
    return null;
  }
  try {
    if (signal.aborted) return null;
    const scale = Math.min(1, MAX_THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const result = signal.aborted ? null : canvas.toDataURL('image/jpeg', .75);
    canvas.width = 0;
    canvas.height = 0;
    return result;
  } finally {
    bitmap.close();
  }
}

function drain(): void {
  while (running < MAX_CONCURRENT_DECODES && pending.length) {
    const job = pending.shift()!;
    if (job.signal.aborted) { job.resolve(null); continue; }
    running++;
    void makeThumbnail(job.file, job.signal).then(job.resolve, () => job.resolve(null)).finally(() => {
      running--;
      drain();
    });
  }
}

export function galleryThumbnail(file: File, signal: AbortSignal): Promise<string | null> {
  if (!canMakeGalleryThumbnail(file) || signal.aborted) return Promise.resolve(null);
  return new Promise(resolve => {
    const job = {file, signal, resolve};
    pending.push(job);
    signal.addEventListener('abort', () => {
      const index = pending.indexOf(job);
      if (index >= 0) { pending.splice(index, 1); resolve(null); }
    }, {once: true});
    drain();
  });
}

