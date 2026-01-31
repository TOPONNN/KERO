"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { 
  Music, Target, MessageSquareText, Swords, ArrowLeft, Users, Copy, Check, 
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
import BattleModeGame from "@/components/game/BattleModeGame";
import DuetModeGame from "@/components/game/DuetModeGame";
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
     title: "노래 퀴즈",
     icon: MessageSquareText,
     color: "#FF6B6B",
     Component: LyricsQuizGame,
   },
  battle: {
    title: "배틀 모드",
    icon: Swords,
    color: "#FF4500",
    Component: BattleModeGame,
  },
  duet: {
    title: "듀엣 모드",
    icon: Users,
    color: "#9B59B6",
    Component: DuetModeGame,
  },
};

interface TJSong {
  number: string;
  title: string;
  artist: string;
  composer?: string;
  lyricist?: string;
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
   
   const [bgVideoId, setBgVideoId] = useState<string | null>(null);
   useEffect(() => {
     const fetchRandomMV = async () => {
       try {
         const res = await fetch("/api/songs/random-mv");
         const data = await res.json();
         if (data.success && data.data?.videoId) {
           setBgVideoId(data.data.videoId);
         } else {
           setBgVideoId("gdZLi9oWNZg");
         }
       } catch {
         setBgVideoId("gdZLi9oWNZg");
       }
     };
     fetchRandomMV();
   }, []);

   const [bgMounted, setBgMounted] = useState(false);

