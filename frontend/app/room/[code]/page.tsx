"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { 
  Music, Target, MessageSquareText, ArrowLeft, Users, Copy, Check, 
  Loader2, Play, Pause, Plus, X, Disc3, AlertCircle, ListMusic, Trash2, SkipForward,
  Mic, MicOff, Video, CameraOff, Volume2, VolumeX
} from "lucide-react";
import type { RootState } from "@/store";
import { setRoom } from "@/store/slices/roomSlice";
import { 
  setGameMode, setGameStatus, setCurrentSong, setQuizQuestions,
  addToQueue, removeFromQueue, updateQueueItem, playNextInQueue, resetQuiz, resetGame
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
     title: "노래 퀴즈",
     icon: MessageSquareText,
     color: "#FF6B6B",
     Component: LyricsQuizGame,
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
  
  const [userName, setUserName] = useState<string>("Guest");
  const [visitorId, setVisitorId] = useState<string>("");
  const [nicknameReady, setNicknameReady] = useState(false);
  const [showNicknameModal, setShowNicknameModal] = useState(false);
  const [nicknameInput, setNicknameInput] = useState("");

  const { status: gameStatus, currentSong, songQueue, currentTime } = useSelector((state: RootState) => state.game);
  const { participants } = useSelector((state: RootState) => state.room);
  const { emitEvent } = useSocket(nicknameReady ? code : null);
   
    const [bgVideoId, setBgVideoId] = useState<string | null>(null);
    const [bgVideoLoaded, setBgVideoLoaded] = useState(false);
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
   const [isQuizLoading, setIsQuizLoading] = useState(false);
   const [quizCount, setQuizCount] = useState(30);
   const [quizCategory, setQuizCategory] = useState<"KOR" | "JPN" | "ENG">("KOR");
   const [volume, setVolume] = useState(1.0);
   const [isPlaying, setIsPlaying] = useState(false);

   const isHost = participants.some(p => p.nickname === userName && p.isHost);

   const mountedRef = useRef(true);
   const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

   useEffect(() => {
    dispatch(resetGame());
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
    let profileName = "Guest";
    if (user) {
      const userData = JSON.parse(user);
      profileName = userData.name || "Guest";
      setVisitorId(userData.id || "");
    }

    const savedNickname = sessionStorage.getItem("roomNickname");
    if (savedNickname) {
      setUserName(savedNickname);
      setNicknameReady(true);
    } else {
      setNicknameInput(profileName);
      setUserName(profileName);
      setShowNicknameModal(true);
    }
  }, []);

   // 클라이언트 마운트 후에만 배경 뮤비 렌더링 (SSR hydration 불일치 방지)
   useEffect(() => {
     setBgMounted(true);
   }, []);

   // Cleanup polling on unmount
   useEffect(() => {
     return () => {
       mountedRef.current = false;
       if (pollTimeoutRef.current) {
         clearTimeout(pollTimeoutRef.current);
       }
     };
   }, []);

   // Listen for skip forward event from game components
  useEffect(() => {
    const handleSkipForward = () => skipToNext();
    window.addEventListener("kero:skipForward", handleSkipForward);
    return () => window.removeEventListener("kero:skipForward", handleSkipForward);
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      if (isHost) return;
      const customEvent = event as CustomEvent<{ quizCount: number; quizCategory: string }>;
      const nextCategory = customEvent.detail.quizCategory;
      if (nextCategory === "KOR" || nextCategory === "JPN" || nextCategory === "ENG") {
        setQuizCategory(nextCategory);
      }
      setQuizCount(customEvent.detail.quizCount);
    };

    window.addEventListener("kero:quizSettingsUpdated", handler);
    return () => window.removeEventListener("kero:quizSettingsUpdated", handler);
  }, [isHost]);

   // Clear quiz loading state when game starts
   useEffect(() => {
     if (gameStatus === "playing") {
       setIsQuizLoading(false);
       setIsPlaying(true);
     } else {
       setIsPlaying(false);
     }
   }, [gameStatus]);

   const formatTime = (time: number) => {
     const mins = Math.floor(time / 60);
     const secs = Math.floor(time % 60);
     return `${mins}:${secs.toString().padStart(2, "0")}`;
   };

   const handlePlayPause = () => {
     setIsPlaying(!isPlaying);
     window.dispatchEvent(new Event("kero:togglePlay"));
   };

   const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
     const v = parseFloat(e.target.value);
     setVolume(v);
     window.dispatchEvent(new CustomEvent("kero:setVolume", { detail: { volume: v } }));
   };

   const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
     if (!currentSong) return;
     const rect = e.currentTarget.getBoundingClientRect();
     const percent = (e.clientX - rect.left) / rect.width;
     window.dispatchEvent(new CustomEvent("kero:seek", { detail: { progress: percent } }));
   };

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
        if (!mountedRef.current) return;
        
        try {
          const res = await fetch(`/api/songs/${songId}/status`);
          const data = await res.json();
          
          if (!data.success) {
            // Retry on API error instead of silently stopping
            if (retryCount < maxRetries && mountedRef.current) {
              retryCount++;
              pollTimeoutRef.current = setTimeout(() => checkStatus(), 5000);
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
            if (mountedRef.current) {
              pollTimeoutRef.current = setTimeout(() => checkStatus(), 2000);
            }
          }
        } catch (e) {
          if (retryCount < maxRetries && mountedRef.current) {
            retryCount++;
            pollTimeoutRef.current = setTimeout(() => checkStatus(), 5000);
          }
        }
      };
      
      checkStatus();
    }, [dispatch, mountedRef, pollTimeoutRef]);

  const playSong = async (queueItem: typeof songQueue[0]) => {
    console.log("[playSong] Called with:", queueItem);
    if (queueItem.status !== "ready" || !queueItem.songId) {
      console.log("[playSong] Early return - status:", queueItem.status, "songId:", queueItem.songId);
      return;
    }
    
    try {
      const res = await fetch(`/api/songs/${queueItem.songId}`);
      const data = await res.json();
      
      if (!data.success) return;
      
      const song = data.data;
      const songData = {
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
             
           })),
        })) || [],
      };
      
       if (room?.gameMode === "lyrics_quiz") {
         // Get all ready songs in queue for mixed quiz generation
         const readySongIds = songQueue
           .filter(s => s.status === "ready" && s.songId)
           .map(s => s.songId as string);
         const allSongIds = [queueItem.songId, ...readySongIds.filter(id => id !== queueItem.songId)];
         
          const quizRes = await fetch(`/api/songs/quiz/generate?songIds=${allSongIds.join(",")}&count=${quizCount}`);
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
      
      console.log("[playSong] Emitting game:start with songData:", songData);
      emitEvent("game:start", { roomCode: code, songId: queueItem.songId, songData, queueItemId: queueItem.id });
    } catch (e) {
      console.error("[playSong] Error:", e);
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

  const confirmNickname = () => {
    const name = nicknameInput.trim() || "Guest";
    sessionStorage.setItem("roomNickname", name);
    setUserName(name);
    setNicknameReady(true);
    setShowNicknameModal(false);
  };

  if (showNicknameModal) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl ring-1 ring-white/5 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mx-auto mb-6">
            <Users className="w-8 h-8 text-white/70" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">닉네임 설정</h2>
          <p className="text-sm text-gray-400 mb-6">이 방에서 사용할 닉네임을 입력하세요</p>
          <input
            type="text"
            value={nicknameInput}
            onChange={(e) => setNicknameInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") confirmNickname(); }}
            placeholder="닉네임"
            autoFocus
            className="w-full px-4 py-3 mb-4 bg-white/5 border border-white/10 rounded-xl text-white text-center text-lg font-medium focus:outline-none focus:border-white/30 focus:bg-white/10 transition-colors placeholder:text-gray-500"
          />
          <button
            onClick={confirmNickname}
            disabled={!nicknameInput.trim()}
            className="w-full py-3 rounded-xl font-bold text-black bg-white hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-lg"
          >
            입장
          </button>
        </div>
      </div>
    );
  }

    const startQuiz = async () => {
      dispatch(resetQuiz());
      setIsQuizLoading(true);
      try {
         const res = await fetch(`/api/songs/quiz/generate?count=${quizCount}&category=${quizCategory}`);
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
        
        emitEvent("quiz:broadcast-questions", { roomCode: code, questions, category: quizCategory });
      } catch (error) {
        console.error("퀴즈 시작 오류:", error);
      } finally {
        setIsQuizLoading(false);
      }
    };

  if (gameStatus === "playing" && room?.gameMode === "lyrics_quiz") {
    return (
      <div className="fixed inset-0 bg-black text-white">
        <GameComponent
          onBack={() => {
            dispatch(resetQuiz());
            dispatch(setGameStatus("waiting"));
            dispatch(setCurrentSong(null));
          }}
          onMicToggle={handleMicToggle}
          onCameraToggle={handleCameraToggle}
          mediaStatus={mediaStatus}
          quizCount={quizCount}
          quizCategory={quizCategory}
          cameraElement={
            <VideoRoom
              roomCode={code}
              participantName={userName}
              participantId={visitorId}
              hideControls={true}
              layout="column"
              onStatusChange={setMediaStatus}
            />
          }
        />
      </div>
    );
  }

  if (gameStatus === "playing" && currentSong) {
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

        <button
          onClick={() => setShowAddSong(true)}
          className="absolute top-6 right-6 z-50 p-4 rounded-full text-black shadow-lg shadow-black/20 hover:scale-110 active:scale-95 transition-all group"
          style={{ backgroundColor: config.color }}
          title="노래 예약하기"
        >
          <Plus className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
        </button>

        {/* Song Info Bar (Top-Center) */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30">
          {currentSong && (
            <div className="flex items-center gap-3 px-5 py-3 bg-black/80 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl">
              <div className="flex items-center gap-1.5 bg-white text-black px-3 py-1 rounded-lg">
                <Music className="w-3.5 h-3.5" />
                <span className="text-xs font-bold">현재곡</span>
              </div>
              <span className="text-lg font-bold text-white">{currentSong.title}</span>
              <span className="text-base font-medium text-lime-400">{currentSong.artist}</span>
              {songQueue.length > 0 && (
                <>
                  <div className="w-px h-6 bg-white/20" />
                  <span className="text-xs text-white/50">다음:</span>
                  <span className="text-sm text-white/70 max-w-[100px] truncate">{songQueue[0].title}</span>
                </>
              )}
            </div>
          )}
          
          {!currentSong && songQueue.length > 0 && (
            <div className="flex items-center gap-3 px-5 py-3 bg-black/80 backdrop-blur-md rounded-2xl border border-white/10 shadow-2xl">
              <div className="flex items-center gap-1.5 bg-yellow-400 text-black px-3 py-1 rounded-lg">
                <span className="text-xs font-bold">다음곡</span>
              </div>
              <span className="text-lg font-bold text-white">{songQueue[0].title}</span>
              <span className="text-base font-medium text-white/60">{songQueue[0].artist}</span>
            </div>
          )}
        </div>

        {/* Camera Stack (Right Side) */}
        <div className="absolute right-5 top-1/2 -translate-y-1/2 z-30 flex flex-col justify-center h-[70vh] pointer-events-auto">
          <VideoRoom
            roomCode={code}
            participantName={userName}
            participantId={visitorId}
            hideControls={true}
            layout="column"
            onStatusChange={setMediaStatus}
          />
        </div>

        {/* Bottom Playback Bar */}
        <div className="absolute bottom-0 left-0 right-0 z-40 px-6 py-6 bg-gradient-to-t from-black via-black/95 to-transparent">
          <div className="max-w-5xl mx-auto flex items-center gap-6">
            
            {/* Left: Mic/Camera Controls */}
            <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-full border border-white/5 backdrop-blur-sm shadow-xl">
               <button 
                 onClick={handleMicToggle} 
                 className={`p-2.5 rounded-full transition-all duration-200 ${
                   mediaStatus.isMicOn 
                     ? "bg-white/10 hover:bg-white/20 text-white" 
                     : "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                 }`}
                 title={mediaStatus.isMicOn ? "마이크 끄기" : "마이크 켜기"}
               >
                 {mediaStatus.isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
               </button>
               <button 
                 onClick={handleCameraToggle} 
                 className={`p-2.5 rounded-full transition-all duration-200 ${
                   mediaStatus.isCameraOn 
                     ? "bg-white/10 hover:bg-white/20 text-white" 
                     : "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/20"
                 }`}
                 title={mediaStatus.isCameraOn ? "카메라 끄기" : "카메라 켜기"}
               >
                 {mediaStatus.isCameraOn ? <Video className="w-5 h-5" /> : <CameraOff className="w-5 h-5" />}
               </button>
            </div>

            {currentSong ? (
              <>
                {/* Center: Progress Bar */}
                <div className="flex-1 flex items-center gap-4 bg-white/5 px-6 py-3 rounded-2xl border border-white/5 backdrop-blur-sm shadow-xl">
                  <span className="text-xs font-mono text-white/50 w-10 text-right">{formatTime(currentTime)}</span>
                  <div 
                    className="flex-1 h-1.5 bg-white/10 rounded-full cursor-pointer relative group"
                    onClick={handleSeek}
                  >
                    <div className="absolute inset-0 bg-white/5 rounded-full" />
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 rounded-full relative transition-all duration-100 ease-linear shadow-[0_0_10px_rgba(59,130,246,0.5)]"
                      style={{ width: `${currentSong.duration ? (currentTime / currentSong.duration) * 100 : 0}%` }}
                    >
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity scale-125" />
                    </div>
                  </div>
                  <span className="text-xs font-mono text-white/50 w-10">{formatTime(currentSong.duration)}</span>
                </div>

                {/* Right: Play Controls */}
                <div className="flex items-center gap-4 bg-white/5 px-5 py-2 rounded-full border border-white/5 backdrop-blur-sm shadow-xl">
                   <div className="flex items-center gap-2 group/vol relative">
                       <button onClick={() => {
                         const newVol = volume === 0 ? 1 : 0;
                         setVolume(newVol);
                         window.dispatchEvent(new CustomEvent("kero:setVolume", { detail: { volume: newVol } }));
                       }} className="p-2 text-white/50 hover:text-white transition-colors">
                         {volume === 0 ? <VolumeX className="w-5 h-5"/> : <Volume2 className="w-5 h-5"/>}
                       </button>
                       <div className="w-0 overflow-hidden group-hover/vol:w-20 transition-all duration-300 ease-out">
                         <input 
                           type="range" 
                           min="0" 
                           max="1" 
                           step="0.01" 
                           value={volume} 
                           onChange={handleVolumeChange} 
                           className="w-20 h-1 accent-white cursor-pointer" 
                         />
                       </div>
                   </div>

                   <div className="w-px h-6 bg-white/10" />

                   <button 
                     onClick={handlePlayPause}
                     className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 active:scale-95 transition-all shadow-lg shadow-white/20"
                   >
                     {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                   </button>
                   
                   <button 
                     onClick={() => window.dispatchEvent(new Event("kero:skipForward"))}
                     className="p-2 text-white/50 hover:text-white hover:text-red-400 transition-colors"
                     title="다음 곡으로 넘기기"
                   >
                     <SkipForward className="w-5 h-5"/>
                   </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-white/30 text-sm font-medium italic">
                {room?.gameMode === "lyrics_quiz" ? "퀴즈 진행 중..." : "노래를 선택해주세요"}
              </div>
            )}
          </div>
        </div>

        <AnimatePresence>
          {showAddSong && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
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
                  <h2 className="text-xl font-bold flex items-center gap-2 text-white">
                    <span className="text-2xl">🎤</span> 곡 검색
                  </h2>
                  <button 
                    onClick={() => setShowAddSong(false)}
                    className="p-2 rounded-full hover:bg-white/10 transition-colors text-white"
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
               src={`https://www.youtube-nocookie.com/embed/${bgVideoId}?autoplay=1&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${bgVideoId}&modestbranding=1&playsinline=1&vq=hd2160`}
               loading="lazy"
               onLoad={() => setBgVideoLoaded(true)}
               className={`absolute top-1/2 left-1/2 w-[150%] h-[150%] -translate-x-1/2 -translate-y-1/2 transition-opacity duration-1000 ${bgVideoLoaded ? 'opacity-100' : 'opacity-0'}`}
               allow="autoplay; encrypted-media"
               title="Background Video"
             />
            <div className="absolute inset-0" />
          </div>
        )}

      {/* 상단 헤더 */}
      <header className="relative z-20 flex items-center justify-between px-4 py-3 md:p-6 bg-black/30 backdrop-blur-md border-b border-white/5">
        <Link href={`/lobby?mode=${room.gameMode}`} className="flex items-center gap-2 text-white/60 hover:text-white transition-colors shrink-0">
          <div className="p-2 rounded-full bg-white/5 hover:bg-white/10 transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </div>
          <span className="hidden md:inline font-medium">로비</span>
        </Link>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-3 max-w-[50%] sm:max-w-[60%]">
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
            className="flex items-center gap-2 px-2 sm:px-4 py-1 sm:py-2 rounded-full bg-white/10 hover:bg-white/20 transition-all border border-white/5 active:scale-95 backdrop-blur-md"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="font-mono font-bold text-sm tracking-wider">{code}</span>
          </button>
        </div>
      </header>

      {room?.gameMode === "lyrics_quiz" ? (
        <main className="relative z-10 flex flex-col items-center justify-center min-h-[calc(100vh-80px)] p-4 gap-4">
          <div className="w-full max-w-lg bg-black/40 backdrop-blur-xl border border-white/10 rounded-3xl p-4 sm:p-8 shadow-2xl ring-1 ring-white/5 text-center">
            <div className="w-20 h-20 rounded-2xl bg-[#FF6B6B]/20 flex items-center justify-center mx-auto mb-6">
              <MessageSquareText className="w-10 h-10 text-[#FF6B6B]" />
            </div>
            <h2 className="text-3xl font-bold mb-3">노래 퀴즈</h2>
            <p className="text-gray-400 mb-8">6가지 퀴즈 유형으로 노래 실력을 겨뤄보세요!</p>

            <div className="mb-6">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">카테고리</p>
              <div className="flex gap-3 justify-center">
                {([
                  { key: "KOR" as const, label: "한국곡", emoji: "🇰🇷" },
                  { key: "JPN" as const, label: "일본곡", emoji: "🇯🇵" },
                  { key: "ENG" as const, label: "팝송", emoji: "🌍" },
                ]).map(({ key, label, emoji }) => (
                  <button
                    key={key}
                    onClick={() => {
                      if (isHost) {
                        setQuizCategory(key);
                        emitEvent("quiz:settings-update", { roomCode: code, quizCount, quizCategory: key });
                      }
                    }}
                    disabled={!isHost}
                    className={`px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl font-bold text-sm sm:text-base whitespace-nowrap transition-all border ${
                      quizCategory === key
                        ? "bg-[#FF6B6B]/20 border-[#FF6B6B]/60 text-[#FF6B6B] shadow-[0_0_15px_-5px_rgba(255,107,107,0.4)]"
                        : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-300"
                    } ${!isHost ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    {emoji} {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mb-6">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">문제 수</p>
              <div className="flex gap-3 justify-center">
               {[10, 30, 50, 100].map((num) => (
                   <button
                     key={num}
                     onClick={() => {
                       if (isHost) {
                         setQuizCount(num);
                         emitEvent("quiz:settings-update", { roomCode: code, quizCount: num, quizCategory });
                       }
                     }}
                     disabled={!isHost}
                     className={`px-3 py-2 sm:px-5 sm:py-3 rounded-xl font-bold text-sm sm:text-base whitespace-nowrap transition-all border ${
                       quizCount === num
                         ? "bg-[#FF6B6B]/20 border-[#FF6B6B]/60 text-[#FF6B6B] shadow-[0_0_15px_-5px_rgba(255,107,107,0.4)]"
                         : "bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-300"
                     } ${!isHost ? "opacity-50 cursor-not-allowed" : ""}`}
                   >
                     {num}문제
                   </button>
                 ))}
              </div>
            </div>

              <button
                onClick={startQuiz}
                disabled={isQuizLoading || !isHost}
                className={`w-full py-4 rounded-xl font-bold text-xl transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                  isHost
                    ? "bg-[#FF6B6B] text-black hover:bg-[#FF5252]"
                    : "bg-white/10 text-white/50 border border-white/10"
                }`}
              >
                {isQuizLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-black"></div>
                    퀴즈 생성 중...
                  </>
                ) : isHost ? (
                  "퀴즈 시작"
                ) : (
                  "호스트가 퀴즈를 시작합니다"
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
                <p className="text-gray-400 text-xs sm:text-sm mb-8 leading-relaxed">
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
                    className="group relative flex items-center gap-4 p-3 sm:p-4 bg-black/40 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-2xl transition-all duration-300 backdrop-blur-sm"
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
                        <div className="flex flex-col gap-1.5 min-w-[100px] sm:min-w-[140px] p-2 sm:p-3 rounded-xl bg-black/20 border border-white/5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin text-yellow-400" />
                              <span className="text-xs text-yellow-400 font-bold">
                                {song.processingStep === "download" && "다운로드"}
                                {song.processingStep === "separation" && "음원 분리"}
                                 {song.processingStep === "lyrics" && "자막 생성"}
                                 {song.processingStep === "fcpe" && "음정 분석"}
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
