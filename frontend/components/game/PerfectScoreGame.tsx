"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { Play, Pause, Volume2, Mic, MicOff, RotateCcw, SkipForward, AlertCircle } from "lucide-react";
import type { RootState } from "@/store";
import { updateCurrentTime, setGameStatus } from "@/store/slices/gameSlice";

interface LyricsWord {
  startTime: number;
  endTime: number;
  text: string;
  pitch?: number;
  note?: string;
  midi?: number;
}

interface LyricsLine {
  startTime: number;
  endTime: number;
  text: string;
  words?: LyricsWord[];
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const VISIBLE_WINDOW = 8;
const HIT_LINE_RATIO = 0.2;
const MIDI_MIN = 36;
const MIDI_MAX = 83;
const USER_TRAIL_SECONDS = 4;
const RAIL_HEIGHT = 8;
const LABEL_AREA_WIDTH = 54;

type JudgmentLabel = "PERFECT" | "GREAT" | "GOOD" | "NORMAL" | "BAD";

type GameStats = {
  totalWords: number;
  scoredWords: number;
  perfectCount: number;
  greatCount: number;
  goodCount: number;
  normalCount: number;
  badCount: number;
  maxCombo: number;
  vibratoCount: number;
};

const createInitialStats = (): GameStats => ({
  totalWords: 0,
  scoredWords: 0,
  perfectCount: 0,
  greatCount: 0,
  goodCount: 0,
  normalCount: 0,
  badCount: 0,
  maxCombo: 0,
  vibratoCount: 0,
});

const getGrade = (scorePercent: number) => {
  if (scorePercent >= 95) return "SSS";
  if (scorePercent >= 90) return "SS";
  if (scorePercent >= 85) return "S";
  if (scorePercent >= 80) return "A";
  if (scorePercent >= 70) return "B";
  return "C";
};

const JUDGMENT_SEGMENTS: { key: JudgmentLabel; label: string; color: string }[] = [
  { key: "PERFECT", label: "PERFECT", color: "#FFD700" },
  { key: "GREAT", label: "GREAT", color: "#34D399" },
  { key: "GOOD", label: "GOOD", color: "#60A5FA" },
  { key: "NORMAL", label: "NORMAL", color: "#A78BFA" },
  { key: "BAD", label: "BAD", color: "#EF4444" },
];

const RADAR_LABELS = ["음정", "박자", "바이브레이션", "표현력", "안정도"];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const freqToMidi = (frequency: number) => 69 + 12 * Math.log2(frequency / 440);

const formatTime = (time: number) => {
  const mins = Math.floor(time / 60);
  const secs = Math.floor(time % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function PerfectScoreGame() {
  const dispatch = useDispatch();
  const { currentSong, status, songQueue } = useSelector((state: RootState) => state.game);

  const rafRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const lastTimeRef = useRef(0);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const isMicOnRef = useRef(false);
  const userPitchTrailRef = useRef<{ time: number; midi: number }[]>([]);
  const scoredResultsRef = useRef<Map<string, { result: string; scoredAt: number }>>(new Map());
  const latestPitchRef = useRef<{ frequency: number; time: number }>({ frequency: 0, time: 0 });
  const pitchSamplesRef = useRef<Map<string, number[]>>(new Map());
  const judgementPopupsRef = useRef<
    { id: number; text: string; time: number; x: number; y: number; color: string }[]
  >([]);
  const lastJudgmentRef = useRef<JudgmentLabel | null>(null);
  const statsRef = useRef<GameStats>(createInitialStats());
  const radarCanvasRef = useRef<HTMLCanvasElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [localTime, setLocalTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [volume, setVolume] = useState(1);
  const [scorePopups, setScorePopups] = useState<{ id: number; type: string; points: number }[]>([]);

  const lyrics: LyricsLine[] = currentSong?.lyrics || [];
  const audioUrl = currentSong?.instrumentalUrl || currentSong?.audioUrl;
  const progress = duration ? (localTime / duration) * 100 : 0;

  isMicOnRef.current = isMicOn;

  const words = useMemo(() => {
    if (!lyrics.length) return [] as Array<LyricsWord & { lineIndex: number; wordIndex: number }>;
    const list: Array<LyricsWord & { lineIndex: number; wordIndex: number }> = [];
    lyrics.forEach((line, lineIndex) => {
      line.words?.forEach((word, wordIndex) => {
        if (typeof word.midi === "number") {
          list.push({ ...word, lineIndex, wordIndex });
        }
      });
    });
    return list;
  }, [lyrics]);

  useEffect(() => {
    statsRef.current = createInitialStats();
    statsRef.current.totalWords = words.length;
    lastJudgmentRef.current = null;
  }, [currentSong, words.length]);

  const findCurrentLyricIndex = useCallback(
    (time: number): number => {
      if (lyrics.length === 0) return -1;
      if (time < lyrics[0].startTime) return 0;

      for (let i = 0; i < lyrics.length; i++) {
        const line = lyrics[i];
        const nextLine = lyrics[i + 1];

        if (time >= line.startTime && time <= line.endTime) {
          return i;
        }

        if (time > line.endTime) {
          if (nextLine && time < nextLine.startTime) {
            const gapDuration = nextLine.startTime - line.endTime;
            if (time <= line.endTime + 0.5) return i;
            if (gapDuration <= 3.0) return i + 1;
            return -1;
          }
          if (!nextLine) {
            if (time <= line.endTime + 2.0) return i;
            return -1;
          }
        }
      }

      return -1;
    },
    [lyrics]
  );

  const currentLine = currentLyricIndex >= 0 ? lyrics[currentLyricIndex] : null;
  const nextLine = useMemo(() => {
    if (currentLyricIndex >= 0) {
      return lyrics[currentLyricIndex + 1] || null;
    }
    return lyrics.find(line => line.startTime > localTime) || null;
  }, [currentLyricIndex, lyrics, localTime]);

  const startMicrophone = useCallback(async () => {
    try {
      if (mediaStreamRef.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      audioContextRef.current = new AudioContext();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      source.connect(analyserRef.current);
      setIsMicOn(true);
    } catch (error) {
      console.error("Microphone access denied:", error);
      setIsMicOn(false);
    }
  }, []);

  const stopMicrophone = useCallback(() => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    if (!audioRef.current) return;

    const audio = audioRef.current;
    audio.volume = volume;

    const handleEnded = () => {
      setIsPlaying(false);
      dispatch(setGameStatus("finished"));
    };

    const handleCanPlay = () => setAudioLoaded(true);

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("canplay", handleCanPlay);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);

    return () => {
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("canplay", handleCanPlay);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
    };
  }, [dispatch, volume]);

  useEffect(() => {
    if (!audioRef.current || !audioLoaded) return;
    if (status === "playing" && !isPlaying) {
      audioRef.current.play().catch(console.error);
      setIsPlaying(true);
    }
    if (status === "paused" && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
    if (status === "finished" && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, [audioLoaded, isPlaying, status]);

  useEffect(() => {
    if (!isMicOn) {
      stopMicrophone();
      return;
    }
    if (!analyserRef.current) {
      startMicrophone();
    }
  }, [isMicOn, startMicrophone, stopMicrophone]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !audioLoaded) return;
    if (isPlaying) {
      audioRef.current.pause();
      dispatch(setGameStatus("paused"));
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      if (isMicOn && !analyserRef.current) {
        startMicrophone();
      }
      dispatch(setGameStatus("playing"));
      setIsPlaying(true);
    }
  }, [audioLoaded, dispatch, isMicOn, isPlaying, startMicrophone]);

  const handleRestart = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    lastTimeRef.current = 0;
    setLocalTime(0);
    setCurrentLyricIndex(-1);
    scoreRef.current = 0;
    comboRef.current = 0;
    setScore(0);
    setCombo(0);
    setScorePopups([]);
    userPitchTrailRef.current = [];
    scoredResultsRef.current.clear();
    pitchSamplesRef.current.clear();
    judgementPopupsRef.current = [];
    lastJudgmentRef.current = null;
    statsRef.current = createInitialStats();
    statsRef.current.totalWords = words.length;
  }, [words.length]);

  const handleSeek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!audioRef.current || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      const newTime = clamp(percent, 0, 1) * duration;
      audioRef.current.currentTime = newTime;
      setLocalTime(newTime);
    },
    [duration]
  );

