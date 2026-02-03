"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { ChevronDown, Music, Target, MessageSquareText, Swords, Users } from "lucide-react";
import Link from "next/link";
import { useLenis } from "lenis/react";
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
  const [hasExitedHero, setHasExitedHero] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastScrollTime = useRef(0);
  const lenis = useLenis();
  
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start start", "end start"],
  });

  const y = useTransform(scrollYProgress, [0, 1], ["0%", "50%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.2]);

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 100) {
        setHasExitedHero(true);
      } else if (window.scrollY === 0) {
        setHasExitedHero(false);
        setActiveMode(0);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Lock/unlock scroll using Lenis API
  useEffect(() => {
    if (!lenis) return;
    
    if (!hasExitedHero && activeMode < modes.length - 1) {
      lenis.stop();
    } else {
      lenis.start();
    }
    
    return () => {
      lenis.start(); // Ensure scroll is enabled on unmount
    };
  }, [lenis, hasExitedHero, activeMode]);

  const scrollToContent = () => {
    const heroHeight = containerRef.current?.offsetHeight || window.innerHeight;
    window.scrollTo({ top: heroHeight, behavior: 'smooth' });
  };

  const handleWheel = useCallback((e: WheelEvent) => {
    if (hasExitedHero || window.scrollY > 10 || window.innerWidth < 768) return;
    
    const isLastMode = activeMode === modes.length - 1;
    const isFirstMode = activeMode === 0;
    const scrollingDown = e.deltaY > 0;
    const scrollingUp = e.deltaY < 0;
    
    if (scrollingDown && isLastMode) return;
    if (scrollingUp && isFirstMode) return;
    
    const now = Date.now();
    if (now - lastScrollTime.current < 400) return;
    
    if (scrollingDown && activeMode < modes.length - 1) {
      setActiveMode(prev => prev + 1);
      lastScrollTime.current = now;
    } else if (scrollingUp && activeMode > 0) {
      setActiveMode(prev => prev - 1);
      lastScrollTime.current = now;
    }
  }, [hasExitedHero, activeMode]);

  useEffect(() => {
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const currentMode = modes[activeMode];
  const Icon = currentMode.icon;

  return (
      <section ref={containerRef} className="relative min-h-screen md:h-screen w-full overflow-y-auto md:overflow-hidden bg-black">
       <motion.div style={{ y, scale, opacity }} className="absolute inset-0 z-0 hidden md:block">
         <video
           autoPlay
           loop
           muted
           playsInline
           preload="auto"
           disablePictureInPicture
           disableRemotePlayback
           className="absolute inset-0 w-full h-full object-cover opacity-80"
           style={{ imageRendering: 'auto', WebkitBackfaceVisibility: 'hidden' }}
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
           preload="auto"
           disablePictureInPicture
           disableRemotePlayback
           className="absolute inset-0 w-full h-full object-cover opacity-80"
           style={{ imageRendering: 'auto', WebkitBackfaceVisibility: 'hidden' }}
         >
           <source src="/hero-video.webm" type="video/webm" />
           <source src="/hero-video.mp4" type="video/mp4" />
         </video>
        <motion.div 
          className="absolute inset-0"
          animate={{ 
            background: `linear-gradient(to bottom, rgba(0,0,0,0.6), ${currentMode.accent}15, rgba(0,0,0,0.7))` 
          }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <div className="relative z-10 flex h-full w-full flex-col justify-between p-4 sm:p-6 md:p-12 lg:p-20">
        <div className="flex flex-col gap-6 mt-12 sm:mt-16 md:mt-20">
          <div className="flex items-end gap-6">
            <motion.h1 
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.8 }}
              className="text-6xl sm:text-7xl md:text-[10rem] font-bold tracking-tighter text-white"
            >
              KERO
            </motion.h1>
            <AnimatePresence mode="wait">
              <motion.div
                key={activeMode}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-2 mb-4 md:gap-3 md:mb-6"
              >
                <Icon className="w-6 h-6 sm:w-8 sm:h-8" style={{ color: currentMode.accent }} />
                <span 
                  className="text-xl sm:text-2xl md:text-3xl font-bold tracking-wider"
                  style={{ color: currentMode.accent }}
                >
                  {currentMode.title}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
          
          <AnimatePresence mode="wait">
            <motion.div 
              key={activeMode}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3 }}
              className="space-y-4"
            >
              <p className="text-base sm:text-xl font-medium tracking-wide text-gray-300 md:text-2xl">
                {currentMode.subtitle}
              </p>
              <div className="max-w-md text-gray-400 space-y-1">
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
            className="flex gap-3 sm:gap-4 mt-6 md:mt-8"
          >
            <Link href={currentMode.href}>
              <motion.button 
                className="rounded-full px-5 py-2.5 sm:px-8 sm:py-3 text-sm font-bold sm:font-medium text-black transition-all"
                style={{ backgroundColor: currentMode.accent }}
                whileHover={{ 
                  backgroundColor: "#fff",
                  scale: 1.05 
                }}
                whileTap={{ scale: 0.95 }}
              >
                지금 참여하기
              </motion.button>
            </Link>
            <motion.button 
              onClick={scrollToContent}
              className="rounded-full border px-5 py-2.5 sm:px-8 sm:py-3 text-sm font-medium text-white transition-all hover:text-black"
              style={{ borderColor: `${currentMode.accent}50` }}
              whileHover={{ 
                backgroundColor: currentMode.accent,
                scale: 1.05 
              }}
              whileTap={{ scale: 0.95 }}
            >
              기능 둘러보기
            </motion.button>
          </motion.div>
          <div className="grid grid-cols-2 gap-2.5 mt-6 md:hidden">
            {modes.map((mode, i) => {
              const ModeIcon = mode.icon;
              const isActive = i === activeMode;
              return (
                <motion.button
                  key={mode.id}
                  onClick={() => setActiveMode(i)}
                  className="flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all"
                  style={{
                    background: isActive ? `linear-gradient(135deg, ${mode.accent}40, ${mode.accent}20)` : `${mode.accent}12`,
                    borderColor: isActive ? `${mode.accent}90` : `${mode.accent}30`,
                    boxShadow: isActive ? `0 0 20px -2px ${mode.accent}50` : 'none',
                  }}
                  whileTap={{ scale: 0.95 }}
                >
                  <ModeIcon className="w-5 h-5 shrink-0" style={{ color: mode.accent }} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold truncate ${isActive ? 'text-white' : 'text-gray-200'}`}>{mode.title}</p>
                    <p className="text-[11px] truncate" style={{ color: isActive ? `${mode.accent}cc` : `${mode.accent}80` }}>{mode.subtitle}</p>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="absolute right-8 top-1/2 -translate-y-1/2 hidden flex-col gap-8 md:flex">
          <div className="flex flex-col gap-4 text-right">
            {modes.map((mode, i) => (
              <motion.button
                key={mode.id}
                onClick={() => setActiveMode(i)}
                className={`cursor-pointer text-xl font-bold transition-all duration-300 ${
                  i === activeMode 
                    ? "scale-125" 
                    : "text-white/30 hover:text-white/60"
                }`}
                style={{ color: i === activeMode ? mode.accent : undefined }}
                whileHover={{ scale: i === activeMode ? 1.25 : 1.1 }}
                whileTap={{ scale: 0.95 }}
              >
                {mode.id}
              </motion.button>
            ))}
          </div>
          <motion.div 
            className="h-24 w-[2px] self-end mr-3 rounded-full"
            style={{ backgroundColor: `${currentMode.accent}40` }}
            layoutId="mode-indicator"
          />
        </div>

        <motion.button
          onClick={scrollToContent}
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="self-center flex flex-col items-center gap-2 text-white/50 hover:text-white transition-colors cursor-pointer mt-8 mb-4 md:mt-0 md:mb-0"
        >
           <span className="text-xs tracking-widest uppercase hidden md:block">Skip to Content</span>
           <ChevronDown className="h-5 w-5" />
          </motion.button>
        </div>
       <OnlineIndicator />
     </section>
   );
}
