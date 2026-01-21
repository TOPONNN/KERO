"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { User, UserPlus, LogOut } from "lucide-react";
import { motion } from "framer-motion";

interface UserData {
  id: string;
  name: string;
  email: string;
}

export default function Header() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("user");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
      }
    }
  }, []);

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
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-white">
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">{user.name}</span>
            </div>
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
    </header>
  );
}
