"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MenuItem, Position, SoundItem } from "./radial-menu-types";

interface RadialMenuPresentationalProps {
  isOpen: boolean;
  position: Position;
  items: MenuItem[];
  soundItems: SoundItem[];
  activeIndex: number | null;
  activeTab: "emoji" | "soundboard";
}

export default function RadialMenuPresentational({
  isOpen,
  position,
  items,
  soundItems,
  activeIndex,
  activeTab,
}: RadialMenuPresentationalProps) {
  const radius = 140;
  const centerIcon = activeTab === "emoji" ? "😀" : "🔊";

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed z-[100]"
          style={{
            left: position.x,
            top: position.y,
            pointerEvents: "none",
          }}
        >
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            className="absolute rounded-full -translate-x-1/2 -translate-y-1/2 bg-neutral-900/80 backdrop-blur-md border border-white/10 w-12 h-12 flex items-center justify-center shadow-2xl"
          >
            <span className="text-lg leading-none">{centerIcon}</span>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute -translate-x-1/2 -translate-y-1/2 top-9 text-[10px] tracking-wide text-white/70 whitespace-nowrap"
          >
            클릭으로 전환
          </motion.div>

          {activeTab === "emoji" &&
            items.map((item, index) => {
              const count = items.length;
              const slice = 360 / count;
              const angleDeg = index * slice - 90;
              const angleRad = (angleDeg * Math.PI) / 180;
              const x = Math.cos(angleRad) * radius;
              const y = Math.sin(angleRad) * radius;
              const isActive = activeIndex === index;

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                  animate={{ opacity: 1, scale: isActive ? 1.2 : 1, x, y }}
                  exit={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="absolute flex items-center justify-center -translate-x-1/2 -translate-y-1/2"
                >
                  <div
                    className={`relative flex items-center justify-center w-14 h-14 rounded-full shadow-lg border transition-colors duration-200 ${
                      isActive
                        ? "bg-white text-black border-white"
                        : "bg-neutral-800 text-white border-neutral-700"
                    }`}
                    style={{
                      backgroundColor: isActive ? item.color : undefined,
                      borderColor: isActive ? item.color : undefined,
                      color: isActive ? "#fff" : undefined,
                    }}
                  >
                    <span className="text-2xl">{item.emoji}</span>
                    {isActive && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute top-16 bg-black/80 text-white text-xs px-2 py-1 rounded backdrop-blur-md whitespace-nowrap"
                      >
                        {item.label}
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              );
            })}

          {activeTab === "soundboard" &&
            soundItems.map((item, index) => {
              const count = soundItems.length;
              const slice = 360 / count;
              const angleDeg = index * slice - 90;
              const angleRad = (angleDeg * Math.PI) / 180;
              const x = Math.cos(angleRad) * radius;
              const y = Math.sin(angleRad) * radius;
              const isActive = activeIndex === index;

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                  animate={{ opacity: 1, scale: isActive ? 1.2 : 1, x, y }}
                  exit={{ opacity: 0, scale: 0, x: 0, y: 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  className="absolute flex items-center justify-center -translate-x-1/2 -translate-y-1/2"
                >
                  <div
                    className={`relative flex items-center justify-center w-14 h-14 rounded-full shadow-lg border transition-colors duration-200 ${
                      isActive
                        ? "bg-white text-black border-white"
                        : "bg-neutral-800 text-white border-neutral-700"
                    }`}
                    style={{
                      backgroundColor: isActive ? item.color : undefined,
                      borderColor: isActive ? item.color : undefined,
                      color: isActive ? "#fff" : undefined,
                    }}
                  >
                    <span className="text-2xl">{item.icon}</span>
                    {isActive && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute top-16 bg-black/80 text-white text-xs px-2 py-1 rounded backdrop-blur-md whitespace-nowrap"
                      >
                        {item.label}
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              );
            })}
        </div>
      )}
    </AnimatePresence>
  );
}
