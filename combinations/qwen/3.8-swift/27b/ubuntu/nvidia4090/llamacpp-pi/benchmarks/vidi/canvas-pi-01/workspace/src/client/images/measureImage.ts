// Natural-dimension measurement (see spec: image.insert).
//
// createImageBitmap decodes in a worker and gives exact pixel dimensions;
// a rejection (corrupt/truncated file) means the file is not a usable image
// and the caller reports a type rejection (TC-29). The Image-element
// fallback covers environments without createImageBitmap (and jsdom, which
// resolves nothing and therefore yields a rejection there too).

import { IMAGE_SNIFF_BYTES } from '../../shared/config';
import { sniffImageType } from '../../shared/image-format';

export interface NaturalSize {
  width: number;
  height: number;
  /** The sniffed MIME type (falls back to file.type, then image/png). */
  contentType: string;
}

async function sniff(file: File): Promise<string> {
  try {
    const head = new Uint8Array(await file.slice(0, IMAGE_SNIFF_BYTES).arrayBuffer());
    return sniffImageType(head) ?? file.type ?? 'image/png';
  } catch {
    return file.type ?? 'image/png';
  }
}

function viaImageElement(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (width > 0 && height > 0) resolve({ width, height });
      else reject(new Error('no natural dimensions'));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    img.src = url;
  });
}

/**
 * Decode a file and report its natural pixel size. Rejects when the file
 * cannot be decoded as an image.
 */
export async function measureImage(file: File): Promise<NaturalSize> {
  const contentType = await sniff(file);
  let width: number;
  let height: number;
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      width = bitmap.width;
      height = bitmap.height;
      bitmap.close();
    } catch {
      // Fall through to the Image element (some browsers reject certain
      // formats in createImageBitmap that the Image element decodes).
      ({ width, height } = await viaImageElement(file));
    }
  } else {
    ({ width, height } = await viaImageElement(file));
  }
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('no natural dimensions');
  }
  return { width, height, contentType };
}
