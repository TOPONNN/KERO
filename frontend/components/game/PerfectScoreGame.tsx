"use client";

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useSelector, useDispatch } from "react-redux";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Mic, MicOff, Pause, Play, RotateCcw, SkipForward, Volume2, AlertCircle } from "lucide-react";
import type { RootState } from "@/store";
import { updateCurrentTime, setGameStatus } from "@/store/slices/gameSlice";
import { getSocket } from "@/lib/socket";

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

interface FinalScoreLike {
  participantId?: number | string;
  nickname?: string;
  totalScore?: number;
  score?: number;
  odId?: string;
  odName?: string;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const VISIBLE_WINDOW = 8;
const HIT_LINE_RATIO = 0.2;
const MIDI_MIN = 36;
const MIDI_MAX = 76;
const USER_TRAIL_SECONDS = 4;
const LABEL_AREA_WIDTH = 64;
const SMOOTHING_WINDOW_SIZE = 5;
const SNAP_MIDI_THRESHOLD = 0.35;

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
  { key: "PERFECT", label: "PERFECT", color: "#22c55e" },
  { key: "GREAT", label: "GREAT", color: "#06b6d4" },
  { key: "GOOD", label: "GOOD", color: "#3b82f6" },
  { key: "NORMAL", label: "NORMAL", color: "#eab308" },
  { key: "BAD", label: "BAD", color: "#ef4444" },
];

const RADAR_LABELS = ["음정", "박자", "바이브레이션", "표현력", "안정도"];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const freqToMidi = (frequency: number) => 69 + 12 * Math.log2(frequency / 440);

const midiToNoteLabel = (midi: number) => {
  const roundedMidi = Math.round(midi);
  const note = NOTE_NAMES[((roundedMidi % 12) + 12) % 12];
  const octave = Math.floor(roundedMidi / 12) - 1;
  return `${note}${octave}`;
};

interface PerfectScoreGameProps {
  onBackAction?: () => void;
  cameraElement?: ReactNode;
}

