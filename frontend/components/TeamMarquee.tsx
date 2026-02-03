"use client";

import { motion } from "framer-motion";
import SectionWrapper from "@/components/animations/SectionWrapper";
import RevealAnimation from "@/components/animations/RevealAnimation";

const TEAM = ["윤희준", "정훈호", "김관익", "김성민", "박찬진", "윤희망"];

export default function TeamMarquee() {
  return (
    <SectionWrapper
      id="team"
      className="w-full py-12 sm:py-16 md:py-24 overflow-hidden"
    >
      
      <div className="relative z-10 flex flex-col items-center gap-8">
        <RevealAnimation>
          <h2 className="font-display text-4xl md:text-7xl font-bold text-center text-white">MEET THE TEAM</h2>
        </RevealAnimation>
        
        <div className="flex w-full overflow-hidden whitespace-nowrap">
          <motion.div
            animate={{ x: [0, -1000] }}
            transition={{ repeat: Infinity, duration: 30, ease: "linear" }}
            className="flex gap-12 text-2xl sm:text-3xl md:text-4xl lg:text-6xl font-light tracking-widest text-white/80"
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
    </SectionWrapper>
  );
}
