"use client";

import Link from "next/link";
import { User, UserPlus } from "lucide-react";
import { motion } from "framer-motion";

export default function Header() {
  return (
    <header className="fixed top-0 right-0 z-50 p-6 md:p-8">
      <div className="flex items-center gap-3">
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
      </div>
    </header>
  );
}
