"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, X } from "lucide-react";

interface OnlineUser {
  nickname: string;
  profileImage: string | null;
  currentPage: string;
  lastSeen: number;
}

interface OnlineData {
  count: number;
  users: OnlineUser[];
}

const avatarGradients = [
  'from-purple-500 to-pink-500',
  'from-blue-500 to-cyan-500',
  'from-green-500 to-emerald-500',
  'from-orange-500 to-red-500',
  'from-indigo-500 to-purple-500',
];

export default function OnlineIndicator() {
  const [onlineData, setOnlineData] = useState<OnlineData>({ count: 0, users: [] });
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    
    // 1. Initialize Visitor ID
    let visitorId = localStorage.getItem("visitorId");
    if (!visitorId) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        visitorId = crypto.randomUUID();
      } else {
        // Fallback for older browsers
        visitorId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
          const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
          return v.toString(16);
        });
      }
      localStorage.setItem("visitorId", visitorId);
    }

    const sendHeartbeat = async () => {
      try {
        const token = localStorage.getItem("token");
        const userStr = localStorage.getItem("user");
        let user = null;
        try {
          user = userStr ? JSON.parse(userStr) : null;
        } catch {
          // ignore invalid json
        }

        const payload = {
          visitorId,
          nickname: user?.name || "게스트",
          profileImage: user?.profileImage || null,
          currentPage: window.location.pathname
        };

        const headers: Record<string, string> = {
          "Content-Type": "application/json"
        };
        if (token) {
          headers["Authorization"] = `Bearer ${token}`;
        }

        await fetch('/api/online/heartbeat', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      } catch {
        // Silent fail
      }
    };

    const fetchOnline = async () => {
      try {
        const res = await fetch('/api/online');
        const data = await res.json();
        if (data.success) {
          setOnlineData(data.data);
        }
      } catch {
        // Silent fail
      }
    };

    sendHeartbeat();
    fetchOnline();

    const heartbeatInterval = setInterval(sendHeartbeat, 10000);
    const fetchInterval = setInterval(fetchOnline, 5000);

    return () => {
      clearInterval(heartbeatInterval);
      clearInterval(fetchInterval);
    };
  }, []);

  const getPageName = (path: string) => {
    if (path === '/') return '메인';
    if (path === '/lobby') return '로비';
    if (path.startsWith('/room/')) return '방';
    if (path === '/login') return '로그인';
    if (path === '/signup') return '회원가입';
    if (path.startsWith('/mode/')) return '모드 선택';
    return '탐색 중';
  };

  if (!mounted) return null;

   return (
     <motion.div
       className="absolute bottom-6 right-6 z-30"
       initial={{ opacity: 0, y: 20 }}
       animate={{ opacity: 1, y: 0 }}
     >
      <motion.div
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer flex items-center gap-3 px-4 py-2.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl hover:bg-black/80 transition-colors"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <div className="relative">
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
          <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-green-400 animate-ping opacity-75" />
        </div>
        
        <div className="flex -space-x-2">
          {onlineData.users.slice(0, 5).map((user, i) => (
            <div key={i} className="relative" style={{ zIndex: 5 - i }}>
              {user.profileImage ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={user.profileImage} alt="" className="w-7 h-7 rounded-full object-cover ring-2 ring-black/60" />
              ) : (
                <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${avatarGradients[i % avatarGradients.length]} flex items-center justify-center text-[10px] font-bold text-white ring-2 ring-black/60`}>
                  {user.nickname?.charAt(0) || '?'}
                </div>
              )}
            </div>
          ))}
          {onlineData.count > 5 && (
            <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-[10px] font-bold text-white/70 ring-2 ring-black/60">
              +{onlineData.count - 5}
            </div>
          )}
        </div>
        
        <span className="text-sm font-medium text-white/80">{onlineData.count}명 접속 중</span>
      </motion.div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute bottom-full right-0 mb-2 w-72 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-white/60" />
                <span className="text-sm font-bold text-white/80">접속 중</span>
                <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full font-bold">{onlineData.count}</span>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setExpanded(false); }} className="text-white/40 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto p-2 space-y-1">
              {onlineData.users.map((user, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-white/5 transition-colors">
                  {user.profileImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={user.profileImage} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarGradients[i % avatarGradients.length]} flex items-center justify-center text-xs font-bold text-white`}>
                      {user.nickname?.charAt(0) || '?'}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{user.nickname}</span>
                    </div>
                    <span className="text-xs text-white/40 truncate block">
                      {getPageName(user.currentPage)}
                    </span>
                  </div>
                  <div className="w-2 h-2 rounded-full bg-green-400 shrink-0 shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
                </div>
              ))}
              {onlineData.users.length === 0 && (
                <div className="text-center py-8 text-white/30 text-xs">
                  접속자 정보를 불러오는 중...
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