  const autoCorrelate = (buffer: Float32Array, sampleRate: number): number => {
    let size = buffer.length;
    let rms = 0;
    for (let i = 0; i < size; i++) {
      rms += buffer[i] * buffer[i];
    }
    rms = Math.sqrt(rms / size);
    if (rms < 0.01) return -1;

    let r1 = 0;
    let r2 = size - 1;
    const threshold = 0.2;

    for (let i = 0; i < size / 2; i++) {
      if (Math.abs(buffer[i]) < threshold) {
        r1 = i;
        break;
      }
    }

    for (let i = 1; i < size / 2; i++) {
      if (Math.abs(buffer[size - i]) < threshold) {
        r2 = size - i;
        break;
      }
    }

    buffer = buffer.slice(r1, r2);
    size = buffer.length;

    const c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - i; j++) {
        c[i] += buffer[j] * buffer[j + i];
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;

    let maxval = -1;
    let maxpos = -1;
    for (let i = d; i < size; i++) {
      if (c[i] > maxval) {
        maxval = c[i];
        maxpos = i;
      }
    }

    return sampleRate / maxpos;
  };

  const loop = useCallback(() => {
    const audio = audioRef.current;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas?.getContext("2d");

    const now = audio?.currentTime ?? lastTimeRef.current;

    if (Math.abs(now - lastTimeRef.current) > 0.016) {
      if (Math.floor(now * 10) !== Math.floor(lastTimeRef.current * 10)) {
        dispatch(updateCurrentTime(now));
      }
      lastTimeRef.current = now;
      setLocalTime(now);

      const newIndex = findCurrentLyricIndex(now);
      if (newIndex !== currentLyricIndex) {
        setCurrentLyricIndex(newIndex);
      }
    }

    if (isMicOnRef.current && analyserRef.current && audioContextRef.current) {
      const bufferLength = analyserRef.current.fftSize;
      const buffer = new Float32Array(bufferLength);
      analyserRef.current.getFloatTimeDomainData(buffer);
      const frequency = autoCorrelate(buffer, audioContextRef.current.sampleRate);

       if (frequency > 0) {
         latestPitchRef.current = { frequency, time: now };
         const rawMidi = freqToMidi(frequency);
         userPitchTrailRef.current.push({ time: now, midi: rawMidi });
       }
    }

    userPitchTrailRef.current = userPitchTrailRef.current.filter(point => now - point.time <= USER_TRAIL_SECONDS);

    if (isMicOnRef.current && latestPitchRef.current.frequency > 0) {
      words.forEach(word => {
        if (now >= word.startTime && now <= word.endTime && typeof word.midi === "number") {
          const key = `${word.lineIndex}-${word.wordIndex}`;
          const list = pitchSamplesRef.current.get(key) || [];
          list.push(latestPitchRef.current.frequency);
          pitchSamplesRef.current.set(key, list);
        }
      });
    }

    words.forEach(word => {
      if (typeof word.midi !== "number") return;
      if (now <= word.endTime) return;
      const key = `${word.lineIndex}-${word.wordIndex}`;
      if (scoredResultsRef.current.has(key)) return;

      const samples = pitchSamplesRef.current.get(key) || [];
      const targetFreq = midiToFreq(word.midi);
      let bestFreq = 0;
      let bestCents = Number.POSITIVE_INFINITY;

      for (const sample of samples) {
        const cents = 1200 * Math.log2(sample / targetFreq);
        const absCents = Math.abs(cents);
        if (absCents < bestCents) {
          bestCents = absCents;
          bestFreq = sample;
        }
      }

      let result = "MISS";
      let basePoints = 0;
      if (bestFreq > 0) {
        if (bestCents < 10) {
          result = "PERFECT";
          basePoints = 100;
        } else if (bestCents < 25) {
          result = "GREAT";
          basePoints = 75;
        } else if (bestCents < 50) {
          result = "GOOD";
          basePoints = 50;
        }
      }

      const wordDuration = word.endTime - word.startTime;
      const hasVibrato = wordDuration > 0.8;
      const judgment: JudgmentLabel = result === "PERFECT"
        ? "PERFECT"
        : result === "GREAT"
        ? "GREAT"
        : result === "GOOD"
        ? "GOOD"
        : bestFreq > 0
        ? "NORMAL"
        : "BAD";

      lastJudgmentRef.current = judgment;
      statsRef.current.scoredWords += 1;
      if (judgment === "PERFECT") statsRef.current.perfectCount += 1;
      if (judgment === "GREAT") statsRef.current.greatCount += 1;
      if (judgment === "GOOD") statsRef.current.goodCount += 1;
      if (judgment === "NORMAL") statsRef.current.normalCount += 1;
      if (judgment === "BAD") statsRef.current.badCount += 1;
      if (hasVibrato) statsRef.current.vibratoCount += 1;

      scoredResultsRef.current.set(key, { result, scoredAt: now });
      pitchSamplesRef.current.delete(key);

      const popupId = Date.now() + Math.random();
      if (basePoints > 0 && isMicOnRef.current) {
        const mult = Math.min(2, 1 + comboRef.current * 0.1);
        const points = Math.round(basePoints * mult);
        comboRef.current += 1;
        scoreRef.current += points;
        setScore(scoreRef.current);
        setCombo(comboRef.current);
        setScorePopups(prev => [...prev.slice(-3), { id: popupId, type: result, points }]);
      } else {
        comboRef.current = 0;
        setCombo(0);
        setScorePopups(prev => [...prev.slice(-3), { id: popupId, type: "MISS", points: 0 }]);
      }

      statsRef.current.maxCombo = Math.max(statsRef.current.maxCombo, comboRef.current);

      const yForPopup = clamp(MIDI_MAX - word.midi, 0, MIDI_MAX - MIDI_MIN);
      judgementPopupsRef.current.push({
        id: popupId,
        text: result,
        time: now,
        x: 0,
        y: yForPopup,
        color: result === "PERFECT" ? "#FFD700" : result === "GREAT" ? "#34D399" : result === "GOOD" ? "#60A5FA" : "#777777",
      });
    });

    if (canvas && ctx && container) {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      ctx.clearRect(0, 0, width, height);

      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, "#0E041A");
      background.addColorStop(1, "#050814");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const drawRail = (y: number) => {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y, width, RAIL_HEIGHT);
        ctx.clip();
        const stripeWidth = 12;
        for (let x = -width; x < width * 2; x += stripeWidth) {
          ctx.strokeStyle = (Math.floor(x / stripeWidth) % 2 === 0) ? "#00F2FF" : "#111111";
          ctx.lineWidth = 6;
          ctx.beginPath();
          ctx.moveTo(x, y + RAIL_HEIGHT + 6);
          ctx.lineTo(x + RAIL_HEIGHT * 2, y - 6);
          ctx.stroke();
        }
        ctx.restore();
      };

      drawRail(0);
      drawRail(height - RAIL_HEIGHT);

      const contentTop = RAIL_HEIGHT + 8;
      const contentBottom = height - RAIL_HEIGHT - 8;
      const staffHeight = Math.max(1, contentBottom - contentTop);
      const hitLineX = Math.max(width * HIT_LINE_RATIO, LABEL_AREA_WIDTH + 12);
      const pixelsPerSecond = width / VISIBLE_WINDOW;
      const leftWindow = VISIBLE_WINDOW * HIT_LINE_RATIO;
      const rightWindow = VISIBLE_WINDOW - leftWindow;
      const startTime = now - leftWindow;
      const endTime = now + rightWindow;

      const midiToY = (midi: number) => {
        const range = Math.max(1, MIDI_MAX - MIDI_MIN);
        return contentTop + ((MIDI_MAX - midi) / range) * staffHeight;
      };

      const beatInterval = 1.0;
      const firstBeat = Math.ceil(startTime / beatInterval) * beatInterval;
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let t = firstBeat; t < endTime; t += beatInterval) {
        const x = hitLineX + (t - now) * pixelsPerSecond;
        ctx.moveTo(x, contentTop);
        ctx.lineTo(x, contentBottom);
      }
      ctx.stroke();

      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi += 1) {
        const y = midiToY(midi);
        const noteIdx = midi % 12;
        const isC = noteIdx === 0;
        const isNatural = [0, 2, 4, 5, 7, 9, 11].includes(noteIdx);

        ctx.beginPath();
        ctx.moveTo(LABEL_AREA_WIDTH, y);
        ctx.lineTo(width, y);

        if (isC) {
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "rgba(255,255,255,0.20)";
          ctx.setLineDash([]);
          ctx.stroke();
          const octave = Math.floor(midi / 12) - 1;
          ctx.fillStyle = "rgba(255,255,255,0.70)";
          ctx.font = "bold 11px 'Noto Sans KR', 'Rajdhani', sans-serif";
          ctx.fillText(`C${octave}`, LABEL_AREA_WIDTH - 6, y);
        } else if (isNatural) {
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = "rgba(255,255,255,0.08)";
          ctx.setLineDash([]);
          ctx.stroke();
          const octave = Math.floor(midi / 12) - 1;
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.font = "9px 'Noto Sans KR', 'Rajdhani', sans-serif";
          ctx.fillText(`${NOTE_NAMES[noteIdx]}${octave}`, LABEL_AREA_WIDTH - 6, y);
        } else {
          ctx.lineWidth = 0.5;
          ctx.strokeStyle = "rgba(255,255,255,0.03)";
          ctx.setLineDash([2, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      const pulse = 0.7 + 0.3 * Math.sin(now * 6);
      ctx.save();
      ctx.shadowColor = "rgba(0, 229, 255, 0.9)";
      ctx.shadowBlur = 18 + pulse * 6;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hitLineX, contentTop);
      ctx.lineTo(hitLineX, contentBottom);
      ctx.stroke();
      ctx.restore();

      const drawPill = (x: number, y: number, widthValue: number, heightValue: number) => {
        const r = heightValue / 2;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + widthValue - r, y);
        ctx.arc(x + widthValue - r, y + r, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(x + r, y + heightValue);
        ctx.arc(x + r, y + r, r, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
      };

       words.forEach((word, index) => {
         if (typeof word.midi !== "number") return;
         if (word.endTime < startTime || word.startTime > endTime) return;

         const xStartRaw = hitLineX + (word.startTime - now) * pixelsPerSecond;
         const xEndRaw = hitLineX + (word.endTime - now) * pixelsPerSecond;
         const xStart = xStartRaw + 1.5;
         const xEnd = xEndRaw - 1.5;
         const barWidth = Math.max(8, xEnd - xStart);
        const yCenter = midiToY(word.midi);
        const barHeight = 12;
        const yTop = yCenter - barHeight / 2;

        const key = `${word.lineIndex}-${word.wordIndex}`;
        const result = scoredResultsRef.current.get(key)?.result;

        const isPast = word.endTime < now;
        const isActive = now >= word.startTime && now <= word.endTime;

        const createGlassGradient = (top: string, mid: string, bottom: string) => {
          const g = ctx.createLinearGradient(0, yTop, 0, yTop + barHeight);
          g.addColorStop(0, top);
          g.addColorStop(0.5, mid);
          g.addColorStop(1, bottom);
          return g;
        };

        let fillStyle: string | CanvasGradient = "#333";
        let glowColor = "rgba(0,0,0,0)";

        if (result) {
          if (result === "PERFECT" || result === "GREAT") {
            fillStyle = createGlassGradient("#CC9A00", "#FFD700", "#FFA000");
            glowColor = "rgba(255, 215, 0, 0.7)";
          } else if (result === "GOOD") {
            fillStyle = createGlassGradient("#2F6EDB", "#60A5FA", "#3070CC");
          } else {
            fillStyle = createGlassGradient("#2B2B2B", "#444444", "#2B2B2B");
          }
        } else if (isPast) {
          fillStyle = createGlassGradient("#2B2B2B", "#444444", "#2B2B2B");
        } else if (isActive) {
          fillStyle = createGlassGradient("#00B7D6", "#FFFFFF", "#00E5FF");
          glowColor = "rgba(0, 229, 255, 0.9)";
        } else {
          fillStyle = createGlassGradient("#3A7CB5", "#FFFFFF", "#80D0FF");
        }

        ctx.save();
        if (glowColor !== "rgba(0,0,0,0)") {
          ctx.shadowColor = glowColor;
          ctx.shadowBlur = isActive ? 16 : 10;
        }
        ctx.fillStyle = fillStyle;
        drawPill(xStart, yTop, barWidth, barHeight);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();

        const wordDuration = word.endTime - word.startTime;
        const hasVibrato = wordDuration > 0.8;
        const prevWord = words[index - 1];
        const interval = typeof prevWord?.midi === "number" ? word.midi - prevWord.midi : 0;
        const hasRise = interval >= 3;
        const hasFall = interval <= -3;
        const techniqueIcons: { label: string; color: string }[] = [];

        if (hasVibrato) {
          techniqueIcons.push({ label: "V", color: "#FF69B4" });
        }
        if (hasRise) {
          techniqueIcons.push({ label: "↑", color: "#00FF88" });
        } else if (hasFall) {
          techniqueIcons.push({ label: "↓", color: "#FF8800" });
        }

        if (techniqueIcons.length > 0) {
          const iconRadius = 8;
          const iconSpacing = 4;
          const baseX = xStart + barWidth - iconRadius - 2;
          const baseY = yCenter;

          ctx.save();
          ctx.font = "bold 10px 'Noto Sans KR', 'Rajdhani', sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";

          techniqueIcons.forEach((icon, iconIndex) => {
            const iconX = baseX - iconIndex * (iconRadius * 2 + iconSpacing);
            ctx.fillStyle = icon.color;
            ctx.beginPath();
            ctx.arc(iconX, baseY, iconRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(0,0,0,0.85)";
            ctx.fillText(icon.label, iconX, baseY + 0.5);
          });

          ctx.restore();
        }
      });

      const trail = userPitchTrailRef.current;
      if (trail.length > 0) {
        ctx.save();
        ctx.strokeStyle = "#00E5FF";
        ctx.lineWidth = 3;
        ctx.shadowColor = "rgba(0, 229, 255, 0.6)";
        ctx.shadowBlur = 12;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();

        let started = false;
        for (let i = 0; i < trail.length; i++) {
          const point = trail[i];
          const x = hitLineX + (point.time - now) * pixelsPerSecond;
          const y = midiToY(point.midi);
          if (x < 0 || x > width) continue;

          if (!started) {
            ctx.moveTo(x, y);
            started = true;
           } else {
             const prevPoint = trail[i - 1];
             if (point.time - prevPoint.time > 0.3 || Math.abs(point.midi - prevPoint.midi) > 12) {
               ctx.moveTo(x, y);
             } else {
               ctx.lineTo(x, y);
             }
           }
        }
        ctx.stroke();

        const lastPoint = trail[trail.length - 1];
        if (lastPoint) {
          const headX = hitLineX + (lastPoint.time - now) * pixelsPerSecond;
          const headY = midiToY(lastPoint.midi);
          if (headX > 0 && headX < width) {
            ctx.fillStyle = "#FFFFFF";
            ctx.shadowColor = "rgba(255,255,255,0.9)";
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(headX, headY, 4, 0, Math.PI * 2);
            ctx.fill();

            if (Math.abs(headX - hitLineX) < 10) {
              ctx.fillStyle = "#00E5FF";
              ctx.shadowColor = "rgba(0,229,255,0.9)";
              ctx.shadowBlur = 16;
              ctx.beginPath();
              ctx.arc(headX, headY, 6, 0, Math.PI * 2);
              ctx.fill();
            }

            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            for (let i = 0; i < 3; i++) {
              ctx.beginPath();
              ctx.arc(headX + 8 + i * 3, headY - 6 - i * 2, 1.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }

        ctx.restore();
      }

      const popupDuration = 0.5;
      judgementPopupsRef.current = judgementPopupsRef.current.filter(popup => now - popup.time <= popupDuration);
      judgementPopupsRef.current.forEach(popup => {
        const life = clamp(1 - (now - popup.time) / popupDuration, 0, 1);
        const alpha = life * life;
        ctx.save();
        ctx.font = "bold 20px 'Noto Sans KR', 'Rajdhani', sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = `${popup.color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
        ctx.shadowColor = popup.color;
        ctx.shadowBlur = 10 * alpha;
        const y = clamp(contentTop + popup.y * (staffHeight / (MIDI_MAX - MIDI_MIN)), contentTop, contentBottom);
        ctx.fillText(popup.text, hitLineX + 16, y - 8 * (1 - alpha));
        ctx.restore();
      });
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [currentLyricIndex, dispatch, findCurrentLyricIndex, words]);

  useEffect(() => {
    if (!audioLoaded) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [audioLoaded, loop]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopMicrophone();
    };
  }, [stopMicrophone]);

  const statsSnapshot = statsRef.current;
  const totalWords = statsSnapshot.totalWords || words.length;
  const totalScored = statsSnapshot.scoredWords;
  const perfectCount = statsSnapshot.perfectCount;
  const greatCount = statsSnapshot.greatCount;
  const goodCount = statsSnapshot.goodCount;
  const normalCount = statsSnapshot.normalCount;
  const badCount = statsSnapshot.badCount;
  const accuracy = totalScored
    ? Math.round(((perfectCount + greatCount + goodCount) / totalScored) * 100)
    : 0;
  const scorePercent = totalWords
    ? Math.min(100, Math.round((score / (totalWords * 100)) * 100))
    : 0;
  const grade = getGrade(scorePercent);
  const gradeColor = scorePercent >= 85
    ? "#FFD700"
    : scorePercent >= 80
    ? "#34D399"
    : scorePercent >= 70
    ? "#60A5FA"
    : "#EF4444";
  const pitchScore = totalScored
    ? Math.round(
        (perfectCount * 100 + greatCount * 85 + goodCount * 70 + normalCount * 45 + badCount * 20) /
          totalScored
      )
    : 0;
  const rhythmScore = totalWords
    ? Math.min(100, Math.round((statsSnapshot.maxCombo / totalWords) * 100))
    : 0;
  const vibratoScore = totalScored
    ? Math.min(100, Math.round((statsSnapshot.vibratoCount / totalScored) * 100))
    : 0;
  const expressionScore = totalScored
    ? Math.min(100, Math.round(((perfectCount + greatCount * 0.7) / totalScored) * 100))
    : 0;
  const stabilityScore = totalScored
    ? Math.min(100, Math.round(((totalScored - badCount - normalCount * 0.5) / totalScored) * 100))
    : 0;
  const radarValues = [pitchScore, rhythmScore, vibratoScore, expressionScore, stabilityScore];
  const segmentCounts: Record<JudgmentLabel, number> = {
    PERFECT: perfectCount,
    GREAT: greatCount,
    GOOD: goodCount,
    NORMAL: normalCount,
    BAD: badCount,
  };
  const totalForBars = Math.max(1, totalScored);

  useEffect(() => {
    if (status !== "finished") return;
    const canvas = radarCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 220;
    const height = canvas.clientHeight || 220;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 18;
    const angleStep = (Math.PI * 2) / radarValues.length;
    const startAngle = -Math.PI / 2;

    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    for (let level = 1; level <= 4; level++) {
      const levelRatio = level / 4;
      ctx.beginPath();
      radarValues.forEach((_, index) => {
        const angle = startAngle + index * angleStep;
        const x = centerX + Math.cos(angle) * radius * levelRatio;
        const y = centerY + Math.sin(angle) * radius * levelRatio;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    radarValues.forEach((_, index) => {
      const angle = startAngle + index * angleStep;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(x, y);
      ctx.stroke();
    });

    ctx.beginPath();
    radarValues.forEach((value, index) => {
      const ratio = clamp(value / 100, 0, 1);
      const angle = startAngle + index * angleStep;
      const x = centerX + Math.cos(angle) * radius * ratio;
      const y = centerY + Math.sin(angle) * radius * ratio;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 229, 255, 0.3)";
    ctx.strokeStyle = "rgba(0, 229, 255, 0.85)";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.font = "11px 'Noto Sans KR', 'Rajdhani', sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    RADAR_LABELS.forEach((label, index) => {
      const angle = startAngle + index * angleStep;
      const x = centerX + Math.cos(angle) * (radius + 14);
      const y = centerY + Math.sin(angle) * (radius + 14);
      const cos = Math.cos(angle);
      ctx.textAlign = Math.abs(cos) < 0.2 ? "center" : cos > 0 ? "left" : "right";
      ctx.textBaseline = Math.abs(Math.sin(angle)) < 0.2 ? "middle" : Math.sin(angle) > 0 ? "top" : "bottom";
      ctx.fillText(label, x, y);
    });
  }, [expressionScore, pitchScore, rhythmScore, status, vibratoScore, stabilityScore]);

  if (!currentSong) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-gradient-to-b from-[#0E041A] via-[#050814] to-black text-white">
        <AlertCircle className="w-16 h-16 text-white/40 mb-4" />
        <p className="text-white/60">노래 정보를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full h-full bg-gradient-to-b from-[#0E041A] via-[#050814] to-black text-white overflow-hidden">
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          crossOrigin="anonymous"
        />
      )}

      <div className="shrink-0 pl-16 pr-56 pt-4 pb-2 z-20">
        <div className="flex items-start justify-between gap-4 select-none">
          <div className="flex flex-col items-start">
            <p className="text-sm text-[#BD00FF] tracking-[0.25em] font-black italic drop-shadow-[0_0_10px_rgba(189,0,255,0.6)]">
              PERFECT SCORE
            </p>
            <div className="relative mt-[-6px]">
              <div
                className="text-4xl sm:text-5xl font-black text-white tabular-nums tracking-tight"
                style={{ textShadow: "0 0 18px rgba(0, 229, 255, 0.45)" }}
              >
                {score.toFixed(2)}
              </div>
            </div>
            <div className="mt-3">
              <div className="w-[200px] h-4 rounded-full overflow-hidden bg-white/10 border border-white/15 flex">
                {JUDGMENT_SEGMENTS.map(segment => {
                  const isActive = lastJudgmentRef.current === segment.key;
                  return (
                    <div
                      key={segment.key}
                      className="flex-1 transition-opacity duration-200"
                      style={{ backgroundColor: segment.color, opacity: isActive ? 1 : 0.3 }}
                    />
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[9px] uppercase tracking-[0.18em] text-white/50">
                {JUDGMENT_SEGMENTS.map(segment => (
                  <span key={segment.key}>{segment.label}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="hidden sm:flex flex-col items-center text-center pt-2">
            <h1 className="text-lg font-bold truncate max-w-[320px] text-white/90">
              {currentSong.title}
            </h1>
            <p className="text-xs text-white/60">{currentSong.artist}</p>
          </div>

          <div className="flex flex-col items-end">
            <div
              className="text-4xl sm:text-5xl font-black text-[#FFA500] tabular-nums tracking-tighter"
              style={{ textShadow: "0 0 18px rgba(255, 165, 0, 0.5)" }}
            >
              {combo}
            </div>
            <div className="text-sm text-[#FFA500] font-bold tracking-[0.4em] mt-[-4px]">
              COMBO
            </div>
          </div>
        </div>

        <div
          className="mt-4 h-2 w-full bg-white/10 rounded-full overflow-hidden cursor-pointer relative group"
          onClick={handleSeek}
        >
          <motion.div
            className="h-full bg-gradient-to-r from-[#FFD700] via-[#A020F0] to-[#00E5FF]"
            style={{ width: `${progress}%` }}
          />
          <div className="absolute top-0 bottom-0 w-full opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="h-full bg-white/10 w-full" />
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative w-full z-10 my-2 px-2 sm:px-6">
        <div ref={containerRef} className="relative w-full h-full">
          <canvas ref={canvasRef} className="w-full h-full rounded-2xl border border-white/10 bg-black/40" />
        </div>

        <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden">
          <AnimatePresence>
            {scorePopups.map(popup => (
              <motion.div
                key={popup.id}
                initial={{ opacity: 1, y: 0, scale: 1 }}
                animate={{ opacity: 0, y: -60, scale: 1.4 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8 }}
                className={`text-4xl font-black drop-shadow-[0_6px_20px_rgba(0,0,0,0.6)] ${
                  popup.type === "PERFECT"
                    ? "text-[#FFD700]"
                    : popup.type === "GREAT"
                    ? "text-green-400"
                    : popup.type === "GOOD"
                    ? "text-blue-400"
                    : "text-gray-400"
                }`}
              >
                {popup.type}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      <div className="shrink-0 px-4 py-2 z-20 min-h-[110px] flex flex-col justify-center">
        <div className="flex flex-col gap-2 items-center text-center">
          <div className="flex flex-wrap justify-center gap-x-[0.35em] text-2xl sm:text-3xl md:text-4xl font-black">
            {currentLine ? (
              currentLine.words && currentLine.words.length > 0 ? (
                currentLine.words.map((word, idx) => {
                  const durationValue = word.endTime - word.startTime;
                  const progressValue = durationValue > 0
                    ? clamp((localTime - word.startTime) / durationValue, 0, 1)
                    : (localTime >= word.endTime ? 1 : 0);
                  return (
                    <span key={idx} className="relative inline-block">
                      <span
                        className="text-white/30"
                        style={{
                          WebkitTextStroke: "2px rgba(0,0,0,0.85)",
                          paintOrder: "stroke fill",
                        }}
                      >
                        {word.text}
                      </span>
                      <span
                         className="absolute left-0 top-0 bottom-0 text-[#FFD700] overflow-hidden whitespace-nowrap"
                        style={{
                          width: `${progressValue * 100}%`,
                          WebkitTextStroke: "2px rgba(0,0,0,0.95)",
                          paintOrder: "stroke fill",
                          textShadow: "0 0 14px rgba(255, 215, 0, 0.65)",
                        }}
                      >
                        {word.text}
                      </span>
                    </span>
                  );
                })
              ) : (
                <span className="text-white" style={{ WebkitTextStroke: "2px rgba(0,0,0,0.9)" }}>
                  {currentLine.text}
                </span>
              )
            ) : (
              <span>&nbsp;</span>
            )}
          </div>

          <div
            className="text-lg sm:text-2xl font-bold text-white/50 mt-1"
            style={{ WebkitTextStroke: "1px rgba(0,0,0,0.8)", paintOrder: "stroke fill" }}
          >
            {nextLine?.text || "\u00A0"}
          </div>
        </div>
      </div>

      <div className="shrink-0 px-4 py-3 sm:px-6 sm:py-4 bg-gradient-to-t from-black via-black/80 to-transparent z-30">
        <div className="max-w-5xl mx-auto">
          <div className="flex justify-between text-xs text-white/60 font-mono mb-2 px-1">
            <span>{formatTime(localTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setVolume(v => v === 0 ? 1 : 0)}
                  className="p-1 hover:text-white text-white/60 transition-colors"
                >
                  <Volume2 className="w-5 h-5" />
                </button>
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
                  className="w-20 sm:w-24 accent-[#FFD700] hidden sm:block"
                />
              </div>

              <button
                onClick={() => setIsMicOn(!isMicOn)}
                className={`px-3 py-2 rounded-full transition-all flex items-center gap-2 ${
                  isMicOn ? "bg-[#FFD700]/20 text-[#FFD700]" : "bg-white/10 text-white/60"
                }`}
              >
                {isMicOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                <span className="text-xs font-bold tracking-[0.3em]">MIC</span>
              </button>
            </div>

            <div className="flex items-center gap-4 sm:gap-6">
              <button
                onClick={handleRestart}
                className="p-2 text-white/70 hover:text-white transition-colors"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              <button
                onClick={togglePlay}
                disabled={!audioLoaded}
                className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-[#FFD700] text-black flex items-center justify-center shadow-xl disabled:opacity-50 hover:scale-105 transition-transform"
              >
                {isPlaying ? <Pause className="w-5 h-5 sm:w-6 sm:h-6" /> : <Play className="w-5 h-5 sm:w-6 sm:h-6 ml-1" />}
              </button>
              <button
                onClick={() => window.dispatchEvent(new Event("kero:skipForward"))}
                className="p-2 text-white/70 hover:text-white transition-colors"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-white/50 font-mono hidden sm:block w-20 text-right">
              {songQueue.length}곡 대기
            </div>
            <div className="w-8 sm:hidden"></div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {status === "finished" && score > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 px-4 py-8"
          >
            <div className="relative w-full max-w-5xl rounded-[32px] border border-white/15 bg-white/10 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl">
              <div className="absolute top-0 left-0 right-0 h-1 rounded-t-[32px] bg-gradient-to-r from-[#00E5FF] via-[#FFD700] to-[#BD00FF]" />

              <div className="flex flex-col lg:flex-row gap-8">
                <div className="flex flex-col items-center lg:items-start gap-5">
                  <div className="flex items-center gap-3">
                    <p className="text-white/60 tracking-[0.4em] text-xs uppercase">Final Result</p>
                    <span className="px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[10px] font-bold tracking-[0.3em] text-white/70">
                      {scorePercent}%
                    </span>
                  </div>
                  <div className="flex items-end gap-4">
                    <p className="text-5xl sm:text-6xl font-black text-[#FFD700] tabular-nums">
                      {score.toFixed(2)}
                    </p>
                    <div className="text-xs text-white/50 uppercase tracking-[0.3em] mb-2">Score</div>
                  </div>
                  <div className="relative">
                    <canvas ref={radarCanvasRef} className="w-[220px] h-[220px]" />
                  </div>
                </div>

                <div className="flex-1 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.35em] text-white/50">Grade</p>
                      <div className="mt-1 px-4 py-2 rounded-2xl bg-white/10 border border-white/15 text-3xl font-black" style={{ color: gradeColor }}>
                        {grade}
                      </div>
                    </div>
                    <div className="px-4 py-3 rounded-2xl bg-white/10 border border-white/20 text-center">
                      <p className="text-xs uppercase tracking-[0.3em] text-white/50">Accuracy</p>
                      <p className="text-2xl font-bold text-[#00E5FF]">{accuracy}%</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs text-white/50 uppercase tracking-[0.2em]">Max Combo</p>
                      <p className="text-lg font-bold text-[#FFA500]">{statsSnapshot.maxCombo}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs text-white/50 uppercase tracking-[0.2em]">Scored</p>
                      <p className="text-lg font-bold text-white">
                        {totalScored}/{totalWords}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs text-white/50 uppercase tracking-[0.2em]">Vibrato</p>
                      <p className="text-lg font-bold text-pink-300">{statsSnapshot.vibratoCount}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs text-white/50 uppercase tracking-[0.2em]">Perfect</p>
                      <p className="text-lg font-bold text-[#FFD700]">{perfectCount}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs text-white/50 uppercase tracking-[0.2em]">Great</p>
                      <p className="text-lg font-bold text-[#34D399]">{greatCount}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs text-white/50 uppercase tracking-[0.2em]">Good</p>
                      <p className="text-lg font-bold text-[#60A5FA]">{goodCount}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                {JUDGMENT_SEGMENTS.map(segment => {
                  const count = segmentCounts[segment.key];
                  const percent = totalScored ? (count / totalForBars) * 100 : 0;
                  return (
                    <div key={segment.key} className="flex items-center gap-3">
                      <div className="w-16 text-xs uppercase tracking-[0.2em] text-white/60">
                        {segment.label}
                      </div>
                      <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full"
                          style={{ width: `${percent}%`, backgroundColor: segment.color }}
                        />
                      </div>
                      <div className="w-10 text-right text-xs text-white/50 tabular-nums">
                        {count}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 flex items-center justify-center">
                <button
                  onClick={() => window.dispatchEvent(new Event("kero:skipForward"))}
                  className="px-6 py-2 rounded-full bg-white/15 hover:bg-white/25 text-white/90 transition-colors"
                >
                  Next Song
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
