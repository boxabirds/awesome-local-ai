import { createContext } from 'react';
import type { Rect } from '../../shared/geometry';

/** Rectangles of every object an arrow can attach to, in z order (later = on top). Provided by App. */
export const ObjectRectsContext = createContext<ReadonlyMap<string, Rect>>(new Map());
