declare module 'heic-to/next' {
  export function heicTo(options:{blob:Blob;type:'bitmap';options?:ImageBitmapOptions}):Promise<ImageBitmap>;
}
