"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { Play, Pause, SkipForward, Volume2, VolumeX, Mic, MicOff, RotateCcw, AlertCircle } from "lucide-react";
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

export default function NormalModeGame() {
  const dispatch = useDispatch();
  const { currentSong, status } = useSelector((state: RootState) => state.game);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [localTime, setLocalTime] = useState(0);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [volume, setVolume] = useState(0.8);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioLoaded, setAudioLoaded] = useState(false);

  const lyrics: LyricsLine[] = currentSong?.lyrics || [];
  const audioUrl = currentSong?.instrumentalUrl || currentSong?.audioUrl;

  const animationFrameRef = useRef<number | null>(null);

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

    const handleError = () => {
      setAudioError("오디오를 불러올 수 없습니다. 다시 시도해주세요.");
      setAudioLoaded(false);
    };

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("error", handleError);
    };
  }, [dispatch, volume]);

  useEffect(() => {
    if (!isPlaying || !audioRef.current) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }

    const updateTime = () => {
      if (!audioRef.current || !isPlaying) return;
      
      const time = audioRef.current.currentTime;
      setLocalTime(time);
      dispatch(updateCurrentTime(time));

      const index = lyrics.findIndex((line, i) => {
        const nextLine = lyrics[i + 1];
        return time >= line.startTime && (nextLine ? time < nextLine.startTime : time <= line.endTime);
      });
      setCurrentLyricIndex(index);

      animationFrameRef.current = requestAnimationFrame(updateTime);
    };

    animationFrameRef.current = requestAnimationFrame(updateTime);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, lyrics, dispatch]);

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
    if (!audioRef.current || !currentSong?.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const newTime = percent * currentSong.duration;
    audioRef.current.currentTime = newTime;
    setLocalTime(newTime);
  }, [currentSong?.duration]);

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

  const progress = currentSong?.duration ? (localTime / currentSong.duration) * 100 : 0;

  const getLyricProgress = (line: LyricsLine) => {
    if (localTime < line.startTime) return 0;
    if (localTime > line.endTime) return 100;
    return ((localTime - line.startTime) / (line.endTime - line.startTime)) * 100;
  };

  if (!currentSong) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <AlertCircle className="w-16 h-16 text-gray-500 mb-4" />
        <p className="text-gray-400">노래 정보를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-black via-gray-900 to-black">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          muted={isMuted}
          crossOrigin="anonymous"
        />
      )}

      <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#C0C0C0]/5 via-transparent to-transparent" />
        
        <div className="text-center mb-8 z-10">
          <h2 className="text-2xl font-bold text-white mb-2">{currentSong.title}</h2>
          <p className="text-gray-400">{currentSong.artist}</p>
        </div>

        {audioError && (
          <div className="z-10 mb-4 p-4 bg-red-500/20 border border-red-500/30 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400" />
            <span className="text-red-400">{audioError}</span>
          </div>
        )}

        <div className="w-full max-w-4xl z-10">
          <div className="relative h-[350px] overflow-hidden rounded-3xl bg-black/50 backdrop-blur-xl border border-white/10">
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8">
              <AnimatePresence mode="popLayout">
                {lyrics.length > 0 ? lyrics.map((line, index) => {
                  const isActive = index === currentLyricIndex;
                  const isPast = index < currentLyricIndex;
                  const distance = index - currentLyricIndex;

                  if (Math.abs(distance) > 3) return null;

                  return (
                    <motion.div
                      key={`${index}-${line.text}`}
                      initial={{ opacity: 0, y: 80, scale: 0.8 }}
                      animate={{
                        opacity: isActive ? 1 : isPast ? 0.3 : 0.5,
                        y: distance * 70,
                        scale: isActive ? 1.15 : 1,
                        filter: isActive ? "blur(0px)" : "blur(1px)",
                      }}
                      exit={{ opacity: 0, y: -80, scale: 0.8 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      className="absolute text-center w-full px-4"
                    >
                      {isActive ? (
                        <div className="relative inline-block">
                          <span className="text-3xl font-bold text-white/30">
                            {line.words?.map((w, i) => (
                              <span key={i}>{w.text}{i < (line.words?.length || 0) - 1 ? " " : ""}</span>
                            )) || line.text}
                          </span>
                          <span className="absolute inset-0 text-3xl font-bold overflow-hidden whitespace-nowrap">
                            {line.words?.map((word, i) => {
                              const wordProgress = Math.max(0, Math.min(1, 
                                (localTime - word.startTime) / (word.endTime - word.startTime)
                              ));
                              return (
                                <span 
                                  key={i} 
                                  className="relative inline-block"
                                  style={{ 
                                    color: wordProgress > 0 ? "#C0C0C0" : "transparent",
                                    clipPath: `inset(0 ${100 - wordProgress * 100}% 0 0)`,
                                  }}
                                >
                                  {word.text}{i < (line.words?.length || 0) - 1 ? " " : ""}
                                </span>
                              );
                            }) || (
                              <span 
                                className="text-[#C0C0C0]"
                                style={{ clipPath: `inset(0 ${100 - getLyricProgress(line)}% 0 0)` }}
                              >
                                {line.text}
                              </span>
                            )}
                          </span>
                        </div>
                      ) : (
                        <span className={`text-2xl font-medium ${isPast ? "text-gray-600" : "text-gray-400"}`}>
                          {line.text}
                        </span>
                      )}
                    </motion.div>
                  );
                }) : (
                  <p className="text-gray-500 text-xl">가사를 불러오는 중...</p>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>

      <div className="p-6 bg-gradient-to-t from-black via-black/95 to-transparent">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <span className="text-sm text-gray-400 w-12 text-right font-mono">{formatTime(localTime)}</span>
            <div
              className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden cursor-pointer group"
              onClick={handleSeek}
            >
              <motion.div
                className="h-full bg-gradient-to-r from-[#C0C0C0] to-white relative"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity" />
              </motion.div>
            </div>
            <span className="text-sm text-gray-400 w-12 font-mono">{formatTime(currentSong.duration || 0)}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
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
                className="w-24 accent-[#C0C0C0]"
              />
              <button
                onClick={() => setIsMicOn(!isMicOn)}
                className={`p-3 rounded-full transition-colors ${
                  isMicOn ? "bg-green-500/20 text-green-400" : "bg-white/10 hover:bg-white/20"
                }`}
              >
                {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
              </button>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handleRestart}
                className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              <motion.button
                onClick={togglePlay}
                disabled={!audioLoaded}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="p-5 rounded-full bg-gradient-to-r from-[#C0C0C0] to-white text-black shadow-lg shadow-white/20 disabled:opacity-50"
              >
                {isPlaying ? <Pause className="w-7 h-7" /> : <Play className="w-7 h-7 ml-1" />}
              </motion.button>
              <button className="p-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors">
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            <div className="w-[140px]" />
          </div>
        </div>
      </div>
    </div>
  );
}
