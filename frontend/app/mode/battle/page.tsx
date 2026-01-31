"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Swords, ArrowLeft, Play, Users, Mic, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function BattleModePage() {
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
      router.push("/login?redirect=/mode/battle");
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
          name: "배틀 모드 방",
          gameMode: "battle",
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
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-[#FF4500]/20 rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between p-6 md:p-8">
        <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span>홈으로</span>
        </Link>
        <div className="flex items-center gap-3">
          <Swords className="w-6 h-6 text-[#FF4500]" />
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
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#FF4500]/20 text-[#FF4500] mb-6">
            <Swords className="w-5 h-5" />
            <span className="text-sm font-medium">MODE 04</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="text-[#FF4500]">배틀</span> 모드
          </h1>

          <p className="text-xl text-gray-400 mb-12 leading-relaxed">
            같은 노래를 부르고 점수로 승부하세요.
            <br />
            누가 더 잘 부르는지 겨뤄보세요!
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Play className="w-8 h-8 text-[#FF4500] mb-4" />
              <h3 className="font-bold mb-2">실시간 점수 대결</h3>
              <p className="text-sm text-gray-400">같은 곡을 부르며 실시간으로 점수 대결</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Users className="w-8 h-8 text-[#FF4500] mb-4" />
              <h3 className="font-bold mb-2">랭킹 시스템</h3>
              <p className="text-sm text-gray-400">최고의 가수를 가리는 랭킹 시스템</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Mic className="w-8 h-8 text-[#FF4500] mb-4" />
              <h3 className="font-bold mb-2">콤보 배틀</h3>
              <p className="text-sm text-gray-400">연속 정확도로 콤보 점수를 쌓으세요</p>
            </div>
          </div>

          {mounted && (
            <motion.button
              onClick={handleStart}
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.05 }}
              whileTap={{ scale: loading ? 1 : 0.95 }}
              className="px-12 py-4 rounded-full bg-[#FF4500] text-black font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  방 생성 중...
                </>
              ) : isLoggedIn ? (
                "방 만들기"
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
