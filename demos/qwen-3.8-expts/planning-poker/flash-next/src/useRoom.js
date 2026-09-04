import { useCallback, useEffect, useRef, useState } from 'react'

function wsBase() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export function useRoom(config) {
  const [state, setState] = useState(null)
  const [status, setStatus] = useState('connecting')
  const wsRef = useRef(null)

  const { roomId, memberId, name, role, isHost, deck } = config

  useEffect(() => {
    if (!roomId || !memberId) return
    const params = new URLSearchParams({
      room: roomId,
      memberId,
      name,
      role,
      deck,
      host: isHost ? '1' : '0',
    })
    const ws = new WebSocket(`${wsBase()}?${params.toString()}`)
    wsRef.current = ws
    setStatus('connecting')

    ws.onopen = () => setStatus('open')
    ws.onerror = () => setStatus('error')
    ws.onclose = () => setStatus('closed')
    ws.onmessage = (evt) => {
      const msg = JSON.parse(evt.data)
      if (msg.type === 'state') setState(msg.state)
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [roomId, memberId, name, role, isHost, deck])

  const send = useCallback((payload) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload))
    }
  }, [])

  return { state, status, send }
}
