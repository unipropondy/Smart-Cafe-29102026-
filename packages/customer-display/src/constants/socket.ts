import { io, Socket } from 'socket.io-client';
import { API_URL } from './Config';

/**
 * Shared Socket.io client — used by CustomerDisplayContent to receive
 * customer_display_sync events from the Railway backend.
 *
 * Works identically on Android (React Native) and web (Electron BrowserWindow
 * via React Native Web + socket.io-client).
 */
const globalAny: any = typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : {};
let _socket: Socket | null = globalAny._customerDisplaySocket || null;

function getSocket(): Socket {
  if (_socket) return _socket;

  _socket = io(API_URL, {
    transports: ['polling', 'websocket'], // Start with polling, upgrade to websocket
    reconnectionAttempts: 20,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    autoConnect: true,
    forceNew: false,
  });

  _socket.on('connect', () => {
    console.log('🔌 [CustomerDisplay] Socket connected:', _socket?.id);
  });

  _socket.on('connect_error', (error) => {
    console.error('🔌 [CustomerDisplay] Socket connection error:', error);
  });

  globalAny._customerDisplaySocket = _socket;
  return _socket;
}

export const socket: Socket = new Proxy({} as Socket, {
  get(_target, prop) {
    return (getSocket() as any)[prop];
  },
  set(_target, prop, value) {
    (getSocket() as any)[prop] = value;
    return true;
  },
});
