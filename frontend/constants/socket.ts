import { io, Socket } from "socket.io-client";
import { API_URL } from "./Config";

// Lazy-initialized singleton — the io() call is deferred until the socket is
// first accessed so it never blocks module evaluation (avoids the 6000ms
// React Native bridge timeout that fires when this module is imported at
// the top level during static rendering or on app startup).
const globalAny: any = typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : {};
let _socket: Socket | null = globalAny._globalSocket || null;

function getSocket(): Socket {
  if (_socket) return _socket;

  _socket = io(API_URL, {
    transports: ["polling", "websocket"], // Starts with polling then upgrades to websocket
    reconnectionAttempts: 20,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    autoConnect: true,
    forceNew: false,
  });

  _socket.on("connect", () => {
    console.log("🔌 Socket connected:", _socket?.id);
  });

  _socket.on("connect_error", (error) => {
    console.error("🔌 Socket connection error:", error);
  });

  globalAny._globalSocket = _socket;
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
