"use client";

import RevealAnimation from "@/components/animations/RevealAnimation";

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
    </section>
  );
};

export default SkillsSection;
