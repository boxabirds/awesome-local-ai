/**
 * Story 12, task 7 (TC-21 to TC-24): what one image looks like, to the person
 * who added it and to everybody else.
 *
 * `ImageObject` is rendered directly for the six states, because the state is
 * what is being tested and the board around it would only be scenery. Two tests
 * go through the real `App` instead, because they are about the wiring a state
 * needs to exist at all: the shared clock that turns an abandoned upload into
 * "Image upload didn't finish" with nobody having to click anything, and the
 * Remove button a board can act on.
 *
 * Run first: `npm run test:component -- ImageObject`
 */

import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { App } from "../../src/client/App";
import { snapshot } from "../../src/shared/board-model";
import { IMAGE_UPLOAD_CLOCK_MS, IMAGE_UPLOAD_STALE_MS } from "../../src/shared/config";
import { createImagePlaceholders } from "../../src/shared/objects/image";
import { ImageObject, type ImageObjectProps } from "../../src/client/objects/ImageObject";

const UPLOADER = "identity-leo";
const OTHER = "identity-sam";
const ASSET_KEY = "Zm9vYmFyYmF6aW5nZHVwZA/RmlsZU9uZTIyY2hhcnMxMg";
const UNAVAILABLE = "Image unavailable";
const FAILED = "Upload failed";
const DID_NOT_FINISH = "Image upload didn't finish";

/** One image, 400 × 300 board units, uploaded by `UPLOADER`. */
function propsFor(overrides: Partial<ImageObjectProps> = {}): ImageObjectProps {
  const startedAt = Date.now();
  return {
    id: "object-1",
    width: 400,
    height: 300,
    status: "uploading",
    assetKey: "",
    uploaderId: UPLOADER,
    identityId: UPLOADER,
    startedAt,
    now: startedAt,
    canRetry: false,
    onRetry: () => undefined,
    onRemove: () => undefined,
    ...overrides,
  };
}

