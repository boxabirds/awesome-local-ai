import { createContext } from 'react';

/**
 * Element inside the world layer, after all objects. Per-object UI (such as the note toolbar) is portalled
 * here so it is drawn above every object while still being positioned in world coordinates.
 */
export const WorldOverlayContext = createContext<HTMLElement | null>(null);
