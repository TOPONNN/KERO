"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import confetti from "canvas-confetti";
import RadialMenuPresentational from "./RadialMenuPresentational";
import { MenuItem, Position, SoundItem } from "./radial-menu-types";
import { usePresence } from "../PresenceProvider";
import { useSoundboard } from "../../hooks/useSoundboard";

const MENU_ITEMS: MenuItem[] = [
  { id: "love", emoji: "\u2764\uFE0F", label: "Love", color: "#ef4444" },
  { id: "laugh", emoji: "\uD83D\uDE02", label: "Haha", color: "#fbbf24" },
  { id: "wow", emoji: "\uD83D\uDE2E", label: "Wow", color: "#3b82f6" },
  { id: "sad", emoji: "\uD83D\uDE22", label: "Sad", color: "#60a5fa" },
  { id: "angry", emoji: "\uD83D\uDE21", label: "Angry", color: "#f97316" },
  { id: "fire", emoji: "\uD83D\uDD25", label: "Lit", color: "#f59e0b" },
];

type MenuTab = "emoji" | "soundboard";

const SOUND_ITEMS: SoundItem[] = [
  { id: "ddau", label: "따우", icon: "🔊", color: "#8b5cf6", soundFile: "ecyrAkS-WFQ.mp3" },
  { id: "speaky-mop", label: "물걸레질", icon: "🧹", color: "#06b6d4", soundFile: "bWkgBZbgHJ0.mp3" },
  { id: "speaky-hide", label: "숨바꼭질", icon: "🙈", color: "#22c55e", soundFile: "afk0rGI6b9g.mp3" },
  { id: "speaky-hair", label: "머리잡기", icon: "😱", color: "#ef4444", soundFile: "pVQsxskAiA8.mp3" },
  { id: "noot", label: "핑구", icon: "🐧", color: "#3b82f6", soundFile: "noot_p0CPOIz.mp3" },
  { id: "clap", label: "박수", icon: "👏", color: "#f59e0b", soundFile: "clap.mp3" },
];

const MENU_TABS: MenuTab[] = ["emoji", "soundboard"];

const DEAD_ZONE = 20;
const HOLD_DELAY = 0;

export default function RadialMenu() {
  const { emitEmoji, emitSound } = usePresence();
  const { playSound } = useSoundboard();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<Position>({ x: 0, y: 0 });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<MenuTab>("emoji");

  const isOpenRef = useRef(false);
  const menuPosRef = useRef<Position>({ x: 0, y: 0 });
  const activeIndexRef = useRef<number | null>(null);
  const activeTabRef = useRef<MenuTab>("emoji");
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const suppressMenuRef = useRef(false);
  const lastTabSwitchRef = useRef(0);

  useEffect(() => {
    isOpenRef.current = isOpen;
    menuPosRef.current = menuPos;
    activeIndexRef.current = activeIndex;
    activeTabRef.current = activeTab;
  }, [isOpen, menuPos, activeIndex, activeTab]);

  const fireConfetti = useCallback((pageX: number, pageY: number, emoji: string) => {
    const normalizedX = (pageX - window.scrollX) / window.innerWidth;
    const normalizedY = (pageY - window.scrollY) / window.innerHeight;
    const count = 5;

    for (let i = 0; i < count; i++) {
      const scalar = 1.5 + Math.random() * 5;
      const emojiShape = confetti.shapeFromText({ text: emoji, scalar });

      confetti({
        particleCount: 15,
        spread: 60 + Math.random() * 20,
        origin: { x: normalizedX, y: normalizedY },
        shapes: [emojiShape],
        scalar,
        disableForReducedMotion: true,
        zIndex: 9999,
        startVelocity: 25 + Math.random() * 10,
        gravity: 0.6 + Math.random() * 0.4,
        drift: (Math.random() - 0.5) * 0.5,
      });
    }
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isOpenRef.current) return;
    const origin = menuPosRef.current;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;

    const itemCount = activeTabRef.current === "emoji" ? MENU_ITEMS.length : SOUND_ITEMS.length;
    const ITEM_RING_RADIUS = 100;
    const HIT_RADIUS = 35;

    let closestIndex: number | null = null;
    let closestDist = Infinity;

    for (let i = 0; i < itemCount; i++) {
      const angleDeg = i * (360 / itemCount) - 90;
      const angleRad = (angleDeg * Math.PI) / 180;
      const itemX = Math.cos(angleRad) * ITEM_RING_RADIUS;
      const itemY = Math.sin(angleRad) * ITEM_RING_RADIUS;
      const distToItem = Math.sqrt((dx - itemX) ** 2 + (dy - itemY) ** 2);

      if (distToItem < HIT_RADIUS && distToItem < closestDist) {
        closestDist = distToItem;
        closestIndex = i;
      }
    }

    if (activeIndexRef.current !== closestIndex) setActiveIndex(closestIndex);
  }, []);

  const switchTab = useCallback(() => {
    const now = Date.now();
    if (now - lastTabSwitchRef.current < 400) return;
    lastTabSwitchRef.current = now;
    setActiveIndex(null);
    setActiveTab((prev) => {
      const currentIndex = MENU_TABS.indexOf(prev);
      const nextIndex = (currentIndex + 1) % MENU_TABS.length;
      return MENU_TABS[nextIndex];
    });
  }, []);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (e.button === 0 && isOpenRef.current) {
      const dx = e.clientX - menuPosRef.current.x;
      const dy = e.clientY - menuPosRef.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 50) {
        e.preventDefault();
        switchTab();
      }
      return;
    }
    if (e.button === 2) {
      const pos = { x: e.clientX, y: e.clientY };
      timerRef.current = setTimeout(() => {
        setMenuPos(pos);
        setIsOpen(true);
        setActiveIndex(null);
        suppressMenuRef.current = true;
      }, HOLD_DELAY);
    }
  }, [switchTab]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (e.button === 0 && isOpenRef.current) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (isOpenRef.current) {
      if (activeIndexRef.current !== null) {
        if (activeTabRef.current === "emoji") {
          const item = MENU_ITEMS[activeIndexRef.current];
          fireConfetti(e.pageX, e.pageY, item.emoji);
          emitEmoji(item.emoji, e.pageX, e.pageY);
        } else {
          const item = SOUND_ITEMS[activeIndexRef.current];
          emitSound(item.soundFile);
          playSound(item.soundFile);
        }
      }
      setIsOpen(false);
      setActiveIndex(null);
      setActiveTab("emoji");
    }
  }, [emitEmoji, emitSound, fireConfetti, playSound]);

  const handleWheel = useCallback((e: WheelEvent) => {
    if (!isOpenRef.current) return;
    if (e.deltaY === 0) return;
    e.preventDefault();
    switchTab();
  }, [switchTab]);

  const handleContextMenu = useCallback((e: MouseEvent) => {
    if (suppressMenuRef.current) {
      e.preventDefault();
      suppressMenuRef.current = false;
    }
  }, []);

  useEffect(() => {
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("contextmenu", handleContextMenu);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp, handleContextMenu]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("radial-menu-toggle", { detail: { open: isOpen } }));
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    document.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      document.removeEventListener("wheel", handleWheel);
    };
  }, [handleWheel, isOpen]);

  return (
    <RadialMenuPresentational
      isOpen={isOpen}
      position={menuPos}
      items={MENU_ITEMS}
      soundItems={SOUND_ITEMS}
      activeIndex={activeIndex}
      activeTab={activeTab}
    />
  );
}
