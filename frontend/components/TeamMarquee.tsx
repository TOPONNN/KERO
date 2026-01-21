"use client";

import { motion } from "framer-motion";

const TEAM = ["윤희준", "정훈호", "김관익", "김성민", "박찬진", "윤희망"];

export default function TeamMarquee() {
  return (
    <section className="relative w-full py-24 overflow-hidden bg-black/90">
      <div className="absolute inset-0 bg-white/5 backdrop-blur-xl" />
      
      <div className="relative z-10 flex flex-col items-center gap-8">
        <h2 className="text-xs font-bold tracking-[0.2em] text-white/50">MEET THE TEAM</h2>
        
        <div className="flex w-full overflow-hidden whitespace-nowrap">
          <motion.div
            animate={{ x: [0, -1000] }}
            transition={{ repeat: Infinity, duration: 30, ease: "linear" }}
            className="flex gap-12 text-4xl font-light tracking-widest text-white/80 md:text-6xl"
          >
            {[...TEAM, ...TEAM, ...TEAM, ...TEAM].map((member, i) => (
              <div key={i} className="flex items-center gap-12">
                <span>{member}</span>
                <span className="h-2 w-2 rounded-full bg-white/20" />
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
