"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, DoorOpen } from "lucide-react";
import Link from "next/link";
import { motion } from "framer-motion";

export default function RoomError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen bg-[#020817] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 w-full max-w-md bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl ring-1 ring-white/5 text-center"
      >
        <div className="w-16 h-16 rounded-2xl bg-yellow-500/10 flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="w-8 h-8 text-yellow-500" />
        </div>

        <h2 className="text-2xl font-bold text-white mb-2">방에 접속할 수 없습니다</h2>
        <p className="text-white/60 mb-8 break-keep">
          방 정보를 불러오는 중 오류가 발생했습니다.<br />
          네트워크 상태를 확인해주세요.
        </p>

        <div className="flex flex-col gap-3">
          <button
            onClick={reset}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-[#C0C0C0] text-black font-bold hover:bg-white transition-colors hover:scale-[1.02] active:scale-[0.98]"
          >
            <RefreshCw className="w-4 h-4" />
            다시 시도
          </button>
          
          <Link 
            href="/lobby"
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-colors border border-white/5"
          >
            <DoorOpen className="w-4 h-4" />
            로비로 돌아가기
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
