"use client";

import RevealAnimation from "@/components/animations/RevealAnimation";

const SkillsSection = () => {
  return (
    <section
      id="skills"
      className="relative w-full h-screen md:h-[150dvh] pointer-events-none"
    >
      <div className="sticky top-[70px] z-20 flex flex-col items-center pt-16 md:pt-24 text-center">
        <RevealAnimation>
          <h2 className="font-display text-4xl text-center md:text-7xl font-bold text-white">
            Tech Stack
          </h2>
        </RevealAnimation>
        <RevealAnimation delay={0.2}>
          <p className="font-display mx-auto mt-4 max-w-3xl text-base text-center text-white/50">
            (hint: press a key)
          </p>
        </RevealAnimation>
      </div>
    </section>
  );
};

export default SkillsSection;
