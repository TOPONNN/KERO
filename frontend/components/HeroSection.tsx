"use client";

import { useRef, useState, useEffect } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { ChevronDown, Music, Target, MessageSquareText, Swords, Users, ArrowRight } from "lucide-react";
import Link from "next/link";
import OnlineIndicator from "@/components/OnlineIndicator";

const modes = [
  {
    id: "01",
    title: "일반",
    subtitle: "자유롭게 즐기는 노래",
    description: ["점수나 제한 없이 자유롭게 노래를 즐기세요.", "편안한 분위기에서 마음껏 부르세요."],
    icon: Music,
    accent: "#C0C0C0",
    href: "/lobby?mode=normal",
  },
  {
    id: "02", 
    title: "퍼펙트 스코어",
    subtitle: "완벽한 음정을 향해",
    description: ["AI 음정 분석으로 실시간 점수를 확인하세요.", "100점에 도전해보세요!"],
    icon: Target,
    accent: "#FFD700",
    href: "/lobby?mode=perfect_score",
  },
    {
      id: "03",
      title: "노래 퀴즈",
      subtitle: "6가지 퀴즈로 즐기는 Kahoot",
      description: ["가사, 제목, 가수, 초성 등 다양한 문제 유형으로 경쟁하세요.", "실시간 대결에서 스트릭을 쌓고 최고 점수를 노려보세요!"],
      icon: MessageSquareText,
      accent: "#FF6B6B",
      href: "/lobby?mode=lyrics_quiz",
    },
  {
    id: "04",
    title: "배틀",
    subtitle: "실력을 겨루는 대결",
    description: ["같은 노래를 부르고 점수로 승부하세요.", "누가 더 잘 부르는지 겨뤄보세요!"],
    icon: Swords,
    accent: "#FF4500",
    href: "/lobby?mode=battle",
  },
  {
    id: "05",
    title: "듀엣",
    subtitle: "함께 부르는 하모니",
    description: ["파트를 나눠 함께 노래하세요.", "완벽한 듀엣을 만들어보세요!"],
    icon: Users,
    accent: "#9B59B6",
    href: "/lobby?mode=duet",
  },
];

export default function HeroSection() {
  const [activeMode, setActiveMode] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.2]);

  const currentMode = modes[activeMode];
  const Icon = currentMode.icon;

  return (
    <section ref={containerRef} className="relative min-h-screen w-full overflow-hidden bg-black flex flex-col">
      <motion.div style={{ y, scale, opacity }} className="absolute inset-0 z-0 hidden md:block">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-70"
        >
          <source src="/hero-video.webm" type="video/webm" />
          <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        <motion.div 
          className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent"
          animate={{ 
            background: `linear-gradient(to right, rgba(0,0,0,0.8), ${currentMode.accent}10, transparent)` 
          }}
          transition={{ duration: 0.5 }}
        />
      </motion.div>

      <div className="absolute inset-0 z-0 md:hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        >
           <source src="/hero-video.webm" type="video/webm" />
           <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-black/60" />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col p-4 sm:p-6 md:p-12 lg:p-20 overflow-y-auto md:overflow-visible">
        
        <div className="flex flex-col gap-2 mt-8 sm:mt-12 md:mt-20 shrink-0">
          <motion.h1 
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="text-6xl sm:text-7xl md:text-8xl lg:text-9xl xl:text-[10rem] font-bold tracking-tighter text-white"
          >
            KERO
          </motion.h1>
        </div>

        <div className="hidden md:flex flex-col gap-6 mt-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeMode}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-3 mb-6"
              >
                <Icon className="w-8 h-8" style={{ color: currentMode.accent }} />
                <span 
                  className="text-3xl font-bold tracking-wider"
                  style={{ color: currentMode.accent }}
                >
                  {currentMode.title}
                </span>
              </motion.div>
            </AnimatePresence>
          
          <AnimatePresence mode="wait">
            <motion.div 
              key={activeMode}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-2xl font-medium tracking-wide text-gray-300">
                {currentMode.subtitle}
              </p>
              <div className="max-w-xl text-gray-400 space-y-1 text-lg">
                {currentMode.description.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            </motion.div>
          </AnimatePresence>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="flex gap-4 mt-8"
          >
            <Link href={currentMode.href}>
              <motion.button 
                className="rounded-full px-8 py-3 text-base font-medium text-black transition-all"
                style={{ backgroundColor: currentMode.accent }}
                whileHover={{ scale: 1.05, backgroundColor: "#fff" }}
                whileTap={{ scale: 0.95 }}
              >
                지금 참여하기
              </motion.button>
            </Link>
          </motion.div>
        </div>

        <div className="flex-1 mt-8 md:mt-auto md:pt-12 pb-20 md:pb-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 md:gap-4">
            {modes.map((mode, i) => {
              const ModeIcon = mode.icon;
              const isActive = i === activeMode;
              
              return (
                <Link 
                  key={mode.id} 
                  href={mode.href}
                  onClick={(e) => {
                    setActiveMode(i);
                  }}
                  onMouseEnter={() => setActiveMode(i)}
                  className="group relative"
                >
                  <motion.div
                    className={`h-full p-4 rounded-2xl border transition-all duration-300 flex flex-col justify-between gap-3
                      ${isActive ? 'bg-white/10 border-white/20' : 'bg-black/20 border-white/5 hover:bg-white/5'}
                    `}
                    style={{ borderColor: isActive ? mode.accent : undefined }}
                    whileHover={{ y: -5 }}
                    whileTap={{ scale: 0.98 }}
                  >
                     <div className="flex items-start justify-between">
                        <ModeIcon 
                          className={`w-6 h-6 transition-colors duration-300`}
                          style={{ color: isActive ? mode.accent : '#666' }}
                        />
                        {isActive && <div className="hidden md:block w-2 h-2 rounded-full" style={{ backgroundColor: mode.accent }} />}
                     </div>
                     
                     <div>
                       <h3 className={`font-bold text-sm sm:text-base mb-1 transition-colors ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-200'}`}>
                         {mode.title}
                       </h3>
                       <p className="text-xs text-gray-500 line-clamp-1 group-hover:text-gray-400">
                         {mode.subtitle}
                       </p>
                     </div>
                     
                     <div className="md:hidden mt-2 flex justify-end">
                        <div className="p-1.5 rounded-full bg-white/10" style={{ color: mode.accent }}>
                           <ArrowRight className="w-4 h-4" />
                        </div>
                     </div>
                  </motion.div>
                </Link>
              );
            })}
          </div>
        </div>

       </div>
       <OnlineIndicator />
     </section>
   );
}
