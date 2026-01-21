"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { MessageSquareText, ArrowLeft, Brain, Sparkles, Clock } from "lucide-react";

export default function LyricsQuizModePage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute bottom-1/4 left-1/3 w-[500px] h-[500px] bg-[#FF6B6B]/20 rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between p-6 md:p-8">
        <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span>홈으로</span>
        </Link>
        <div className="flex items-center gap-3">
          <MessageSquareText className="w-6 h-6 text-[#FF6B6B]" />
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
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#FF6B6B]/20 text-[#FF6B6B] mb-6">
            <MessageSquareText className="w-5 h-5" />
            <span className="text-sm font-medium">MODE 03</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="text-[#FF6B6B]">가사 맞추기</span>
          </h1>

          <p className="text-xl text-gray-400 mb-12 leading-relaxed">
            빈칸으로 가려진 가사를 맞춰보세요.
            <br />
            얼마나 많은 노래 가사를 알고 있나요?
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Brain className="w-8 h-8 text-[#FF6B6B] mb-4" />
              <h3 className="font-bold mb-2">기억력 테스트</h3>
              <p className="text-sm text-gray-400">좋아하는 노래 가사 기억하기</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Sparkles className="w-8 h-8 text-[#FF6B6B] mb-4" />
              <h3 className="font-bold mb-2">다양한 난이도</h3>
              <p className="text-sm text-gray-400">쉬움부터 극한까지 선택</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Clock className="w-8 h-8 text-[#FF6B6B] mb-4" />
              <h3 className="font-bold mb-2">타임 어택</h3>
              <p className="text-sm text-gray-400">제한 시간 내 정답 맞추기</p>
            </div>
          </div>

          <Link href="/login?redirect=/mode/lyrics-quiz">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-12 py-4 rounded-full bg-[#FF6B6B] text-black font-bold text-lg"
            >
              퀴즈 시작하기
            </motion.button>
          </Link>
        </motion.div>
      </main>
    </div>
  );
}