function textOf(element: Element | null): string {
  return element?.textContent ?? "";
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---- TC-21: a failed upload ------------------------------------------------

describe("TC-21: an upload that failed", () => {
  it("tells the uploader it failed, and offers Retry and Remove", () => {
    const retried: string[] = [];
    const removed: string[] = [];
    render(
      <ImageObject
        {...propsFor({
          status: "failed",
          identityId: UPLOADER,
          canRetry: true,
          onRetry: (id) => retried.push(id),
          onRemove: (id) => removed.push(id),
        })}
      />,
    );

    const box = screen.getByTestId("image-failed");
    expect(textOf(box)).toContain(FAILED);
    // `image.aspect_resize`'s box: a failed placeholder is the same size as the
    // image it was going to be.
    expect((box as HTMLElement).style.width).toBe("400px");
    expect((box as HTMLElement).style.height).toBe("300px");

    const retry = screen.getByTestId("image-retry") as HTMLButtonElement;
    const remove = screen.getByTestId("image-remove") as HTMLButtonElement;
    expect(retry.textContent).toBe("Retry");
    expect(remove.textContent).toBe("Remove");

    fireEvent.click(retry);
    fireEvent.click(remove);
    expect(retried).toEqual(["object-1"]);
    expect(removed).toEqual(["object-1"]);
  });

  it("tells everybody else only that the image is unavailable", () => {
    render(<ImageObject {...propsFor({ status: "failed", identityId: OTHER, canRetry: true })} />);

    const box = screen.getByTestId("image-unavailable");
    expect(textOf(box)).toContain(UNAVAILABLE);
    expect(screen.queryByTestId("image-failed")).toBeNull();
    expect(screen.queryByTestId("image-retry")).toBeNull();
    // Retry and Remove belong to the tab that has the file; a viewer's box says
    // what it can say and stops there.
    expect(screen.queryByTestId("image-remove")).toBeNull();
  });

  it("shows a placeholder of the same size and position to the other viewer while uploading", () => {
    const started = Date.now();
    render(
      <ImageObject {...propsFor({ status: "uploading", identityId: OTHER, startedAt: started, now: started })} />,
    );

    const box = screen.getByTestId("image-other-uploading");
    expect(textOf(box)).toContain("Uploading\u2026");
    expect((box as HTMLElement).style.width).toBe("400px");
    expect((box as HTMLElement).style.height).toBe("300px");
    // A viewer gets no percentage: that number belongs to the upload they are not
    // making.
    expect(screen.queryByTestId("image-progress")).toBeNull();
  });
});

// ---- TC-22: an upload nobody finished --------------------------------------

describe("TC-22: an abandoned upload", () => {
  it("is unfinished for everyone, and anyone can remove it", () => {
    const started = Date.now() - (IMAGE_UPLOAD_STALE_MS + 1_000);
    const removed: string[] = [];

    render(
      <ImageObject
        {...propsFor({
          status: "uploading",
          identityId: OTHER,
          startedAt: started,
          now: started + IMAGE_UPLOAD_STALE_MS + 1_000,
          onRemove: (id) => removed.push(id),
        })}
      />,
    );

    const box = screen.getByTestId("image-unfinished");
    expect(textOf(box)).toContain(DID_NOT_FINISH);
    expect(screen.queryByTestId("image-other-uploading")).toBeNull();

    fireEvent.click(screen.getByTestId("image-remove") as HTMLButtonElement);
    expect(removed).toEqual(["object-1"]);
  });

  it("becomes unfinished on its own, because the board keeps a clock", () => {
    // Time is moved by hand here: the threshold is five minutes and the clock
    // ticks every thirty seconds, and what is being proved is that the board
    // re-renders on that clock — not that the clock is fast.
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const ticks: Array<() => void> = [];
    vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, ms?: number) => {
      if (ms === IMAGE_UPLOAD_CLOCK_MS) ticks.push(callback);
      return 0 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => undefined);

    const started = Date.now() - (IMAGE_UPLOAD_STALE_MS - 60_000);
    const doc = new Y.Doc();
    createImagePlaceholders(
      doc,
      [{ rect: { x: 40, y: 40, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: "image/png" }],
      UPLOADER,
      started,
    );

    render(<App doc={doc} />);

    // Not yet stale: this tab never uploaded it, so it is the plain placeholder.
    expect(screen.getByTestId("image-object").dataset.imageStatus).toBe("uploading");
    expect(ticks.length).toBeGreaterThan(0);

    // One tick of the board's own clock, with nothing clicked and nothing typed.
    act(() => {
      now += IMAGE_UPLOAD_STALE_MS;
      for (const tick of ticks) tick();
    });

    expect(screen.getByTestId("image-object").dataset.imageStatus).toBe("unfinished");
    const box = screen.getByTestId("image-unfinished");
    expect(textOf(box)).toContain(DID_NOT_FINISH);
    expect(box.querySelector("[data-testid='image-remove']")).toBeTruthy();

    doc.destroy();
  });

  it("Remove on a board deletes the object from the document", async () => {
    const doc = new Y.Doc();
    const started = Date.now() - (IMAGE_UPLOAD_STALE_MS + 5_000);
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 240, height: 180 }, naturalWidth: 240, naturalHeight: 180, contentType: "image/png" }],
      UPLOADER,
      started,
    );

    render(<App doc={doc} />);

    expect(snapshot(doc).filter((object) => object.type === "image")).toHaveLength(1);
    expect(snapshot(doc).filter((object) => object.type === "image")[0]!.id).toBe(id);
    fireEvent.click(screen.getByTestId("image-remove") as HTMLButtonElement);
    await waitFor(() => expect(snapshot(doc).filter((object) => object.type === "image")).toHaveLength(0));
    expect(screen.queryByTestId("image-object")).toBeNull();

    doc.destroy();
  });
});

// ---- TC-23: an image that cannot be fetched -------------------------------

