// Image bytes for tests that cannot read tests/fixtures/images/* from disk (the Workers integration runtime,
// jsdom), plus generators for the size-limit boundaries. The files in tests/fixtures/images/ are the real
// fixtures for unit and e2e tests: screenshot.png (1440x900), photo.jpg (4032x3024), animated.gif, picture.webp,
// script.svg (contains a script tag), document-renamed.png (a PDF), truncated.png (a cut-off PNG).

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A real 64x40 PNG. */
export const SMALL_PNG = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCRkPOBxTyE+pAAAAeklEQVRYw+3X0Q2AMAwD0SAxOAMyEhCG8Id10nWCPsVN0mPva8jn3Odr3yEDDB2wLx1ArwA/QnjAu+07ZAAjJCAEjHNAQAawC9UB9EdshASEgKEvc/gK4AH8LkSfA0aoDcBXAA/wRyYgBPC7kMtcGcCPEB5AnwNGqHx+l3Np8fWJfZcAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDktMjVUMTU6NTY6MjgrMDA6MDCD6CsEAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA5LTI1VDE1OjU2OjI4KzAwOjAw8rWTuAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wOS0yNVQxNTo1NjoyOCswMDowMKWgsmcAAAAASUVORK5CYII=');
export const SMALL_PNG_SIZE = { width: 64, height: 40 };
/** A real 48x32 JPEG. */
export const SMALL_JPEG = fromBase64('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAgADADAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCemSLgAAAAAAAAAAAAAAAAAAAAAAP/2Q==');
/** A PDF (as if renamed to .png). */
export const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
/** An SVG carrying a script. */
export const SVG_WITH_SCRIPT = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><script>alert(1)</script><rect width="100" height="100" fill="red"/></svg>');

/**
 * A valid JPEG of exactly `size` bytes: SMALL_JPEG followed by padding (decoders stop at the end-of-image marker,
 * so the image still decodes).
 */
export function jpegOfSize(size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(SMALL_JPEG.subarray(0, Math.min(size, SMALL_JPEG.length)));
  return out;
}
