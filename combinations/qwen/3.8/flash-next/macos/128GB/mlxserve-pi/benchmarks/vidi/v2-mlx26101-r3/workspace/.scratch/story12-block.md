## Where story 12 leaves the board

Written as story 12 goes along; the parts of it that outlive the story are the ones about the fixtures.

### Deviations and decisions taken while implementing

- **`sniffImageType`'s parameter is named `head`, not `buffer`.** The contract in `design.md` writes
  `sniffImageType(buffer)`. Only the first `IMAGE_SNIFF_BYTES` bytes are ever read, and the calling code
  reads them out of an unawaited `slice()`, so the name says what the function actually wants. Positional
  callers are unaffected.
- **The fixtures live in `tests/fixtures/images/`, not `tests/e2e/fixtures/images/`.** `design.md` and
  `tasks.md` say "e2e fixtures" for files that the unit tests, the integration tests and the e2e suite all
  read; `tests/fixtures/` is where every other story's fixtures already are, and one directory of load
  -bearing files is worth the one-line difference in the spec's prose. `generate.mjs` regenerates them and
  is committed, because a fixture nobody can re-make is a fixture nobody can review.
- **`tests/fixtures/imageBytes.ts` exists because workerd has no file system.** The integration tests run
  inside the Workers runtime, where `node:fs` is a sandbox that does not contain this project: a probe read
  of `tests/fixtures/images/photo.jpg` there returns nothing. Fixtures those tests need are _built_ - a PNG
  assembled from chunks and deflated with `CompressionStream`, a JPEG and a WebP carried in as base64 that
  `images/generate.mjs` writes to `embeddedImages.ts` - or, when the test only needs to know that
  `onProgress` fired, held in memory as a blob of zeros that is a PNG's length and never claimed to be a
  photograph. The e2e suite and the node-side unit tests read the real files on disk.
- **`jpegBytesOfLength` pads a real 16x12 JPEG with comment segments rather than writing a file that
  begins `FF D8 FF`.** A ten-megabyte boundary test wants a file that _is_ a JPEG at exactly ten
  megabytes, because a decoder may be pointed at it; `FF FE` comment segments are what a decoder is
  required to skip. A segment weighs 4..65537 bytes, which is why the division has an adjustment in it.
- **Story 11's `tests/unit/stroke.test.ts` and `tests/component/helpers/pen.tsx` did not typecheck.**
  Thirty-one errors under `noUncheckedIndexedAccess` (`parts[1][0]`, `CORNER[0]`, an unused
  `STROKE_TYPE` import, `DragPenOptions` handed to `press()` which takes `PointerOptions`,
  `strokeIn` returning `| null` where it says `| undefined`). They had been committed with
  `npm run typecheck` failing - story 11's tasks 1-6 are marked "not yet verified" in `PROGRESS.md`, and
  this is what that looked like. Story 12 fixes them mechanically (`!`, `?? undefined`, `{}` for the
  pointer defaults, one import removed) and changes no assertion: `npm run typecheck` is a gate every
  story has to pass, so the fix had to happen somewhere, and the place it could happen was here.
- **`IMAGE_MAX_FILES_PER_ADD` is 20 and the PRD's count message says 20.** `tasks.md` says "over 10
  files" in task 1's wording; the PRD's rule and the PRD's message agree on 20, and a message that
  contradicts the constant it explains is a bug a person reads.

### What the browser taught after jsdom had finished

Four things this story got wrong that no test below the browser could see, and the two places where an
earlier story's test had to move because of what this one added. Written down because each of them looks
like a different problem until it has been met once.

- **The upload response was read for a field the Worker never sends.** `uploadImage` took `assetId` out of
  the 201 body and built the address itself; the Worker answers `{ assetKey, contentType }` - the whole
  address, which is what `design.md`'s API table says. Both halves were tested against what the other was
  assumed to say: the component double handed back whatever the client asked for, the integration tests read
  the Worker's own body, and every one of them passed while a real upload left a real board saying "Upload
  failed". `assetKeyFromResponse` now takes the address whole, checks it against `ASSET_KEY_PATTERN`, and
  checks that its board half is the board being uploaded to; `tests/unit/upload-response.test.ts` pins both
  readings of the contract, including the wrong one, so the mistake has a name here.
- **A button inside an object's box never received its click.** `ImageBoardObject`'s box passes
  `pointerdown` to the transform machinery, which selects the object and captures the pointer for the length
  of the drag - and a pointer that an element has captured delivers its `click` to the _capturing_ element,
  not to the button underneath. So in Chrome, pressing Retry did nothing at all: no request, no state
  change, no error. `fireEvent.click(button)` in jsdom places the click exactly where the test puts it and
  cannot show this. The box now returns early when `isBoardUi(event.target)` is true, which is the same
  convention `PenToolbar` uses so a colour swatch does not start a stroke, and the two image buttons carry
  `data-board-ui`. TC-28 presses Retry with a mouse and TC-26 presses Remove with a mouse; those two clicks
  are the test for this.
