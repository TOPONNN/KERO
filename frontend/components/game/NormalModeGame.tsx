"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipForward, Volume2, VolumeX, Mic, MicOff, Video, CameraOff, RotateCcw, AlertCircle, Music2, Trophy, Star } from "lucide-react";
import type { RootState } from "@/store";
import { updateCurrentTime, setGameStatus } from "@/store/slices/gameSlice";
import { getSocket } from "@/lib/socket";

interface LyricsWord {
  startTime: number;
  endTime: number;
  text: string;
  energy?: number;
  pitch?: number;    // Average frequency in Hz (e.g., 440.0)
  note?: string;     // Musical note name (e.g., "A4", "C#5")
  midi?: number;     // MIDI note number (e.g., 69)
  energyCurve?: number[];  // NEW: 4-8 values representing energy contour within word
}

interface LyricsLine {
  startTime: number;
  endTime: number;
  text: string;
  words?: LyricsWord[];
}

// 노래방 싱크 설정 상수
const SYNC_CONFIG = {
  WORD_LEAD_TIME: 0,            // 단어 하이라이트가 미리 시작하는 시간 (초)
  NEXT_LINE_PREVIEW: 1.5,      // 다음 가사 미리보기 시간 (초)
  LINE_HOLD_AFTER_END: 1.0,    // 가사가 끝난 후 유지 시간 (초)
};

type GamePhase = 'intro' | 'countdown' | 'singing';

