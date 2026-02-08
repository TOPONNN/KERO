"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { Music, Eye, EyeOff, Loader2, X, Mail, ArrowLeft, Check } from "lucide-react";

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function KakaoIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path fill="#000000" d="M12 3C6.48 3 2 6.58 2 10.94c0 2.8 1.86 5.27 4.66 6.67-.15.53-.96 3.4-.99 3.62 0 0-.02.17.09.23.11.07.24.01.24.01.32-.04 3.7-2.44 4.28-2.86.56.08 1.14.13 1.72.13 5.52 0 10-3.58 10-7.94S17.52 3 12 3z"/>
    </svg>
  );
}

function PasswordRecoveryModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"email" | "code" | "reset" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSendCode = async () => {
    if (!email) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/send-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "인증 코드 전송에 실패했습니다.");
        setLoading(false);
        return;
      }
      setStep("code");
    } catch {
      setError("서버 연결에 실패했습니다.");
    }
    setLoading(false);
  };

  const handleVerifyCode = async () => {
    if (!code) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "인증 코드가 올바르지 않습니다.");
        setLoading(false);
        return;
      }
      setStep("reset");
    } catch {
      setError("서버 연결에 실패했습니다.");
    }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    if (newPassword !== confirmPassword) {
      setError("비밀번호가 일치하지 않습니다.");
      return;
    }
    if (newPassword.length < 8) {
      setError("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code, newPassword }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || "비밀번호 재설정에 실패했습니다.");
        setLoading(false);
        return;
      }
      setStep("done");
    } catch {
      setError("서버 연결에 실패했습니다.");
    }
    setLoading(false);
  };

  const handleClose = () => {
    setStep("email");
    setEmail("");
    setCode("");
    setNewPassword("");
    setConfirmPassword("");
    setError("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
      onClick={handleClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="w-full max-w-sm bg-zinc-900 border border-white/10 rounded-2xl p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={handleClose} className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-xl font-bold text-white mb-6">비밀번호 찾기</h2>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
            {error}
          </div>
        )}

        {step === "email" && (
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">가입한 이메일 주소를 입력하면 인증 코드를 보내드립니다.</p>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 ml-1">이메일</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#C0C0C0] transition-colors"
                  placeholder="example@email.com"
                />
              </div>
            </div>
            <button
              onClick={handleSendCode}
              disabled={loading || !email}
              className="w-full py-3 rounded-xl font-medium text-black bg-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              인증 코드 전송
            </button>
          </div>
        )}

        {step === "code" && (
          <div className="space-y-4">
            <p className="text-gray-400 text-sm"><span className="text-white">{email}</span>으로 전송된 인증 코드를 입력하세요.</p>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 ml-1">인증 코드</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-center text-2xl tracking-[0.5em] placeholder-gray-500 focus:outline-none focus:border-[#C0C0C0] transition-colors"
                placeholder="000000"
                maxLength={6}
              />
            </div>
            <button
              onClick={handleVerifyCode}
              disabled={loading || !code}
              className="w-full py-3 rounded-xl font-medium text-black bg-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              확인
            </button>
            <button onClick={() => { setStep("email"); setError(""); }} className="w-full text-center text-sm text-gray-500 hover:text-white transition-colors flex items-center justify-center gap-1">
              <ArrowLeft className="w-3 h-3" /> 이메일 다시 입력
            </button>
          </div>
        )}

        {step === "reset" && (
          <div className="space-y-4">
            <p className="text-gray-400 text-sm">새로운 비밀번호를 입력하세요.</p>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 ml-1">새 비밀번호</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#C0C0C0] transition-colors pr-12"
                  placeholder="8자 이상 입력"
                  minLength={8}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors">
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 ml-1">비밀번호 확인</label>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none transition-colors ${
                  confirmPassword && newPassword === confirmPassword ? "border-green-500" : "border-white/10 focus:border-[#C0C0C0]"
                }`}
                placeholder="비밀번호 재입력"
              />
            </div>
            <button
              onClick={handleResetPassword}
              disabled={loading || !newPassword || !confirmPassword}
              className="w-full py-3 rounded-xl font-medium text-black bg-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:bg-gray-100 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              비밀번호 재설정
            </button>
          </div>
        )}

        {step === "done" && (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-500/20 flex items-center justify-center">
              <Check className="w-8 h-8 text-green-400" />
            </div>
            <p className="text-white font-medium">비밀번호가 변경되었습니다</p>
            <p className="text-gray-400 text-sm">새 비밀번호로 로그인하세요.</p>
            <button
              onClick={handleClose}
              className="w-full py-3 rounded-xl font-medium text-black bg-white hover:bg-gray-100 transition-colors"
            >
              확인
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false);
  const [socialLoading, setSocialLoading] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "SOCIAL_LOGIN_SUCCESS") {
        const { token, user } = event.data.payload;
        localStorage.setItem("token", token);
        localStorage.setItem("user", JSON.stringify(user));
        const redirect = searchParams.get("redirect") || "/";
        router.push(redirect);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [router, searchParams]);

  const handleSocialLogin = (provider: "google" | "kakao") => {
    setSocialLoading(provider);
    const width = 500;
    const height = 600;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;

    let url = "";
    if (provider === "google") {
      const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
      const redirectUri = `${window.location.origin}/auth/google/callback`;
      url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=token&scope=${encodeURIComponent("email profile")}`;
    } else {
      const clientId = process.env.NEXT_PUBLIC_KAKAO_CLIENT_ID;
      const redirectUri = `${window.location.origin}/auth/kakao/callback`;
      url = `https://kauth.kakao.com/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    }

    const popup = window.open(url, `${provider}_login`, `width=${width},height=${height},left=${left},top=${top}`);

    const checkClosed = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(checkClosed);
        setSocialLoading(null);
      }
    }, 500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!data.success) {
        setError(data.message || "로그인에 실패했습니다.");
        setLoading(false);
        return;
      }

      localStorage.setItem("token", data.data.token);
      localStorage.setItem("user", JSON.stringify(data.data.user));

      const redirect = searchParams.get("redirect") || "/";
      router.push(redirect);
    } catch {
      setError("서버 연결에 실패했습니다.");
      setLoading(false);
    }
  };

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
      <h1 className="text-2xl font-bold text-white mb-2">로그인</h1>
      <p className="text-gray-400 mb-8">계정에 로그인하여 노래를 시작하세요</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-xl px-4 py-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-2">이메일</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#C0C0C0] transition-colors pr-12"
              placeholder="••••••••"
              required
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

        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
            <input type="checkbox" className="rounded bg-white/5 border-white/10" />
            <span>로그인 유지</span>
          </label>
          <button type="button" onClick={() => setShowPasswordRecovery(true)} className="text-[#C0C0C0] hover:text-white transition-colors">
            비밀번호 찾기
          </button>
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
              로그인 중...
            </>
          ) : (
            "로그인"
          )}
        </motion.button>
      </form>

      <div className="mt-6 relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-white/10" />
        </div>
        <div className="relative flex justify-center text-sm">
          <span className="px-4 bg-white/5 text-gray-500">또는</span>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <motion.button
          onClick={() => handleSocialLogin("google")}
          disabled={!!socialLoading}
          whileHover={{ scale: socialLoading ? 1 : 1.02 }}
          whileTap={{ scale: socialLoading ? 1 : 0.98 }}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl bg-white text-black font-medium hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {socialLoading === "google" ? <Loader2 className="w-5 h-5 animate-spin" /> : <GoogleIcon />}
          Google로 계속하기
        </motion.button>

        <motion.button
          onClick={() => handleSocialLogin("kakao")}
          disabled={!!socialLoading}
          whileHover={{ scale: socialLoading ? 1 : 1.02 }}
          whileTap={{ scale: socialLoading ? 1 : 0.98 }}
          className="w-full flex items-center justify-center gap-3 py-3 rounded-xl bg-[#FEE500] text-[#191919] font-medium hover:bg-[#FDD800] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {socialLoading === "kakao" ? <Loader2 className="w-5 h-5 animate-spin" /> : <KakaoIcon />}
          카카오로 계속하기
        </motion.button>
      </div>

      <div className="mt-8 pt-6 border-t border-white/10 text-center">
        <p className="text-gray-400">
          계정이 없으신가요?{" "}
          <Link href="/signup" className="text-[#FFD700] hover:text-white transition-colors font-medium">
            회원가입
          </Link>
        </p>
      </div>

      <AnimatePresence>
        <PasswordRecoveryModal isOpen={showPasswordRecovery} onClose={() => setShowPasswordRecovery(false)} />
      </AnimatePresence>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-6">
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#C0C0C0]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#FFD700]/10 rounded-full blur-3xl" />
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

        <Suspense fallback={<div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8 animate-pulse h-96" />}>
          <LoginForm />
        </Suspense>
      </motion.div>
    </div>
  );
}
