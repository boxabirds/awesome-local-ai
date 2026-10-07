#!/usr/bin/env python3
"""
Story 12 fixtures (`tests/fixtures/images/`) — real image files.

Run once to (re)create the directory:

    python3 tests/fixtures/make-image-fixtures.py

They are real decodable images because the e2e tests hand them to a browser, and
a browser only renders something a decoder accepts. The unit and integration
tests do not need these files (workerd has no filesystem); they build their own
small byte sequences in `tests/fixtures/image-bytes.ts`.

What each one is for (design.md "Fixtures"):
  screenshot.png      1440x900 PNG, the natural size of a real screenshot
  tiny.png            120x80 PNG, the small file several tests drop
  photo.jpg           4032x3024 JPEG (~3 MB), a phone photo
  animated.gif        GIF89a with several frames (`image.gif` plays)
  photo.webp          WebP
  script.svg          an SVG carrying a <script> element — must never render
  renamed-pdf.png     PDF bytes with a .png name — refused by content, not name
  corrupt.png         a PNG cut off in the middle of its data
  exactly-10mb.jpg    a JPEG padded to exactly IMAGE_MAX_BYTES (boundary)
  over-10mb.jpg       IMAGE_MAX_BYTES + 1 byte (boundary)
"""

import io
import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "images")
IMAGE_MAX_BYTES = 10 * 1024 * 1024


def screenshot(size=(1440, 900)) -> Image.Image:
    """A flat 'screenshot' of coloured blocks: compresses small, decodes anywhere."""
    image = Image.new("RGB", size, (238, 242, 248))
    draw = ImageDraw.Draw(image)
    colours = [(33, 150, 243), (67, 160, 71), (255, 152, 0), (233, 30, 99), (142, 36, 170)]
    step = 120
    x = 40
    y = 40
    index = 0
    while x < size[0] - step and y < size[1] - step:
        draw.rectangle([x, y, x + step - 10, y + step - 10], fill=colours[index % len(colours)])
        x += step
        if x > size[0] - step:
            x = 40
            y += step
        index += 1
    return image


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    screenshot().save(os.path.join(OUT, "screenshot.png"))
    screenshot((120, 80)).save(os.path.join(OUT, "tiny.png"))

    # A large noisy JPEG: noise is what makes a photo *big*, which is what a
    # 3 MB board image looks like in real life.
    noise = Image.effect_noise((4032, 3024), 60).convert("RGB")
    # A phone photo is a few megabytes; the target here is ~3 MB, comfortably
    # under IMAGE_MAX_BYTES, so the file is a *valid* upload.
    for quality in range(95, 30, -1):
        import io

        buffer = io.BytesIO()
        noise.save(buffer, "JPEG", quality=quality)
        if len(buffer.getvalue()) <= 3 * 1024 * 1024:
            with open(os.path.join(OUT, "photo.jpg"), "wb") as handle:
                handle.write(buffer.getvalue())
            break

    # Animated GIF (GIF89a): four frames, so `image.gif` has something to animate.
    frames = []
    for index in range(4):
        frame = Image.new("P", (160, 120))
        draw = ImageDraw.Draw(frame)
        draw.rectangle([10 + index * 30, 10, 60 + index * 30, 90], fill=index + 1)
        frames.append(frame)
    frames[0].save(
        os.path.join(OUT, "animated.gif"),
        save_all=True,
        append_images=frames[1:],
        duration=200,
        loop=0,
    )

    screenshot((800, 600)).save(os.path.join(OUT, "photo.webp"), "WEBP", quality=80)

    with open(os.path.join(OUT, "script.svg"), "w", encoding="utf-8") as handle:
        handle.write(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"100\" height=\"100\">"
            "<rect width=\"100\" height=\"100\" fill=\"red\"/>"
            "<script>document.body.appendChild(document.createTextNode('pwned'))</script>"
            "</svg>\n"
        )

    # A real (tiny) PDF, named .png: the server must decide by its bytes.
    pdf = (
        b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n"
        b"trailer<</Size 4/Root 1 0 R>>\n%%EOF\n"
    )
    with open(os.path.join(OUT, "renamed-pdf.png"), "wb") as handle:
        handle.write(pdf)

    # A PNG cut off in the middle of its compressed data: magic bytes are right,
    # the picture is not there.
    with open(os.path.join(OUT, "tiny.png"), "rb") as handle:
        png = handle.read()
    with open(os.path.join(OUT, "corrupt.png"), "wb") as handle:
        handle.write(png[: max(24, len(png) // 2)])

    # A JPEG padded past its end marker to an exact byte count. Trailing bytes
    # after FFD9 are ignored by decoders, so the file stays a valid JPEG while
    # its *size* lands exactly on the limit.
    small_jpeg = jpeg_bytes()
    with open(os.path.join(OUT, "exactly-10mb.jpg"), "wb") as handle:
        handle.write(small_jpeg + b"\x00" * (IMAGE_MAX_BYTES - len(small_jpeg)))
    with open(os.path.join(OUT, "over-10mb.jpg"), "wb") as handle:
        handle.write(small_jpeg + b"\x00" * (IMAGE_MAX_BYTES + 1 - len(small_jpeg)))

    for name in sorted(os.listdir(OUT)):
        path = os.path.join(OUT, name)
        print(f"{name}: {os.path.getsize(path)} bytes")


def jpeg_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.effect_noise((480, 360), 90).convert("RGB").save(buffer, "JPEG", quality=100)
    return buffer.getvalue()


if __name__ == "__main__":
    main()
