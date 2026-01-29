"use client";

import { useState, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Music, Target, MessageSquareText, Swords, Zap, ArrowLeft, Plus, Users, 
  Search, Loader2, DoorOpen, Lock, Globe, RefreshCw, Trash2
} from "lucide-react";

const modeConfig = {
  normal: { title: "일반 모드", icon: Music, color: "#C0C0C0" },
  perfect_score: { title: "퍼펙트 스코어", icon: Target, color: "#FFD700" },
  lyrics_quiz: { title: "가사 맞추기", icon: MessageSquareText, color: "#FF6B6B" },
  battle: { title: "배틀 모드", icon: Swords, color: "#FF4500" },
  duet: { title: "듀엣 모드", icon: Users, color: "#9B59B6" },
};

interface Room {
  id: string;
  code: string;
  name: string;
  gameMode: "normal" | "perfect_score" | "lyrics_quiz" | "battle" | "duet";
  status: string;
  hostId: string;
  isPrivate: boolean;
  maxParticipants: number;
  participants: { id: string; nickname: string; isHost: boolean }[];
}

function LobbyContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") as "normal" | "perfect_score" | "lyrics_quiz" | "battle" | "duet" | null;
  
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [nickname, setNickname] = useState("");
  const [selectedMode, setSelectedMode] = useState<"normal" | "perfect_score" | "lyrics_quiz" | "battle" | "duet">(mode || "normal");
  const [isPrivate, setIsPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState("");

  useEffect(() => {
    if (mode) setSelectedMode(mode);
  }, [mode]);

  useEffect(() => {
    setMounted(true);
    const token = localStorage.getItem("token");
    const userStr = localStorage.getItem("user");
    setIsLoggedIn(!!token);
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        setUserId(user.id);
        setNickname(user.name || "");
      } catch {}
    }
  }, []);

  useEffect(() => {
    fetchRooms();
  }, [mode]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const url = mode ? `/api/rooms?gameMode=${mode}` : "/api/rooms";
      const res = await fetch(url);
      const data = await res.json();
      if (data.success) {
        setRooms(data.data || []);
      }
    } catch (e) {
      console.error("Failed to fetch rooms:", e);
    } finally {
      setLoading(false);
    }
  };

  const createRoom = async () => {
    if (!isLoggedIn) {
      router.push("/login?redirect=/lobby");
      return;
    }

    if (!roomName.trim()) {
      alert("방 이름을 입력해주세요.");
      return;
    }

    if (!nickname.trim()) {
      alert("닉네임을 입력해주세요.");
      return;
    }

    const userStr = localStorage.getItem("user");
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        user.name = nickname.trim();
        localStorage.setItem("user", JSON.stringify(user));
      } catch {}
    }

    setCreating(true);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        },
        body: JSON.stringify({
          name: roomName,
          gameMode: selectedMode,
          hostId: userId,
          maxParticipants: 8,
          isPrivate,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        alert(data.message || "방 생성에 실패했습니다.");
        setCreating(false);
        return;
      }

      router.push(`/room/${data.data.code}`);
    } catch {
      alert("서버 연결에 실패했습니다.");
      setCreating(false);
    }
  };

  const joinRoom = async (code?: string) => {
    const roomCode = code || joinCode.trim().toUpperCase();
    if (!roomCode) {
      alert("방 코드를 입력해주세요.");
      return;
    }

    if (!isLoggedIn) {
      router.push(`/login?redirect=/room/${roomCode}`);
      return;
    }

    setJoining(true);
    try {
      const res = await fetch(`/api/rooms/${roomCode}`);
      const data = await res.json();

      if (!data.success) {
        alert("방을 찾을 수 없습니다.");
        setJoining(false);
        return;
      }

      router.push(`/room/${roomCode}`);
    } catch {
      alert("서버 연결에 실패했습니다.");
      setJoining(false);
    }
  };

  const deleteRoom = async (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    if (!userId) {
      alert("로그인이 필요합니다.");
      return;
    }
    if (!confirm("정말 이 방을 삭제하시겠습니까?")) return;

    try {
      const res = await fetch(`/api/rooms/${code}?userId=${userId}`, {
        method: "DELETE",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("token")}`
        }
      });

      const data = await res.json();
      if (data.success) {
        fetchRooms();
      } else {
        alert(data.message || "방 삭제에 실패했습니다.");
      }
    } catch {
      alert("서버 연결에 실패했습니다.");
    }
  };

  const config = mode ? modeConfig[mode] : null;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="absolute inset-0 overflow-hidden">
        <div 
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-20"
          style={{ backgroundColor: config?.color || "#C0C0C0" }}
        />
      </div>

      <header className="relative z-10 flex items-center justify-between p-6 md:p-8">
        <Link href="/" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span>홈으로</span>
        </Link>
        <div className="flex items-center gap-3">
          {config && <config.icon className="w-6 h-6" style={{ color: config.color }} />}
          <span className="text-xl font-bold">KERO</span>
        </div>
        <button
          onClick={fetchRooms}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          <span className="text-sm">새로고침</span>
        </button>
      </header>

      <main className="relative z-10 px-6 md:px-12 pb-12">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              {config ? (
                <><span style={{ color: config.color }}>{config.title}</span> 로비</>
              ) : (
                "노래방 로비"
              )}
            </h1>
            <p className="text-gray-400">방을 만들거나 참여하세요</p>
          </div>

          <div className="flex flex-wrap justify-center gap-4 mb-8">
            <motion.button
              onClick={() => setShowCreateModal(true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-black"
              style={{ backgroundColor: config?.color || "#C0C0C0" }}
            >
              <Plus className="w-5 h-5" />
              방 만들기
            </motion.button>
            <motion.button
              onClick={() => setShowJoinModal(true)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-white/10 hover:bg-white/20"
            >
              <DoorOpen className="w-5 h-5" />
              코드로 입장
            </motion.button>
          </div>

          {!mode && (
            <div className="relative mb-8 group">
              <div className="absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none md:hidden" />
              <div className="absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none md:hidden" />
              <div className="flex overflow-x-auto pb-4 md:pb-0 px-4 md:px-0 md:justify-center gap-2 snap-x scrollbar-hide -mx-6 md:mx-0">
                <Link 
                  href="/lobby" 
                  className={`snap-center shrink-0 px-4 py-2.5 rounded-full transition-all border ${
                    !mode 
                      ? "bg-white text-black border-white font-bold" 
                      : "bg-white/5 text-gray-400 border-white/5 hover:bg-white/10 hover:border-white/20"
                  }`}
                >
                  전체
                </Link>
                {Object.entries(modeConfig).map(([key, cfg]) => (
                  <Link 
                    key={key}
                    href={`/lobby?mode=${key}`}
                    className="snap-center shrink-0 px-4 py-2.5 rounded-full bg-white/5 border border-white/5 hover:bg-white/10 hover:border-white/20 transition-all flex items-center gap-2 group/btn"
                  >
                    <div 
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: cfg.color }}
                    />
                    <span className="text-sm font-medium text-gray-300 group-hover/btn:text-white transition-colors">
                      {cfg.title}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : rooms.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 ring-1 ring-white/10">
                <Music className="w-10 h-10 text-white/20" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">아직 열린 방이 없어요</h3>
              <p className="text-gray-500 mb-8 max-w-sm">
                지금 바로 새로운 방을 만들고<br/>친구들을 초대해서 노래를 불러보세요!
              </p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-8 py-3 rounded-full bg-white text-black font-bold hover:scale-105 transition-transform"
              >
                첫 번째 방 만들기
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {rooms.map((room) => {
                const roomConfig = modeConfig[room.gameMode];
                const Icon = roomConfig.icon;
                return (
                  <motion.div
                    key={room.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    whileHover={{ scale: 1.02, y: -2 }}
                    className="group relative p-6 rounded-3xl bg-white/5 border border-white/5 hover:border-white/10 hover:bg-white/10 transition-all cursor-pointer overflow-hidden"
                    onClick={() => joinRoom(room.code)}
                  >
                    <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                      <div className="p-2 rounded-full bg-white/10 backdrop-blur-md text-white">
                        <DoorOpen className="w-4 h-4" />
                      </div>
                    </div>

                    <div className="flex items-start justify-between mb-6">
                      <div className="flex items-center gap-4">
                        <div 
                          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
                          style={{ backgroundColor: roomConfig.color }}
                        >
                          <Icon className="w-7 h-7 text-black" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-white/10 text-white/70">
                              {roomConfig.title}
                            </span>
                            {room.isPrivate && (
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-500 flex items-center gap-1">
                                <Lock className="w-3 h-3" />
                                비공개
                              </span>
                            )}
                          </div>
                          <h3 className="font-bold text-xl truncate max-w-[180px]">{room.name}</h3>
                        </div>
                      </div>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 rounded-xl bg-black/20">
                        <div className="flex items-center gap-2">
                          <div className="flex -space-x-2 overflow-hidden">
                            {room.participants?.slice(0, 3).map((p, i) => (
                              <div 
                                key={i} 
                                className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-900 flex items-center justify-center text-xs font-bold"
                              >
                                {p.nickname[0]}
                              </div>
                            ))}
                            {(room.participants?.length || 0) > 3 && (
                              <div className="w-8 h-8 rounded-full bg-zinc-800 border-2 border-zinc-900 flex items-center justify-center text-xs font-bold text-gray-400">
                                +{room.participants.length - 3}
                              </div>
                            )}
                          </div>
                          <span className="text-sm text-gray-400">
                            참여 중
                          </span>
                        </div>
                        <span className="text-sm font-bold">
                          <span className="text-white">{room.participants?.length || 0}</span>
                          <span className="text-gray-500">/{room.maxParticipants}</span>
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-gray-500 font-mono">
                        <span className="flex items-center gap-1">
                           Host {room.participants?.find(p => p.isHost)?.nickname || "Unknown"}
                        </span>
                        <span>{room.code}</span>
                      </div>
                    </div>

                    {room.hostId === userId && (
                      <div className="absolute bottom-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                         <button
                          onClick={(e) => deleteRoom(e, room.code)}
                          className="p-2 rounded-xl bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-colors"
                         >
                           <Trash2 className="w-4 h-4" />
                         </button>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowCreateModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold mb-6">방 만들기</h2>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">게임 모드</label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(modeConfig).map(([key, cfg]) => (
                      <button
                        key={key}
                        onClick={() => setSelectedMode(key as any)}
                        className={`flex items-center gap-2 p-3 rounded-xl border transition-all ${
                          selectedMode === key
                            ? "bg-white/10 border-white/40 shadow-[0_0_15px_-5px_rgba(255,255,255,0.3)]"
                            : "bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10"
                        }`}
                      >
                        <div 
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                          style={{ backgroundColor: `${cfg.color}20` }}
                        >
                          <cfg.icon className="w-4 h-4" style={{ color: cfg.color }} />
                        </div>
                        <span className={`text-sm font-bold ${
                          selectedMode === key ? "text-white" : "text-gray-400"
                        }`}>
                          {cfg.title}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">방 설정</label>
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        placeholder="닉네임"
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-white/30 focus:bg-white/10 transition-colors"
                      />
                      <input
                        type="text"
                        value={roomName}
                        onChange={(e) => setRoomName(e.target.value)}
                        placeholder="방 이름"
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-white/30 focus:bg-white/10 transition-colors"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => setIsPrivate(!isPrivate)}
                    className="flex items-center gap-3 w-full p-3 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
                  >
                    <div className={`w-10 h-6 rounded-full transition-colors relative ${
                      isPrivate ? "bg-yellow-500" : "bg-white/20"
                    }`}>
                      <div className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${
                        isPrivate ? "translate-x-4" : "translate-x-0"
                      }`} />
                    </div>
                    <span className="text-sm font-medium text-gray-300">비공개 방으로 만들기</span>
                  </button>
                </div>

                <button
                  onClick={createRoom}
                  disabled={creating}
                  className="w-full py-4 rounded-xl font-bold text-black text-lg shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50 disabled:hover:scale-100"
                  style={{ backgroundColor: modeConfig[selectedMode].color }}
                >
                  {creating ? (
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>생성 중...</span>
                    </div>
                  ) : (
                    "방 만들기"
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {showJoinModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowJoinModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold mb-6">코드로 입장</h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-2">방 코드</label>
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="6자리 코드 입력"
                    maxLength={6}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl focus:outline-none focus:border-white/40 text-center text-2xl font-mono tracking-widest"
                  />
                </div>

                <button
                  onClick={() => joinRoom()}
                  disabled={joining || joinCode.length < 6}
                  className="w-full py-3 rounded-xl font-bold text-black bg-white disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {joining ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      입장 중...
                    </>
                  ) : (
                    "입장하기"
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function LobbyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    }>
      <LobbyContent />
    </Suspense>
  );
}