- **A `DataTransfer` cannot be carried into `page.evaluate`.** It is a live browser object, it cannot be
  copied, and what arrives is an empty something that `new DragEvent(..., { dataTransfer })` refuses with
  "Failed to convert value to DataTransfer". Passing the handle from `evaluateHandle` does not work either.
  The files cross as plain `{name, type, bytes}` and the transfer is built inside the same call that
  dispatches `dragenter`/`dragover`/`drop` - which is also the only way to give those events real
  `clientX`/`clientY`, since `locator.dispatchEvent` cannot set coordinates and the board places pictures by
  the point the pointer let go at.
- **A picture that is off the screen is a picture the browser has not been asked for.** The `<img>` is
  `loading="lazy"`, so a box outside the window is never fetched and a test that waits for its pixels waits
  fifteen seconds for a request nobody made. TC-25's row of three is 2104 world units - about two and a half
  screens at the largest size the board places a picture at - so the drop starts near the left edge, where
  the whole row fits at the zoom the test uses. The alternative, dropping the lazy loading, would make a
  board with two hundred pictures on it fetch all two hundred every time somebody opened it.
- **Two of this file's own helpers had been written twice, differently.** `waitForImageStatus` takes an
  object id and waits for that one box; a probe that handed it a count was the only thing that noticed, so
  the count-shaped version never existed. Left as it is, with the wait for a _drawn picture_ now reporting
  what the box says instead of a bare `false` - "not drawn (status ready, the box says \"\", src
  /api/assets/...)" is the difference between a picture that has not arrived and one that was never coming.
- **The toolbar grew by one button, and two earlier stories' presses stopped landing on the board.** The
  toolbar is a strip down the left of the window; adding Image made it 34 pixels taller, and
  `free-text.spec.ts` TC-30 and `shapes-and-connectors.spec.ts` TC-27 had chosen board points whose screen
  positions fell inside the new strip. Both were moved rather than worked around: five headings spread across
  a screen were shifted down out of the strip, and the arrow test frames its board on the shape it is drawing
  from (`aimCamera`) before it presses - which is what `ontoTheBoard` in `helpers/shapes.ts` has always
  advised, and the reason that guard exists is exactly this. Nothing in either story's assertions changed.
- **The latency TC-25 prints is measured twice, and only one of the numbers means anything.** Uploads are
  held back for two seconds so that the state before a picture can be looked at; the drop-to-picture figure
  for those three contains the artificial seconds, so it is printed as drop-to-_boxes_ (which is the shared
  document's own speed, and the number the budget is about). The last picture of the run is dropped after the
  delay is lifted, and that one is timed end to end: 101 ms from a pointer letting go to pixels on a second
  screen, on a machine with the Worker, the bucket and both browsers in front of it.

### A board that arrives empty, when the machine is out of CPU

Two of this story's end-to-end tests failed now and then while the rest of the suite passed, in the same
shape: a page was opened, and the objects that were already in its board did not appear for the whole
waiting window - "no picture with id … on this board (saw nothing)", or a test timeout with a page whose world
layer was empty. Reproduced deliberately by pinning eight CPUs with `yes > /dev/null` and running the suite:
under that starvation `persistence.spec.ts` TC-21 - story 2's own test, a board of two thousand notes, nothing
to do with pictures - fails the same way, polling for fifteen seconds and receiving `0` drawn notes. So the
thing that is slow is a joining client's first sight of the shared document, which is story 3 and 4 territory
and has been here since before this story started; the images spec merely runs more two-context pages with
reloads than any earlier spec, so it meets the slow case more often.

What this story did about it, and did not:

- **Nothing was made to wait less.** Every image assertion still polls for exactly `E2E_EVENTUAL_TIMEOUT_MS`,
  and the functional waits are the shared ones. The flake was not buried by widening a polling window.
- **TC-26 alone got a larger ceiling on its total time** (`test.setTimeout(90_000)`), because it is the one
  test in the suite that moves eleven megabytes across the pipe on purpose - the file has to really be a
  megabyte past the limit, since the rule under test is about size. On a busy machine thirty seconds was gone
  partway through the test and Playwright said "test timeout" instead of naming the act that was still
  waiting, which is the least useful possible failure. A raised ceiling cannot make a wrong board look
  right; the assertion windows are unchanged.
- **Ordinary runs are not affected.** Every full end-to-end run on a machine doing nothing else has passed,
  as has `npm run verify` from start to finish. What is worth knowing before adding more two-person tests is
  that with every core pegged by something else, any of the tests in this repo that wait for a second
  person's screen - including stories 2 and 4's - can run out of the waiting window.
