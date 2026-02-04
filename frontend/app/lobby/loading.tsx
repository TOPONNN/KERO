"use client";

import { motion } from "framer-motion";

export default function LobbyLoading() {
  return (
    <div className="min-h-screen bg-black">
      {/* Background Effect */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-10 bg-white/10 animate-pulse" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between p-6 md:p-8">
        <div className="w-24 h-6 rounded bg-white/5 animate-pulse" />
        <div className="w-32 h-8 rounded bg-white/5 animate-pulse" />
        <div className="w-24 h-9 rounded-full bg-white/5 animate-pulse" />
      </header>

      <main className="relative z-10 px-4 sm:px-6 md:px-8 pb-12">
        <div className="max-w-6xl mx-auto">
          {/* Title Section */}
          <div className="text-center mb-8">
            <div className="h-12 w-64 mx-auto rounded-lg bg-white/5 animate-pulse mb-4" />
            <div className="h-5 w-48 mx-auto rounded bg-white/5 animate-pulse" />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap justify-center gap-4 mb-8">
            <div className="w-40 h-12 rounded-xl bg-white/10 animate-pulse" />
            <div className="w-40 h-12 rounded-xl bg-white/5 animate-pulse" />
          </div>

          {/* Filter Tabs */}
          <div className="flex justify-center gap-2 mb-8">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="w-24 h-10 rounded-full bg-white/5 animate-pulse" />
            ))}
          </div>

          {/* Room Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="h-[200px] rounded-3xl bg-white/5 border border-white/5 p-6 relative overflow-hidden"
              >
                <div className="flex items-start justify-between mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-white/5 animate-pulse" />
                    <div className="space-y-2">
                      <div className="w-16 h-4 rounded-full bg-white/5 animate-pulse" />
                      <div className="w-32 h-6 rounded bg-white/5 animate-pulse" />
                    </div>
                  </div>
                </div>
                <div className="absolute bottom-6 left-6 right-6">
                  <div className="w-full h-12 rounded-xl bg-white/5 animate-pulse" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
