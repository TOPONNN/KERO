"use client";

import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";

export default function RoomLoading() {
  return (
    <div className="min-h-screen bg-black overflow-hidden relative">
      {/* Header Skeleton */}
      <header className="relative z-20 flex items-center justify-between px-4 py-3 md:p-6 border-b border-white/5">
        <div className="w-24 h-10 rounded-full bg-white/5 animate-pulse" />
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/5 animate-pulse" />
          <div className="w-32 h-6 rounded bg-white/5 animate-pulse" />
        </div>
        <div className="flex items-center gap-4">
          <div className="w-16 h-8 rounded-full bg-white/5 animate-pulse" />
          <div className="w-24 h-8 rounded-full bg-white/5 animate-pulse" />
        </div>
      </header>

      <main className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-4 gap-4">
        {/* Main Content Card Skeleton */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="w-full max-w-2xl bg-black/40 border border-white/10 rounded-3xl p-6 shadow-2xl ring-1 ring-white/5 h-[400px] flex flex-col items-center justify-center"
        >
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-10 h-10 text-white/20 animate-spin" />
            <p className="text-white/40 font-medium animate-pulse">방에 접속 중...</p>
          </div>
        </motion.div>

        {/* Participants Skeleton */}
        <div className="w-full max-w-lg bg-black/40 border border-white/10 rounded-2xl p-6 h-32">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-5 h-5 rounded bg-white/5 animate-pulse" />
            <div className="w-20 h-5 rounded bg-white/5 animate-pulse" />
          </div>
          <div className="space-y-2">
            <div className="w-full h-12 rounded-xl bg-white/5 animate-pulse" />
            <div className="w-full h-12 rounded-xl bg-white/5 animate-pulse" />
          </div>
        </div>
      </main>
    </div>
  );
}
