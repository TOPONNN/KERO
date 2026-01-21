"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { Music, Eye, EyeOff, Check, Loader2 } from "lucide-react";

export default function SignupPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (formData.password !== formData.confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          password: formData.password,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.message || "회원가입에 실패했습니다.");
        setLoading(false);
        return;
      }

      router.push("/login?registered=true");
    } catch {
      setError("서버 연결에 실패했습니다.");
      setLoading(false);
    }
  };

  const passwordMatch = formData.password === formData.confirmPassword && formData.confirmPassword !== "";

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6 py-12">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-[#C0C0C0]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-[#FFD700]/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 w-full max-w-md"
      >
        <Link href="/" className="flex items-center justify-center gap-3 mb-12">
          <Music className="w-8 h-8 text-[#C0C0C0]" />
          <span className="text-4xl font-bold text-white">KERO</span>
        </Link>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
          <h1 className="text-2xl font-bold text-white mb-2">회원가입</h1>
          <p className="text-gray-400 mb-8">KERO와 함께 노래를 시작하세요</p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/50 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">이름</label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#C0C0C0] transition-colors"
                placeholder="홍길동"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">연락처</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#C0C0C0] transition-colors"
                placeholder="010-1234-5678"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">이메일</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleChange}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#C0C0C0] transition-colors"
                placeholder="example@email.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">비밀번호</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={formData.password}
                  onChange={handleChange}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#C0C0C0] transition-colors pr-12"
                  placeholder="8자 이상 입력"
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">비밀번호 확인</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? "text" : "password"}
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none transition-colors pr-12 ${
                    passwordMatch ? "border-green-500" : "border-white/10 focus:border-[#C0C0C0]"
                  }`}
                  placeholder="비밀번호 재입력"
                  required
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {passwordMatch && <Check className="w-5 h-5 text-green-500" />}
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 text-sm">
              <input type="checkbox" required className="mt-1 rounded bg-white/5 border-white/10" />
              <span className="text-gray-400">
                <Link href="#" className="text-[#C0C0C0] hover:text-white transition-colors">이용약관</Link> 및{" "}
                <Link href="#" className="text-[#C0C0C0] hover:text-white transition-colors">개인정보처리방침</Link>에 동의합니다
              </span>
            </div>

            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: loading ? 1 : 0.98 }}
              className="w-full bg-gradient-to-r from-[#C0C0C0] to-[#FFD700] text-black font-bold py-3 rounded-xl transition-all hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  가입 중...
                </>
              ) : (
                "가입하기"
              )}
            </motion.button>
          </form>

          <div className="mt-8 pt-6 border-t border-white/10 text-center">
            <p className="text-gray-400">
              이미 계정이 있으신가요?{" "}
              <Link href="/login" className="text-[#C0C0C0] hover:text-white transition-colors font-medium">
                로그인
              </Link>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
