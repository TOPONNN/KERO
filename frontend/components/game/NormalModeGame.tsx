"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipForward, Volume2, VolumeX, Mic, MicOff, Video, CameraOff, RotateCcw, AlertCircle, Music2 } from "lucide-react";
import type { RootState } from "@/store";
import { updateCurrentTime, setGameStatus } from "@/store/slices/gameSlice";

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
  WORD_LEAD_TIME: 0.3,          // 단어 하이라이트가 미리 시작하는 시간 (초)
  NEXT_LINE_PREVIEW: 0.5,      // 다음 가사 미리보기 시간 (초)
  LINE_HOLD_AFTER_END: 0.5,    // 가사가 끝난 후 유지 시간 (초)
};

type GamePhase = 'intro' | 'singing';

export default function NormalModeGame() {
  const dispatch = useDispatch();
  const { currentSong, status, songQueue } = useSelector((state: RootState) => state.game);
  const audioRef = useRef<HTMLAudioElement>(null);
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
  const isMicOnRef = useRef(isMicOn);
  isMicOnRef.current = isMicOn;

  const lyrics: LyricsLine[] = currentSong?.lyrics || [];
  const audioUrl = currentSong?.instrumentalUrl || currentSong?.audioUrl;
  const videoId = currentSong?.videoId;

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  
  const duration = audioDuration || currentSong?.duration || 0;

  // Game phase derived from localTime
  const gamePhase: GamePhase = useMemo(() => {
    if (lyrics.length === 0) return 'intro';
    const introEnd = Math.min(lyrics[0].startTime - 1, 5);
    if (localTime < Math.max(0, introEnd)) return 'intro';
    return 'singing';
  }, [localTime, lyrics]);

  // Interlude detection
  const isInterlude = useMemo(() => {
    if (gamePhase !== 'singing') return false;

    // 1. Prelude (Jeonju): After banner but before first lyric
    if (lyrics.length > 0 && localTime < lyrics[0].startTime) {
       // Show interlude if more than 10s remains until start
       return (lyrics[0].startTime - localTime) > 10;
    }

    // 2. Interlude (Ganju): Between lyrics
    if (currentLyricIndex !== -1) return false;
    // Find next upcoming lyric
    const nextIdx = lyrics.findIndex(l => l.startTime > localTime);
    if (nextIdx <= 0) return false;
    const prevLine = lyrics[nextIdx - 1];
    const nextLine = lyrics[nextIdx];
    return (nextLine.startTime - prevLine.endTime) > 5;
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
    
    // 첫 번째 가사 시작 전: 10초 전부터만 미리 보여줌
    if (time < lyrics[0].startTime) {
      if (time >= lyrics[0].startTime - 10) return 0;
      return -1;
    }
    
    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      const nextLine = lyrics[i + 1];
      
      // 현재 라인 범위 내
      if (time >= line.startTime && time <= line.endTime) {
        return i;
      }
      
      // 현재 라인 끝났지만 다음 라인 시작 전 (갭 구간)
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
                    scoreRef.current += points;
                    setScore(scoreRef.current);
                    setCombo(comboRef.current);
                    setLastScorePopup({ points, key: Date.now() });
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
                  scoreRef.current += points;
                  setScore(scoreRef.current);
                  setCombo(comboRef.current);
                  setLastScorePopup({ points, key: Date.now() });
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

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !audioLoaded) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch(console.error);
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, audioLoaded]);

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



  const currentLine = currentLyricIndex >= 0 ? lyrics[currentLyricIndex] : undefined;
  const nextLine = useMemo(() => {
    if (currentLyricIndex >= 0) {
      return lyrics[currentLyricIndex + 1] || null;
    }
    // During rest: find the actual next upcoming line
    return lyrics.find(line => line.startTime > localTime) || null;
  }, [currentLyricIndex, lyrics, localTime]);

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

      {/* 2. Intro Screen (TJ Style) */}
      <AnimatePresence>
        {gamePhase === 'intro' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-20 flex flex-col items-center justify-center"
          >
            {/* Pink Banner */}
            <div className="w-[95%] sm:w-[85%] max-w-5xl bg-[#C25E8C]/90 backdrop-blur-sm rounded-[2rem] p-5 pb-8 sm:p-8 sm:pb-12 md:p-10 md:pb-14 shadow-2xl flex flex-col items-center text-center relative overflow-hidden border border-white/10">
              <div className="absolute top-0 left-0 w-full h-1 bg-white/30" />
              
              <h1 className="text-3xl sm:text-5xl md:text-7xl font-bold text-white mb-4 tracking-tight drop-shadow-md">
                {currentSong.title}
              </h1>
              <p className="text-lg sm:text-2xl md:text-3xl text-white/90 font-medium">
                {currentSong.artist}
              </p>

              {/* Decorative circle/logo placeholder */}
              <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
            </div>

            {/* Info Row */}
            <div className="mt-8 flex items-center bg-black/80 backdrop-blur-md rounded-xl border border-white/20 overflow-x-auto overflow-y-hidden shadow-xl max-w-full">
               <div className="px-4 py-2 sm:px-6 sm:py-3 md:px-8 md:py-4 flex flex-col items-center min-w-[80px] sm:min-w-[100px] md:min-w-[120px]">
                 <span className="text-yellow-400 text-xs sm:text-sm font-bold mb-1">현재음정</span>
                 <span className="text-white font-bold text-base sm:text-lg md:text-xl">{currentPitch || "원키"}</span>
               </div>
               <div className="w-px h-8 sm:h-10 md:h-12 bg-white/20" />
               <div className="px-4 py-2 sm:px-6 sm:py-3 md:px-8 md:py-4 flex flex-col items-center min-w-[80px] sm:min-w-[100px] md:min-w-[120px]">
                 <span className="text-yellow-400 text-xs sm:text-sm font-bold mb-1">원음정</span>
                 <span className="text-white font-bold text-base sm:text-lg md:text-xl">원키</span>
               </div>
               <div className="w-px h-8 sm:h-10 md:h-12 bg-white/20" />
               <div className="px-4 py-2 sm:px-6 sm:py-3 md:px-8 md:py-4 flex flex-col items-center min-w-[80px] sm:min-w-[100px] md:min-w-[120px]">
                  <span className="text-yellow-400 text-xs sm:text-sm font-bold mb-1">작사</span>
                   <span className="text-white font-bold text-sm sm:text-lg md:text-xl text-center whitespace-nowrap">{currentSong.lyricist || currentSong.artist}</span>
                 </div>
                 <div className="w-px h-8 sm:h-10 md:h-12 bg-white/20" />
                 <div className="px-4 py-2 sm:px-6 sm:py-3 md:px-8 md:py-4 flex flex-col items-center min-w-[80px] sm:min-w-[100px] md:min-w-[120px]">
                   <span className="text-yellow-400 text-xs sm:text-sm font-bold mb-1">작곡</span>
                   <span className="text-white font-bold text-sm sm:text-lg md:text-xl text-center whitespace-nowrap">{currentSong.composer || currentSong.artist}</span>
                </div>
            </div>

             {/* TJ Branding */}
             <div className="absolute bottom-10 opacity-50">
                <span className="text-white font-bold tracking-widest text-lg">KERO</span>
             </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Score Overlay */}
      <AnimatePresence>
        {gamePhase === 'singing' && score > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-4 right-4 sm:top-6 sm:right-6 z-20 flex flex-col items-end gap-1"
          >
            <motion.div
              key={score}
              animate={{ scale: [1.08, 1] }}
              transition={{ duration: 0.15 }}
              className="bg-black/40 backdrop-blur-sm rounded-xl px-3 py-1.5 sm:px-4 sm:py-2 flex items-center gap-3 border border-white/10"
            >
              <span className="text-white/60 text-xs font-medium tracking-wider uppercase">Score</span>
              <span className="text-white font-bold text-base sm:text-lg tabular-nums">{score.toLocaleString()}</span>
              {combo >= 3 && (
                <span className="text-cyan-400 text-xs font-bold ml-1">
                  x{Math.min(2, 1 + combo * 0.1).toFixed(1)}
                </span>
              )}
            </motion.div>
            <AnimatePresence mode="popLayout">
              {lastScorePopup && (
                <motion.div
                  key={lastScorePopup.key}
                  initial={{ opacity: 1, y: 0 }}
                  animate={{ opacity: 0, y: -16 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.6 }}
                  className="text-cyan-300 text-sm font-bold pr-2"
                >
                  +{lastScorePopup.points}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

       {/* 3. Lyrics Display (Singing Phase) */}
       <AnimatePresence>
         {gamePhase === 'singing' && !isInterlude && (
           <div className="absolute bottom-[20%] sm:bottom-[25%] left-0 right-0 z-20 px-4 sm:px-8 md:px-16 flex flex-col gap-6 sm:gap-8 md:gap-12 w-full max-w-7xl mx-auto will-change-transform">
             {/* Current Line */}
             <div className="self-start pl-2 sm:pl-4 md:pl-10 relative">
               {currentLine && (
                 <motion.div 
                    key={`line-${currentLyricIndex}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    className="flex flex-wrap gap-x-4 leading-normal"
                 >
                   {(() => {
                     const line = currentLine;
                     if (line.words && line.words.length > 0) {
                       return line.words.map((word, i) => {
                         const progress = getWordProgressInLine(line, i);
                         return (
                            <span key={i} className="relative block text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-black">
                               <span className="text-white relative z-10" style={{ WebkitTextStroke: '2px rgba(0,0,0,0.8)', paintOrder: 'stroke fill' }}>{word.text}</span>
                               <span className="absolute left-0 top-0 text-cyan-400 overflow-hidden whitespace-nowrap z-20" style={{ width: `${progress}%`, WebkitTextStroke: '2px rgba(0,0,0,0.8)', paintOrder: 'stroke fill' }}>{word.text}</span>
                            </span>
                         );
                       });
                     } else {
                        return (
                          <div className="relative text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-6xl font-black">
                             <span className="text-white" style={{ WebkitTextStroke: '2px rgba(0,0,0,0.8)', paintOrder: 'stroke fill' }}>{line.text}</span>
                             <span className="absolute left-0 top-0 text-cyan-400 overflow-hidden whitespace-nowrap" style={{ width: `${getLineProgress(line)}%`, WebkitTextStroke: '2px rgba(0,0,0,0.8)', paintOrder: 'stroke fill' }}>{line.text}</span>
                         </div>
                        );
                     }
                   })()}
                 </motion.div>
               )}
             </div>

             {/* Next Line */}
             <div className="self-end pr-2 sm:pr-4 md:pr-10 opacity-70">
                {nextLine && (
                   <div 
                     className="text-xl sm:text-2xl md:text-3xl lg:text-4xl md:text-5xl font-black text-white" 
                     style={{ 
                       WebkitTextStroke: '2px rgba(0,0,0,0.8)', 
                       paintOrder: 'stroke fill',
                       textShadow: '2px 2px 4px rgba(0,0,0,0.5)' 
                     }}
                   >
                      {nextLine.text}
                   </div>
                )}
             </div>
          </div>
        )}
      </AnimatePresence>

      {/* 4. Interlude Display */}
      <AnimatePresence>
        {isInterlude && (
           <motion.div 
             initial={{ opacity: 0, scale: 0.8 }}
             animate={{ opacity: 1, scale: 1 }}
             exit={{ opacity: 0 }}
             className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30"
           >
              <div className="bg-black/40 backdrop-blur-sm px-10 py-4 rounded-full border border-white/20">
                  <span className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-cyan-300 animate-pulse tracking-widest drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]">
                    {lyrics.length > 0 && localTime < lyrics[0].startTime ? "♪ 전 주 ♪" : "♪ 간 주 중 ♪"}
                  </span>
              </div>
           </motion.div>
        )}
      </AnimatePresence>

      {/* 5. Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 z-30 px-3 py-3 pb-4 sm:px-4 sm:py-4 md:px-6 md:py-6 md:pb-8 bg-gradient-to-t from-black via-black/80 to-transparent">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <span className="text-[10px] sm:text-xs text-gray-400 font-mono w-8 sm:w-10 text-right">{formatTime(localTime)}</span>
            <div
              className="flex-1 h-1.5 bg-white/20 rounded-full cursor-pointer group hover:h-2 transition-all"
              onClick={handleSeek}
            >
              <div
                className="h-full bg-blue-500 rounded-full relative"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity scale-0 group-hover:scale-100" />
              </div>
            </div>
            <span className="text-[10px] sm:text-xs text-gray-400 font-mono w-8 sm:w-10">{formatTime(duration)}</span>
          </div>

          <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Volume */}
                <div className="flex items-center gap-2 group">
                  <button
                    onClick={() => setIsMuted(!isMuted)}
                    className="p-2 text-gray-400 hover:text-white transition-colors"
                  >
                    {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                  </button>
                  <div className="w-0 overflow-hidden group-hover:w-24 transition-all duration-300">
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={volume}
                      onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        setVolume(v);
                        if (audioRef.current) audioRef.current.volume = v;
                      }}
                      className="w-20 h-1 accent-blue-500"
                    />
                  </div>
                </div>

                {/* Divider */}
                <div className="w-px h-6 bg-white/20" />

                {/* LiveKit Controls */}
                <button
                  onClick={handleMicToggle}
                  className={`p-2 rounded-full transition-all ${
                    isMicOn 
                    ? "text-white/60 hover:text-white" 
                    : "bg-red-500/80 text-white"
                  }`}
                >
                  {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>
                <button
                  onClick={handleCameraToggle}
                  className={`p-2 rounded-full transition-all ${
                    isCamOn 
                    ? "text-white/60 hover:text-white" 
                    : "bg-red-500/80 text-white"
                  }`}
                >
                  {isCamOn ? <Video className="w-4 h-4" /> : <CameraOff className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex items-center gap-6">
                <button
                  onClick={handleRestart}
                  className="p-2 text-white/60 hover:text-white transition-colors hover:rotate-[-30deg]"
                >
                  <RotateCcw className="w-6 h-6" />
                </button>
                
                <button
                  onClick={togglePlay}
                  disabled={!audioLoaded}
                  className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-white/10 disabled:opacity-50 disabled:scale-100"
                >
                  {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-1" />}
                </button>
                
                <button 
                  onClick={() => window.dispatchEvent(new Event("kero:skipForward"))}
                  className="p-2 text-white/60 hover:text-white transition-colors"
                >
                  <SkipForward className="w-6 h-6" />
                </button>
              </div>

            <div className="w-[140px] hidden md:block" /> 
          </div>
        </div>
      </div>

       {/* Final Score */}
       <AnimatePresence>
         {status === 'finished' && score > 0 && (
           <motion.div
             initial={{ opacity: 0, scale: 0.9 }}
             animate={{ opacity: 1, scale: 1 }}
             exit={{ opacity: 0 }}
             className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40"
           >
             <div className="bg-black/60 backdrop-blur-md rounded-2xl px-6 py-5 sm:px-8 sm:py-6 md:px-12 md:py-8 border border-white/15 flex flex-col items-center gap-3 shadow-2xl">
               <span className="text-white/50 text-sm font-medium tracking-widest uppercase">최종 점수</span>
               <motion.span
                 initial={{ scale: 0.5 }}
                 animate={{ scale: 1 }}
                 transition={{ type: "spring", damping: 12 }}
                 className="text-white font-black text-3xl sm:text-4xl md:text-5xl tabular-nums"
               >
                 {score.toLocaleString()}
               </motion.span>
               {combo >= 3 && (
                 <span className="text-cyan-400/80 text-sm font-medium">최고 콤보 달성!</span>
               )}
             </div>
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
