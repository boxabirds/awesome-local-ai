/**
 * Story 12 — Bottom toast notifications.
 *
 * Renders a single toast message with role=status for accessibility.
 */
import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';

interface ToastState {
  message: string;
  visible: boolean;
}

// Global state for toast messages (simple singleton pattern)
let currentToast: ToastState = { message: '', visible: false };
const listeners = new Set<(state: ToastState) => void>();

export function showToast(message: string, durationMs = 5000): void {
  currentToast = { message, visible: true };
  // Notify all listeners immediately
  for (const fn of listeners) {
    fn(currentToast);
  }
  // Auto-dismiss after duration
  setTimeout(() => {
    currentToast = { message: '', visible: false };
    for (const fn of listeners) {
      fn(currentToast);
    }
  }, durationMs);
}

export function useToastListener(): ToastState {
  const [state, setState] = useState<ToastState>(currentToast);

  useEffect(() => {
    const fn = (s: ToastState) => setState(s);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return state;
}

export function Toast(): ReactNode {
  const toast = useToastListener();

  if (!toast.visible || !toast.message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: '24px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: '#333',
        color: '#fff',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '14px',
        zIndex: 10000,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        maxWidth: '90vw',
        textAlign: 'center',
      }}
    >
      {toast.message}
    </div>
  );
}
