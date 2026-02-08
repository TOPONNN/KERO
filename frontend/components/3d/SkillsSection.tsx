"use client";

import RevealAnimation from "@/components/animations/RevealAnimation";
import ExtraTechGrid from "./ExtraTechGrid";

const SkillsSection = () => {
  return (
    <section
      id="skills"
      className="relative w-full h-screen md:h-[150dvh] pointer-events-none"
    >
       <div className="sticky top-[70px] mb-96">
         <RevealAnimation>
            <h2 className="font-display text-4xl text-center md:text-7xl font-bold text-white">
              Tech Stack
            </h2>
         </RevealAnimation>
         <RevealAnimation delay={0.2}>
            <p className="font-display mx-auto line-clamp-4 max-w-3xl font-normal text-base text-center text-white/50">
              (hint: press a key)
            </p>
         </RevealAnimation>
       </div>
       <div className="sticky bottom-0 left-0 right-0 pointer-events-auto pb-4 md:pb-8 px-4 md:px-8">
         <ExtraTechGrid />
       </div>
    </section>
  );
};

export default SkillsSection;
