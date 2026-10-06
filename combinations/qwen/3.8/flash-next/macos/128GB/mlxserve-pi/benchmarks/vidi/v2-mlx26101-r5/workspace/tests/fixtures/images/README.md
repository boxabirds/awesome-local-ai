# Image fixtures

Small files that are what their names say — except the ones whose whole purpose is to not be.

These are read from disk by `tests/e2e/helpers/drop-files.ts` and handed to a browser as real `File` objects,
which is the only way to test what a board does with a file: a `File` made in jsdom has the bytes you gave it
and nothing else, so it can prove how a callback was called but not that a browser can decode the picture. The
other suites do not read this directory. The integration tests cannot — they run inside the Workers runtime,
where there is no `node:fs` — and the unit tests write their bytes out inside the test instead, because a test
of a magic-number table is worth more with the bytes in front of the reader than behind a filename.

Every real picture here is synthetic: a known pixel size, a couple of flat colours, and nothing else worth
asserting about it. They are deliberately not photographs, because the only interesting thing about them is
their dimensions and their format, and a picture of somebody's holiday would be two hundred kilobytes of noise
in the repository to say the same thing.

| File | Bytes | What it is | What it is for |
| --- | --- | --- | --- |
| `screenshot.png` | 5 939 | PNG, 1440 × 900 | The big one. Bigger than the largest box this board places an image in (`IMAGE_MAX_PLACE_SIZE_WORLD`), so it and `photo.jpg` are how TC-25 and TC-26 check that a large file is scaled *down*, in proportion, and that the small file beside it is not scaled at all. |
| `photo.jpg` | 21 570 | JPEG, 1440 × 900 | The same shape in a second codec. TC-25 drops one of each so the assertions cover "the server stored the type the file really is" and "a second decoder worked" at the same time; TC-27 resizes this one, because a picture with a known ratio is what an aspect-locked resize is tested with. |
| `picture.webp` | 1 464 | WebP, 320 × 240 | The one that stays its own size: placed at 320 × 240 because it is already smaller than the maximum, which is the half of the placement rule that a fixture twice the size cannot show. |
| `blue.png` | 1 949 | PNG, 640 × 480 | An ordinary mid-sized picture for the tests that only need *an* image — TC-28's upload that fails and is retried, the second file chosen in TC-26. |
| `animation.gif` | 109 | GIF89a, 16 × 16, two frames of 0.3 s, looping forever | The fourth accepted format, for the assertions that go through all four — the picker's `accept` filter, the sniffing table, `IMAGE_ACCEPTED_TYPES`. A GIF belongs in a moodboard, so refusing to have one would leave the format that shows up most in real drops untested. |
| `fake-image.png` | 104 | **A PDF**, named `.png`, and it will happily be declared `image/png` | The reason this directory exists. It passes every check that reads a name or a MIME type and fails the one that opens the file: the browser's decoder rejects it, so nothing is added (TC-26, TC-29), and the worker's sniffing refuses it with 415 (`tests/integration/assets.test.ts`). Byte 0 is `%PDF-1.4`. |
| `report.pdf` | 104 | A PDF, with an honest name | The same bytes where the name agrees with them, so a test can tell "the type is wrong" apart from "the name was a lie" — and so `fake-image.png` cannot be explained away as a malformed PDF. |
| `diagram.svg` | 1 040 | SVG text | An image format that is *not* accepted, and the only one that a browser would happily draw on screen. The board refuses it by sniffing (`<` is not one of the four magic numbers), which is the whole reason sniffing is done on content rather than on the extension an operating system invented from the first five characters. |
| `truncated.png` | 44 | The first 44 bytes of `screenshot.png`: a real signature, an `IHDR` promising 1440 × 900, and the start of an image-data chunk that never finishes | A file whose magic bytes are right and whose contents are not a picture. The client's decoder rejects it, which is the case the "types" toast exists for; the worker accepts the bytes it is given, which is the case the sniffing test says out loud rather than pretending is safe. |

Two things are deliberately *not* here:

- **A file over 10 MB.** A repository should not contain fifteen megabytes whose only content is "long". Tests
  that need one make it: `fileOfBytes('holiday.jpg', 'image/jpeg', IMAGE_MAX_BYTES + 5_000_000)` in
  `tests/e2e/helpers/drop-files.ts`, and the same idea inline in the unit tests. The limit is asserted against
  `IMAGE_MAX_BYTES` rather than a number copied out of this table.
- **A corrupt JPEG.** `fake-image.png` and `truncated.png` already cover "opens as nothing" through two
  different code paths, and a third file that also fails to decode would be a fixture nobody could tell apart
  from its siblings by reading this list.

`fake-image.png` and `report.pdf` are the same 104 bytes, which is deliberate: the difference a test is
interested in is the name, not the content.
