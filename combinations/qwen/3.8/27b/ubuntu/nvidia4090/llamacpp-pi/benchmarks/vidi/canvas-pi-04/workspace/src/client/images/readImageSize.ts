// Story 12: read a file's natural pixel dimensions (anchor: image.insert).
//
// The natural size is known at drop/paste/pick and is used to size the
// placeholder (image.placement_size). `createImageBitmap` is preferred (fast,
// off the main thread); an <img> element is the fallback for older engines.
// A decode failure rejects, and the caller treats that as a type rejection
// (image.decode failure → type toast, no placeholder; TC-29).

export interface ImageSize {
  width: number;
  height: number;
}

export function readImageSize(file: File): Promise<ImageSize> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file).then((bitmap) => {
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    });
  }
  return new Promise<ImageSize>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = (): void => {
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(size);
    };
    img.onerror = (): void => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read image size'));
    };
    img.src = url;
  });
}
