# Image fixtures

Real encoded files, committed so every run exercises a real decoder rather than an
assertion about what one might do.

| File | What it is | Used by |
| --- | --- | --- |
| `screenshot-1440x900.png` | PNG, 1440×900, opaque | drop target, upload, paste |
| `screenshot-800x600.png` | PNG, 800×600 | resize / aspect-ratio assertions |
| `photo-4032x3024.jpg` | JPEG, 4032×3024 | natural size far above the placement cap |
| `photo-640x480.webp` | WebP (VP8), 640×480 | WebP path |
| `animation.gif` | GIF89a, 4×4, **2 frames** (107 bytes), one with a delay, NETSCAPE loop extension | animated playback (`image.types`) |
| `script.svg` | SVG containing a `<script>` element | must be refused: a vector is not an accepted raster, and its script must never run |
| `document-as-png.png` | PDF (`%PDF-1.4`) named `.png` | must be refused from its content, not its name |
| `corrupt-truncated.png` | PNG signature + header, then cut short (30 bytes) | passes the sniff, fails the browser decode |

`gif89aBytes()` in `../image-bytes.ts` is the same 2-frame GIF as `animation.gif`,
in code: a unit test that needs a header only should use the code version, and the
e2e tests use this file because Playwright needs a file.

The rasters were produced with a canvas encoder (Chromium) rather than copied from
elsewhere, so their contents are known: opaque gradients at the stated size. The
GIF, PDF and truncated-PNG byte sequences were assembled by hand.
