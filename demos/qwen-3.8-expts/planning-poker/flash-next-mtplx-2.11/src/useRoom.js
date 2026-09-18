import { useEffect, useRef, useState, useCallback } from 'react';

function socketUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export function useRoom({ roomId, playerId, name }) {
  const [room, setRoom] = useState(null);
  const [status, setStatus] = useState('connecting');
  const wsRef = useRef(null);

  const send = useCallback((msg) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  }, []);

  useEffect(() => {
    if (!roomId || !name) return;
    const ws = new WebSocket(socketUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      ws.send(JSON.stringify({ type: 'join', roomId, playerId, name }));
    };
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === 'state') setRoom(data.room);
    };
    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('closed');

    return () => ws.close();
  }, [roomId, playerId, name]);

  return { room, status, send };
}
