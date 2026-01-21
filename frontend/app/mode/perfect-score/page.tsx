"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Target, ArrowLeft, Trophy, BarChart3, Zap } from "lucide-react";

export default function PerfectScoreModePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("token");
    setIsLoggedIn(!!token);
  }, []);

  const handleStart = () => {
    if (isLoggedIn) {
      alert("방 만들기 기능은 준비 중입니다!");
    } else {
      router.push("/login?redirect=/mode/perfect-score");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-[#FFD700]/20 rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between p-6 md:p-8">
        <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span>홈으로</span>
        </Link>
        <div className="flex items-center gap-3">
          <Target className="w-6 h-6 text-[#FFD700]" />
          <span className="text-xl font-bold">KERO</span>
        </div>
      </header>

      <main className="relative z-10 flex flex-col items-center justify-center min-h-[80vh] px-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-2xl"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#FFD700]/20 text-[#FFD700] mb-6">
            <Target className="w-5 h-5" />
            <span className="text-sm font-medium">MODE 02</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="text-[#FFD700]">퍼펙트 스코어</span>
          </h1>

          <p className="text-xl text-gray-400 mb-12 leading-relaxed">
            AI 음정 분석으로 실시간 점수를 확인하세요.
            <br />
            100점에 도전해보세요!
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <BarChart3 className="w-8 h-8 text-[#FFD700] mb-4" />
              <h3 className="font-bold mb-2">실시간 음정 분석</h3>
              <p className="text-sm text-gray-400">CREPE AI로 정확한 음정 추적</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Trophy className="w-8 h-8 text-[#FFD700] mb-4" />
              <h3 className="font-bold mb-2">점수 & 랭킹</h3>
              <p className="text-sm text-gray-400">친구들과 점수 경쟁</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Zap className="w-8 h-8 text-[#FFD700] mb-4" />
              <h3 className="font-bold mb-2">즉각 피드백</h3>
              <p className="text-sm text-gray-400">음정/박자 실시간 가이드</p>
            </div>
          </div>

          {mounted && (
            <motion.button
              onClick={handleStart}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-12 py-4 rounded-full bg-[#FFD700] text-black font-bold text-lg"
            >
              {isLoggedIn ? "도전하기" : "로그인하고 도전하기"}
            </motion.button>
          )}
        </motion.div>
      </main>
    </div>
  );
}
