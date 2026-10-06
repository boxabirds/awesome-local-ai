import { useCallback, useEffect } from "react";
import type { AbstractType, Transaction, YEvent } from "yjs";
import type * as Y from "yjs";
import { LOCAL_ORIGIN, snapshot } from "../../shared/board-model";
import { DEFAULT_TEXT_SIZE, type TextSize } from "../../shared/config";
import { setTextBox } from "../../shared/objects/text";
import { defaultMeasurer, layoutText, type Measurer } from "./textLayout";

/**
 * Local-only box sync (`text.height`, `sync.local_only`).
 *
 * The measured width and height are ordinary document fields, so one client has
 * to write them and the others must not. This module is the only place that
 * writes a measured box, and it writes only after a change **this** client made
 * (`transaction.origin === LOCAL_ORIGIN`). A remote client renders from the box
 * the local client measured; it never re-measures, so the same text can never
 * bounce between two clients' slightly different metrics.
 *
 * `remeasureAfterLocalChange` is the explicit call - the editor calls it after a
 * keystroke, the toolbar after a size change. The observer is the safety net for
 * changes this module did not start itself, which is exactly a handle drag: the
 * gesture writes a width through `resizeObjects`, and the height that belongs to
 * it is measured here.
 */

export interface TextBoxSync {
  /** Measure this object's text and store the box, if it is not already that. */
  remeasureAfterLocalChange(): void;
}

/**
 * Framework-free half of the sync: measure `id`'s text and write the box.
 * Returns false when the object is gone, is not a text object, or already has
 * this box - which is what keeps a remeasure from echoing.
 */
export function remeasureTextBox(
  doc: Y.Doc,
  id: string,
  measure: Measurer = defaultMeasurer(),
): boolean {
  const object = snapshot(doc).find((entry) => entry.id === id);
  if (!object || object.type !== "text") return false;

  const box = layoutText(
    {
      text: object.text ?? "",
      size: (object.size ?? DEFAULT_TEXT_SIZE) as TextSize,
      widthMode: object.widthMode ?? "auto",
      width: object.width,
    },
    measure,
  );
  return setTextBox(doc, id, { width: box.width, height: box.height });
}

/** React half of the sync: `useTextBoxSync(doc, id, measure?)`. */
export function useTextBoxSync(doc: Y.Doc, id: string, measure?: Measurer): TextBoxSync {
  const measureRef = measure ?? defaultMeasurer();

  const remeasure = useCallback(
    () => {
      remeasureTextBox(doc, id, measureRef);
    },
    [doc, id, measureRef],
  );

  useEffect(() => {
    const objects = doc.getMap<Y.Map<unknown>>("objects");
    const observer = (events: YEvent<AbstractType<any>>[], transaction: Transaction): void => {
      // Remote text, loaded boards and this client's own box writes reach here;
      // only this client's own edits may write a box.
      if (transaction.origin !== LOCAL_ORIGIN) return;
      if (!eventsTouchObject(events, objects, id)) return;
      remeasure();
    };
    objects.observeDeep(observer);
    return () => objects.unobserveDeep(observer);
  }, [doc, id, remeasure]);

  return { remeasureAfterLocalChange: remeasure };
}

/** Did any of these events come from `id`'s own entry (or its Y.Text)? */
function eventsTouchObject(
  events: readonly YEvent<AbstractType<any>>[],
  objects: Y.Map<Y.Map<unknown>>,
  id: string,
): boolean {
  for (const event of events) {
    let node = event.target as unknown;
    let parent = (node as { parent?: unknown }).parent;
    if (parent === objects) {
      if ((node as Y.Map<unknown>).get("id") === id) return true;
      continue;
    }
    while (parent) {
      const next = (parent as { parent?: unknown }).parent;
      if (next === objects) {
        if ((parent as Y.Map<unknown>).get("id") === id) return true;
        break;
      }
      parent = next;
    }
  }
  return false;
}
