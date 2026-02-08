"use client";

import RevealAnimation from "@/components/animations/RevealAnimation";
import { EXTRA_SKILLS } from "./constants";
import { motion } from "framer-motion";

const SkillsSection = () => {
  const dispatchSkillHover = (skill: typeof EXTRA_SKILLS[0] | null) => {
    if (typeof window === 'undefined') return;
    
    if (skill) {
      window.dispatchEvent(new CustomEvent('extra-skill-hover', {
        detail: {
          ...skill,
          id: -1,
          name: `extra-${skill.label}`
        }
      }));
    } else {
      window.dispatchEvent(new CustomEvent('extra-skill-hover', { detail: null }));
    }
  };

  return (
    <section
      id="skills"
      className="relative w-full h-screen md:h-[130dvh] pointer-events-none"
    >
       <div className="sticky top-[70px] z-10">
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
       <div className="sticky bottom-0 left-0 right-0 pointer-events-auto pb-4 md:pb-8 px-4 md:px-8 z-20">
         <div className="w-full max-w-4xl mx-auto flex flex-wrap justify-center gap-3 md:gap-4 items-end">
           {EXTRA_SKILLS.map((skill, index) => (
             <motion.button
               key={index}
               initial={{ opacity: 0, scale: 0.5 }}
               whileInView={{ opacity: 1, scale: 1 }}
               viewport={{ once: true }}
               className="group relative flex flex-col items-center justify-center w-16 h-16 md:w-20 md:h-20 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl shadow-lg transition-all duration-300"
               style={{
                 boxShadow: `0 4px 12px ${skill.color}20`,
               }}
               whileHover={{
                 y: -5,
                 boxShadow: `0 8px 24px ${skill.color}40`,
                 borderColor: `${skill.color}40`,
               }}
               animate={{
                 y: [0, -8, 0],
               }}
               transition={{
                 y: {
                   duration: 3 + (index % 3),
                   repeat: Infinity,
                   ease: "easeInOut",
                   delay: index * 0.2,
                 },
                 opacity: { duration: 0.5, delay: index * 0.05 },
                 scale: { duration: 0.5, delay: index * 0.05 }
               }}
               onMouseEnter={() => dispatchSkillHover(skill)}
               onMouseLeave={() => dispatchSkillHover(null)}
             >
               <div
                 className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
                 style={{
                   background: `radial-gradient(circle at center, ${skill.color}20, transparent 70%)`,
                 }}
               />
               <img
                 src={skill.icon}
                 alt={skill.label}
                 className="w-6 h-6 md:w-8 md:h-8 object-contain mb-1 drop-shadow-md z-10"
               />
               <span className="text-[10px] md:text-xs font-display font-medium text-white/70 group-hover:text-white transition-colors z-10 text-center leading-tight px-1">
                 {skill.label}
               </span>
             </motion.button>
           ))}
         </div>
       </div>
    </section>
  );
};

export default SkillsSection;
