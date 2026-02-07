"use client";

import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { useMouse } from "../hooks/use-mouse";
import { useThrottle } from "../hooks/use-throttle";

interface OnlineUser {
  socketId: string;
  nickname: string;
  profileImage: string | null;
  currentPage: string;
  connectedAt: number;
  posX: number;
  posY: number;
  color: string;
}

export interface EmojiData {
  socketId: string;
  emoji: string;
  x: number;
  y: number;
}

export interface SoundData {
  socketId: string;
  soundFile: string;
}

interface PresenceData {
  count: number;
  users: OnlineUser[];
}

interface PresenceContextType extends PresenceData {
  socketId: string | null;
  emitEmoji: (emoji: string, x: number, y: number) => void;
  emitSound: (soundFile: string) => void;
  registerEmojiListener: (callback: (data: EmojiData) => void) => () => void;
  registerSoundListener: (callback: (data: SoundData) => void) => () => void;
}

const PresenceContext = createContext<PresenceContextType>({ 
  count: 0, 
  users: [], 
  socketId: null,
  emitEmoji: () => {},
  emitSound: () => {},
  registerEmojiListener: () => () => {},
  registerSoundListener: () => () => {},
});

export function usePresence() {
  return useContext(PresenceContext);
}

const avatarGradients = [
  '#a855f7',
  '#3b82f6',
  '#22c55e',
  '#f97316',
  '#ef4444',
  '#eab308',
  '#ec4899',
  '#06b6d4',
];

const getRandomColor = () => {
  return avatarGradients[Math.floor(Math.random() * avatarGradients.length)];
};

export default function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<PresenceData>({ count: 0, users: [] });
  const [socketId, setSocketId] = useState<string | null>(null);
  const pathname = usePathname();
  const socketRef = useRef<Socket | null>(null);
  const emojiListenersRef = useRef<((data: EmojiData) => void)[]>([]);
  const soundListenersRef = useRef<((data: SoundData) => void)[]>([]);
  const { x, y } = useMouse({ allowPage: true });

  const emitEmoji = useCallback((emoji: string, x: number, y: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("emoji:send", { emoji, x, y });
    }
  }, []);

  const registerEmojiListener = useCallback((callback: (data: EmojiData) => void) => {
    emojiListenersRef.current.push(callback);
    return () => {
      emojiListenersRef.current = emojiListenersRef.current.filter((cb) => cb !== callback);
    };
  }, []);

  const emitSound = useCallback((soundFile: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("soundboard:play", { soundFile });
    }
  }, []);

  const registerSoundListener = useCallback((callback: (data: SoundData) => void) => {
    soundListenersRef.current.push(callback);
    return () => {
      soundListenersRef.current = soundListenersRef.current.filter((cb) => cb !== callback);
    };
  }, []);

  const handleCursorMove = useCallback((posX: number, posY: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("cursor:move", { x: posX, y: posY });
    }
  }, []);

  const throttledCursorMove = useThrottle(handleCursorMove, 150);

  useEffect(() => {
    throttledCursorMove(x, y);
  }, [x, y, throttledCursorMove]);

  useEffect(() => {
    const socket: Socket = io({
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setSocketId(socket.id || null);
      const userStr = localStorage.getItem("user");
      let user = null;
      try {
        user = userStr ? JSON.parse(userStr) : null;
      } catch {
        // ignore
      }

      socket.emit("presence:join", {
        nickname: user?.name || "Guest",
        profileImage: user?.profileImage || null,
        currentPage: window.location.pathname,
        color: getRandomColor(),
      });
    });

    socket.on("presence:update", (presenceData: PresenceData) => {
      setData(presenceData);
    });

    socket.on("cursor:update", (updatedUser: OnlineUser) => {
      setData((prev) => {
        const userIndex = prev.users.findIndex((u) => u.socketId === updatedUser.socketId);
        if (userIndex === -1) {
          return prev;
        }
        
        const newUsers = [...prev.users];
        newUsers[userIndex] = { ...newUsers[userIndex], ...updatedUser };
        return { ...prev, users: newUsers };
      });
    });

    socket.on("emoji:broadcast", (data: EmojiData) => {
      emojiListenersRef.current.forEach((listener) => listener(data));
    });

    socket.on("soundboard:played", (data: SoundData) => {
      soundListenersRef.current.forEach((listener) => listener(data));
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("presence:page", { currentPage: pathname });
    }
  }, [pathname]);

  return (
    <PresenceContext.Provider
      value={{ ...data, socketId, emitEmoji, emitSound, registerEmojiListener, registerSoundListener }}
    >
      {children}
    </PresenceContext.Provider>
  );
}
