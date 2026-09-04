import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, RoomSnapshot, ServerMessage } from "../../shared/protocol";
import { WS_CLOSE } from "../../shared/protocol";
import { clientId } from "./identity";

const HEARTBEAT_MS = 25_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8_000;

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "kicked" | "closed";

export interface UseRoom {
  room: RoomSnapshot | null;
  youId: string | null;
  status: ConnectionStatus;
  error: string | null;
  send: (message: ClientMessage) => void;
}

interface Options {
  code: string;
  name: string;
  role: "voter" | "spectator";
  /** Nothing connects until the player has actually chosen a name. */
  enabled: boolean;
}

function socketUrl(code: string, name: string, role: string): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams({ name, role, cid: clientId() });
  return `${scheme}://${location.host}/api/rooms/${code}/ws?${params}`;
}

export function useRoom({ code, name, role, enabled }: Options): UseRoom {
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [youId, setYouId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timersRef = useRef<{ reconnect?: number; heartbeat?: number }>({});
  // Latest identity, read at connect time so a rename does not force a reconnect loop.
  const identityRef = useRef({ name, role });
  identityRef.current = { name, role };

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  useEffect(() => {
    if (!enabled || !code) return;

    let disposed = false;

    const clearTimers = () => {
      if (timersRef.current.reconnect) window.clearTimeout(timersRef.current.reconnect);
      if (timersRef.current.heartbeat) window.clearInterval(timersRef.current.heartbeat);
      timersRef.current = {};
    };

    const connect = () => {
      if (disposed) return;
      setStatus(attemptRef.current === 0 ? "connecting" : "reconnecting");

      const socket = new WebSocket(
        socketUrl(code, identityRef.current.name, identityRef.current.role),
      );
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed) return;
        attemptRef.current = 0;
        setStatus("open");
        setError(null);
        timersRef.current.heartbeat = window.setInterval(
          () => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ t: "ping" })),
          HEARTBEAT_MS,
        );
      });

      socket.addEventListener("message", (event) => {
        if (disposed) return;
        let message: ServerMessage;
        try {
          message = JSON.parse(String(event.data)) as ServerMessage;
        } catch {
          return;
        }
        if (message.t === "state") {
          setRoom(message.room);
          setYouId(message.youId);
        } else if (message.t === "error") {
          setError(message.message);
        } else if (message.t === "kicked") {
          disposed = true;
          setStatus("kicked");
        }
      });

      socket.addEventListener("close", (event) => {
        if (timersRef.current.heartbeat) window.clearInterval(timersRef.current.heartbeat);
        if (disposed) return;

        if (event.code === WS_CLOSE.KICKED) {
          setStatus("kicked");
          return;
        }

        setStatus("reconnecting");
        const delay = Math.min(
          RECONNECT_BASE_MS * 2 ** attemptRef.current,
          RECONNECT_MAX_MS,
        );
        attemptRef.current += 1;
        timersRef.current.reconnect = window.setTimeout(connect, delay);
      });
    };

    connect();

    return () => {
      disposed = true;
      clearTimers();
      socketRef.current?.close();
      socketRef.current = null;
    };
    // Reconnecting on name/role change is handled by messages, not a new socket.
  }, [code, enabled]);

  return { room, youId, status, error, send };
}
