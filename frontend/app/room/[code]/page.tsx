"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { 
  Music, Target, MessageSquareText, ArrowLeft, Users, Copy, Check, 
  Loader2, Play, Plus, X, Disc3, AlertCircle, ListMusic, Trash2, SkipForward
} from "lucide-react";
import type { RootState } from "@/store";
import { setRoom } from "@/store/slices/roomSlice";
import { 
  setGameMode, setGameStatus, setCurrentSong, setQuizQuestions,
  addToQueue, removeFromQueue, updateQueueItem, playNextInQueue
} from "@/store/slices/gameSlice";
import { useSocket } from "@/hooks/useSocket";
import NormalModeGame from "@/components/game/NormalModeGame";
import PerfectScoreGame from "@/components/game/PerfectScoreGame";
import LyricsQuizGame from "@/components/game/LyricsQuizGame";
import KaraokeSongSearch from "@/components/KaraokeSongSearch";
import dynamic from "next/dynamic";

const VideoRoom = dynamic(() => import("@/components/VideoRoom"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-black/50 rounded-xl flex items-center justify-center">
      <span className="text-white/60 text-sm">카메라 로딩 중...</span>
    </div>
  ),
});

const modeConfig = {
  normal: {
    title: "일반 모드",
    icon: Music,
    color: "#C0C0C0",
    Component: NormalModeGame,
  },
  perfect_score: {
    title: "퍼펙트 스코어",
    icon: Target,
    color: "#FFD700",
    Component: PerfectScoreGame,
  },
  lyrics_quiz: {
    title: "가사 맞추기",
    icon: MessageSquareText,
    color: "#FF6B6B",
    Component: LyricsQuizGame,
  },
};

