import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IMAGE_MAX_BYTES } from '../../../src/shared/config';
import { jpegOfSize } from './inline';

const dir = fileURLToPath(import.meta.url).replace(/[^/]*$/, '');
export const imagePath = (name: string): string => `${dir}${name}`;
export const imageBytes = (name: string): Uint8Array => new Uint8Array(readFileSync(imagePath(name)));

export { jpegOfSize };
export const jpegAtLimit = (): Uint8Array => jpegOfSize(IMAGE_MAX_BYTES);
export const jpegOverLimit = (): Uint8Array => jpegOfSize(IMAGE_MAX_BYTES + 1);
