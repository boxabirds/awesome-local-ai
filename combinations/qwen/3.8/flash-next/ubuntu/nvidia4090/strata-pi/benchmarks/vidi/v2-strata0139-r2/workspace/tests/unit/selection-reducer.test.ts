import { describe, expect, it } from "vitest";
import {
  emptySelection,
  selectionReducer,
  type SelectionState,
} from "../../src/client/board/useSelection";

/**
 * Story 7, task 9 (TC-13 to TC-15) — the pure selection reducer.
 *
 * Selection is per-client view state (TC-15's `prune` is what makes a remote
 * delete leave my selection while the rest of it stays), so it is testable
 * without a DOM, a document or a network.
 */

function selected(...ids: string[]): SelectionState {
  return { ids: new Set(ids), editingId: null };
}

function present(...ids: string[]): ReadonlySet<string> {
  return new Set(ids);
}

const idsOf = (state: SelectionState): string[] => Array.from(state.ids).sort();

describe("sel.interaction: click and shift-click (TC-13, TC-14)", () => {
  it("TC-13 {} -> click a -> {a} -> toggle b -> {a,b} -> click b -> {b}", () => {
    let state = emptySelection;
    state = selectionReducer(state, { type: "click", id: "a" });
    expect(idsOf(state)).toEqual(["a"]);

    state = selectionReducer(state, { type: "toggle", id: "b" });
    expect(idsOf(state)).toEqual(["a", "b"]);

    // A plain click replaces the selection: it is not a toggle.
    state = selectionReducer(state, { type: "click", id: "b" });
    expect(idsOf(state)).toEqual(["b"]);
  });

  it("TC-14 shift-clicking the last member leaves an empty selection", () => {
    const state = selectionReducer(selected("a"), { type: "toggle", id: "a" });
    expect(idsOf(state)).toEqual([]);
  });

  it("shift-click keeps every other selected object", () => {
    const state = selectionReducer(selected("a", "b", "c"), { type: "toggle", id: "b" });
    expect(idsOf(state)).toEqual(["a", "c"]);
  });

  it("shift-clicking an unselected object adds it", () => {
    const state = selectionReducer(selected("a"), { type: "toggle", id: "new" });
    expect(idsOf(state)).toEqual(["a", "new"]);
  });

  it("clicking the object that is already the only selection keeps it selected", () => {
    const state = selectionReducer(selected("a"), { type: "click", id: "a" });
    expect(idsOf(state)).toEqual(["a"]);
  });
});

describe("sel.interaction: setMany (marquee and select all)", () => {
  it("non-additive setMany replaces the selection (select all)", () => {
    const state = selectionReducer(selected("old"), { type: "setMany", ids: ["a", "b"], additive: false });
    expect(idsOf(state)).toEqual(["a", "b"]);
  });

  it("additive setMany keeps what was already selected (marquee)", () => {
    const state = selectionReducer(selected("old"), { type: "setMany", ids: ["a", "b"], additive: true });
    expect(idsOf(state)).toEqual(["a", "b", "old"]);
  });

  it("TC-28 boundary: selecting an empty list changes nothing when it is additive", () => {
    const state = selectionReducer(selected("a"), { type: "setMany", ids: [], additive: true });
    expect(idsOf(state)).toEqual(["a"]);
    expect(selectionReducer(emptySelection, { type: "setMany", ids: [], additive: false })).toBe(emptySelection);
  });
});

describe("sel.interaction: clear", () => {
  it("clear empties the selection and ends editing", () => {
    const state = selectionReducer({ ids: new Set(["a"]), editingId: "a" }, { type: "clear" });
    expect(state).toEqual(emptySelection);
  });
});

describe("sel.interaction: edit", () => {
  it("edit selects exactly the note being edited", () => {
    const state = selectionReducer(selected("a", "b"), { type: "edit", id: "b" });
    expect(idsOf(state)).toEqual(["b"]);
    expect(state.editingId).toBe("b");
  });

  it("edit with null ends editing and keeps the selection", () => {
    const state = selectionReducer({ ids: new Set(["b"]), editingId: "b" }, { type: "edit", id: null });
    expect(idsOf(state)).toEqual(["b"]);
    expect(state.editingId).toBeNull();
  });
});

describe("sel.interaction: pruning remote deletes (TC-15)", () => {
  it("TC-15 {a,b,c} with b deleted remotely -> {a,c}", () => {
    const state = selectionReducer(selected("a", "b", "c"), { type: "prune", presentIds: present("a", "c", "d") });
    expect(idsOf(state)).toEqual(["a", "c"]);
  });

  it("TC-15 all selected objects deleted remotely -> empty selection", () => {
    const state = selectionReducer(selected("a", "b"), { type: "prune", presentIds: present("z") });
    expect(state).toEqual(emptySelection);
  });

  it("TC-15 editing an object that was deleted remotely ends the edit", () => {
    const state = selectionReducer({ ids: new Set(["a", "b"]), editingId: "b" }, {
      type: "prune",
      presentIds: present("a"),
    });
    expect(idsOf(state)).toEqual(["a"]);
    expect(state.editingId).toBeNull();
  });

  it("editing a surviving object survives the prune", () => {
    const state = selectionReducer({ ids: new Set(["a", "b"]), editingId: "b" }, {
      type: "prune",
      presentIds: present("a", "b"),
    });
    expect(state.editingId).toBe("b");
  });

  it("a prune that changes nothing returns the identical state", () => {
    const before = selected("a", "b");
    expect(selectionReducer(before, { type: "prune", presentIds: present("a", "b") })).toBe(before);
  });
});

describe("sel.interaction: actions for ids that are not on the board (error path)", () => {
  it("click and toggle on absent ids are ignored", () => {
    const options = present("a", "b");
    expect(selectionReducer(selected("a"), { type: "click", id: "gone" }, { presentIds: options })).toEqual(selected("a"));
    expect(selectionReducer(selected("a"), { type: "toggle", id: "gone" }, { presentIds: options })).toEqual(selected("a"));
  });

  it("setMany drops the ids that are not present", () => {
    const state = selectionReducer(emptySelection, { type: "setMany", ids: ["a", "gone"], additive: false }, { presentIds: present("a") });
    expect(idsOf(state)).toEqual(["a"]);
  });

  it("edit on an absent id is ignored", () => {
    const state = selectionReducer(emptySelection, { type: "edit", id: "gone" }, { presentIds: present("a") });
    expect(state).toEqual(emptySelection);
  });

  it("without a presence set every id is accepted (the hook always passes one)", () => {
    expect(idsOf(selectionReducer(emptySelection, { type: "click", id: "any" }))).toEqual(["any"]);
  });
});
