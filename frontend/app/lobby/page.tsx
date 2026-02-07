"use client";

import { useState, useEffect, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Music, Target, MessageSquareText, ArrowLeft, Plus, 
  Loader2, DoorOpen, Lock, RefreshCw, Trash2, Dices
} from "lucide-react";
import { toast } from "sonner";

const modeConfig = {
   normal: { title: "일반 모드", icon: Music, color: "#C0C0C0" },
   perfect_score: { title: "퍼펙트 스코어", icon: Target, color: "#FFD700" },
   lyrics_quiz: { title: "노래 퀴즈", icon: MessageSquareText, color: "#FF6B6B" },
};

interface Room {
  id: string;
  code: string;
  name: string;
  gameMode: "normal" | "perfect_score" | "lyrics_quiz";
  status: string;
  hostId: string;
  isPrivate: boolean;
  maxParticipants: number;
  participants: { id: string; nickname: string; isHost: boolean }[];
}

function LobbyContent() {
  const funRoomNames = [
    "노래방 천국 🎤", "음치 금지 구역 🚫", "마이크 쟁탈전 🎙️", 
    "숨겨진 보컬리스트 ✨", "떼창 파티 🎉", "고음 불가 지대 💀",
    "나는야 가수왕 👑", "음정 파괴자들 💣", "가요계 레전드 🏆",
    "원키 도전 🔥", "코노 가자 🚗", "반주 틀어줘 🎹",
    "최고 음역대 🎶", "볼륨 업 🔊", "앵콜 앵콜 👏",
    "싱잉 번개 ⚡", "노래 한판 승부 ⚔️", "멜로디 메이커 🎼",
  ];

  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode") as "normal" | "perfect_score" | "lyrics_quiz" | null;

  useEffect(() => {
    if (!mode) {
      router.replace("/lobby?mode=normal");
    }
  }, [mode, router]);
  
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
  const [selectedMode, setSelectedMode] = useState<"normal" | "perfect_score" | "lyrics_quiz">(mode || "normal");
  const [maxParticipants, setMaxParticipants] = useState(6);
  const [isPrivate, setIsPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [deleteTargetCode, setDeleteTargetCode] = useState<string | null>(null);

  useEffect(() => {
    if (mode) setSelectedMode(mode);
  }, [mode]);

  const generateRandomName = () => {
    setRoomName(funRoomNames[Math.floor(Math.random() * funRoomNames.length)]);
  };

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
      toast.error("방 이름을 입력해주세요.");
      return;
    }

    if (!nickname.trim()) {
      toast.error("닉네임을 입력해주세요.");
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
          maxParticipants,
          isPrivate,
        }),
      });

      const data = await res.json();

      if (!data.success) {
        toast.error(data.message || "방 생성에 실패했습니다.");
        setCreating(false);
        return;
      }

      router.push(`/room/${data.data.code}`);
    } catch {
      toast.error("서버 연결에 실패했습니다.");
      setCreating(false);
    }
  };

  const joinRoom = async (code?: string) => {
    const roomCode = code || joinCode.trim().toUpperCase();
    if (!roomCode) {
      toast.error("방 코드를 입력해주세요.");
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
        toast.error("방을 찾을 수 없습니다.");
        setJoining(false);
        return;
      }

      router.push(`/room/${roomCode}`);
    } catch {
      toast.error("서버 연결에 실패했습니다.");
      setJoining(false);
    }
  };

  const requestDeleteRoom = (e: React.MouseEvent, code: string) => {
    e.stopPropagation();
    if (!userId) {
      toast.error("로그인이 필요합니다.");
      return;
    }
    setDeleteTargetCode(code);
  };

  const confirmDeleteRoom = async () => {
    if (!deleteTargetCode || !userId) return;
    const code = deleteTargetCode;
    setDeleteTargetCode(null);

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
        toast.error(data.message || "방 삭제에 실패했습니다.");
      }
    } catch {
      toast.error("서버 연결에 실패했습니다.");
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

      <main className="relative z-10 px-4 sm:px-6 md:px-8 pb-12">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
                        <div className="flex items-center gap-2">
                          {room.hostId === userId && (
                            <button
                              onClick={(e) => requestDeleteRoom(e, room.code)}
                              className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <span>{room.code}</span>
                        </div>
                      </div>
                    </div>
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
              className="w-full max-w-md mx-4 sm:mx-auto bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl ring-1 ring-white/5 max-h-[90vh] overflow-y-auto scrollbar-hide"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-2xl font-bold mb-2">방 만들기</h2>
              <p className="text-sm text-gray-500 mb-6">새로운 노래방을 만들고 친구를 초대하세요</p>
              
              <div className="flex items-center gap-4 p-4 rounded-2xl mb-6" style={{ backgroundColor: `${modeConfig[selectedMode].color}15` }}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${modeConfig[selectedMode].color}25` }}>
                  {(() => { const ModeIcon = modeConfig[selectedMode].icon; return <ModeIcon className="w-6 h-6" style={{ color: modeConfig[selectedMode].color }} />; })()}
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">게임 모드</p>
                  <p className="text-lg font-bold" style={{ color: modeConfig[selectedMode].color }}>{modeConfig[selectedMode].title}</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">닉네임</label>
                  <input
                    type="text"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="닉네임"
                    className="w-full px-4 py-3 min-h-[44px] bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-white/30 focus:bg-white/10 transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">방 이름</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                      placeholder="방 이름을 입력하세요"
                      className="w-full px-4 py-3 pr-12 min-h-[44px] bg-white/5 border border-white/10 rounded-xl focus:outline-none focus:border-white/30 focus:bg-white/10 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={generateRandomName}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
                      title="랜덤 이름 생성"
                    >
                      <Dices className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">최대 인원</label>
                  <div className="flex items-center gap-3">
                    {[2, 3, 4, 5, 6].map((num) => (
                      <button
                        key={num}
                        onClick={() => setMaxParticipants(num)}
                        className={`flex-1 py-2.5 min-h-[44px] rounded-xl font-bold text-sm transition-all border ${
                          maxParticipants === num
                            ? "border-white/40 bg-white/15 text-white shadow-lg"
                            : "border-white/5 bg-white/5 text-gray-500 hover:bg-white/10 hover:text-gray-300"
                        }`}
                        style={maxParticipants === num ? { 
                          borderColor: `${modeConfig[selectedMode].color}60`,
                          boxShadow: `0 0 15px -5px ${modeConfig[selectedMode].color}40`
                        } : {}}
                      >
                        {num}명
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setIsPrivate(!isPrivate)}
                  className="flex items-center gap-3 w-full p-3 min-h-[44px] rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors"
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
              className="w-full max-w-md mx-4 sm:mx-auto bg-zinc-900 border border-white/10 rounded-2xl p-6"
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
                    className="w-full px-4 py-3 min-h-[44px] bg-white/10 border border-white/20 rounded-xl focus:outline-none focus:border-white/40 text-center text-2xl font-mono tracking-widest"
                  />
                </div>

                <button
                  onClick={() => joinRoom()}
                  disabled={joining || joinCode.length < 6}
                  className="w-full py-3 min-h-[44px] rounded-xl font-bold text-black bg-white disabled:opacity-50 flex items-center justify-center gap-2"
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
        {deleteTargetCode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setDeleteTargetCode(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-sm mx-4 sm:mx-auto bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl ring-1 ring-white/5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-500/20 flex items-center justify-center">
                  <Trash2 className="w-5 h-5 text-red-400" />
                </div>
                <h3 className="text-lg font-bold text-white">방 삭제</h3>
              </div>
              <p className="text-sm text-gray-400 mb-6">정말 이 방을 삭제하시겠습니까?<br />삭제된 방은 복구할 수 없습니다.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteTargetCode(null)}
                  className="flex-1 py-2.5 rounded-xl font-bold text-white bg-white/10 hover:bg-white/20 transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={confirmDeleteRoom}
                  className="flex-1 py-2.5 rounded-xl font-bold text-white bg-red-500 hover:bg-red-600 transition-colors"
                >
                  삭제
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