export default function NormalModeGame() {
  const dispatch = useDispatch();
  const { currentSong, status, songQueue } = useSelector((state: RootState) => state.game);
  const { code: roomCode, participants } = useSelector((state: RootState) => state.room);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSyncTimeRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);
  const [localTime, setLocalTime] = useState(0);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [volume, setVolume] = useState(1.0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  // Score system
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [lastScorePopup, setLastScorePopup] = useState<{ points: number; key: number } | null>(null);
  const scoredWordsRef = useRef<Set<string>>(new Set());
  const comboRef = useRef(0);
  const scoreRef = useRef(0);
  const maxComboRef = useRef(0);
  const totalWordsRef = useRef(0);
  const isMicOnRef = useRef(isMicOn);
  isMicOnRef.current = isMicOn;

  const lyrics: LyricsLine[] = currentSong?.lyrics || [];

  const [pronunciationMap, setPronunciationMap] = useState<Map<number, { text: string; words?: { text: string; pronunciation: string }[] }>>(new Map());
  const pronunciationFetchedRef = useRef<string | null>(null);

  const isJapanese = useMemo(() => {
    const jpPattern = /[\u3040-\u309F\u30A0-\u30FF]/;
    const sample = lyrics.slice(0, 5).map((l) => l.text).join("");
    return jpPattern.test(sample);
  }, [lyrics]);

  useEffect(() => {
    if (!isJapanese || lyrics.length === 0) return;
    const songId = currentSong?.id || currentSong?.title || "";
    if (pronunciationFetchedRef.current === songId) return;
    pronunciationFetchedRef.current = songId;

    const fetchPronunciation = async () => {
      try {
        const payload = lyrics.map((l) => ({
          text: l.text,
          words: l.words?.map((w) => ({ text: w.text })),
        }));
        const res = await fetch("/api/songs/lyrics/pronunciation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lines: payload }),
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          const map = new Map<number, { text: string; words?: { text: string; pronunciation: string }[] }>();
          data.data.forEach((item: { text: string; pronunciation: string; words?: { text: string; pronunciation: string }[] }, idx: number) => {
            map.set(idx, { text: item.pronunciation, words: item.words });
          });
          setPronunciationMap(map);
        }
      } catch (e) {
        console.error("[NormalModeGame] Failed to fetch pronunciation:", e);
      }
    };
    fetchPronunciation();
  }, [isJapanese, lyrics, currentSong]);

  useEffect(() => {
    if (lyrics.length > 0) {
      let count = 0;
      lyrics.forEach(line => {
        if (line.words && line.words.length > 0) {
          count += line.words.length;
        } else {
          count += 1;
        }
      });
      totalWordsRef.current = count;
    }
  }, [lyrics]);
  const audioUrl = currentSong?.instrumentalUrl || currentSong?.audioUrl;
  const videoId = currentSong?.videoId;

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  
  const duration = audioDuration || currentSong?.duration || 0;

  const gamePhase: GamePhase = useMemo(() => {
    if (lyrics.length === 0) return 'intro';
    const firstLyricStart = lyrics[0].startTime;
    const countdownStart = Math.max(0, firstLyricStart - 4);
    const countdownEnd = firstLyricStart;
    if (localTime < countdownStart) return 'intro';
    if (localTime < countdownEnd) return 'countdown';
    return 'singing';
  }, [localTime, lyrics]);

  const countdownNumber = useMemo(() => {
    if (gamePhase !== 'countdown' || lyrics.length === 0) return 0;
    const remaining = Math.ceil(lyrics[0].startTime - localTime);
    return Math.max(0, Math.min(3, remaining));
  }, [gamePhase, localTime, lyrics]);

  const isInterlude = useMemo(() => {
    if (gamePhase !== 'singing') return false;
    if (currentLyricIndex !== -1) return false;
    const nextIdx = lyrics.findIndex(l => l.startTime > localTime);
    if (nextIdx < 0) return false;
    if (nextIdx === 0) return true;
    const prevLine = lyrics[nextIdx - 1];
    const nextLine = lyrics[nextIdx];
    return (nextLine.startTime - prevLine.endTime) > 3;
  }, [gamePhase, currentLyricIndex, lyrics, localTime]);

  // Current pitch from current word
  const currentPitch = useMemo(() => {
    if (currentLyricIndex < 0) return null;
    const line = lyrics[currentLyricIndex];
    if (!line?.words) return null;
    const word = line.words.find(w => localTime >= w.startTime && localTime <= w.endTime);
    return word?.note || null;
  }, [currentLyricIndex, lyrics, localTime]);

  const findCurrentLyricIndex = useCallback((time: number): number => {
    if (lyrics.length === 0) return -1;
    
    // 첫 번째 가사 시작 전: 프리뷰 시간 내에만 표시, 그 외엔 간주중
    if (time < lyrics[0].startTime) {
      if (lyrics[0].startTime - time <= SYNC_CONFIG.NEXT_LINE_PREVIEW) return 0;
      return -1;
    }
    
    // Defensive: find the LATEST line whose range covers current time
    // (handles any residual overlap in data)
    let bestMatch = -1;
    
    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      
      if (time >= line.startTime && time <= line.endTime) {
        bestMatch = i;  // Keep updating — last match wins (latest startTime)
      }
    }
    
    if (bestMatch >= 0) return bestMatch;
    
    // No direct match — check gap logic
    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      const nextLine = lyrics[i + 1];
      
      if (time > line.endTime) {
        // 다음 라인이 있는 경우
        if (nextLine && time < nextLine.startTime) {
           const gapDuration = nextLine.startTime - line.endTime;
           
           // 라인이 끝나고 잠시 유지 (LINE_HOLD_AFTER_END)
           if (time <= line.endTime + SYNC_CONFIG.LINE_HOLD_AFTER_END) {
             return i;
           }
           
           // 짧은 갭 (3초 이하): 다음 가사를 미리 보여줌 (Preview)
           if (gapDuration <= 3.0) {
             return i + 1;
           }
           
           // 긴 갭 (> 3초, 간주 등): 점 3개 애니메이션 표시
           return -1;
        }
        
        // 마지막 라인인 경우
        if (!nextLine) {
          // 끝난 후 2초까지만 마지막 라인 표시
          if (time <= line.endTime + 2.0) {
            return i;
          }
          return -1;
        }
      }
    }
    
    return -1;
  }, [lyrics]);

  useEffect(() => {
    if (!audioRef.current) return;

    const audio = audioRef.current;
    audio.volume = volume;

    const handleEnded = () => {
      setIsPlaying(false);
      dispatch(setGameStatus("finished"));
    };

    const handleCanPlay = () => {
      setAudioLoaded(true);
      setAudioError(null);
    };

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };

    const handleError = () => {
      setAudioError("오디오를 불러올 수 없습니다. 다시 시도해주세요.");
      setAudioLoaded(false);
    };

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("error", handleError);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [dispatch, volume]);

  useEffect(() => {
    const handleSyncTime = (e: CustomEvent<{ time: number }>) => {
      if (audioRef.current && typeof e.detail?.time === "number") {
        audioRef.current.currentTime = e.detail.time;
        setLocalTime(e.detail.time);
        setIsPlaying(true);
        audioRef.current.play().catch(() => {});
      }
    };

    window.addEventListener("kero:syncTime", handleSyncTime as EventListener);
    return () => window.removeEventListener("kero:syncTime", handleSyncTime as EventListener);
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !audioLoaded) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(console.error);
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, audioLoaded]);

  useEffect(() => {
    const handleTogglePlay = () => togglePlay();
    const handleSetVolume = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.volume === 'number') {
        setVolume(detail.volume);
      }
    };
    const handleSeek = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.progress === 'number' && audioRef.current && duration) {
        const newTime = detail.progress * duration;
        audioRef.current.currentTime = newTime;
        setLocalTime(newTime);
      }
    };

    window.addEventListener("kero:togglePlay", handleTogglePlay);
    window.addEventListener("kero:setVolume", handleSetVolume);
    window.addEventListener("kero:seek", handleSeek);

    return () => {
      window.removeEventListener("kero:togglePlay", handleTogglePlay);
      window.removeEventListener("kero:setVolume", handleSetVolume);
      window.removeEventListener("kero:seek", handleSeek);
    };
  }, [togglePlay, duration]);

  // 고성능 시간 업데이트 루프
  useEffect(() => {
    if (!isPlaying || !audioRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const updateTime = () => {
      if (!audioRef.current || !isPlaying) return;
      
      const time = audioRef.current.currentTime;
      
      // 시간이 변했을 때만 업데이트 (성능 최적화)
      if (Math.abs(time - lastTimeRef.current) > 0.016) { // ~60fps
        // Redux 업데이트는 덜 자주 (성능) - must check BEFORE updating lastTimeRef
        if (Math.floor(time * 10) !== Math.floor(lastTimeRef.current * 10)) {
          dispatch(updateCurrentTime(time));
        }
        
        // 서버에 시간 동기화 (2초마다)
        if (time - lastSyncTimeRef.current >= 2) {
          lastSyncTimeRef.current = time;
          try {
            const socket = getSocket();
            if (socket?.connected && roomCode) {
              socket.emit("normal:play", { roomCode, currentTime: time });
            }
          } catch {}
        }
        
        lastTimeRef.current = time;
        setLocalTime(time);
        
        // 가사 인덱스 업데이트
        const newIndex = findCurrentLyricIndex(time);
        if (newIndex !== currentLyricIndex) {
          setCurrentLyricIndex(newIndex);
        }
        
        // Score: award points for active lyrics
        const lineIdx = newIndex >= 0 ? newIndex : currentLyricIndex;
        if (lineIdx >= 0) {
          const line = lyrics[lineIdx];
          if (line) {
            // Word-level scoring (if words available)
            if (line.words && line.words.length > 0) {
              const wordIdx = line.words.findIndex(w => time >= w.startTime && time <= w.endTime);
              if (wordIdx >= 0) {
                const wordKey = `${lineIdx}-${wordIdx}`;
                if (!scoredWordsRef.current.has(wordKey)) {
                  scoredWordsRef.current.add(wordKey);
                  if (isMicOnRef.current) {
                    const word = line.words[wordIdx];
                    const energy = word.energy ?? 0.5;
                    const comboMult = Math.min(2, 1 + comboRef.current * 0.1);
                    const points = Math.round(10 * energy * comboMult);
                    comboRef.current += 1;
                    maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
                    scoreRef.current += points;
                    setScore(scoreRef.current);
                    setCombo(comboRef.current);
                    // Removed score popup
                  } else {
                    comboRef.current = 0;
                    setCombo(0);
                  }
                }
              }
            } else {
              // Line-level fallback: score once per line when time is within line range
              const lineKey = `line-${lineIdx}`;
              if (time >= line.startTime && time <= line.endTime && !scoredWordsRef.current.has(lineKey)) {
                scoredWordsRef.current.add(lineKey);
                if (isMicOnRef.current) {
                  const comboMult = Math.min(2, 1 + comboRef.current * 0.1);
                  const points = Math.round(50 * comboMult); // 50 base points per line
                  comboRef.current += 1;
                  maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
                  scoreRef.current += points;
                  setScore(scoreRef.current);
                  setCombo(comboRef.current);
                } else {
                  comboRef.current = 0;
                  setCombo(0);
                }
              }
            }
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(updateTime);
    };

    animationFrameRef.current = requestAnimationFrame(updateTime);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, findCurrentLyricIndex, currentLyricIndex, dispatch]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (status === "playing" && audioRef.current && !isPlaying && audioLoaded) {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
  }, [status, audioLoaded]);



  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    audioRef.current.currentTime = newTime;
    setLocalTime(newTime);
  }, [duration]);

  const handleRestart = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    setLocalTime(0);
    setCurrentLyricIndex(-1);
    setScore(0);
    setCombo(0);
    setLastScorePopup(null);
    scoreRef.current = 0;
    comboRef.current = 0;
    maxComboRef.current = 0;
    scoredWordsRef.current.clear();
  }, []);

  const handleMicToggle = () => {
    window.dispatchEvent(new Event("kero:toggleMic"));
    setIsMicOn(!isMicOn);
  };

   const handleCameraToggle = () => {
     window.dispatchEvent(new Event("kero:toggleCamera"));
     setIsCamOn(!isCamOn);
   };

   // Sync LiveKit state from VideoRoom via custom events
   useEffect(() => {
     const handleMicStatus = (e: Event) => {
       const detail = (e as CustomEvent).detail;
       if (typeof detail?.isMicOn === 'boolean') {
         setIsMicOn(detail.isMicOn);
       }
     };
     const handleCamStatus = (e: Event) => {
       const detail = (e as CustomEvent).detail;
       if (typeof detail?.isCamOn === 'boolean') {
         setIsCamOn(detail.isCamOn);
       }
     };
     window.addEventListener("kero:micStatus", handleMicStatus);
     window.addEventListener("kero:camStatus", handleCamStatus);
     return () => {
       window.removeEventListener("kero:micStatus", handleMicStatus);
       window.removeEventListener("kero:camStatus", handleCamStatus);
     };
   }, []);

   const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = duration ? (localTime / duration) * 100 : 0;

   // 단어별 하이라이트 진행률 계산 (MFA 타이밍 기반)
   const getWordProgressInLine = useCallback((line: LyricsLine, wordIndex: number): number => {
     if (!line.words || line.words.length === 0) return 0;
     
     const word = line.words[wordIndex];
     const wordStart = word.startTime - SYNC_CONFIG.WORD_LEAD_TIME;
     const wordEnd = word.endTime;
     const wordDuration = wordEnd - wordStart;
     
     if (wordDuration <= 0) return localTime >= wordStart ? 100 : 0;
     if (localTime < wordStart) return 0;
     if (localTime >= wordEnd) return 100;
     
     // Simple linear progress — most accurate for karaoke sync
     const t = (localTime - wordStart) / wordDuration;
     return Math.min(100, Math.max(0, t * 100));
   }, [localTime]);

  // 라인 전체 진행률 (단어가 없을 때 사용)
  const getLineProgress = useCallback((line: LyricsLine): number => {
    const adjustedStart = line.startTime;
    
    if (localTime < adjustedStart) return 0;
    if (localTime >= line.endTime) return 100;
    
    return ((localTime - adjustedStart) / (line.endTime - adjustedStart)) * 100;
  }, [localTime]);

  if (!currentSong) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <AlertCircle className="w-16 h-16 text-gray-500 mb-4" />
        <p className="text-gray-400">노래 정보를 불러오는 중...</p>
      </div>
    );
  }




  const renderLine = useCallback((lineIndex: number, align: 'start' | 'end') => {
    const line = lyrics[lineIndex];
    if (!line) return null;

    const isLineWaiting = currentLyricIndex < lineIndex;
    
    return (
      <div className={`self-${align} w-full max-w-[90%] ${align === 'start' ? 'pl-2 sm:pl-4 md:pl-10 text-left' : 'pr-2 sm:pr-4 md:pr-10 text-right'} relative`}>
        <div className={`flex flex-col gap-1 ${align === 'end' ? 'items-end' : 'items-start'}`}>
          {isJapanese && pronunciationMap.has(lineIndex) && (
            <div className={`text-sm sm:text-base md:text-lg lg:text-xl font-bold ${isLineWaiting ? 'text-white/50' : 'text-yellow-300/80'}`} style={{ WebkitTextStroke: '1px rgba(0,0,0,0.6)', paintOrder: 'stroke fill' }}>
              {pronunciationMap.get(lineIndex)?.words
                ? pronunciationMap.get(lineIndex)!.words!.map((w, i) => <span key={i} className="mr-2">{w.pronunciation}</span>)
                : pronunciationMap.get(lineIndex)?.text}
            </div>
          )}
          <div className={`flex flex-wrap gap-x-4 leading-normal ${align === 'end' ? 'justify-end' : 'justify-start'}`}>
            {(() => {
              if (line.words && line.words.length > 0) {
                return line.words.map((word, i) => {
                  const progress = getWordProgressInLine(line, i);
                  return (
                    <span key={i} className="relative block text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-black">
                      <span className={`text-white relative z-10 ${isLineWaiting ? 'opacity-70' : 'opacity-100'}`} style={{ WebkitTextStroke: '2px rgba(0,0,0,0.8)', paintOrder: 'stroke fill' }}>{word.text}</span>
                      <span className="absolute left-0 top-0 text-cyan-400 whitespace-nowrap z-20" style={{ clipPath: `inset(-0.25em ${100 - progress}% -0.25em 0)`, transition: 'clip-path 60ms linear', WebkitTextStroke: '2px rgba(0,0,0,0.8)', paintOrder: 'stroke fill' }}>{word.text}</span>
                    </span>
                  );
                });
              } else {
                return (
                  <div className="relative text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-black">
                    <span className={`text-white ${isLineWaiting ? 'opacity-70' : 'opacity-100'}`} style={{ WebkitTextStroke: '2px rgba(0,0,0,0.8)', paintOrder: 'stroke fill' }}>{line.text}</span>
                    <span className="absolute left-0 top-0 text-cyan-400 whitespace-nowrap" style={{ clipPath: `inset(-0.25em ${100 - getLineProgress(line)}% -0.25em 0)`, WebkitTextStroke: '2px rgba(0,0,0,0.8)', paintOrder: 'stroke fill' }}>{line.text}</span>
                  </div>
                );
              }
            })()}
          </div>
        </div>
      </div>
    );
  }, [lyrics, currentLyricIndex, isJapanese, pronunciationMap, getWordProgressInLine, getLineProgress]);



  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none font-sans">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          muted={isMuted}
          crossOrigin="anonymous"
        />
      )}

       {/* 1. Background Layer */}
       <div className="absolute inset-0 z-0" style={{ transform: 'translateZ(0)' }}>
         {videoId ? (
           <>
               <iframe
                 src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${videoId}&modestbranding=1&playsinline=1&vq=hd2160`}
                 className="absolute top-1/2 left-1/2 w-[200%] h-[200%] -translate-x-1/2 -translate-y-1/2"
                 allow="autoplay; encrypted-media"
                 title="Background MV"
                 style={{ pointerEvents: 'none' }}
                 loading="lazy"
               />
            <div className="absolute inset-0" />
          </>
        ) : (
           <div className="absolute inset-0 overflow-hidden">
             {/* Animated gradient orbs */}
             <div 
               className="absolute w-[400px] h-[400px] rounded-full blur-[80px] opacity-20"
               style={{
                 background: 'radial-gradient(circle, #C25E8C 0%, transparent 70%)',
                 top: '10%',
                 left: '20%',
                 animation: 'float1 20s ease-in-out infinite',
               }}
             />
             <div 
               className="absolute w-[350px] h-[350px] rounded-full blur-[60px] opacity-15"
               style={{
                 background: 'radial-gradient(circle, #4F46E5 0%, transparent 70%)',
                 bottom: '10%',
                 right: '15%',
                 animation: 'float2 25s ease-in-out infinite',
               }}
             />
             <div 
               className="absolute w-[300px] h-[300px] rounded-full blur-[50px] opacity-10"
               style={{
                 background: 'radial-gradient(circle, #06B6D4 0%, transparent 70%)',
                 top: '50%',
                 left: '60%',
                 animation: 'float3 18s ease-in-out infinite',
               }}
             />
          </div>
        )}
      </div>

      <AnimatePresence>
        {gamePhase === 'intro' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.5, type: "spring", damping: 20 }}
              className="relative w-[90%] max-w-2xl"
            >
              <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl" style={{ background: 'linear-gradient(135deg, #1a237e 0%, #4a148c 50%, #1a237e 100%)' }}>
                <div className="px-8 sm:px-12 py-10 sm:py-14 flex flex-col items-center text-center">
                  <motion.h1
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.4 }}
                    className="text-4xl sm:text-5xl md:text-7xl font-black text-white tracking-tight leading-tight"
                    style={{ textShadow: '0 2px 20px rgba(0,0,0,0.5)' }}
                  >
                    {currentSong.title}
                  </motion.h1>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5, duration: 0.4 }}
                    className="mt-3 flex items-center gap-3"
                  >
                    <span className="block w-8 h-px bg-white/30" />
                    <p className="text-xl sm:text-2xl md:text-3xl text-white/80 font-medium tracking-wide">
                      {currentSong.artist}
                    </p>
                    <span className="block w-8 h-px bg-white/30" />
                  </motion.div>
                </div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.7, duration: 0.3 }}
                  className="px-6 sm:px-10 py-3 bg-black/20 border-t border-white/10 flex items-center justify-center gap-6 text-yellow-300/90 text-xs sm:text-sm font-medium tracking-wide"
                >
                  {currentSong.lyricist && <span>작사 {currentSong.lyricist}</span>}
                  {currentSong.lyricist && currentSong.composer && <span className="text-white/20">|</span>}
                  {currentSong.composer && <span>작곡 {currentSong.composer}</span>}
                  {!currentSong.lyricist && !currentSong.composer && <span className="text-white/40">♪</span>}
                </motion.div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {gamePhase === 'countdown' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            className="absolute inset-0 z-20 flex items-center justify-center"
          >
            <AnimatePresence mode="wait">
              <motion.span
                key={countdownNumber}
                initial={{ scale: 2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.4, type: "spring", damping: 15 }}
                className="text-8xl sm:text-[150px] font-black text-white tabular-nums"
                style={{ textShadow: '0 0 60px rgba(6,182,212,0.5), 0 4px 20px rgba(0,0,0,0.5)' }}
              >
                {countdownNumber > 0 ? countdownNumber : '♪'}
              </motion.span>
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

       {/* Score Overlay Removed */}


       {/* 3. Lyrics Display (Singing Phase) — Pair-based leapfrog like TJ karaoke */}
       <AnimatePresence mode="wait">
         {gamePhase === 'singing' && !isInterlude && currentLyricIndex >= 0 && (() => {
           const pairIndex = Math.floor(currentLyricIndex / 2);
           const lineAIndex = pairIndex * 2;
           const lineBIndex = pairIndex * 2 + 1;
           return (
             <motion.div
               key={`pair-${pairIndex}`}
               initial={{ opacity: 0, y: 30 }}
               animate={{ opacity: 1, y: 0 }}
               exit={{ opacity: 0, y: -30, transition: { duration: 0.25 } }}
               transition={{ duration: 0.3 }}
               className="absolute bottom-[18%] sm:bottom-[22%] left-0 right-0 z-20 px-4 sm:px-8 md:px-16 flex flex-col gap-5 sm:gap-7 md:gap-10 w-full max-w-7xl mx-auto will-change-transform"
             >
               {renderLine(lineAIndex, 'start')}
               {lyrics[lineBIndex] && renderLine(lineBIndex, 'end')}
             </motion.div>
           );
         })()}
       </AnimatePresence>

      <AnimatePresence>
        {isInterlude && (
           <motion.div 
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             transition={{ duration: 0.4 }}
             className="absolute bottom-[28%] sm:bottom-[32%] left-0 right-0 z-30 flex justify-center"
           >
              <div className="flex items-center gap-3">
                 <span className="block w-8 h-px bg-white/30" />
                 <span className="text-lg sm:text-xl md:text-2xl font-medium text-white/50 tracking-[0.3em]">
                   간주중
                 </span>
                 <span className="block w-8 h-px bg-white/30" />
              </div>
           </motion.div>
        )}
      </AnimatePresence>

       <div className="hidden" />

       {/* Final Score / Result Screen */}
       <AnimatePresence>
         {status === 'finished' && (
           <motion.div
             initial={{ opacity: 0, scale: 0.9 }}
             animate={{ opacity: 1, scale: 1 }}
             exit={{ opacity: 0 }}
             className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-lg"
           >
             {(() => {
                const accuracy = totalWordsRef.current > 0 ? (scoredWordsRef.current.size / totalWordsRef.current) * 100 : 0;
                let grade = 'F';
                let gradeColor = '#6B7280';
                if (accuracy >= 95) { grade = 'S'; gradeColor = '#FFD700'; }
                else if (accuracy >= 85) { grade = 'A'; gradeColor = '#22D3EE'; }
                else if (accuracy >= 70) { grade = 'B'; gradeColor = '#4ADE80'; }
                else if (accuracy >= 50) { grade = 'C'; gradeColor = '#FB923C'; }
                else if (accuracy >= 30) { grade = 'D'; gradeColor = '#F87171'; }

                return (
                  <div className="w-full max-w-2xl bg-black/40 backdrop-blur-md rounded-3xl p-8 sm:p-12 border border-white/10 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
                     <div className="flex items-center gap-3 mb-8">
                       <Trophy className="w-8 h-8 text-yellow-400" />
                       <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-widest">노래 완료!</h2>
                     </div>

                     <motion.div 
                       initial={{ scale: 0.5, opacity: 0 }}
                       animate={{ scale: 1, opacity: 1 }}
                       transition={{ delay: 0.2, type: "spring" }}
                       className="mb-6"
                     >
                        <span className="text-[120px] sm:text-[150px] font-black leading-none" style={{ color: gradeColor, textShadow: `0 0 40px ${gradeColor}40` }}>
                          {grade}
                        </span>
                     </motion.div>

                     <div className="mb-10">
                       <span className="text-white/50 text-sm font-medium tracking-widest uppercase block mb-1">최종 점수</span>
                       <span className="text-white font-black text-4xl sm:text-6xl tabular-nums tracking-tight">
                         {score.toLocaleString()}
                       </span>
                     </div>

                     <div className="grid grid-cols-3 gap-4 w-full mb-10">
                        <div className="bg-white/5 rounded-2xl p-4 flex flex-col items-center border border-white/5">
                           <span className="text-white/40 text-xs font-bold mb-1">정확도</span>
                           <span className="text-white font-bold text-xl sm:text-2xl">{accuracy.toFixed(1)}%</span>
                        </div>
                        <div className="bg-white/5 rounded-2xl p-4 flex flex-col items-center border border-white/5">
                           <span className="text-white/40 text-xs font-bold mb-1">최고 콤보</span>
                           <span className="text-white font-bold text-xl sm:text-2xl">{maxComboRef.current}x</span>
                        </div>
                        <div className="bg-white/5 rounded-2xl p-4 flex flex-col items-center border border-white/5">
                           <span className="text-white/40 text-xs font-bold mb-1">채점 단어</span>
                           <span className="text-white font-bold text-xl sm:text-2xl">{scoredWordsRef.current.size}<span className="text-white/30 text-base font-medium">/{totalWordsRef.current}</span></span>
                        </div>
                     </div>

                     <div className="flex gap-4 w-full sm:w-auto">
                       <button
                         onClick={() => {
                           handleRestart();
                           dispatch(setGameStatus("playing"));
                           setIsPlaying(true);
                           if (audioRef.current) audioRef.current.play().catch(() => {});
                         }}
                         className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-8 py-4 bg-white/10 hover:bg-white/20 text-white rounded-xl font-bold transition-all active:scale-95"
                       >
                         <RotateCcw className="w-5 h-5" />
                         다시 부르기
                       </button>
                        <button
                         onClick={() => window.dispatchEvent(new Event("kero:skipForward"))}
                         className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-8 py-4 bg-cyan-500 hover:bg-cyan-400 text-black rounded-xl font-bold transition-all active:scale-95 shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)]"
                       >
                         <SkipForward className="w-5 h-5" />
                         다음 곡
                       </button>
                     </div>
                  </div>
                );
             })()}
           </motion.div>
         )}
       </AnimatePresence>

       {/* Error Toast */}
       {audioError && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 p-4 bg-red-500/90 backdrop-blur text-white rounded-lg shadow-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span>{audioError}</span>
        </div>
       )}

      <style>{`
        @keyframes float1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 30px) scale(0.9); }
        }
        @keyframes float2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-40px, 30px) scale(1.05); }
          66% { transform: translate(20px, -40px) scale(0.95); }
        }
        @keyframes float3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(50px, 20px) scale(1.1); }
        }
      `}</style>
    </div>
  );
}
