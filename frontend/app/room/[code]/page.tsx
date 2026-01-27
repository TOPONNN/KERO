"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { 
  Music, Target, MessageSquareText, ArrowLeft, Users, Copy, Check, 
  Loader2, Play, Plus, X, Disc3, AlertCircle, ListMusic, Trash2, SkipForward,
  Mic, MicOff, Video, CameraOff
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
  
  const backgroundVideos = [
    "CKZvWhCqx1s", // BLACKPINK - Shut Down
    "gdZLi9oWNZg", // BTS - Dynamite
    "ArmDp-zijuc", // aespa - Supernova
    "pC6tPEaAiYU", // NewJeans - Super Shy
    "dZs_cLHfnNA", // LE SSERAFIM - EASY
    "os_hS_gY7p8", // IU - Shopper
    "MjCZfZfucEc", // IVE - Baddie
  ];

  const [bgVideoId] = useState(() => backgroundVideos[Math.floor(Math.random() * backgroundVideos.length)]);

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
  const [mediaStatus, setMediaStatus] = useState({ isCameraOn: true, isMicOn: true });

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
      const ytRes = await fetch(`/api/search/youtube?q=${encodeURIComponent(`${song.title} ${song.artist} official MV`)}`);
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
      const songStatus = data.data.status;
      
      // If song is already completed, set ready immediately without polling
      if (songStatus === "completed") {
        dispatch(updateQueueItem({ 
          id: queueId, 
          updates: { songId, videoId: video.videoId, status: "ready" } 
        }));
      } else if (songStatus === "failed") {
        dispatch(updateQueueItem({ 
          id: queueId, 
          updates: { 
            songId, 
            videoId: video.videoId, 
            status: "failed",
            errorMessage: data.data.message || "처리 중 오류가 발생했습니다"
          } 
        }));
      } else {
        // Song is still processing, start polling
        dispatch(updateQueueItem({ 
          id: queueId, 
          updates: { songId, videoId: video.videoId } 
        }));
        pollSongStatus(queueId, songId);
      }
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
        
        const statusData = data.data;
        
        if (statusData.status === "completed") {
          dispatch(updateQueueItem({ id: queueId, updates: { status: "ready" } }));
        } else if (statusData.status === "failed") {
          dispatch(updateQueueItem({ 
            id: queueId, 
            updates: { 
              status: "failed",
              errorMessage: statusData.message || "처리 중 오류가 발생했습니다"
            } 
          }));
        } else {
          dispatch(updateQueueItem({ 
            id: queueId, 
            updates: { 
              processingStep: statusData.step,
              processingProgress: statusData.progress,
              processingMessage: statusData.message,
            } 
          }));
          setTimeout(() => checkStatus(), 2000);
        }
      } catch (e) {
        setTimeout(() => checkStatus(), 5000);
      }
    };
    
    checkStatus();
  }, [dispatch]);

  const playSong = async (queueItem: typeof songQueue[0]) => {
    if (queueItem.status !== "ready" || !queueItem.songId) return;
    
    try {
      const res = await fetch(`/api/songs/${queueItem.songId}`);
      const data = await res.json();
      
      if (!data.success) return;
      
      const song = data.data;
      dispatch(setCurrentSong({
        id: song.id,
        title: song.title,
        artist: song.artist,
        duration: song.duration || 0,
        audioUrl: song.originalUrl,
        instrumentalUrl: song.instrumentalUrl,
        vocalUrl: song.vocalsUrl,
        videoId: queueItem.videoId,
        lyrics: song.lyrics?.map((l: any) => ({
          startTime: l.startTime ?? l.start_time,
          endTime: l.endTime ?? l.end_time,
          text: l.text,
          words: l.words?.map((w: any) => ({
            startTime: w.startTime ?? w.start_time,
            endTime: w.endTime ?? w.end_time,
            text: w.text,
          })),
        })) || [],
      }));
      
      if (room?.gameMode === "lyrics_quiz") {
        const quizRes = await fetch(`/api/songs/${queueItem.songId}/quiz`);
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
      emitEvent("game:start", { roomCode: code, songId: queueItem.songId });
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

  const handleCameraToggle = () => {
    window.dispatchEvent(new Event("kero:toggleCamera"));
    setMediaStatus(prev => ({ ...prev, isCameraOn: !prev.isCameraOn }));
  };

  const handleMicToggle = () => {
    window.dispatchEvent(new Event("kero:toggleMic"));
    setMediaStatus(prev => ({ ...prev, isMicOn: !prev.isMicOn }));
  };

  if (gameStatus === "playing" && currentSong) {
    return (
      <div className="fixed inset-0 bg-black text-white">
        <GameComponent />
        
        <div className="absolute top-4 left-4 z-50">
          <button
            onClick={() => {
              dispatch(setGameStatus("waiting"));
              dispatch(setCurrentSong(null));
            }}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/50 backdrop-blur-md text-white/80 hover:text-white hover:bg-black/70 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>대기실</span>
          </button>
        </div>

        <div className="absolute top-4 right-4 w-48 h-36 rounded-xl overflow-hidden border border-white/20 shadow-2xl z-50">
          <VideoRoom
            roomCode={code}
            participantName={userName}
            participantId={visitorId}
            hideControls={true}
            onStatusChange={setMediaStatus}
          />
        </div>

        <div className="absolute bottom-6 left-6 z-50 flex items-center gap-3">
          <button
            onClick={handleMicToggle}
            className={`p-3 rounded-full backdrop-blur-md transition-all ${
              mediaStatus.isMicOn 
                ? "bg-white/20 hover:bg-white/30 text-white" 
                : "bg-red-500/80 hover:bg-red-500 text-white"
            }`}
            title={mediaStatus.isMicOn ? "마이크 끄기" : "마이크 켜기"}
          >
            {mediaStatus.isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>
          
          <button
            onClick={handleCameraToggle}
            className={`p-3 rounded-full backdrop-blur-md transition-all ${
              mediaStatus.isCameraOn 
                ? "bg-white/20 hover:bg-white/30 text-white" 
                : "bg-red-500/80 hover:bg-red-500 text-white"
            }`}
            title={mediaStatus.isCameraOn ? "카메라 끄기" : "카메라 켜기"}
          >
            {mediaStatus.isCameraOn ? <Video className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white overflow-hidden relative">
      {/* 배경 뮤비 (YouTube Embed) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <iframe
          src={`https://www.youtube.com/embed/${bgVideoId}?autoplay=1&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${bgVideoId}&modestbranding=1&enablejsapi=1&origin=${typeof window !== 'undefined' ? window.location.origin : ''}`}
          className="absolute top-1/2 left-1/2 w-[150%] h-[150%] -translate-x-1/2 -translate-y-1/2 opacity-60"
          allow="autoplay; encrypted-media"
          title="Background Video"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black/90" />
      </div>

      {/* 상단 헤더 */}
      <header className="relative z-20 flex items-center justify-between p-4 bg-black/30 backdrop-blur-md border-b border-white/5">
        <Link href="/lobby" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors">
          <ArrowLeft className="w-5 h-5" />
          <span>로비</span>
        </Link>
        <div className="flex items-center gap-3">
          <Icon className="w-6 h-6" style={{ color: config.color }} />
          <span className="text-xl font-bold">{room.name}</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 border border-white/5">
            <Users className="w-4 h-4 text-white/70" />
            <span className="text-sm font-medium">{participants.length}명</span>
          </div>
          <button
            onClick={copyCode}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors border border-white/5"
          >
            {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
            <span className="font-mono font-bold text-sm">{code}</span>
          </button>
        </div>
      </header>

      {/* 메인: 중앙 대기열 카드 */}
      <main className="relative z-10 flex items-center justify-center min-h-[calc(100vh-80px)] p-4">
        <div className="w-full max-w-2xl bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-2xl ring-1 ring-white/5">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <ListMusic className="w-6 h-6" style={{ color: config.color }} />
              <h2 className="text-xl font-bold">대기열</h2>
              <span className="text-sm text-white/60 bg-white/10 px-2 py-0.5 rounded-full">{songQueue.length}곡</span>
            </div>
            <button
              onClick={() => setShowAddSong(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-black hover:opacity-90 transition-opacity shadow-lg shadow-white/5"
              style={{ backgroundColor: config.color }}
            >
              <Plus className="w-5 h-5" />
              곡 추가
            </button>
          </div>
          
          {songQueue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center mb-4 ring-1 ring-white/5">
                <Music className="w-10 h-10 text-white/20" />
              </div>
              <p className="text-white/60 text-lg mb-2">대기열이 비어있습니다</p>
              <p className="text-white/40 text-sm mb-6">좋아하는 노래를 예약해보세요!</p>
              <button
                onClick={() => setShowAddSong(true)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-medium text-black hover:opacity-90 transition-opacity shadow-lg"
                style={{ backgroundColor: config.color }}
              >
                <Plus className="w-5 h-5" />
                첫 곡 추가하기
              </button>
            </div>
          ) : (
            <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2">
              {songQueue.map((song, idx) => (
                <motion.div
                  key={song.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="flex items-center gap-4 p-4 bg-white/5 rounded-xl hover:bg-white/10 transition-colors group border border-white/5 ring-1 ring-white/5"
                >
                  <div 
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
                    style={{ backgroundColor: `${config.color}20`, color: config.color }}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-lg truncate text-white/90">{song.title}</p>
                    <p className="text-sm text-white/50 truncate">{song.artist}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {song.status === "processing" && (
                      <div className="flex flex-col gap-1.5 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-yellow-400" />
                          <span className="text-xs text-yellow-400 font-medium">
                            {song.processingStep === "download" && "다운로드 중"}
                            {song.processingStep === "demucs" && "음원 분리"}
                            {song.processingStep === "whisper" && "가사 추출"}
                            {song.processingStep === "crepe" && "음정 분석"}
                            {!song.processingStep && "처리 대기"}
                          </span>
                        </div>
                        {song.processingProgress !== undefined && (
                          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 transition-all duration-300"
                              style={{ width: `${song.processingProgress}%` }}
                            />
                          </div>
                        )}
                        {song.processingProgress !== undefined && (
                          <span className="text-[10px] text-white/40 text-right">
                            {song.processingProgress}%
                          </span>
                        )}
                      </div>
                    )}
                    {song.status === "failed" && (
                      <div className="flex flex-col gap-1 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-red-400 font-medium">
                            ❌ 처리 실패
                          </span>
                        </div>
                        {song.errorMessage && (
                          <span className="text-[10px] text-red-400/70 truncate max-w-[140px]" title={song.errorMessage}>
                            {song.errorMessage}
                          </span>
                        )}
                      </div>
                    )}
                    {song.status === "ready" && (
                      <button
                        onClick={() => playSong(song)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 font-medium transition-colors"
                      >
                        <Play className="w-4 h-4" />
                        <span className="text-sm hidden sm:inline">재생</span>
                      </button>
                    )}
                    <button
                      onClick={() => dispatch(removeFromQueue(song.id))}
                      className="p-2 rounded-lg bg-white/5 text-white/40 hover:bg-red-500/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* 곡 추가 모달 (기존 유지) */}
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
              className="w-full max-w-2xl bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b border-white/10">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <span className="text-2xl">🎤</span> 곡 검색
                </h2>
                <button 
                  onClick={() => setShowAddSong(false)}
                  className="p-2 rounded-full hover:bg-white/10 transition-colors"
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
