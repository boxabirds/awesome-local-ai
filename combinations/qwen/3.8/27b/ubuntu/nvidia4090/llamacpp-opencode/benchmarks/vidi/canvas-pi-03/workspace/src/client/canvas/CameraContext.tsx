import { createContext, useContext } from 'react';
import type { UseCameraResult } from './useCamera';

export const CameraContext = createContext<UseCameraResult | null>(null);

export function useCameraContext(): UseCameraResult {
  const ctx = useContext(CameraContext);
  if (!ctx) throw new Error('useCameraContext must be used within a CameraContext.Provider');
  return ctx;
}
