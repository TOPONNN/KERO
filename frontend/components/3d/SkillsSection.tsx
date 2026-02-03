"use client";

import RevealAnimation from "@/components/animations/RevealAnimation";
import SectionWrapper from "@/components/animations/SectionWrapper";

const SkillsSection = () => {
  return (
    <SectionWrapper
      id="skills"
      className="w-full h-screen md:h-[150dvh] pointer-events-none"
    >
      <div className="sticky top-[70px] z-20 flex flex-col items-center pt-16 md:pt-24 text-center">
        <RevealAnimation>
          <h2 className="text-4xl md:text-7xl font-bold text-center text-white">
            Tech Stack
          </h2>
        </RevealAnimation>
        <RevealAnimation delay={0.2}>
          <p className="mt-4 text-base text-white/50 text-center">(hint: press a key)</p>
        </RevealAnimation>
      </div>
    </SectionWrapper>
  );
};

export default SkillsSection;
