"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users, ArrowLeft, Play, Mic, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function DuetModePage() {
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
      router.push("/login?redirect=/mode/duet");
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
          name: "듀엣 모드 방",
          gameMode: "duet",
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
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-[#9B59B6]/20 rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between p-6 md:p-8">
        <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span>홈으로</span>
        </Link>
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-[#9B59B6]" />
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
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#9B59B6]/20 text-[#9B59B6] mb-6">
            <Users className="w-5 h-5" />
            <span className="text-sm font-medium">MODE 05</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6">
            <span className="text-[#9B59B6]">듀엣</span> 모드
          </h1>

          <p className="text-xl text-gray-400 mb-12 leading-relaxed">
            파트를 나눠 함께 노래하세요.
            <br />
            완벽한 듀엣을 만들어보세요!
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Play className="w-8 h-8 text-[#9B59B6] mb-4" />
              <h3 className="font-bold mb-2">파트 분배</h3>
              <p className="text-sm text-gray-400">각자의 파트를 나눠 함께 부르세요</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Users className="w-8 h-8 text-[#9B59B6] mb-4" />
              <h3 className="font-bold mb-2">하모니 모드</h3>
              <p className="text-sm text-gray-400">둘이 함께 완벽한 하모니를 만드세요</p>
            </div>
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10">
              <Mic className="w-8 h-8 text-[#9B59B6] mb-4" />
              <h3 className="font-bold mb-2">듀엣 녹음</h3>
              <p className="text-sm text-gray-400">함께 부른 노래를 녹음하고 공유하세요</p>
            </div>
          </div>

          {mounted && (
            <motion.button
              onClick={handleStart}
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.05 }}
              whileTap={{ scale: loading ? 1 : 0.95 }}
              className="px-12 py-4 rounded-full bg-[#9B59B6] text-black font-bold text-lg disabled:opacity-50 flex items-center justify-center gap-2 mx-auto"
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
