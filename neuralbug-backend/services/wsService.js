// services/wsService.js — WebSocket real-time event broadcasting
'use strict';

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

let wss = null;
const clients = new Map(); // clientId → ws

function initWS(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'ws://localhost');
    const token = url.searchParams.get('token');
    let userId = 'anonymous';

    try {
      if (token) {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        userId = payload.sub;
      }
    } catch { /* invalid token — allow but mark anonymous */ }

    const clientId = Date.now() + '_' + Math.random().toString(36).slice(2);
    clients.set(clientId, { ws, userId });

    ws.send(JSON.stringify({ type: 'connected', payload: { clientId, userId, time: new Date().toISOString() } }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch {}
    });

    ws.on('close', () => clients.delete(clientId));
    ws.on('error', () => clients.delete(clientId));

    // Ping to keep alive
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      else clearInterval(ping);
    }, 30000);
  });

  console.log('🔌 WebSocket server ready at /ws');
}

function broadcastEvent(type, payload, targetUserId = null) {
  if (!wss) return;
  const message = JSON.stringify({ type, payload, time: new Date().toISOString() });
  for (const [, client] of clients) {
    if (client.ws.readyState !== 1) continue; // OPEN
    if (targetUserId && client.userId !== targetUserId) continue;
    client.ws.send(message);
  }
}

function getStats() {
  return { connected: clients.size };
}

module.exports = { initWS, broadcastEvent, getStats };
