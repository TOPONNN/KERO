"use client";

import { motion } from "framer-motion";
import { EXTRA_SKILLS } from "./constants";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.3,
    },
  },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 100,
      damping: 10,
    },
  },
};

const ExtraTechGrid = () => {
  return (
    <div className="w-full max-w-7xl mx-auto backdrop-blur-sm rounded-3xl p-4 md:p-6 bg-black/20 border border-white/5">
      <div className="mb-4 pl-1">
        <h3 className="font-display text-xl md:text-2xl font-bold text-white/40">
          & More
        </h3>
      </div>
      
      <motion.div 
        className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4"
        variants={containerVariants}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "-50px" }}
      >
        {EXTRA_SKILLS.map((skill, index) => (
          <motion.div
            key={index}
            variants={itemVariants}
            className="group relative flex flex-col md:flex-row items-start md:items-center gap-3 p-3 md:p-4 rounded-xl bg-white/5 border border-white/10 overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:border-white/30 hover:shadow-lg hover:bg-white/[0.07]"
            style={{
              boxShadow: `0 0 0 0 ${skill.color}00`,
            }}
            whileHover={{
              boxShadow: `0 0 20px -5px ${skill.color}40`,
            }}
          >
            <div 
              className="absolute left-0 top-0 bottom-0 w-1 transition-opacity duration-300" 
              style={{ backgroundColor: skill.color }} 
            />
            
            <div className="relative z-10 flex-shrink-0 w-8 h-8 md:w-10 md:h-10 ml-2 md:ml-1">
              <img 
                src={skill.icon} 
                alt={skill.label} 
                className="w-full h-full object-contain drop-shadow-md"
                loading="lazy"
              />
            </div>
            
            <div className="relative z-10 flex flex-col ml-2 md:ml-1 min-w-0">
              <span className="font-display font-bold text-sm md:text-base text-white group-hover:text-white transition-colors">
                {skill.label}
              </span>
              <span className="text-[10px] md:text-xs text-white/50 leading-tight line-clamp-2 group-hover:text-white/70 transition-colors mt-0.5">
                {skill.shortDescription}
              </span>
            </div>
            
            <div 
              className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300 pointer-events-none"
              style={{ background: `linear-gradient(90deg, ${skill.color}, transparent)` }}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
};

export default ExtraTechGrid;
