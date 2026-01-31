"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageSquareText, ArrowLeft, Brain, Sparkles, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function LyricsQuizModePage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");
    setIsLoggedIn(!!token);
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setUserId(user.id);
      } catch {}
    }
  }, []);

  const handleStart = async () => {
    if (!isLoggedIn) {
      router.push("/login?redirect=/mode/lyrics-quiz");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({
           name: "노래 퀴즈 방",
           gameMode: "lyrics_quiz",
           hostId: userId,
           maxParticipants: 8,
           isPrivate: false,
         }),
      });

      const data = await res.json();

      if (!data.success) {
        toast.error(data.message || "방 생성에 실패했습니다.");
        setLoading(false);
        return;
      }

      router.push(`/room/${data.data.code}`);
    } catch {
      toast.error("서버 연결에 실패했습니다.");
      setLoading(false);
    }
  };

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
             <span className="text-[#FF6B6B]">노래 퀴즈</span>
           </h1>

           <p className="text-xl text-gray-400 mb-12 leading-relaxed">
             6가지 퀴즈 유형으로 노래 실력을 겨뤄보세요.
             <br />
             가사, 제목, 가수, 초성, 순서, O/X 퀴즈까지 다양한 문제가 기다리고 있습니다!
           </p>

           <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
             <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
               <Brain className="w-8 h-8 text-[#FF6B6B] mb-4" />
               <h3 className="font-bold mb-2">6가지 퀴즈 유형</h3>
               <p className="text-sm text-gray-400">가사, 제목, 가수, 초성, 순서, O/X</p>
             </div>
             <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
               <Sparkles className="w-8 h-8 text-[#FF6B6B] mb-4" />
               <h3 className="font-bold mb-2">실시간 대결</h3>
               <p className="text-sm text-gray-400">친구들과 함께 경쟁하며 즐기기</p>
             </div>
             <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
               <Clock className="w-8 h-8 text-[#FF6B6B] mb-4" />
               <h3 className="font-bold mb-2">스트릭 점수</h3>
               <p className="text-sm text-gray-400">연속 정답으로 점수 배수 올리기</p>
             </div>
           </div>

          {mounted && (
            <motion.button
              onClick={handleStart}
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.05 }}
              whileTap={{ scale: loading ? 1 : 0.95 }}
              className="px-12 py-4 rounded-full bg-[#FF6B6B] text-black font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  방 생성 중...
                </>
              ) : isLoggedIn ? (
                "퀴즈 시작하기"
              ) : (
                "로그인하고 시작하기"
              )}
            </motion.button>
          )}
        </motion.div>
      </main>
    </div>
  );
}