  const [room, setRoomData] = useState<{
    id: string;
    code: string;
    name: string;
    gameMode: "normal" | "perfect_score" | "lyrics_quiz" | "battle" | "duet";
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
   const [isQuizLoading, setIsQuizLoading] = useState(false);

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

  // 클라이언트 마운트 후에만 배경 뮤비 렌더링 (SSR hydration 불일치 방지)
  useEffect(() => {
    setBgMounted(true);
  }, []);

  // Listen for skip forward event from game components
  useEffect(() => {
    const handleSkipForward = () => skipToNext();
    window.addEventListener("kero:skipForward", handleSkipForward);
    return () => window.removeEventListener("kero:skipForward", handleSkipForward);
  }, []);

   // Clear quiz loading state when game starts
   useEffect(() => {
     if (gameStatus === "playing") {
       setIsQuizLoading(false);
     }
   }, [gameStatus]);

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
     
     const queueSong = {
       id: queueId,
       title: song.title,
       artist: song.artist,
       addedBy: userName,
       status: "processing" as const,
       tjNumber: song.number,
       composer: song.composer,
       lyricist: song.lyricist,
     };
     
     dispatch(addToQueue(queueSong));
     
     // 다른 플레이어에게 대기열 추가 브로드캐스트
     emitEvent("queue:add", { roomCode: code, song: queueSong });
     
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
      const songStatus = data.data.processingStatus || data.data.status;
      
       if (songStatus === "completed") {
         dispatch(updateQueueItem({ 
           id: queueId, 
           updates: { songId, videoId: video.videoId, status: "ready" } 
         }));
         emitEvent("queue:update", { roomCode: code, songId: queueId, updates: { songId, videoId: video.videoId, status: "ready" } });
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
         emitEvent("queue:update", { roomCode: code, songId: queueId, updates: { songId, videoId: video.videoId, status: "failed", errorMessage: data.data.message || "처리 중 오류가 발생했습니다" } });
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
     let retryCount = 0;
     const maxRetries = 30;
     
     const checkStatus = async () => {
       try {
         const res = await fetch(`/api/songs/${songId}/status`);
         const data = await res.json();
         
         if (!data.success) {
           // Retry on API error instead of silently stopping
           if (retryCount < maxRetries) {
             retryCount++;
             setTimeout(() => checkStatus(), 5000);
           }
           return;
         }
         
         // Reset retry count on successful API response
         retryCount = 0;
         
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
         if (retryCount < maxRetries) {
           retryCount++;
           setTimeout(() => checkStatus(), 5000);
         }
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
        composer: queueItem.composer,
        lyricist: queueItem.lyricist,
        lyrics: song.lyrics?.map((l: any) => ({
          startTime: l.startTime ?? l.start_time,
          endTime: l.endTime ?? l.end_time,
          text: l.text,
           words: l.words?.map((w: any) => ({
             startTime: w.startTime ?? w.start_time,
             endTime: w.endTime ?? w.end_time,
             text: w.text,
             energy: w.energy,
             energyCurve: w.energyCurve ?? w.energy_curve,
             pitch: w.pitch,
             note: w.note,
             midi: w.midi,
             voiced: w.voiced,
           })),
        })) || [],
      }));
      
       if (room?.gameMode === "lyrics_quiz") {
         // Get all ready songs in queue for mixed quiz generation
         const readySongIds = songQueue
           .filter(s => s.status === "ready" && s.songId)
           .map(s => s.songId as string);
         const allSongIds = [queueItem.songId, ...readySongIds.filter(id => id !== queueItem.songId)];
         
          const quizRes = await fetch(`/api/songs/quiz/generate?songIds=${allSongIds.join(",")}&count=30`);
         const quizData = await quizRes.json();
         if (quizData.success && quizData.data.questions) {
           dispatch(setQuizQuestions(quizData.data.questions.map((q: any, idx: number) => {
             const options = q.wrongAnswers && q.wrongAnswers.length > 0
               ? [q.correctAnswer, ...q.wrongAnswers].sort(() => Math.random() - 0.5)
               : undefined;
             const correctIndex = options ? options.indexOf(q.correctAnswer) : undefined;
             
             return {
               id: q.id || String(idx),
               type: q.type || "lyrics_fill",
               questionText: q.questionText,
               options,
               correctIndex,
               correctAnswer: q.correctAnswer,
               timeLimit: q.timeLimit || 10,
               metadata: q.metadata,
               lines: q.type === "lyrics_order" && q.wrongAnswers
                 ? q.wrongAnswers.map((text: string, i: number) => ({ idx: i, text })).sort(() => Math.random() - 0.5)
                 : undefined,
             };
           })));
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

    const startQuiz = async () => {
      setIsQuizLoading(true);
      try {
         const res = await fetch(`/api/songs/quiz/generate?count=30`);
        const data = await res.json();
        
        if (!data.success || !data.data?.questions) {
          console.error("퀴즈 생성 실패:", data.message);
          return;
        }
        
        const questions = data.data.questions.map((q: any, idx: number) => {
          const options = q.wrongAnswers && q.wrongAnswers.length > 0
            ? [q.correctAnswer, ...q.wrongAnswers].sort(() => Math.random() - 0.5)
            : undefined;
          const correctIndex = options ? options.indexOf(q.correctAnswer) : undefined;
          
          return {
            id: q.id || String(idx),
            type: q.type || "lyrics_fill",
            questionText: q.questionText,
            options,
            correctIndex,
            correctAnswer: q.correctAnswer,
            timeLimit: q.timeLimit || 10,
            metadata: q.metadata,
            lines: q.type === "lyrics_order" && q.wrongAnswers
              ? q.wrongAnswers.map((text: string, i: number) => ({ idx: i, text })).sort(() => Math.random() - 0.5)
              : undefined,
          };
        });
        
        dispatch(setQuizQuestions(questions));
        dispatch(setGameStatus("playing"));
        
        // 다른 플레이어에게도 브로드캐스트
        emitEvent("quiz:broadcast-questions", { roomCode: code, questions });
      } catch (error) {
        console.error("퀴즈 시작 오류:", error);
      } finally {
        setIsQuizLoading(false);
      }
    };

  if (gameStatus === "playing" && (currentSong || room?.gameMode === "lyrics_quiz")) {
    return (
      <div className="fixed inset-0 bg-black text-white">
        <GameComponent />
        
        {/* Top-left: small back button - compact, doesn't block quiz content */}
        <button
          onClick={() => {
            dispatch(setGameStatus("waiting"));
            dispatch(setCurrentSong(null));
          }}
          className="absolute top-3 left-3 z-50 p-2.5 rounded-full bg-black/50 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/70 transition-all"
          title="대기실로 돌아가기"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <div className="absolute top-3 right-2 z-40 w-48 flex flex-col rounded-2xl overflow-hidden border border-white/10 shadow-2xl bg-black/40 backdrop-blur-md max-h-[70vh]">
          <div className="w-full">
            <VideoRoom
              roomCode={code}
              participantName={userName}
              participantId={visitorId}
              hideControls={true}
              onStatusChange={setMediaStatus}
            />
          </div>
          <div className="flex items-center justify-center gap-2 py-1.5 px-2 border-t border-white/10 bg-black/30">
            <button 
              onClick={handleMicToggle} 
              className={`p-1.5 rounded-full transition-all ${
                mediaStatus.isMicOn 
                  ? "text-white/70 hover:text-white hover:bg-white/10" 
                  : "bg-red-500/80 text-white"
              }`}
              title={mediaStatus.isMicOn ? "마이크 끄기" : "마이크 켜기"}
            >
              {mediaStatus.isMicOn ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
            </button>
            <button 
              onClick={handleCameraToggle} 
              className={`p-1.5 rounded-full transition-all ${
                mediaStatus.isCameraOn 
                  ? "text-white/70 hover:text-white hover:bg-white/10" 
                  : "bg-red-500/80 text-white"
              }`}
              title={mediaStatus.isCameraOn ? "카메라 끄기" : "카메라 켜기"}
            >
              {mediaStatus.isCameraOn ? <Video className="w-3.5 h-3.5" /> : <CameraOff className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const avatarGradients = [
    'from-purple-500 to-pink-500',
    'from-blue-500 to-cyan-500', 
    'from-green-500 to-emerald-500',
    'from-orange-500 to-red-500',
    'from-indigo-500 to-purple-500',
    'from-pink-500 to-rose-500',
    'from-teal-500 to-green-500',
    'from-yellow-500 to-orange-500',
  ];

  const renderParticipants = (maxWidthClass = "max-w-lg") => (
    participants.length > 0 && (
      <div className={`w-full ${maxWidthClass} bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl ring-1 ring-white/5`}>
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-white/70" />
          <span className="font-bold text-white/80">참가자</span>
          <span className="text-xs bg-white/10 text-white/60 px-2 py-0.5 rounded-full">{participants.length}명</span>
        </div>
        <div className="space-y-2">
          {participants.map((p: any, idx: number) => (
            <motion.div 
              key={p.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
            >
              {p.profileImage ? (
                <img 
                  src={p.profileImage} 
                  alt={p.nickname} 
                  className="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-white/20"
                />
              ) : (
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarGradients[idx % avatarGradients.length]} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
                  {p.nickname?.charAt(0) || '?'}
                </div>
              )}
              <span className="text-white font-medium truncate">{p.nickname}</span>
              {p.isHost && (
                <span className="text-[10px] font-bold bg-[#FFD700]/20 text-[#FFD700] px-2 py-0.5 rounded-full shrink-0">HOST</span>
              )}
              <div className="ml-auto w-2 h-2 rounded-full bg-green-400 shrink-0 shadow-[0_0_8px_rgba(74,222,128,0.5)]" />
            </motion.div>
          ))}
        </div>
      </div>
    )
  );

   return (
     <div className="min-h-screen bg-black text-white overflow-hidden relative">
       {/* 배경 뮤비 */}
       {bgMounted && bgVideoId && (
         <div className="fixed inset-0 z-0 pointer-events-none">
           <iframe
             src={`https://www.youtube.com/embed/${bgVideoId}?autoplay=1&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${bgVideoId}&modestbranding=1&playsinline=1`}
             className="absolute top-1/2 left-1/2 w-[150%] h-[150%] -translate-x-1/2 -translate-y-1/2 opacity-60"
             allow="autoplay; encrypted-media"
             title="Background Video"
           />
           <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/60 to-black/90" />
         </div>
       )}

      {/* 상단 헤더 */}
      <header className="relative z-20 flex items-center justify-between px-4 py-3 md:p-6 bg-black/30 backdrop-blur-md border-b border-white/5">
        <Link href="/lobby" className="flex items-center gap-2 text-white/60 hover:text-white transition-colors shrink-0">
          <div className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </div>
          <span className="hidden md:inline font-medium">로비</span>
        </Link>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3 max-w-[40%] md:max-w-[50%]">
          <div 
            className="p-1.5 rounded-lg shrink-0 hidden md:block"
            style={{ backgroundColor: config.color }}
          >
            <Icon className="w-4 h-4 text-black" />
          </div>
          <span className="text-lg md:text-xl font-bold truncate text-center">{room.name}</span>
          <div 
            className="w-2 h-2 rounded-full shrink-0 md:hidden"
            style={{ backgroundColor: config.color }}
          />
        </div>

        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 border border-white/5 backdrop-blur-md">
            <Users className="w-3.5 h-3.5 text-white/70" />
            <span className="text-sm font-medium">{participants.length}</span>
          </div>
          <button
            onClick={copyCode}
            className="flex items-center gap-2 px-3 md:px-4 py-1.5 md:py-2 rounded-full bg-white/10 hover:bg-white/20 transition-all border border-white/5 active:scale-95 backdrop-blur-md"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="font-mono font-bold text-sm tracking-wider">{code}</span>
          </button>
        </div>
      </header>

      {room?.gameMode === "lyrics_quiz" ? (
        <main className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-4 gap-4">
          <div className="w-full max-w-lg bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl ring-1 ring-white/5 text-center">
            <div className="w-20 h-20 rounded-2xl bg-[#FF6B6B]/20 flex items-center justify-center mx-auto mb-6">
              <MessageSquareText className="w-10 h-10 text-[#FF6B6B]" />
            </div>
            <h2 className="text-3xl font-bold mb-3">노래 퀴즈</h2>
            <p className="text-gray-400 mb-8">6가지 퀴즈 유형으로 노래 실력을 겨뤄보세요!</p>
             <button
               onClick={startQuiz}
               disabled={isQuizLoading}
               className="w-full py-4 rounded-xl bg-[#FF6B6B] text-black font-bold text-xl hover:bg-[#FF5252] transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
             >
               {isQuizLoading ? (
                 <>
                   <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-black"></div>
                   퀴즈 생성 중...
                 </>
               ) : (
                 "퀴즈 시작"
               )}
             </button>
          </div>
          {renderParticipants()}
        </main>
      ) : (
        <main className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-4 gap-4">
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
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div 
                  className="relative mb-8 group cursor-pointer" 
                  onClick={() => setShowAddSong(true)}
                >
                  <div 
                    className="absolute inset-0 rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity duration-500"
                    style={{ backgroundColor: config.color }} 
                  />
                  <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform duration-300 ring-1 ring-white/5 group-hover:ring-white/20">
                    <Plus className="w-10 h-10 text-white/40 group-hover:text-white transition-colors" />
                  </div>
                </div>
                <h3 className="text-xl font-bold text-white mb-2">대기열이 비었습니다</h3>
                <p className="text-gray-400 text-sm mb-8 leading-relaxed">
                  지금 바로 노래를 예약하고<br/>무대의 주인공이 되어보세요!
                </p>
                <button
                  onClick={() => setShowAddSong(true)}
                  className="flex items-center gap-2 px-8 py-3 rounded-full font-bold text-black hover:scale-105 active:scale-95 transition-all shadow-lg shadow-white/5"
                  style={{ backgroundColor: config.color }}
                >
                  <Music className="w-5 h-5" />
                  첫 곡 예약하기
                </button>
              </div>
            ) : (
              <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                {songQueue.map((song, idx) => (
                  <motion.div
                    key={song.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                    className="group relative flex items-center gap-4 p-4 bg-black/40 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-2xl transition-all duration-300 backdrop-blur-sm"
                  >
                    <div 
                      className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold shrink-0 shadow-lg"
                      style={{ backgroundColor: `${config.color}20`, color: config.color }}
                    >
                      {idx + 1}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="font-bold text-lg truncate text-white/90 group-hover:text-white transition-colors">{song.title}</p>
                        {idx === 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-white/10 text-[10px] font-bold text-white/60 border border-white/5">
                            NEXT
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-white/50 truncate flex items-center gap-2">
                        <span>{song.artist}</span>
                        <span className="w-1 h-1 rounded-full bg-white/20" />
                        <span className="text-white/30">예약: {song.addedBy}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {song.status === "processing" && (
                        <div className="flex flex-col gap-1.5 min-w-[140px] p-3 rounded-xl bg-black/20 border border-white/5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-400" />
                              <span className="text-xs text-yellow-400 font-bold">
                                {song.processingStep === "download" && "다운로드"}
                                {song.processingStep === "demucs" && "음원 분리"}
                                {song.processingStep === "whisper" && "자막 생성"}
                                {song.processingStep === "crepe" && "음정 분석"}
                                {!song.processingStep && "준비 중"}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-white/40">
                              {song.processingProgress || 0}%
                            </span>
                          </div>
                          <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-yellow-400 to-orange-400 transition-all duration-300"
                              style={{ width: `${song.processingProgress || 0}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {song.status === "failed" && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                          <AlertCircle className="w-4 h-4 text-red-400" />
                          <span className="text-xs font-bold text-red-400">실패</span>
                        </div>
                      )}

                      {song.status === "ready" && (
                        <button
                          onClick={() => playSong(song)}
                          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-green-500 text-black font-bold hover:scale-105 active:scale-95 transition-all shadow-lg shadow-green-500/20"
                        >
                          <Play className="w-4 h-4 fill-current" />
                          <span className="text-sm hidden sm:inline">시작</span>
                        </button>
                      )}

                      <button
                        onClick={() => {
                          dispatch(removeFromQueue(song.id));
                          emitEvent("queue:remove", { roomCode: code, songId: song.id });
                        }}
                        className="p-2.5 rounded-xl text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
          {renderParticipants("max-w-2xl")}
        </main>
      )}

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
