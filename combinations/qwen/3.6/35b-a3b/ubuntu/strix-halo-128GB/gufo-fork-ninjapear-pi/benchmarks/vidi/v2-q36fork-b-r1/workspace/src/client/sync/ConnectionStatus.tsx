/**
 * Connection status badge.
 * Story 3 — live collaboration.
 *
 * Displays connection state at the top centre of the board:
 * - "Connecting…" during initial load (amber text)
 * - hidden when fully connected
 * - amber "Reconnecting…" while disconnected
 * - green "Connected" briefly after reconnection, then hides
 */
import { useState, useEffect } from 'react';
import { CONNECTED_CONFIRMATION_MS } from '@/shared/config';
import type { ConnectionState } from './connectBoard';

interface ConnectionStatusProps {
  state: ConnectionState;
}

export function ConnectionStatus({ state }: ConnectionStatusProps): React.ReactElement | null {
  const [showConfirmed, setShowConfirmed] = useState(false);

  useEffect(() => {
    if (state === 'confirmed') {
      setShowConfirmed(true);
      const timer = setTimeout(() => {
        setShowConfirmed(false);
      }, CONNECTED_CONFIRMATION_MS);
      return () => clearTimeout(timer);
    }
  }, [state]);

  // Always show confirmed state even after the effect cleanup runs
  if (showConfirmed && state !== 'connected') {
    // Show green "Connected" during confirmation period
    return (
      <div
        role="status"
        aria-label="Connection status: Connected"
        style={{
          position: 'fixed',
          top: '12px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          fontSize: '13px',
          fontWeight: 600,
          color: '#2f9e44',
          backgroundColor: 'rgba(255,255,255,0.92)',
          padding: '4px 14px',
          borderRadius: '12px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          whiteSpace: 'nowrap',
        }}
      >
        {'Connected'}
      </div>
    );
  }

  switch (state) {
    case 'connecting':
      return (
        <div
          role="status"
          aria-label="Connection status: Connecting"
          style={{
            position: 'fixed',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            fontSize: '13px',
            fontWeight: 600,
            color: '#e8590c',
            backgroundColor: 'rgba(255,255,255,0.92)',
            padding: '4px 14px',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            whiteSpace: 'nowrap',
          }}
        >
          {'Connecting…'}
        </div>
      );

    case 'reconnecting':
      return (
        <div
          role="status"
          aria-label="Connection status: Reconnecting"
          style={{
            position: 'fixed',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            fontSize: '13px',
            fontWeight: 600,
            color: '#e8590c',
            backgroundColor: 'rgba(255,255,255,0.92)',
            padding: '4px 14px',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            whiteSpace: 'nowrap',
          }}
        >
          {'Reconnecting…'}
        </div>
      );

    case 'confirmed':
      // During this short window show green "Connected" before transition to connected
      return (
        <div
          role="status"
          aria-label="Connection status: Connected"
          style={{
            position: 'fixed',
            top: '12px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            fontSize: '13px',
            fontWeight: 600,
            color: '#2f9e44',
            backgroundColor: 'rgba(255,255,255,0.92)',
            padding: '4px 14px',
            borderRadius: '12px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            whiteSpace: 'nowrap',
          }}
        >
          {'Connected'}
        </div>
      );

    case 'connected':
    default:
      // Hidden when fully connected normally
      return null;
  }
}
