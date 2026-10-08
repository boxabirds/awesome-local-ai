/**
 * Story 10 e2e fixture (design TC-23 to TC-27): the "checkout flow" board —
 * four labelled shapes (rect, diamond, ellipse, rect) connected by three
 * attached connectors plus one connector with a free end, built with the
 * real model calls so the doc is identical to what a client would produce.
 *
 *
 *   [Cart]  ---->  <Pay>  ---->  (Stock)
 *                    |
 *                    v
 *                 [Ship]
 *
 *   (Stock) has one more arrow leaving it to a free point (no target).
 *
 * The fixture is framework-free and deterministic (no Math.random) so
 * integration and e2e builds of the board agree.
 */
import type { Doc } from 'yjs';
import { LOCAL_ORIGIN, objectRects } from '../../src/shared/board-model';
import {
  nearestSide,
  sideAnchor,
} from '../../src/shared/geometry/connector-geometry';
import type { Rect } from '../../src/shared/geometry';
import { createConnector } from '../../src/shared/objects/connector';
import { createShape, getShapeLabel } from '../../src/shared/objects/shape';

export interface CheckoutFlow {
  cart: string;
  pay: string;
  stock: string;
  ship: string;
  /** cart → pay (attached both ends). */
  cartToPay: string;
  /** pay → stock (attached both ends). */
  payToStock: string;
  /** pay → ship (attached both ends). */
  payToShip: string;
  /** stock → free point (480, 60): one attached, one free end. */
  stockFree: string;
}

/** The four shape rects (world coordinates), in fixture order. */
export const CHECKOUT_RECTS: Record<'cart' | 'pay' | 'stock' | 'ship', Rect> = {
  cart: { x: -320, y: -140, width: 200, height: 100 },
  pay: { x: -40, y: -140, width: 200, height: 100 },
  stock: { x: 240, y: -140, width: 200, height: 100 },
  ship: { x: 0, y: 120, width: 200, height: 100 },
};

const LABELS: Record<'cart' | 'pay' | 'stock' | 'ship', string> = {
  cart: 'Cart',
  pay: 'Pay',
  stock: 'Stock',
  ship: 'Ship',
};

/**
 * Builds the checkout flow into `doc` (one LOCAL_ORIGIN transaction per
 * create, so each update is a separate sync frame). Returns the object ids.
 */
const fail = (name: string): never => {
  throw new Error(`buildCheckoutFlow: could not create ${name}`);
};

export function buildCheckoutFlow(doc: Doc, createdBy: string): CheckoutFlow {
  const cart = createShape(doc, { kind: 'rect', rect: CHECKOUT_RECTS.cart, at: { x: CHECKOUT_RECTS.cart.x, y: CHECKOUT_RECTS.cart.y } }, createdBy) ?? fail('cart');
  const pay = createShape(doc, { kind: 'diamond', rect: CHECKOUT_RECTS.pay, at: { x: CHECKOUT_RECTS.pay.x, y: CHECKOUT_RECTS.pay.y } }, createdBy) ?? fail('pay');
  const stock = createShape(doc, { kind: 'ellipse', rect: CHECKOUT_RECTS.stock, at: { x: CHECKOUT_RECTS.stock.x, y: CHECKOUT_RECTS.stock.y } }, createdBy) ?? fail('stock');
  const ship = createShape(doc, { kind: 'rect', rect: CHECKOUT_RECTS.ship, at: { x: CHECKOUT_RECTS.ship.x, y: CHECKOUT_RECTS.ship.y } }, createdBy) ?? fail('ship');
  const shapes = { cart, pay, stock, ship };
  doc.transact(
    () => {
      for (const name of ['cart', 'pay', 'stock', 'ship'] as const) {
        getShapeLabel(doc, shapes[name])?.insert(0, LABELS[name]);
      }
    },
    LOCAL_ORIGIN,
  );

  const rects = objectRects(doc);
  const centre = (name: 'cart' | 'pay' | 'stock' | 'ship') => {
    const r = rects.get(shapes[name])!;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  /** An attached endpoint on `name`, facing `toward`. */
  const attached = (name: 'cart' | 'pay' | 'stock' | 'ship', toward: { x: number; y: number }) => {
    const r = rects.get(shapes[name])!;
    return {
      kind: 'attached' as const,
      objectId: shapes[name],
      fallback: sideAnchor(r, nearestSide(r, toward)),
    };
  };

  const cartToPay = createConnector(doc, {
    from: attached('cart', centre('pay')),
    to: attached('pay', centre('cart')),
  }, createdBy) ?? fail('cartToPay');
  const payToStock = createConnector(doc, {
    from: attached('pay', centre('stock')),
    to: attached('stock', centre('pay')),
  }, createdBy) ?? fail('payToStock');
  const payToShip = createConnector(doc, {
    from: attached('pay', centre('ship')),
    to: attached('ship', centre('pay')),
  }, createdBy) ?? fail('payToShip');
  const stockFree = createConnector(doc, {
    from: attached('stock', { x: 480, y: 60 }),
    to: { kind: 'free', x: 480, y: 60 },
  }, createdBy) ?? fail('stockFree');

  return {
    cart: shapes.cart,
    pay: shapes.pay,
    stock: shapes.stock,
    ship: shapes.ship,
    cartToPay,
    payToStock,
    payToShip,
    stockFree,
  };
}

/** Total object count of a built checkout flow (4 shapes + 4 connectors). */
export const CHECKOUT_OBJECT_COUNT = 8;
