# PRD

Users add PNG, JPEG, GIF and WebP images to a board by dropping, pasting or picking files; images upload with visible progress, appear for everyone, keep their proportions when resized, survive reloads, and fail clearly instead of silently.

## Problem

Workshops constantly reference visual material: screenshots of the current product, competitor pages, photos of paper sketches, mood boards. After stories 2, 10 and 11 the board holds only what users type or draw.

Pain points:
1. **Visuals live elsewhere** — people paste links in chat and switch tabs, losing the shared context of the board.
2. **Adding images is slow** — hunting for an upload button breaks flow; users expect to drag files in or paste a screenshot straight from the clipboard.
3. **Large or odd files break things** — huge photos or unsupported files (PDFs, SVGs, videos) either fail mysteriously or bloat the board.
4. **Uploads look like nothing is happening** — without feedback, users drop the same file again and create duplicates.
5. **Distorted images** — resizing an image freely squashes faces and screenshots.
6. **Broken images are confusing** — a failed or missing image that simply disappears makes people think someone deleted it.

## Solution

- **Visuals elsewhere → images on the board.** Images become ordinary board objects that everyone sees and that stay with the board.
- **Slow to add → three fast ways.** Drag files from the computer onto the board, paste an image from the clipboard, or use the Image tool's file picker.
- **Large or odd files → clear limits.** PNG, JPEG, GIF and WebP up to 10 MB are accepted; anything else is refused with a clear message before uploading. Large images are placed at a sensible size.
- **No feedback → placeholders with progress.** A placeholder of the final size appears immediately with upload progress; others see an "Uploading…" placeholder in the same spot.
- **Distortion → proportional resizing.** Images always keep their proportions.
- **Confusing failures → visible states.** Failed uploads show Retry and Remove; images that cannot be loaded show an "Image unavailable" box in their place; abandoned uploads are marked as unfinished.

## User Experience

### Golden path
1. Leo drags three screenshots from his desktop over the board. A dashed outline appears around the board area and the pointer shows a copy indicator.
2. He drops them. Three grey placeholders appear side by side starting at the drop point, each already the size the image will be, with a progress bar.
3. His colleague sees three "Uploading…" placeholders appear in the same places.
4. Uploads finish: the images replace the placeholders on both screens.
5. Leo takes a screenshot with his OS shortcut and presses Ctrl/Cmd+V on the board. The screenshot appears in the middle of the visible area.
6. He presses **I**; a file picker opens; he chooses a photo; it appears in the middle of the visible area.
7. He selects a photo and drags a corner handle: it grows in proportion.

### Structure
- Left toolbar: Image button (opens the system file picker).
- Drop highlight: dashed outline over the board while files are dragged over it.
- Placeholder (uploader): grey box of final size, image icon, progress bar with percentage.
- Placeholder (others): grey box, "Uploading…".
- Failed (uploader): red-bordered box, "Upload failed", Retry and Remove buttons.
- Failed (others) and unavailable: grey box with broken-image icon, "Image unavailable".
- Unfinished: grey box, "Image upload didn't finish", Remove button (anyone).
- Messages: short toast at the bottom of the screen for refused files.

### Behaviour
- Images are placed at their natural size, scaled down so the longest side is at most 800 board units.
- Several files dropped or picked at once are placed left to right in a row with a small gap, starting at the drop point (or centred in view for picker and paste).
- Up to 20 images can be added in one go; extra files are skipped with a message.
- Pasting only inserts an image when the board (not a text editor) has focus; pasting while editing a note's text pastes text as before.
- Animated GIFs play.
- Images keep their proportions when resized; there is a minimum size.
- Images can be moved, deleted and undone like any object; undoing an image insertion removes it in one step.
- Images stay on the board after reload and after everyone leaves.

### Alternate flows
- **Unsupported file type** (e.g. PDF, SVG, HEIC, video): nothing is added; toast "Only PNG, JPEG, GIF and WebP images can be added." Supported files in the same drop are still added.
- **File over 10 MB:** nothing added for that file; toast "Images must be 10 MB or smaller."
- **More than 20 files:** first 20 added; toast "Only 20 images can be added at once."
- **Upload fails** (network or service error): uploader sees Retry / Remove; others see "Image unavailable". Retry restarts the upload with the same file.
- **Uploader reloads or closes the page mid-upload:** after 5 minutes everyone sees "Image upload didn't finish" with Remove.
- **Offline or reconnecting:** image adding is disabled; toast "You're offline — images can be added when you reconnect."
- **Adding too many images too quickly:** toast "You're adding images too quickly. Wait a minute and try again."
- **Stored image cannot be loaded:** "Image unavailable" box of the same size; the rest of the board works.
- **Empty state:** Image tool always available.

### Explicit non-behaviours
- No image cropping, filters, rotation or captions.
- No importing images from URLs or third-party services.
- No SVG, PDF, video or HEIC support.
- Images are not compressed or converted.
- Deleting an image from the board does not guarantee removal of the stored file.

## Drop image files

> Anchor: `image.drop`

