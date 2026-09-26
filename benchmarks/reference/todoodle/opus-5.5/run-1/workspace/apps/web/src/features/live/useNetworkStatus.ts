import { useSyncExternalStore } from 'react';
import type { NetworkStatus } from './LiveConnection';
import { networkMonitor } from './network';

export function useNetworkStatus(): NetworkStatus {
  return useSyncExternalStore(networkMonitor.subscribe, networkMonitor.getSnapshot);
}
