// Fixtures as constants for the workerd integration pool, which cannot read files from disk.
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const text = (s: string) => new TextEncoder().encode(s);

export const TINY_PNG = fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8AAP///0EdNBEAAAABYktHRAH/Ai3eAAAAB3RJTUUH6goBDhICFWPRdQAAAAtJREFUCNdjYEAFAAAQAAGhxSHBAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTEwLTAxVDE0OjE4OjAyKzAwOjAwrRKTWAAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMC0wMVQxNDoxODowMiswMDowMNxPK+QAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTAtMDFUMTQ6MTg6MDIrMDA6MDCLWgo7AAAAAElFTkSuQmCC',
);
export const FAKE_PDF = text('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
export const SCRIPT_SVG = text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>');

/** A JPEG-looking body (valid magic bytes) of exactly `bytes` bytes. */
export function jpegOfSize(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  out.set([0xff, 0xd8, 0xff, 0xe0]);
  return out;
}