export default function PerfectScoreGame({ onBackAction, cameraElement }: PerfectScoreGameProps) {
  const dispatch = useDispatch();
  const { currentSong, status, songQueue, scores } = useSelector((state: RootState) => state.game);
  const { participants, code: roomCode } = useSelector((state: RootState) => state.room);

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
  const smoothingMidiRef = useRef<number[]>([]);
  const lastPitchEmitAtRef = useRef(0);
  const singerScoreSnapshotRef = useRef<Record<string, number>>({});
  const previousSingerIdRef = useRef<number | null>(null);

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
  const [currentSingerId, setCurrentSingerId] = useState<number | null>(null);
  const [currentSingerNickname, setCurrentSingerNickname] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [snapIndicatorActive, setSnapIndicatorActive] = useState(false);
  const [snapNoteLabel, setSnapNoteLabel] = useState("");
  const [currentJudgment, setCurrentJudgment] = useState<JudgmentLabel>("BAD");
  const [turnScores, setTurnScores] = useState<Record<string, number>>({});

  const lyrics: LyricsLine[] = currentSong?.lyrics || [];
  const audioUrl = currentSong?.instrumentalUrl || currentSong?.audioUrl;
  const progress = duration ? (localTime / duration) * 100 : 0;

  const myNickname = useMemo(() => {
    if (typeof window === "undefined") return "";
    const fromSession = sessionStorage.getItem("roomNickname");
    if (fromSession) return fromSession;
    const userString = localStorage.getItem("user");
    if (!userString) return "";
    try {
      const parsed = JSON.parse(userString) as { name?: string };
      return parsed.name || "";
    } catch {
      return "";
    }
  }, []);

  const myParticipant = useMemo(() => {
    return participants.find((participant) => participant.nickname === myNickname) || null;
  }, [myNickname, participants]);

  const isMyTurn = useMemo(() => {
    if (currentSingerId !== null && myParticipant) {
      return String(currentSingerId) === String(myParticipant.id);
    }
    if (currentSingerNickname && myNickname) {
      return currentSingerNickname === myNickname;
    }
    return false;
  }, [currentSingerId, currentSingerNickname, myNickname, myParticipant]);

  const turnOrder = useMemo(() => {
    return participants.map((participant) => participant.id);
  }, [participants]);

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

  const resetRoundMetrics = useCallback(() => {
    lastTimeRef.current = 0;
    scoreRef.current = 0;
    comboRef.current = 0;
    setScore(0);
    setCombo(0);
    setLocalTime(0);
    setCurrentLyricIndex(-1);
    setScorePopups([]);
    userPitchTrailRef.current = [];
    scoredResultsRef.current.clear();
    pitchSamplesRef.current.clear();
    judgementPopupsRef.current = [];
    lastJudgmentRef.current = null;
    latestPitchRef.current = { frequency: 0, time: 0 };
    smoothingMidiRef.current = [];
    statsRef.current = createInitialStats();
    statsRef.current.totalWords = words.length;
  }, [words.length]);

  useEffect(() => {
    statsRef.current = createInitialStats();
    statsRef.current.totalWords = words.length;
    lastJudgmentRef.current = null;
  }, [currentSong, words.length]);

  useEffect(() => {
    if (!participants.length) return;
    if (currentSingerId !== null || currentSingerNickname) return;

    const first = participants[0];
    setCurrentSingerId(typeof first.id === "number" ? first.id : Number(first.id));
    setCurrentSingerNickname(first.nickname);
  }, [currentSingerId, currentSingerNickname, participants]);

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
    return lyrics.find((line) => line.startTime > localTime) || null;
  }, [currentLyricIndex, lyrics, localTime]);

  const shouldCaptureMic = isMicOn && isMyTurn;
  isMicOnRef.current = shouldCaptureMic;

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
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
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
      if (!roomCode || !isMyTurn) return;
      getSocket().emit("perfect:end-song", { roomCode });
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
  }, [isMyTurn, roomCode, volume]);

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
    if (!shouldCaptureMic) {
      stopMicrophone();
      return;
    }
    if (!analyserRef.current) {
      startMicrophone();
    }
  }, [shouldCaptureMic, startMicrophone, stopMicrophone]);

  useEffect(() => {
    const socket = getSocket();

    const handleTurnChanged = (payload: { currentSingerId: number; currentSingerNickname: string }) => {
      const prevSingerId = previousSingerIdRef.current;
      if (prevSingerId !== null) {
        singerScoreSnapshotRef.current[String(prevSingerId)] = Math.round(scoreRef.current);
        setTurnScores({ ...singerScoreSnapshotRef.current });
      }

      previousSingerIdRef.current = payload.currentSingerId;
      setCurrentSingerId(payload.currentSingerId);
      setCurrentSingerNickname(payload.currentSingerNickname);
      resetRoundMetrics();

      if (!audioRef.current) return;
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      if (status === "playing") {
        audioRef.current.play().catch(console.error);
        setIsPlaying(true);
      }
    };

    socket.on("perfect:turn-changed", handleTurnChanged);
    return () => {
      socket.off("perfect:turn-changed", handleTurnChanged);
    };
  }, [resetRoundMetrics, status]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !audioLoaded) return;
    if (isPlaying) {
      audioRef.current.pause();
      dispatch(setGameStatus("paused"));
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(console.error);
      if (shouldCaptureMic && !analyserRef.current) {
        startMicrophone();
      }
      dispatch(setGameStatus("playing"));
      setIsPlaying(true);
    }
  }, [audioLoaded, dispatch, isPlaying, shouldCaptureMic, startMicrophone]);

  const handleRestart = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    resetRoundMetrics();
  }, [resetRoundMetrics]);

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

  const passTurn = useCallback(() => {
    if (!roomCode || !isMyTurn) return;
    singerScoreSnapshotRef.current[String(currentSingerId)] = Math.round(scoreRef.current);
    setTurnScores({ ...singerScoreSnapshotRef.current });
    getSocket().emit("perfect:pass-turn", { roomCode });
  }, [currentSingerId, isMyTurn, roomCode]);

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
        smoothingMidiRef.current.push(rawMidi);
        if (smoothingMidiRef.current.length > SMOOTHING_WINDOW_SIZE) {
          smoothingMidiRef.current.shift();
        }
        const smoothedMidi = smoothingMidiRef.current.reduce((sum, value) => sum + value, 0) / smoothingMidiRef.current.length;
        userPitchTrailRef.current.push({ time: now, midi: smoothedMidi });

        if (roomCode && now - lastPitchEmitAtRef.current > 0.12) {
          getSocket().emit("perfect:pitch-data", {
            roomCode,
            pitchData: {
              time: now,
              frequency,
              confidence: 0.9,
            },
          });
          lastPitchEmitAtRef.current = now;
        }
      }
    }

    userPitchTrailRef.current = userPitchTrailRef.current.filter((point) => now - point.time <= USER_TRAIL_SECONDS);

    if (isMicOnRef.current && latestPitchRef.current.frequency > 0) {
      words.forEach((word) => {
        if (now >= word.startTime && now <= word.endTime && typeof word.midi === "number") {
          const key = `${word.lineIndex}-${word.wordIndex}`;
          const list = pitchSamplesRef.current.get(key) || [];
          list.push(latestPitchRef.current.frequency);
          pitchSamplesRef.current.set(key, list);
        }
      });
    }

    words.forEach((word) => {
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
      setCurrentJudgment(judgment);
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
        setScorePopups((prev) => [...prev.slice(-3), { id: popupId, type: result, points }]);
      } else {
        comboRef.current = 0;
        setCombo(0);
        setScorePopups((prev) => [...prev.slice(-3), { id: popupId, type: "MISS", points: 0 }]);
      }

      statsRef.current.maxCombo = Math.max(statsRef.current.maxCombo, comboRef.current);

      const yForPopup = clamp(MIDI_MAX - word.midi, 0, MIDI_MAX - MIDI_MIN);
      judgementPopupsRef.current.push({
        id: popupId,
        text: result,
        time: now,
        x: 0,
        y: yForPopup,
        color: result === "PERFECT" ? "#10b981" : result === "GREAT" ? "#4ecdc4" : result === "GOOD" ? "#93c5fd" : "#f28b82",
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

      const background = ctx.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, "#0a0a1a");
      background.addColorStop(0.6, "#111a2f");
      background.addColorStop(1, "#1a1a2e");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      const contentTop = 16;
      const contentBottom = height - 16;
      const staffHeight = Math.max(1, contentBottom - contentTop);
      const hitLineX = Math.max(width * HIT_LINE_RATIO, LABEL_AREA_WIDTH + 16);
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
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
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
          ctx.lineWidth = 1.4;
          ctx.strokeStyle = "rgba(240,192,64,0.28)";
          ctx.stroke();
          const octave = Math.floor(midi / 12) - 1;
          ctx.fillStyle = "rgba(240,192,64,0.95)";
          ctx.font = "600 12px 'DM Sans', 'Noto Sans KR', sans-serif";
          ctx.fillText(`C${octave}`, LABEL_AREA_WIDTH - 8, y);
        } else if (isNatural) {
          const octave = Math.floor(midi / 12) - 1;
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = "rgba(255,255,255,0.09)";
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.45)";
          ctx.font = "500 10px 'DM Sans', 'Noto Sans KR', sans-serif";
          ctx.fillText(`${NOTE_NAMES[noteIdx]}${octave}`, LABEL_AREA_WIDTH - 8, y);
        } else {
          ctx.lineWidth = 0.5;
          ctx.strokeStyle = "rgba(255,255,255,0.04)";
          ctx.stroke();
        }
      }

      const hitGradient = ctx.createLinearGradient(hitLineX, contentTop, hitLineX, contentBottom);
      hitGradient.addColorStop(0, "rgba(78,205,196,0)");
      hitGradient.addColorStop(0.5, "rgba(78,205,196,0.9)");
      hitGradient.addColorStop(1, "rgba(78,205,196,0)");
      ctx.strokeStyle = hitGradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hitLineX, contentTop);
      ctx.lineTo(hitLineX, contentBottom);
      ctx.stroke();

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

      words.forEach((word) => {
        if (typeof word.midi !== "number") return;
        if (word.endTime < startTime || word.startTime > endTime) return;

        const xStartRaw = hitLineX + (word.startTime - now) * pixelsPerSecond;
        const xEndRaw = hitLineX + (word.endTime - now) * pixelsPerSecond;
        const xStart = xStartRaw + 1.5;
        const xEnd = xEndRaw - 1.5;
        const barWidth = Math.max(8, xEnd - xStart);
        const yCenter = midiToY(word.midi);
        const barHeight = 14;
        const yTop = yCenter - barHeight / 2;

        const key = `${word.lineIndex}-${word.wordIndex}`;
        const result = scoredResultsRef.current.get(key)?.result;
        const isPast = word.endTime < now;
        const isActive = now >= word.startTime && now <= word.endTime;

        const createGradient = (top: string, bottom: string) => {
          const g = ctx.createLinearGradient(0, yTop, 0, yTop + barHeight);
          g.addColorStop(0, top);
          g.addColorStop(1, bottom);
          return g;
        };

        let fillStyle: string | CanvasGradient = createGradient("rgba(177,191,220,0.35)", "rgba(150,165,200,0.35)");
        let strokeStyle = "rgba(255,255,255,0.16)";
        let glow = "rgba(0,0,0,0)";

        if (result) {
          if (result === "PERFECT" || result === "GREAT") {
            fillStyle = createGradient("rgba(21,180,134,0.95)", "rgba(16,143,109,0.95)");
            strokeStyle = "rgba(188,255,233,0.8)";
            glow = "rgba(16,185,129,0.7)";
          } else if (result === "GOOD") {
            fillStyle = createGradient("rgba(111,191,255,0.95)", "rgba(76,145,226,0.9)");
            strokeStyle = "rgba(194,228,255,0.85)";
          } else {
            fillStyle = createGradient("rgba(90,94,114,0.75)", "rgba(61,64,82,0.75)");
            strokeStyle = "rgba(164,171,201,0.35)";
          }
        } else if (isPast) {
          fillStyle = createGradient("rgba(78,83,104,0.65)", "rgba(58,61,79,0.65)");
          strokeStyle = "rgba(150,158,191,0.28)";
        } else if (isActive) {
          fillStyle = createGradient("rgba(240,192,64,0.95)", "rgba(212,158,37,0.95)");
          strokeStyle = "rgba(255,241,199,0.85)";
          glow = "rgba(240,192,64,0.8)";
        }

        ctx.save();
        if (glow !== "rgba(0,0,0,0)") {
          const pulse = 0.6 + 0.4 * Math.sin(now * 8);
          ctx.shadowColor = glow;
          ctx.shadowBlur = 10 + pulse * 8;
        }
        ctx.fillStyle = fillStyle;
        drawPill(xStart, yTop, barWidth, barHeight);
        ctx.fill();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      });

      const trail = userPitchTrailRef.current;
      if (trail.length > 0) {
        const currentTargetWord = words.find(
          (word) => typeof word.midi === "number" && now >= word.startTime && now <= word.endTime
        );

        ctx.save();
        ctx.strokeStyle = "#4ecdc4";
        ctx.lineWidth = 5;
        ctx.shadowColor = "rgba(78,205,196,0.9)";
        ctx.shadowBlur = 18;
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
            if (!prevPoint || point.time - prevPoint.time > 0.3 || Math.abs(point.midi - prevPoint.midi) > 12) {
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
            const noteLabel = midiToNoteLabel(lastPoint.midi);
            const targetMidi = typeof currentTargetWord?.midi === "number" ? currentTargetWord.midi : null;
            const snapped = targetMidi !== null && Math.abs(lastPoint.midi - targetMidi) <= SNAP_MIDI_THRESHOLD;

            setSnapIndicatorActive(snapped);
            setSnapNoteLabel(snapped && targetMidi !== null ? midiToNoteLabel(targetMidi) : "");

            if (snapped && targetMidi !== null) {
              const targetY = midiToY(targetMidi);
              ctx.strokeStyle = "rgba(16,185,129,0.85)";
              ctx.lineWidth = 2;
              ctx.setLineDash([6, 4]);
              ctx.beginPath();
              ctx.moveTo(headX, headY);
              ctx.lineTo(hitLineX, targetY);
              ctx.stroke();
              ctx.setLineDash([]);

              ctx.fillStyle = "rgba(16,185,129,0.95)";
              ctx.shadowColor = "rgba(16,185,129,0.9)";
              ctx.shadowBlur = 20;
              ctx.beginPath();
              ctx.arc(headX, headY, 8, 0, Math.PI * 2);
              ctx.fill();
            }

            ctx.fillStyle = "#ffffff";
            ctx.shadowColor = "rgba(255,255,255,0.95)";
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(headX, headY, 5, 0, Math.PI * 2);
            ctx.fill();

            const noteTagWidth = 46;
            const noteTagHeight = 22;
            const noteTagX = clamp(headX + 12, 8, width - noteTagWidth - 8);
            const noteTagY = clamp(headY - 32, 6, height - noteTagHeight - 6);

            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(255,255,255,0.14)";
            ctx.strokeStyle = snapped ? "rgba(16,185,129,0.88)" : "rgba(240,192,64,0.7)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            const r = 11;
            ctx.moveTo(noteTagX + r, noteTagY);
            ctx.lineTo(noteTagX + noteTagWidth - r, noteTagY);
            ctx.arcTo(noteTagX + noteTagWidth, noteTagY, noteTagX + noteTagWidth, noteTagY + r, r);
            ctx.lineTo(noteTagX + noteTagWidth, noteTagY + noteTagHeight - r);
            ctx.arcTo(noteTagX + noteTagWidth, noteTagY + noteTagHeight, noteTagX + noteTagWidth - r, noteTagY + noteTagHeight, r);
            ctx.lineTo(noteTagX + r, noteTagY + noteTagHeight);
            ctx.arcTo(noteTagX, noteTagY + noteTagHeight, noteTagX, noteTagY + noteTagHeight - r, r);
            ctx.lineTo(noteTagX, noteTagY + r);
            ctx.arcTo(noteTagX, noteTagY, noteTagX + r, noteTagY, r);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = snapped ? "#b6ffdf" : "#f7d06d";
            ctx.font = "700 12px 'IBM Plex Mono', monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(noteLabel, noteTagX + noteTagWidth / 2, noteTagY + noteTagHeight / 2 + 0.5);
          }
        } else {
          setSnapIndicatorActive(false);
          setSnapNoteLabel("");
        }

        ctx.restore();
      } else {
        setSnapIndicatorActive(false);
        setSnapNoteLabel("");
      }

      const popupDuration = 0.5;
      judgementPopupsRef.current = judgementPopupsRef.current.filter((popup) => now - popup.time <= popupDuration);
      judgementPopupsRef.current.forEach((popup) => {
        const life = clamp(1 - (now - popup.time) / popupDuration, 0, 1);
        const alpha = life * life;
        ctx.save();
        ctx.font = "700 20px 'DM Sans', 'Noto Sans KR', sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = `${popup.color}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
        ctx.shadowColor = popup.color;
        ctx.shadowBlur = 10 * alpha;
        const y = clamp(contentTop + popup.y * (staffHeight / (MIDI_MAX - MIDI_MIN)), contentTop, contentBottom);
        ctx.fillText(popup.text, hitLineX + 14, y - 8 * (1 - alpha));
        ctx.restore();
      });
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [currentLyricIndex, dispatch, findCurrentLyricIndex, roomCode, words]);

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
    ? "#f0c040"
    : scorePercent >= 80
    ? "#10b981"
    : scorePercent >= 70
    ? "#4ecdc4"
    : "#f28b82";
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

  const normalizedServerScores = useMemo(() => {
    return scores.map((entry) => {
      const item = entry as unknown as FinalScoreLike;
      return {
        participantKey: item.participantId !== undefined ? String(item.participantId) : item.odId || "",
        nickname: item.nickname || item.odName || "Unknown",
        score: typeof item.totalScore === "number" ? item.totalScore : typeof item.score === "number" ? item.score : 0,
      };
    });
  }, [scores]);

  const orderedTurnResults = useMemo(() => {
    const serverMap: Record<string, { nickname: string; score: number }> = {};
    normalizedServerScores.forEach((entry) => {
      if (!entry.participantKey) return;
      serverMap[entry.participantKey] = { nickname: entry.nickname, score: entry.score };
    });

    return turnOrder.map((id) => {
      const key = String(id);
      const participant = participants.find((p) => String(p.id) === key);
      const serverScore = serverMap[key];
      const localScore = turnScores[key];
      return {
        id: key,
        nickname: participant?.nickname || serverScore?.nickname || "Unknown",
        score: typeof serverScore?.score === "number" ? serverScore.score : localScore ?? 0,
      };
    });
  }, [normalizedServerScores, participants, turnOrder, turnScores]);

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

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
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
    ctx.fillStyle = "rgba(78,205,196,0.28)";
    ctx.strokeStyle = "rgba(78,205,196,0.95)";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.font = "11px 'DM Sans', 'Noto Sans KR', sans-serif";
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
  }, [expressionScore, pitchScore, radarValues, rhythmScore, stabilityScore, status, vibratoScore]);

  if (!currentSong) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-[#0a0a1a] via-[#131a2b] to-[#1a1a2e] text-white">
        <AlertCircle className="mb-4 h-14 w-14 text-white/45" />
        <p className="text-white/65" style={{ fontFamily: "'DM Sans', 'Noto Sans KR', sans-serif" }}>노래 정보를 불러오는 중...</p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full overflow-hidden text-white"
      style={{
        fontFamily: "'DM Sans', 'Noto Sans KR', sans-serif",
        background: "linear-gradient(150deg, #0a0a1a 0%, #121b2f 56%, #1a1a2e 100%)",
      }}
    >
      {audioUrl && <audio ref={audioRef} src={audioUrl} crossOrigin="anonymous" />}

      <div className="absolute inset-0 opacity-[0.15] pointer-events-none" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, rgba(240,192,64,0.35), transparent 35%), radial-gradient(circle at 80% 0%, rgba(78,205,196,0.25), transparent 30%)" }} />

      <div className="relative z-10 flex h-full w-full flex-col px-3 pb-4 pt-3 sm:px-5 sm:pt-4">
        <div className="mb-3 rounded-2xl border border-white/15 bg-white/[0.05] px-4 py-3 backdrop-blur-xl sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.35em] text-white/55">Now Singing</p>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold text-white sm:text-xl">{currentSingerNickname || "대기 중"}</span>
                {isMyTurn && <span className="rounded-full bg-[#f0c040]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#f0c040]">Your turn!</span>}
              </div>
            </div>

            <div className="min-w-0 flex-1 text-center sm:max-w-[46%]">
              <h1 className="truncate text-base font-semibold text-white sm:text-lg">{currentSong.title}</h1>
              <p className="truncate text-xs uppercase tracking-[0.26em] text-white/55">{currentSong.artist}</p>
            </div>

            <div className="flex items-center gap-3 sm:gap-5">
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.28em] text-white/55">Score</p>
                <p className="text-2xl font-bold text-[#f0c040]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{score.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.28em] text-white/55">Combo</p>
                <p className="text-2xl font-bold text-[#4ecdc4]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{combo}</p>
              </div>
            </div>
          </div>

          <div className="mt-3 h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-white/10" onClick={handleSeek}>
            <motion.div
              className="h-full"
              style={{ width: `${progress}%`, background: "linear-gradient(90deg, #4ecdc4 0%, #f0c040 100%)" }}
            />
          </div>
        </div>

        {/* Judgment Score Bar — TJ parallelogram style */}
        <div className="mb-2 flex h-7 w-full items-center gap-[2px]" data-testid="perfect-judgment-bar">
          {JUDGMENT_SEGMENTS.map((seg) => {
            const isActive = currentJudgment === seg.key;
            return (
              <div
                key={seg.key}
                className="flex h-full flex-1 items-center justify-center transition-all duration-200"
                style={{
                  transform: "skewX(-20deg)",
                  backgroundColor: isActive ? seg.color : "rgba(0,0,0,0.6)",
                  border: isActive ? `1px solid ${seg.color}` : "1px solid rgba(255,255,255,0.1)",
                  boxShadow: isActive ? `0 0 12px ${seg.color}80` : "none",
                }}
              >
                <span
                  className={`text-[9px] font-bold uppercase tracking-wider transition-all sm:text-[10px] ${isActive ? "text-white" : "text-white/30"}`}
                  style={{ transform: "skewX(20deg)" }}
                >
                  {seg.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col gap-3 lg:flex-row" data-testid="perfect-layout-shell">
          {/* Turn sidebar - moved to LEFT */}
          <aside className={`${isSidebarCollapsed ? "w-12" : "w-[250px]"} order-first hidden h-full shrink-0 flex-col rounded-2xl border border-white/15 bg-white/[0.05] p-3 backdrop-blur-xl transition-all duration-300 lg:flex`} data-testid="perfect-turn-sidebar">
            <button
              className="mb-3 flex h-8 w-8 items-center justify-center self-end rounded-full border border-white/20 bg-white/10 text-white/75 hover:bg-white/20"
              onClick={() => setIsSidebarCollapsed((prev) => !prev)}
            >
              {isSidebarCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>

            {!isSidebarCollapsed && (
              <>
                <p className="mb-2 text-[11px] uppercase tracking-[0.3em] text-white/55">Turn Order</p>
                <div className="space-y-2">
                  {participants.map((participant, index) => {
                    const isActive = String(participant.id) === String(currentSingerId);
                    const scoreValue = turnScores[String(participant.id)] ?? 0;
                    return (
                      <div key={String(participant.id)} className={`rounded-xl border px-3 py-2 ${isActive ? "border-[#f0c040]/55 bg-[#f0c040]/10" : "border-white/10 bg-white/[0.03]"}`}>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white/65">{index + 1}</span>
                          <span className="text-sm font-medium text-white">{participant.nickname}</span>
                        </div>
                        <div className="mt-1 text-right text-xs text-white/55" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                          {scoreValue.toFixed(0)} pts
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </aside>

          {/* Main content (canvas + lyrics) */}
          <div className="relative flex min-h-0 flex-1 flex-col" data-testid="perfect-main-content">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-3xl border border-white/15 bg-white/[0.03] backdrop-blur-lg">
              <div ref={containerRef} className="h-full w-full">
                <canvas ref={canvasRef} className="h-full w-full" />
              </div>

              {!isMyTurn && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a0a1a]/55 backdrop-blur-sm">
                  <div className="rounded-2xl border border-white/20 bg-white/[0.08] px-6 py-4 text-center shadow-2xl">
                    <p className="text-xs uppercase tracking-[0.3em] text-white/60">Turn Locked</p>
                    <p className="mt-1 text-lg font-semibold text-white">Waiting for {currentSingerNickname || "next singer"} to sing...</p>
                  </div>
                </div>
              )}

              <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${isMyTurn ? "bg-[#10b981]/25 text-[#b8ffe0]" : "bg-white/10 text-white/70"}`}>
                  {isMyTurn ? "Your turn" : "Spectating"}
                </span>
                {snapIndicatorActive && (
                  <span className="rounded-full bg-[#10b981]/25 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[#b8ffe0]">
                    Snap {snapNoteLabel}
                  </span>
                )}
              </div>

              <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
                <AnimatePresence>
                  {scorePopups.map((popup) => (
                    <motion.div
                      key={popup.id}
                      initial={{ opacity: 1, y: 0, scale: 1 }}
                      animate={{ opacity: 0, y: -56, scale: 1.25 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.72 }}
                      className="text-4xl font-bold"
                      style={{ color: popup.type === "PERFECT" ? "#10b981" : popup.type === "GREAT" ? "#4ecdc4" : popup.type === "GOOD" ? "#93c5fd" : "#f28b82" }}
                    >
                      {popup.type}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Add pitch band overlay inside the canvas container */}
              <div className="pointer-events-none absolute inset-0 flex flex-col justify-between px-4 py-2" style={{ background: "linear-gradient(180deg, rgba(6,182,212,0.06) 0%, transparent 30%, transparent 70%, rgba(6,182,212,0.06) 100%)" }}>
                <div className="h-px w-full bg-cyan-400/25" />
                <div className="h-px w-full bg-cyan-400/15" />
                <div className="h-px w-full bg-cyan-400/25" />
                <div className="h-px w-full bg-cyan-400/15" />
                <div className="h-px w-full bg-cyan-400/25" />
              </div>
            </div>

            {/* Back button */}
            {onBackAction && (
              <button
                onClick={onBackAction}
                className="absolute top-3 left-3 z-40 p-2 rounded-full bg-black/50 backdrop-blur-sm text-white/60 hover:text-white hover:bg-black/70 transition-all"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}

            <div className="mt-3 rounded-2xl border border-white/15 bg-white/[0.04] px-4 py-4 text-center backdrop-blur-xl sm:px-6">
              <div className="flex min-h-[56px] flex-wrap justify-center gap-x-[0.32em] text-3xl font-extrabold sm:text-4xl"
                   style={{
                     WebkitTextStroke: "4px #3b82f6",
                     paintOrder: "stroke fill",
                     textShadow: "4px 4px 0px rgba(0,0,0,0.5), 0 0 12px rgba(59,130,246,0.6), 0 0 24px rgba(59,130,246,0.3)",
                   }}>
                {currentLine ? (
                  currentLine.words && currentLine.words.length > 0 ? (
                    currentLine.words.map((word, idx) => {
                      const durationValue = word.endTime - word.startTime;
                      const progressValue = durationValue > 0
                        ? clamp((localTime - word.startTime) / durationValue, 0, 1)
                        : localTime >= word.endTime
                        ? 1
                        : 0;
                      return (
                        <span key={idx} className="relative inline-block">
                          <span className="text-white/35">{word.text}</span>
                          <span
                            className="absolute left-0 top-0 whitespace-nowrap text-[#f0c040]"
                            style={{
                              clipPath: `inset(-0.25em ${100 - progressValue * 100}% -0.25em 0)`,
                              textShadow: "0 0 14px rgba(240,192,64,0.62)",
                            }}
                          >
                            {word.text}
                          </span>
                        </span>
                      );
                    })
                  ) : (
                    <span>{currentLine.text}</span>
                  )
                ) : (
                  <span>&nbsp;</span>
                )}
              </div>

              <p className="mt-2 min-h-[24px] text-lg font-semibold sm:text-xl" style={{ color: "rgba(255,255,255,0.55)", WebkitTextStroke: "0.5px rgba(0,0,0,0.4)", paintOrder: "stroke fill" }}>{nextLine?.text || "\u00A0"}</p>
            </div>
          </div>

          {/* Camera aside - RIGHT side */}
          {cameraElement && (
            <aside className="h-[180px] w-full shrink-0 rounded-2xl overflow-hidden border border-white/15 bg-black/50 shadow-2xl sm:h-[200px] lg:h-full lg:w-[280px] xl:w-[320px]" data-testid="perfect-camera-panel">
              <div className="h-full w-full">{cameraElement}</div>
            </aside>
          )}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-3 z-30 flex justify-center px-3 sm:px-6">
          <div className="pointer-events-auto flex w-full max-w-4xl items-center justify-between gap-2 rounded-2xl border border-white/20 bg-white/[0.08] px-3 py-2 backdrop-blur-2xl sm:px-4 sm:py-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setVolume((v) => (v === 0 ? 1 : 0))}
                className="rounded-full border border-white/20 bg-white/10 p-2 text-white/80 hover:bg-white/20"
              >
                <Volume2 className="h-4 w-4" />
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
                className="w-16 accent-[#f0c040] sm:w-24"
              />
              <button
                onClick={() => setIsMicOn((prev) => !prev)}
                disabled={!isMyTurn}
                className={`rounded-full border p-2 ${isMyTurn ? "border-[#4ecdc4]/60 bg-[#4ecdc4]/12 text-[#9efff8]" : "border-white/20 bg-white/10 text-white/40"}`}
              >
                {isMicOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </button>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={handleRestart}
                className="rounded-full border border-white/20 bg-white/10 p-2 text-white/80 hover:bg-white/20"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                onClick={togglePlay}
                disabled={!audioLoaded}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0c040] text-[#101018] shadow-lg shadow-[#f0c040]/35 disabled:opacity-50"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
              </button>
              <button
                onClick={() => window.dispatchEvent(new Event("kero:skipForward"))}
                className="rounded-full border border-white/20 bg-white/10 p-2 text-white/80 hover:bg-white/20"
              >
                <SkipForward className="h-4 w-4" />
              </button>
              <button
                onClick={passTurn}
                disabled={!isMyTurn}
                className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-[0.24em] ${isMyTurn ? "bg-[#f0c040] text-[#101018]" : "bg-white/10 text-white/45"}`}
              >
                패스
              </button>
            </div>

            <div className="hidden min-w-[84px] text-right text-[11px] uppercase tracking-[0.23em] text-white/55 sm:block">
              {songQueue.length} queue
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {status === "finished" && score >= 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-[#090b16]/70 px-4 py-6 backdrop-blur-xl"
          >
            <motion.div
              initial={{ y: 16, scale: 0.97 }}
              animate={{ y: 0, scale: 1 }}
              className="relative w-full max-w-6xl overflow-hidden rounded-[34px] border border-white/20 bg-white/[0.09] p-6 shadow-2xl sm:p-8"
            >
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-[-10%] top-[-24%] h-56 w-56 rounded-full bg-[#f0c040]/30 blur-3xl" />
                <div className="absolute right-[-8%] top-[-16%] h-56 w-56 rounded-full bg-[#4ecdc4]/26 blur-3xl" />
              </div>

              <div className="relative grid gap-6 lg:grid-cols-[1.15fr_1fr]">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.3em] text-white/60">Final Result</p>
                  <div className="mt-2 flex items-end gap-4">
                    <motion.p
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: "spring", stiffness: 220, damping: 16 }}
                      className="relative text-7xl font-black"
                      style={{ color: gradeColor, textShadow: "0 0 28px rgba(240,192,64,0.35)" }}
                    >
                      {grade}
                      <span className="absolute -inset-8 -z-10 rounded-full border border-white/20" />
                    </motion.p>
                    <p className="text-2xl font-bold text-white/88" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{score.toFixed(2)}</p>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-3">
                      <p className="text-[10px] uppercase tracking-[0.26em] text-white/58">Accuracy</p>
                      <p className="mt-1 text-2xl font-bold text-[#4ecdc4]">{accuracy}%</p>
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-3">
                      <p className="text-[10px] uppercase tracking-[0.26em] text-white/58">Max Combo</p>
                      <p className="mt-1 text-2xl font-bold text-[#f0c040]">{statsSnapshot.maxCombo}</p>
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-3">
                      <p className="text-[10px] uppercase tracking-[0.26em] text-white/58">Scored</p>
                      <p className="mt-1 text-2xl font-bold text-white">{totalScored}/{totalWords}</p>
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-3">
                      <p className="text-[10px] uppercase tracking-[0.26em] text-white/58">Perfect</p>
                      <p className="mt-1 text-2xl font-bold text-[#10b981]">{perfectCount}</p>
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-3">
                      <p className="text-[10px] uppercase tracking-[0.26em] text-white/58">Great</p>
                      <p className="mt-1 text-2xl font-bold text-[#4ecdc4]">{greatCount}</p>
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/[0.06] p-3">
                      <p className="text-[10px] uppercase tracking-[0.26em] text-white/58">Good</p>
                      <p className="mt-1 text-2xl font-bold text-[#93c5fd]">{goodCount}</p>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-white/15 bg-white/[0.05] p-4">
                    <p className="mb-3 text-[11px] uppercase tracking-[0.3em] text-white/56">Turn Results</p>
                    <div className="space-y-2">
                      {orderedTurnResults.map((entry, index) => (
                        <div key={entry.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                          <span className="text-sm text-white/70">#{index + 1} {entry.nickname}</span>
                          <span className="text-sm font-semibold text-white" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{entry.score.toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-5">
                  <div className="rounded-2xl border border-white/15 bg-white/[0.05] p-4">
                    <p className="mb-3 text-[11px] uppercase tracking-[0.3em] text-white/56">Performance Radar</p>
                    <div className="flex justify-center">
                      <canvas ref={radarCanvasRef} className="h-[230px] w-[230px]" />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/15 bg-white/[0.05] p-4">
                    <p className="mb-3 text-[11px] uppercase tracking-[0.3em] text-white/56">Judgment Spread</p>
                    <div className="space-y-2.5">
                      {JUDGMENT_SEGMENTS.map((segment) => {
                        const count = segmentCounts[segment.key];
                        const percent = totalScored ? (count / totalForBars) * 100 : 0;
                        return (
                          <div key={segment.key} className="flex items-center gap-3">
                            <div className="w-16 text-[11px] uppercase tracking-[0.18em] text-white/60">{segment.label}</div>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                              <div className="h-full" style={{ width: `${percent}%`, backgroundColor: segment.color }} />
                            </div>
                            <div className="w-8 text-right text-xs text-white/65">{count}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    onClick={() => window.dispatchEvent(new Event("kero:skipForward"))}
                    className="rounded-full bg-[#f0c040] px-6 py-2.5 text-sm font-bold uppercase tracking-[0.26em] text-[#111319]"
                  >
                    Next Song
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