interface TJSong {
  number: string;
  title: string;
  artist: string;
}

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const dispatch = useDispatch();
  const code = params.code as string;
  
  const { status: gameStatus, currentSong, songQueue } = useSelector((state: RootState) => state.game);
  const { participants } = useSelector((state: RootState) => state.room);
  const { emitEvent } = useSocket(code);
  
  const [userName, setUserName] = useState<string>("Guest");
  const [visitorId, setVisitorId] = useState<string>("");

  const [room, setRoomData] = useState<{
    id: string;
    code: string;
    name: string;
    gameMode: "normal" | "perfect_score" | "lyrics_quiz";
    status: string;
    maxParticipants: number;
    hostId: string;
  } | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [showAddSong, setShowAddSong] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const fetchRoom = async () => {
      try {
        const res = await fetch(`/api/rooms/${code}`);
        const data = await res.json();
        
        if (!data.success) {
          setError(data.message || "방을 찾을 수 없습니다.");
          setLoading(false);
          return;
        }
        
        setRoomData(data.data);
        dispatch(setRoom({
          id: data.data.id,
          code: data.data.code,
          name: data.data.name,
          gameMode: data.data.gameMode,
          status: data.data.status,
          maxParticipants: data.data.maxParticipants,
          hostId: data.data.hostId,
        }));
        dispatch(setGameMode(data.data.gameMode));

        setLoading(false);
      } catch {
        setError("서버 연결에 실패했습니다.");
        setLoading(false);
      }
    };

    fetchRoom();
  }, [code, dispatch]);

  useEffect(() => {
    const user = localStorage.getItem("user");
    if (user) {
      const userData = JSON.parse(user);
      setUserName(userData.name || "Guest");
      setVisitorId(userData.id || "");
    }
  }, []);

  // Auto-play next song when current song finishes
  useEffect(() => {
    if (gameStatus === "finished") {
      const nextReady = songQueue.find(s => s.status === "ready");
      if (nextReady) {
        const timer = setTimeout(() => {
          playSong(nextReady);
        }, 2000);
        return () => clearTimeout(timer);
      } else {
        dispatch(setGameStatus("waiting"));
        dispatch(setCurrentSong(null));
      }
    }
  }, [gameStatus, songQueue]);

  const addSongToQueue = async (song: TJSong) => {
    const queueId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    dispatch(addToQueue({
      id: queueId,
      title: song.title,
      artist: song.artist,
      addedBy: userName,
      status: "processing",
      tjNumber: song.number,
    }));
    
    setShowAddSong(false);
    
    try {
      const ytRes = await fetch(`/api/search/youtube?q=${encodeURIComponent(`${song.title} ${song.artist} official audio`)}`);
      const ytData = await ytRes.json();
      
      if (!ytData.success || !ytData.data.length) {
        dispatch(updateQueueItem({ id: queueId, updates: { status: "waiting" } }));
        return;
      }
      
      const video = ytData.data[0];
      
      const res = await fetch("/api/search/youtube/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          videoId: video.videoId, 
          title: song.title, 
          artist: song.artist 
        }),
      });
      
      const data = await res.json();
      
      if (!data.success) {
        dispatch(updateQueueItem({ id: queueId, updates: { status: "waiting" } }));
        return;
      }
      
      const songId = data.data.id;
      dispatch(updateQueueItem({ 
        id: queueId, 
        updates: { id: songId, videoId: video.videoId } 
      }));
      
      pollSongStatus(queueId, songId);
    } catch (e) {
      console.error("Error adding song:", e);
      dispatch(updateQueueItem({ id: queueId, updates: { status: "waiting" } }));
    }
  };

  const pollSongStatus = useCallback(async (queueId: string, songId: string) => {
    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/songs/${songId}/status`);
        const data = await res.json();
        
        if (!data.success) return;
        
        if (data.data.status === "completed") {
          dispatch(updateQueueItem({ id: queueId, updates: { status: "ready" } }));
        } else if (data.data.status === "failed") {
          dispatch(updateQueueItem({ id: queueId, updates: { status: "waiting" } }));
        } else {
          setTimeout(() => checkStatus(), 3000);
        }
      } catch (e) {
        setTimeout(() => checkStatus(), 5000);
      }
    };
    
    checkStatus();
  }, [dispatch]);

  const playSong = async (queueItem: typeof songQueue[0]) => {
    if (queueItem.status !== "ready") return;
    
    try {
      const res = await fetch(`/api/songs/${queueItem.id}`);
      const data = await res.json();
      
      if (!data.success) return;
      
      const song = data.data;
      dispatch(setCurrentSong({
        id: song.id,
        title: song.title,
        artist: song.artist,
        duration: song.duration || 180,
        audioUrl: song.originalUrl,
        instrumentalUrl: song.instrumentalUrl,
        vocalUrl: song.vocalsUrl,
        lyrics: song.lyrics?.map((l: any) => ({
          startTime: l.startTime,
          endTime: l.endTime,
          text: l.text,
        })) || [],
      }));
      
      if (room?.gameMode === "lyrics_quiz") {
        const quizRes = await fetch(`/api/songs/${queueItem.id}/quiz`);
        const quizData = await quizRes.json();
        if (quizData.success && quizData.data.questions) {
          dispatch(setQuizQuestions(quizData.data.questions.map((q: any) => ({
            id: q.id,
            lyrics: q.questionText,
            options: [q.correctAnswer, ...q.wrongAnswers].sort(() => Math.random() - 0.5),
            correctIndex: 0,
            timeLimit: q.timeLimit,
          }))));
        }
      }
      
      dispatch(removeFromQueue(queueItem.id));
      dispatch(setGameStatus("playing"));
      emitEvent("game:start", { roomCode: code, songId: queueItem.id });
    } catch (e) {
      console.error("Error playing song:", e);
    }
  };

  const skipToNext = () => {
    dispatch(setGameStatus("waiting"));
    dispatch(setCurrentSong(null));
    
    const nextReady = songQueue.find(s => s.status === "ready");
    if (nextReady) {
      playSong(nextReady);
    }
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white animate-spin" />
      </div>
    );
  }

  if (error || !room) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white">
        <h1 className="text-2xl font-bold mb-4">😢 {error || "방을 찾을 수 없습니다"}</h1>
        <Link href="/" className="text-gray-400 hover:text-white">
          홈으로 돌아가기
        </Link>
      </div>
    );
  }

  const config = modeConfig[room.gameMode];
  const Icon = config.icon;
  const GameComponent = config.Component;

  if (gameStatus === "playing" && currentSong) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col">
        {/* 상단 대기열 표시 */}
        {songQueue.length > 0 && (
          <div className="bg-gradient-to-r from-purple-900/50 to-blue-900/50 border-b border-white/10 px-4 py-2">
            <div className="flex items-center gap-4 overflow-x-auto">
              <span className="text-xs text-white/60 whitespace-nowrap">다음 곡:</span>
              {songQueue.slice(0, 3).map((song, idx) => (
                <div 
                  key={song.id} 
                  className="flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full text-sm whitespace-nowrap"
                >
                  <span className="text-white/40">{idx + 1}</span>
                  <span className="font-medium">{song.title}</span>
                  <span className="text-white/60">- {song.artist}</span>
                  {song.status === "processing" && (
                    <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
                  )}
                </div>
              ))}
              {songQueue.length > 3 && (
                <span className="text-xs text-white/40">+{songQueue.length - 3}곡</span>
              )}
            </div>
          </div>
        )}

        <header className="flex items-center justify-between p-4 bg-black/50 backdrop-blur-xl border-b border-white/10">
          <button
            onClick={() => {
              dispatch(setGameStatus("waiting"));
              dispatch(setCurrentSong(null));
            }}
            className="flex items-center gap-2 text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>대기실</span>
          </button>
          <div className="flex items-center gap-3">
            <Icon className="w-5 h-5" style={{ color: config.color }} />
            <span className="font-bold">{currentSong.title}</span>
            <span className="text-white/60">- {currentSong.artist}</span>
          </div>
          <div className="flex items-center gap-2">
            {songQueue.length > 0 && (
              <button
                onClick={skipToNext}
                className="flex items-center gap-1 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 text-sm"
              >
                <SkipForward className="w-4 h-4" />
                다음 곡
              </button>
            )}
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/10">
              <Users className="w-4 h-4" />
              <span className="text-sm">{participants.length}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 flex">
          <div className="flex-1">
            <GameComponent />
          </div>
          <div className="w-80 h-full border-l border-white/10 bg-black/30">
            <div className="p-3 border-b border-white/10">
              <h3 className="text-sm font-medium text-white/80">참가자 화면</h3>
            </div>
            <div className="h-[calc(100%-48px)]">
              <VideoRoom
                roomCode={code}
                participantName={userName}
                participantId={visitorId}
              />
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="absolute inset-0 overflow-hidden">
        <div 
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] rounded-full blur-3xl opacity-20"
          style={{ backgroundColor: config.color }}
        />
      </div>

      <header className="relative z-10 flex items-center justify-between p-4 md:p-6">
        <Link href="/lobby" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span>로비</span>
        </Link>
        <div className="flex items-center gap-3">
          <Icon className="w-6 h-6" style={{ color: config.color }} />
          <span className="text-xl font-bold">{room.name}</span>
        </div>
        <button
          onClick={copyCode}
          className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
        >
          {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
          <span className="font-mono font-bold text-sm">{code}</span>
        </button>
      </header>

      <main className="relative z-10 flex gap-6 px-4 md:px-6 pb-6 h-[calc(100vh-80px)]">
        {/* 왼쪽: 대기열 */}
        <div className="w-80 flex flex-col bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-white/10">
            <div className="flex items-center gap-2">
              <ListMusic className="w-5 h-5" style={{ color: config.color }} />
              <span className="font-bold">대기열</span>
              <span className="text-sm text-white/60">({songQueue.length}곡)</span>
            </div>
            <button
              onClick={() => setShowAddSong(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium text-black"
              style={{ backgroundColor: config.color }}
            >
              <Plus className="w-4 h-4" />
              곡 추가
            </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2">
            {songQueue.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-4">
                <Music className="w-12 h-12 text-white/20 mb-3" />
                <p className="text-white/40 text-sm">대기열이 비어있습니다</p>
                <p className="text-white/30 text-xs mt-1">곡을 추가해주세요</p>
              </div>
            ) : (
              <div className="space-y-2">
                {songQueue.map((song, idx) => (
                  <motion.div
                    key={song.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-3 p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors group"
                  >
                    <div 
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold"
                      style={{ backgroundColor: `${config.color}30`, color: config.color }}
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{song.title}</p>
                      <p className="text-sm text-white/60 truncate">{song.artist}</p>
                      <p className="text-xs text-white/40">{song.addedBy}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {song.status === "processing" && (
                        <div className="flex items-center gap-1 text-yellow-400">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-xs">처리중</span>
                        </div>
                      )}
                      {song.status === "ready" && (
                        <button
                          onClick={() => playSong(song)}
                          className="p-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30"
                        >
                          <Play className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => dispatch(removeFromQueue(song.id))}
                        className="p-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 오른쪽: 참가자 & 비디오 */}
        <div className="flex-1 flex flex-col gap-4">
          {/* 참가자 목록 */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-5 h-5" style={{ color: config.color }} />
              <span className="font-bold">참가자</span>
              <span className="text-sm text-white/60">({participants.length}/{room.maxParticipants})</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {participants.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
                    p.isHost ? "bg-yellow-500/20 text-yellow-400" : "bg-white/10"
                  }`}
                >
                  <span>{p.nickname}</span>
                  {p.isHost && <span>👑</span>}
                </div>
              ))}
            </div>
          </div>

          {/* 비디오 영역 */}
          <div className="flex-1 bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
            <div className="p-3 border-b border-white/10">
              <h3 className="text-sm font-medium text-white/80">참가자 화면</h3>
            </div>
            <div className="h-[calc(100%-48px)]">
              <VideoRoom
                roomCode={code}
                participantName={userName}
                participantId={visitorId}
              />
            </div>
          </div>
        </div>
      </main>

      {/* 곡 추가 모달 */}
      <AnimatePresence>
        {showAddSong && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowAddSong(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <h2 className="text-xl font-bold">🎤 곡 추가</h2>
                <button 
                  onClick={() => setShowAddSong(false)}
                  className="p-2 rounded-full hover:bg-white/10"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4 max-h-[70vh] overflow-y-auto">
                <KaraokeSongSearch
                  onSelect={addSongToQueue}
                  isLoading={searching}
                  accentColor={config.color}
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
