"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User, UserPlus, LogOut, X, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface UserData {
  id: string;
  name: string;
  email: string;
}

export default function Header() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [mounted, setMounted] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("user");
    if (stored) {
      try {
        const userData = JSON.parse(stored);
        setUser(userData);
        setNickname(userData.name);
      } catch {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
      }
    }
  }, []);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowProfileModal(false);
    };
    if (showProfileModal) {
      window.addEventListener("keydown", handleEsc);
      if (user) setNickname(user.name);
    }
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showProfileModal, user]);

  const handleUpdateProfile = () => {
    if (!user || !nickname.trim()) return;
    setSaving(true);
    
    const newUser = { ...user, name: nickname.trim() };
    localStorage.setItem("user", JSON.stringify(newUser));
    setUser(newUser);
    
    setTimeout(() => {
        setSaving(false);
        setShowProfileModal(false);
    }, 500);
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    router.push("/");
  };

  if (!mounted) {
    return (
      <header className="fixed top-0 right-0 z-50 p-6 md:p-8">
        <div className="flex items-center gap-3">
          <div className="w-24 h-10 rounded-full bg-white/10 animate-pulse" />
        </div>
      </header>
    );
  }

  return (
    <header className="fixed top-0 right-0 z-50 p-6 md:p-8">
      <div className="flex items-center gap-3">
        {user ? (
          <>
            <motion.button
              onClick={() => setShowProfileModal(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white hover:bg-white/20 transition-all cursor-pointer"
            >
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">{user.name}</span>
            </motion.button>
            <motion.button
              onClick={handleLogout}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/20 backdrop-blur-md border border-red-500/30 text-red-400 hover:bg-red-500/30 transition-all"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-medium hidden md:block">로그아웃</span>
            </motion.button>
          </>
        ) : (
          <>
            <Link href="/login">
              <motion.div
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white/80 hover:text-white hover:bg-white/20 transition-all"
              >
                <User className="w-4 h-4" />
                <span className="text-sm font-medium hidden md:block">로그인</span>
              </motion.div>
            </Link>
            <Link href="/signup">
              <motion.div
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black hover:bg-gray-200 transition-all"
              >
                <UserPlus className="w-4 h-4" />
                <span className="text-sm font-medium hidden md:block">회원가입</span>
              </motion.div>
            </Link>
          </>
        )}
      </div>
      
      <AnimatePresence>
        {showProfileModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowProfileModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-6 relative"
              onClick={(e) => e.stopPropagation()}
            >
              <button 
                onClick={() => setShowProfileModal(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h2 className="text-2xl font-bold mb-6 text-white">프로필 설정</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">닉네임</label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="닉네임을 입력하세요"
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl focus:outline-none focus:border-white/40 text-white"
                    autoFocus
                  />
                </div>

                <div className="pt-2">
                    <button
                        onClick={handleUpdateProfile}
                        disabled={saving || !nickname.trim()}
                        className="w-full py-3 rounded-xl font-bold text-black bg-white disabled:opacity-50 flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                    >
                        {saving ? (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            저장 중...
                        </>
                        ) : (
                        "저장하기"
                        )}
                    </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
