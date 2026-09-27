import { pngBytes } from './image-bytes';

/**
 * `File` objects for the client's side of story 12.
 *
 * The byte fixtures in `./image-bytes` stay free of any environment so they can
 * be used inside workerd, in Node, and in jsdom alike. A `File` belongs to the
 * browser end only — the Worker is handed a request body, never a file — so this
 * wrapper lives apart from them.
 */

/** A file named and typed exactly as asked, holding `bytes`. */
export function imageFile(
  name: string,
  type: string,
  bytes: Uint8Array | number[] = pngBytes(),
): File {
  const content = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  return new File([new Uint8Array(content)], name, { type });
}
