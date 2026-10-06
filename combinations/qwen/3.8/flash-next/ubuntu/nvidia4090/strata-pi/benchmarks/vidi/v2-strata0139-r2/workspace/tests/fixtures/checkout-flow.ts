/**
 * The checkout flow fixture (story 10).
 *
 * A real board, built with the real model calls: four labelled shapes (a rect, a
 * diamond, an ellipse and another rect), three connectors attached at both ends
 * and one connector whose far end is fixed to an empty board point. Every object
 * is what `createShape` and `createConnector` produce — never a hand-written
 * Yjs document — so a test that renders this board renders what a person would
 * have drawn.
 */

import * as Y from "yjs";
import { initDoc, snapshot } from "../../src/shared/board-model";
import { createConnector } from "../../src/shared/objects/connector";
import { createShape, getShapeLabel, type ShapeSnap } from "../../src/shared/objects/shape";

export interface CheckoutFlowIds {
  start: string;
  paid: string;
  card: string;
  receipt: string;
  /** start -> paid, paid -> card, paid -> receipt. */
  toPaid: string;
  toCard: string;
  toReceipt: string;
  /** Attached at one end, fixed to a board point at the other. */
  dangling: string;
}

export interface CheckoutFlow extends CheckoutFlowIds {
  doc: Y.Doc;
  shapes: readonly ShapeSnap[];
}

/** Board positions, chosen so no shape touches another and every arrow is visible. */
const POSITIONS = {
  start: { x: -520, y: -80, width: 220, height: 140 },
  paid: { x: -160, y: -90, width: 240, height: 160 },
  card: { x: 200, y: -100, width: 240, height: 160 },
  receipt: { x: -160, y: 160, width: 220, height: 140 },
} as const;

const KINDS = { start: "rect", paid: "diamond", card: "ellipse", receipt: "rect" } as const;

const LABELS = {
  start: "Start the order",
  paid: "Was the card paid?",
  card: "Charge the card",
  receipt: "Send the receipt",
} as const;

/** The point the dangling arrow's free end is fixed to (`connector.create_free`). */
export const DANGLING_END = { x: 620, y: 220 };

export function buildCheckoutFlow(doc: Y.Doc = new Y.Doc()): CheckoutFlow {
  initDoc(doc);

  const ids: CheckoutFlowIds = {
    start: "",
    paid: "",
    card: "",
    receipt: "",
    toPaid: "",
    toCard: "",
    toReceipt: "",
    dangling: "",
  };

  const shape = (key: keyof typeof POSITIONS): string => {
    const at = POSITIONS[key];
    const created = createShape(doc, {
      kind: KINDS[key],
      rect: { x: at.x, y: at.y, width: at.width, height: at.height },
      at: { x: at.x, y: at.y },
    });
    if (typeof created !== "string") throw new Error(`createShape refused ${key}`);
    getShapeLabel(doc, created)?.insert(0, LABELS[key]);
    return created;
  };

  ids.start = shape("start");
  ids.paid = shape("paid");
  ids.card = shape("card");
  ids.receipt = shape("receipt");

  const link = (from: string, to: string): string => {
    const created = createConnector(doc, { kind: "attached", objectId: from }, { kind: "attached", objectId: to });
    if (typeof created !== "string") throw new Error(`createConnector refused ${from} -> ${to}`);
    return created;
  };

  ids.toPaid = link(ids.start, ids.paid);
  ids.toCard = link(ids.paid, ids.card);
  ids.toReceipt = link(ids.paid, ids.receipt);

  const dangling = createConnector(
    doc,
    { kind: "attached", objectId: ids.card },
    { kind: "free", x: DANGLING_END.x, y: DANGLING_END.y },
  );
  if (typeof dangling !== "string") throw new Error("createConnector refused the free end");
  ids.dangling = dangling;

  return { doc, ...ids, shapes: snapshot(doc).filter((entry): entry is ShapeSnap => entry.type === "shape") };
}
