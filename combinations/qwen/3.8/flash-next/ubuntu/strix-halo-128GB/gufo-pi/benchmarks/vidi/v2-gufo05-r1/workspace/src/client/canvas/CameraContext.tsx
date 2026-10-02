/**
 * The board's camera, shared with the input surface and the overlay controls.
 *
 * `BoardViewport` owns the viewport size and `useCamera`; the zoom controls and
 * the navigation hint are fixed overlays outside the viewport element, so they
 * read the same camera through this context instead of owning a second one.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useCamera, useWindowSize, type CameraNav } from './useCamera';

const CameraContext = createContext<CameraNav | null>(null);

export function CameraProvider({ children }: { children: ReactNode }) {
  const nav = useCamera(useWindowSize());
  const value = useMemo(() => nav, [nav]);
  return <CameraContext.Provider value={value}>{children}</CameraContext.Provider>;
}

export function useCameraContext(): CameraNav {
  const nav = useContext(CameraContext);
  if (!nav) throw new Error('useCameraContext must be used inside <CameraProvider>');
  return nav;
}