WHEN a user drops one or more supported image files onto the board THE SYSTEM SHALL add each image with its top-left corner starting at the drop point, placing multiple images left to right in a row separated by a gap of 24 board units, and WHILE files are dragged over the board THE SYSTEM SHALL show a drop highlight.

## Paste an image

> Anchor: `image.paste`

WHEN a user pastes clipboard content containing an image while the board has focus and no text is being edited THE SYSTEM SHALL add the image centred in the visible board area, and IF text is being edited THEN THE SYSTEM SHALL NOT add an image.

## Pick files with the Image tool

> Anchor: `image.pick`

WHEN a user activates the Image tool (button or I key) THE SYSTEM SHALL open the file picker filtered to supported image types, and WHEN files are chosen THE SYSTEM SHALL add them centred in the visible board area in a row.

## Sensible placement size

> Anchor: `image.placement_size`

WHEN an image is added THE SYSTEM SHALL size it to its natural pixel dimensions in board units, scaled down proportionally so that its longest side is no more than 800 board units.

## Only supported image types

> Anchor: `image.types`

IF a file being added is not a PNG, JPEG, GIF or WebP image (judged by its content, not just its name) THEN THE SYSTEM SHALL NOT upload or add it and SHALL show "Only PNG, JPEG, GIF and WebP images can be added.", while still adding any supported files from the same action.

## Size limit

> Anchor: `image.size_limit`

IF a file being added is larger than 10 MB THEN THE SYSTEM SHALL NOT upload or add it and SHALL show "Images must be 10 MB or smaller."

## Count limit per action

> Anchor: `image.count_limit`

IF more than 20 supported files are added in one action THEN THE SYSTEM SHALL add only the first 20 and SHALL show "Only 20 images can be added at once."

## Placeholder and progress while uploading

> Anchor: `image.uploading`

WHILE an image is uploading THE SYSTEM SHALL show the uploader a placeholder of the image's final size with upload progress as a percentage, and SHALL show other connected people an "Uploading…" placeholder of the same size and position within 1 second of the upload starting.

## Uploaded images appear for everyone

> Anchor: `image.shared`

WHEN an upload completes THE SYSTEM SHALL replace the placeholder with the image on every connected person's screen within 1 second plus the time to download the image, and THE SYSTEM SHALL show the image to anyone who opens the board later.

## Failed uploads can be retried or removed

> Anchor: `image.upload_failure`

IF an upload fails THEN THE SYSTEM SHALL show the uploader "Upload failed" with Retry and Remove, and SHALL show others "Image unavailable"; WHEN the uploader clicks Retry THE SYSTEM SHALL upload the same file again, and WHEN anyone with the controls clicks Remove THE SYSTEM SHALL delete the placeholder.

## Abandoned uploads are marked

> Anchor: `image.unfinished`

WHILE an image has been uploading for more than 5 minutes without completing THE SYSTEM SHALL show everyone "Image upload didn't finish" with a Remove button, instead of a permanent "Uploading…" placeholder.

## Proportional resizing

> Anchor: `image.aspect_resize`

WHEN a user resizes an image THE SYSTEM SHALL keep its width-to-height ratio and SHALL NOT make either side smaller than 16 board units.

## Unloadable images show a placeholder

> Anchor: `image.unavailable`

IF a stored image cannot be loaded THEN THE SYSTEM SHALL show an "Image unavailable" box at the image's size and position and SHALL NOT affect the rest of the board.

## Adding images requires a connection

> Anchor: `image.offline`

WHILE the board is not connected THE SYSTEM SHALL NOT start image uploads, and WHEN a user tries to add images THE SYSTEM SHALL show "You're offline — images can be added when you reconnect."

## Upload rate limit

> Anchor: `image.rate_limit`

IF a visitor uploads more than 60 images within one minute THEN THE SYSTEM SHALL NOT accept further uploads until the minute has passed and SHALL show "You're adding images too quickly. Wait a minute and try again."

## Constraints

- **Security:** only raster image types are accepted (no SVG, which can carry scripts); served images must never be interpreted as anything other than images. Stored image addresses must be unguessable, consistent with board links (story 5), and only boards that exist can receive uploads.
- **Access:** anyone with the board link can see its images (same model as story 5); no sign-in required.
- **Undo:** adding images is one undo step per add action (story 8); completion of an upload is not a separate undo step.
- **Live collaboration:** placeholders and images follow story 3's delivery and capacity guarantees.
- **Export:** images must be retrievable by the board page itself so board export (story 17) can embed them.
- **Settings:** accepted types, size limit (10 MB), count limit (20), placement size (800), minimum size (16), gap (24), unfinished timeout (5 minutes) and rate limit (60 per minute) are named product settings.
- **Performance:** a board with 100 images loads without blocking interaction; images load progressively.
- **Accessibility:** Image button labelled; images announced as "Image"; status messages announced politely.

## Out of scope

- Cropping, rotation, filters, captions, alt-text editing.
- Importing from URLs, Google Drive, Dropbox or other services.
- SVG, PDF, HEIC, video and audio.
- Server-side resizing, thumbnails or format conversion.
- Garbage collection of stored files for deleted images.
- Upload resumption after page reload.