describe("TC-23: a stored image the browser cannot load", () => {
  it("shows the picture, at the asset's own address", () => {
    render(<ImageObject {...propsFor({ status: "ready", assetKey: ASSET_KEY, identityId: OTHER })} />);

    const img = screen.getByTestId("image-content") as HTMLImageElement;
    expect(img.getAttribute("src")).toContain(`/api/assets/${ASSET_KEY}`);
    // A GIF or an animated file is the same element: the browser plays it.
    expect(img.getAttribute("draggable")).toBe("false");
  });

  it("keeps the box the same size and says the image is unavailable", () => {
    render(<ImageObject {...propsFor({ status: "ready", assetKey: ASSET_KEY })} />);

    const before = screen.getByTestId("image-ready") as HTMLElement;
    expect(before.style.width).toBe("400px");
    expect(before.style.height).toBe("300px");

    fireEvent.error(screen.getByTestId("image-content"));

    const after = screen.getByTestId("image-unavailable") as HTMLElement;
    expect(textOf(after)).toContain(UNAVAILABLE);
    expect(after.style.width).toBe("400px");
    expect(after.style.height).toBe("300px");
    expect(screen.queryByTestId("image-content")).toBeNull();
  });

  it("tries again for a different asset in the same box", () => {
    const first = `${ASSET_KEY}`;
    const { rerender } = render(<ImageObject {...propsFor({ status: "ready", assetKey: first })} />);
    fireEvent.error(screen.getByTestId("image-content"));
    expect(screen.getByTestId("image-unavailable")).toBeTruthy();

    // A repaired object pointing at a new key is a new attempt, not a remembered failure.
    rerender(<ImageObject {...propsFor({ status: "ready", assetKey: `${ASSET_KEY}`.replace("RmlsZU9uZTIyY2hhcnMxMg", "RmlsZVR3bzIyY2hhcnMxMg") })} />);
    expect(screen.getByTestId("image-ready")).toBeTruthy();
    expect((screen.getByTestId("image-content") as HTMLImageElement).getAttribute("src")).toContain("RmlsZVR3bzIyY2hhcnMxMg");
  });
});

// ---- TC-24: Retry, and the reload that took it away ------------------------

describe("TC-24: Retry is the uploader's, and only theirs", () => {
  it("offers Retry while the file is still in memory", () => {
    const retried: string[] = [];
    render(
      <ImageObject {...propsFor({ status: "failed", canRetry: true, onRetry: (id) => retried.push(id) })} />,
    );

    fireEvent.click(screen.getByTestId("image-retry") as HTMLButtonElement);
    expect(retried).toEqual(["object-1"]);
  });

  it("offers only Remove after a reload took the file away", () => {
    render(<ImageObject {...propsFor({ status: "failed", canRetry: false })} />);

    expect(screen.queryByTestId("image-retry")).toBeNull();
    expect(textOf(screen.getByTestId("image-failed"))).toContain(FAILED);
    expect(screen.getByTestId("image-remove").textContent).toBe("Remove");
  });

  it("goes back to a placeholder when the retry starts", () => {
    const started = Date.now();
    const { rerender } = render(<ImageObject {...propsFor({ status: "failed", startedAt: started, now: started })} />);
    expect(screen.getByTestId("image-failed")).toBeTruthy();

    // `markImageRetrying`: uploading again, with a new `uploadStartedAt`.
    rerender(
      <ImageObject
        {...propsFor({
          status: "uploading",
          startedAt: started + 10_000,
          now: started + 10_000,
          progress: 0,
        })}
      />,
    );
    const box = screen.getByTestId("image-uploading");
    expect(textOf(box)).toContain("Uploading\u2026");
    expect(screen.queryByTestId("image-retry")).toBeNull();
  });
});

// ---- the uploader's own progress -------------------------------------------

describe("image.uploading: the uploader's placeholder", () => {
  it("shows the percentage this tab's upload has reached", () => {
    render(<ImageObject {...propsFor({ status: "uploading", progress: 0.42 })} />);

    const box = screen.getByTestId("image-uploading");
    expect(textOf(box)).toContain("42%");
    const bar = screen.getByTestId("image-progress").firstElementChild as HTMLElement;
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(bar.style.width).toBe("42%");
  });

  it("says only that it is uploading before any progress has come back", () => {
    render(<ImageObject {...propsFor({ status: "uploading" })} />);
    expect(textOf(screen.getByTestId("image-uploading"))).toContain("Uploading\u2026");
    expect(textOf(screen.getByTestId("image-uploading"))).not.toContain("%");
  });
});
