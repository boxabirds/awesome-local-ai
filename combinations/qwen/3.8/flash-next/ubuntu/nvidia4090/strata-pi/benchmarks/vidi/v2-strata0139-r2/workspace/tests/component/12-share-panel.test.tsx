/**
 * Share panel component tests (`share.share_panel`) — TC-22 to TC-25.
 *
 * The clipboard is injected, so the two paths that matter — it worked, and it
 * did not — are both decided by the test rather than by jsdom. Timers are faked
 * so "visible for two seconds" is an exact assertion against LINK_COPIED_MS.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { newBoardId } from "../../src/shared/board-id";
import { LINK_COPIED_MS } from "../../src/shared/config";
import { boardLink } from "../../src/client/api";
import { SharePanel } from "../../src/client/pages/SharePanel";

const ORIGIN = "https://vidi6.example";
const boardId = "aB3-_x9A8b7C6d5E4f3G2h";
const LINK = `${ORIGIN}/b/${boardId}`;

function panel(copy: (text: string) => Promise<void> = async () => undefined) {
  return render(<SharePanel boardId={boardId} origin={ORIGIN} copy={copy} />);
}

function linkInput(): HTMLInputElement {
  return screen.getByTestId("share-link-input") as HTMLInputElement;
}

function activeElement(): Element | null {
  return document.activeElement;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the Share button and panel (`share.share_panel`)", () => {
  it("the board screen offers a Share button", () => {
    panel();
    const button = screen.getByTestId("share-button");
    expect(button.textContent).toBe("Share");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // Closed by default: the panel is opened, not always on screen.
    expect(screen.queryByTestId("share-panel")).toBeNull();
  });

  it("clicking Share opens a dialog panel holding the board link", () => {
    panel();
    fireEvent.click(screen.getByTestId("share-button"));

    const panelEl = screen.getByTestId("share-panel");
    expect(panelEl.getAttribute("role")).toBe("dialog");
    expect(panelEl.getAttribute("aria-label")).toBe("Share board");
    expect(screen.getByTestId("share-button").getAttribute("aria-expanded")).toBe("true");

    const input = linkInput();
    expect(input.value).toBe(LINK);
    expect(input.readOnly).toBe(true);
  });

  it("the panel shows the link itself so it can be copied by hand", () => {
    panel();
    fireEvent.click(screen.getByTestId("share-button"));
    const input = linkInput();
    expect(input.tagName).toBe("INPUT");
    // Fallback exists without any copy attempt: the link is already selectable.
    input.select();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it("the panel says nothing about visibility or permissions (negative)", () => {
    panel();
    fireEvent.click(screen.getByTestId("share-button"));
    const text = screen.getByTestId("share-panel").textContent ?? "";
    for (const word of ["public", "permission", "visibility", "invite", "password"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
  });
});

describe("the copied link (TC-22)", () => {
  it("Copy link writes exactly the full board link to the clipboard (TC-22)", async () => {
    const copy = vi.fn<(text: string) => Promise<void>>(async () => undefined);
    panel(copy);
    fireEvent.click(screen.getByTestId("share-button"));
    fireEvent.click(screen.getByTestId("copy-link-button"));
    await vi.waitFor(() => expect(copy).toHaveBeenCalledTimes(1));

    // The negative half: one argument, exactly the URL — no markup, no
    // trailing whitespace, no appended query parameter.
    // `toHaveBeenCalledWith` is the exact assertion: one call, one argument, that
    // argument is the URL itself.
    expect(copy).toHaveBeenCalledTimes(1);
    expect(copy).toHaveBeenCalledWith(LINK);
    expect(copy.mock.calls).toHaveLength(1);
  });

  it("the link is a plain board address with nothing attached", () => {
    panel();
    fireEvent.click(screen.getByTestId("share-button"));
    const value = linkInput().value;
    expect(value.endsWith(`/b/${boardId}`)).toBe(true);
    expect(value.includes("?")).toBe(false);
    expect(value.includes("#")).toBe(false);
    expect(value).toBe(value.trim());
    expect(boardLink(boardId, ORIGIN)).toBe(value);
  });

  it("success says 'Link copied' for LINK_COPIED_MS and then stops saying it", async () => {
    panel(async () => undefined);
    fireEvent.click(screen.getByTestId("share-button"));
    fireEvent.click(screen.getByTestId("copy-link-button"));
    await vi.waitFor(() => expect(screen.getByTestId("link-copied")).toBeTruthy());

    expect(screen.getByTestId("link-copied").textContent).toBe("Link copied");
    expect(screen.getByTestId("copy-link-button").textContent).toBe("Link copied \u2713");
    expect(Number(screen.getByTestId("link-copied").getAttribute("data-duration-ms"))).toBe(LINK_COPIED_MS);

    await vi.advanceTimersByTimeAsync(LINK_COPIED_MS - 1);
    expect(screen.getByTestId("link-copied")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(1);
    expect(screen.queryByTestId("link-copied")).toBeNull();
  });

  it("the confirmation does not linger after the panel is closed", async () => {
    panel(async () => undefined);
    fireEvent.click(screen.getByTestId("share-button"));
    fireEvent.click(screen.getByTestId("copy-link-button"));
    await vi.waitFor(() => expect(screen.getByTestId("link-copied")).toBeTruthy());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("link-copied")).toBeNull();
    // And no stray timer fires into a closed panel.
    await vi.advanceTimersByTimeAsync(LINK_COPIED_MS * 2);
    expect(screen.queryByTestId("link-copied")).toBeNull();
  });
});

describe("the manual-copy fallback (TC-23, TC-24)", () => {
  it("a clipboard that refuses says so and leaves the link selected (TC-23)", async () => {
    const copy = vi.fn<(text: string) => Promise<void>>(async () => {
      throw new Error("clipboard denied");
    });
    panel(copy);
    fireEvent.click(screen.getByTestId("share-button"));
    fireEvent.click(screen.getByTestId("copy-link-button"));
    await vi.waitFor(() => expect(screen.getByTestId("copy-fallback")).toBeTruthy());

    // The spec's wording, verbatim (TC-23).
    expect(screen.getByTestId("copy-fallback").textContent).toBe("Press Ctrl+C (Cmd+C on Mac) to copy");
    expect(screen.queryByTestId("link-copied")).toBeNull();
    const input = linkInput();
    expect(activeElement()).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(LINK.length);
  });

  it("a clipboard that is missing entirely takes the same path (TC-24)", async () => {
    // `copyToClipboard` (the default) throws when navigator.clipboard is absent;
    // jsdom has no clipboard, so the default prop is the missing-clipboard case.
    render(<SharePanel boardId={boardId} origin={ORIGIN} />);
    fireEvent.click(screen.getByTestId("share-button"));
    fireEvent.click(screen.getByTestId("copy-link-button"));
    await vi.waitFor(() => expect(screen.getByTestId("copy-fallback")).toBeTruthy());
    expect(screen.queryByTestId("link-copied")).toBeNull();
  });

  it("a copy that works again after a failure clears the fallback", async () => {
    let attempt = 0;
    const copy = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("clipboard denied");
    });
    panel(copy);
    fireEvent.click(screen.getByTestId("share-button"));
    fireEvent.click(screen.getByTestId("copy-link-button"));
    await vi.waitFor(() => expect(screen.getByTestId("copy-fallback")).toBeTruthy());

    fireEvent.click(screen.getByTestId("copy-link-button"));
    await vi.waitFor(() => expect(screen.getByTestId("link-copied")).toBeTruthy());
    expect(screen.queryByTestId("copy-fallback")).toBeNull();
  });
});

describe("closing the panel (TC-25)", () => {
  it("Escape closes it and focus returns to the Share button", () => {
    panel();
    const button = screen.getByTestId("share-button");
    fireEvent.click(button);
    expect(screen.getByTestId("share-panel")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("share-panel")).toBeNull();
    expect(activeElement()).toBe(button);
    expect(screen.getByTestId("share-button").getAttribute("aria-expanded")).toBe("false");
  });

  it("a click outside closes it and focus returns to the Share button", () => {
    panel();
    const button = screen.getByTestId("share-button");
    fireEvent.click(button);

    fireEvent.mouseDown(document.body);

    expect(screen.queryByTestId("share-panel")).toBeNull();
    expect(activeElement()).toBe(button);
  });

  it("a click inside the panel keeps it open", () => {
    panel();
    fireEvent.click(screen.getByTestId("share-button"));

    fireEvent.mouseDown(screen.getByTestId("share-panel"));

    expect(screen.getByTestId("share-panel")).toBeTruthy();
  });

  it("Share again closes it (one toggle, not a stack of panels)", () => {
    panel();
    fireEvent.click(screen.getByTestId("share-button"));
    expect(screen.getByTestId("share-panel")).toBeTruthy();

    fireEvent.click(screen.getByTestId("share-button"));
    expect(screen.queryByTestId("share-panel")).toBeNull();
  });

  it("the link is selected when the panel opens", () => {
    panel();
    fireEvent.click(screen.getByTestId("share-button"));
    expect(activeElement()).toBe(linkInput());
  });
});

describe("the link is the board address the app itself would open (`share.share_panel`)", () => {
  it("the panel's link is the current page's own board address", () => {
    // No origin passed: the panel uses this window's origin, which is what a
    // person copying from the panel and pasting into an address bar needs.
    render(<SharePanel boardId={boardId} copy={async () => undefined} />);
    fireEvent.click(screen.getByTestId("share-button"));

    const value = linkInput().value;
    expect(value).toBe(`${window.location.origin}/b/${boardId}`);
    expect(new URL(value).pathname).toBe(`/b/${boardId}`);
  });

  it("two panels on two boards share two different links (negative)", () => {
    const other = newBoardId();
    render(
      <div>
        <SharePanel boardId={boardId} origin={ORIGIN} copy={async () => undefined} />
        <SharePanel boardId={other} origin={ORIGIN} copy={async () => undefined} />
      </div>,
    );

    const buttons = screen.getAllByTestId("share-button");
    fireEvent.click(buttons[0]!);
    fireEvent.click(buttons[1]!);

    const links = screen.getAllByTestId("share-link-input").map((el) => (el as HTMLInputElement).value);
    expect(links).toEqual([`${ORIGIN}/b/${boardId}`, `${ORIGIN}/b/${other}`]);
    expect(new Set(links).size).toBe(2);
  });
});
