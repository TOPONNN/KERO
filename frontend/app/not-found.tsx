import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[#020817] flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full blur-3xl opacity-5 bg-white/20" />
      </div>

      <div className="relative z-10 w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl ring-1 ring-white/5 text-center">
        <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-6 ring-1 ring-white/10">
          <SearchX className="w-10 h-10 text-white/40" />
        </div>

        <h1 className="text-6xl font-bold text-white/10 mb-2">404</h1>
        <h2 className="text-2xl font-bold text-white mb-3">페이지를 찾을 수 없습니다</h2>
        <p className="text-white/60 mb-8 break-keep">
          요청하신 페이지가 존재하지 않거나<br />
          삭제되었을 수 있습니다.
        </p>

        <Link
          href="/"
          className="flex items-center justify-center gap-2 w-full py-4 rounded-xl bg-white text-black font-bold hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          <ArrowLeft className="w-5 h-5" />
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
