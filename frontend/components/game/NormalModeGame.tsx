"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipForward, Volume2, VolumeX, Mic, MicOff, RotateCcw, AlertCircle, Music2 } from "lucide-react";
import type { RootState } from "@/store";
import { updateCurrentTime, setGameStatus } from "@/store/slices/gameSlice";

interface LyricsWord {
  startTime: number;
  endTime: number;
  text: string;
}

interface LyricsLine {
  startTime: number;
  endTime: number;
  text: string;
  words?: LyricsWord[];
}

// 노래방 싱크 설정 상수
const SYNC_CONFIG = {
  WORD_LEAD_TIME: 0.03,        // 단어 하이라이트가 미리 시작하는 시간 (초)
  NEXT_LINE_PREVIEW: 0.5,      // 다음 가사 미리보기 시간 (초)
  LINE_HOLD_AFTER_END: 0.5,    // 가사가 끝난 후 유지 시간 (초)
};

export default function NormalModeGame() {
  const dispatch = useDispatch();
  const { currentSong, status, songQueue } = useSelector((state: RootState) => state.game);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [volume, setVolume] = useState(0.8);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number>(0);

  const lyrics: LyricsLine[] = currentSong?.lyrics || [];
  const audioUrl = currentSong?.instrumentalUrl || currentSong?.audioUrl;
  const videoId = currentSong?.videoId;

  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  
  const duration = audioDuration || currentSong?.duration || 0;

  // 정확한 가사 인덱스 계산 함수 (노래방 스타일)
  const findCurrentLyricIndex = useCallback((time: number): number => {
    let newIndex = -1;
    for (let i = 0; i < lyrics.length; i++) {
      const line = lyrics[i];
      const nextLine = lyrics[i + 1];
      
      if (time >= line.startTime) {
        if (time <= line.endTime) {
          newIndex = i;
          break;
        } else if (nextLine && time < nextLine.startTime && time - line.endTime < 1.0) {
          newIndex = i;
          break;
        } else if (!nextLine && time <= line.endTime + 2.0) {
          newIndex = i;
          break;
        }
      }
    }

    if (newIndex !== -1) {
      return newIndex;
    } else if (lyrics.length > 0 && time > lyrics[lyrics.length - 1].endTime) {
      return lyrics.length - 1;
    } else if (lyrics.length > 0 && time < lyrics[0]?.startTime) {
      return -1;
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
        lastTimeRef.current = time;
        setLocalTime(time);
        
        // 가사 인덱스 업데이트
        const newIndex = findCurrentLyricIndex(time);
        if (newIndex !== currentLyricIndex) {
          setCurrentLyricIndex(newIndex);
        }
        
        // Redux 업데이트는 덜 자주 (성능)
        if (Math.floor(time * 10) !== Math.floor(lastTimeRef.current * 10)) {
          dispatch(updateCurrentTime(time));
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
  }, []);

  const formatTime = (time: number) => {
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const progress = duration ? (localTime / duration) * 100 : 0;

  // 단어별 하이라이트 진행률 계산 (노래방 스타일)
  const getWordProgress = useCallback((word: LyricsWord): number => {
    const adjustedStart = word.startTime - SYNC_CONFIG.WORD_LEAD_TIME;
    const wordDuration = word.endTime - adjustedStart;
    
    if (localTime < adjustedStart) return 0;
    if (localTime >= word.endTime) return 100;
    
    return Math.min(100, Math.max(0, ((localTime - adjustedStart) / wordDuration) * 100));
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

  const youtubeEmbedUrl = useMemo(() => {
    if (!videoId) return null;
    return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&showinfo=0&rel=0&loop=1&playlist=${videoId}&modestbranding=1&enablejsapi=1`;
  }, [videoId]);

  const currentLine = lyrics[currentLyricIndex];
  const nextLine = lyrics[currentLyricIndex + 1];

  return (
    <div className="relative w-full h-full bg-black overflow-hidden select-none">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          muted={isMuted}
          crossOrigin="anonymous"
        />
      )}

      <div className="absolute inset-0 z-0 bg-black">
        {youtubeEmbedUrl ? (
          <div className="relative w-full h-full">
             <iframe
              src={youtubeEmbedUrl}
              className="absolute top-1/2 left-1/2 w-[150%] h-[150%] -translate-x-1/2 -translate-y-1/2 object-cover opacity-60 pointer-events-none"
              allow="autoplay; encrypted-media"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/90" />
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <Music2 className="w-32 h-32 text-white/10" />
          </div>
        )}
      </div>

      <div className="absolute top-0 left-0 right-0 z-20 flex flex-col items-center pt-20 pb-6 bg-gradient-to-b from-black/80 to-transparent">
        <h1 className="text-3xl font-bold text-white drop-shadow-lg tracking-tight text-center">
          {currentSong.title}
        </h1>
        <p className="text-xl text-white/80 font-medium drop-shadow-md mt-1 text-center">
          {currentSong.artist}
        </p>
        
        {songQueue.length > 0 && (
          <div className="mt-3 bg-white/10 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
            <span className="text-white/80 text-sm font-medium">
              예약곡 <span className="text-blue-400 font-bold">{songQueue.length}</span>
            </span>
          </div>
        )}
      </div>

      {audioError && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-30 p-4 bg-red-500/80 backdrop-blur-md text-white rounded-xl shadow-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5" />
          <span>{audioError}</span>
        </div>
      )}

      <div className="absolute bottom-[140px] left-0 right-0 z-20 px-4 md:px-12 text-center flex flex-col items-center justify-end min-h-[220px]">
        {/* 현재 가사 */}
        <div className="mb-4 w-full max-w-5xl">
          <AnimatePresence mode="wait">
            {currentLine ? (
              <motion.div
                key={`line-${currentLyricIndex}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="relative"
              >
                <div className="flex flex-wrap justify-center gap-x-2 gap-y-1 leading-relaxed">
                  {currentLine.words && currentLine.words.length > 0 ? (
                    currentLine.words.map((word, i) => {
                      const progress = getWordProgress(word);
                      const isActive = progress > 0 && progress < 100;
                      const isComplete = progress >= 100;
                      
                      return (
                        <span 
                          key={`${currentLyricIndex}-${i}`} 
                          className={`relative text-4xl md:text-5xl lg:text-6xl font-black tracking-wide transition-transform duration-100 ${
                            isActive ? "scale-105" : ""
                          }`}
                        >
                          {/* 배경 텍스트 (흰색) */}
                          <span className={`${isComplete ? "text-transparent" : "text-white/80"} drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]`}>
                            {word.text}
                          </span>
                          
                          {/* 하이라이트 오버레이 (그라디언트) */}
                          <span 
                            className="absolute inset-0 bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(59,130,246,0.8)]"
                            style={{ 
                              clipPath: `inset(0 ${100 - progress}% 0 0)`,
                            }}
                          >
                            {word.text}
                          </span>
                        </span>
                      );
                    })
                  ) : (
                    <span className="relative text-4xl md:text-5xl lg:text-6xl font-black tracking-wide">
                      <span className="text-white/80 drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]">
                        {currentLine.text}
                      </span>
                      <span 
                        className="absolute inset-0 bg-gradient-to-r from-cyan-400 via-blue-500 to-purple-500 bg-clip-text text-transparent"
                        style={{ clipPath: `inset(0 ${100 - getLineProgress(currentLine)}% 0 0)` }}
                      >
                        {currentLine.text}
                      </span>
                    </span>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-center gap-2"
              >
                <span className="w-3 h-3 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-3 h-3 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-3 h-3 bg-white/30 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 다음 가사 미리보기 */}
        <div className="h-14 w-full max-w-4xl flex items-center justify-center">
          <AnimatePresence mode="wait">
            {nextLine && (
              <motion.p 
                key={`next-${currentLyricIndex + 1}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 0.6, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="text-xl md:text-2xl text-gray-300 font-semibold tracking-wide line-clamp-1 drop-shadow-lg"
              >
                {nextLine.text}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-30 px-6 py-6 pb-8 bg-gradient-to-t from-black via-black/80 to-transparent">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <span className="text-xs text-gray-400 font-mono w-10 text-right">{formatTime(localTime)}</span>
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
            <span className="text-xs text-gray-400 font-mono w-10">{formatTime(duration)}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
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
                      const newVolume = parseFloat(e.target.value);
                      setVolume(newVolume);
                      if (audioRef.current) audioRef.current.volume = newVolume;
                    }}
                    className="w-20 h-1 accent-blue-500"
                  />
                </div>
              </div>
              
              <button
                onClick={() => setIsMicOn(!isMicOn)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider transition-all ${
                  isMicOn 
                  ? "bg-green-500/20 text-green-400 border border-green-500/50" 
                  : "bg-white/10 text-gray-400 border border-transparent hover:bg-white/20"
                }`}
              >
                {isMicOn ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
                <span>{isMicOn ? "Mic On" : "Mic Off"}</span>
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
              
              <button className="p-2 text-white/60 hover:text-white transition-colors">
                <SkipForward className="w-6 h-6" />
              </button>
            </div>

            <div className="w-[140px] hidden md:block" /> 
          </div>
        </div>
      </div>
    </div>
  );
}
