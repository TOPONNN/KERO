import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export type GameMode = "normal" | "perfect_score" | "lyrics_quiz";
export type GameStatus = "waiting" | "playing" | "paused" | "finished";

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
  isBlank?: boolean;
  pitchData?: { time: number; frequency: number; note: string; midi: number }[];
}

interface QuizQuestion {
  id: string;
  lyrics: string;
  options: string[];
  correctIndex: number;
  timeLimit: number;
}

interface PlayerScore {
  odId: string;
  odName: string;
  score: number;
  combo: number;
  accuracy: number;
}

interface QueuedSong {
  id: string;
  songId?: string;
  title: string;
  artist: string;
  addedBy: string;
  status: "waiting" | "processing" | "ready";
  videoId?: string;
  tjNumber?: string;
}

interface GameState {
  mode: GameMode | null;
  status: GameStatus;
  songQueue: QueuedSong[];
  currentSong: {
    id: string;
    title: string;
    artist: string;
    duration: number;
    audioUrl: string;
    vocalUrl?: string;
    instrumentalUrl?: string;
    lyrics: LyricsLine[];
    pitchData?: { time: number; frequency: number; note: string; midi: number }[];
    videoId?: string;
  } | null;
  currentTime: number;
  currentLyricIndex: number;
  scores: PlayerScore[];
  myScore: number;
  myCombo: number;
  currentPitch: number;
  targetPitch: number;
  quizQuestions: QuizQuestion[];
  currentQuestionIndex: number;
  selectedAnswer: number | null;
  isAnswerRevealed: boolean;
  roundResults: { odId: string; odName: string; isCorrect: boolean; points: number }[];
}

const initialState: GameState = {
  mode: null,
  status: "waiting",
  songQueue: [],
  currentSong: null,
  currentTime: 0,
  currentLyricIndex: 0,
  scores: [],
  myScore: 0,
  myCombo: 0,
  currentPitch: 0,
  targetPitch: 0,
  quizQuestions: [],
  currentQuestionIndex: 0,
  selectedAnswer: null,
  isAnswerRevealed: false,
  roundResults: [],
};

const gameSlice = createSlice({
  name: "game",
  initialState,
  reducers: {
    setGameMode: (state, action: PayloadAction<GameMode>) => {
      state.mode = action.payload;
    },
    setGameStatus: (state, action: PayloadAction<GameStatus>) => {
      state.status = action.payload;
    },
    setCurrentSong: (state, action: PayloadAction<GameState["currentSong"]>) => {
      state.currentSong = action.payload;
    },
    addToQueue: (state, action: PayloadAction<QueuedSong>) => {
      state.songQueue.push(action.payload);
    },
    removeFromQueue: (state, action: PayloadAction<string>) => {
      state.songQueue = state.songQueue.filter(song => song.id !== action.payload);
    },
    updateQueueItem: (state, action: PayloadAction<{ id: string; updates: Partial<QueuedSong> }>) => {
      const song = state.songQueue.find(s => s.id === action.payload.id);
      if (song) {
        Object.assign(song, action.payload.updates);
      }
    },
    playNextInQueue: (state) => {
      if (state.songQueue.length > 0) {
        state.songQueue.shift();
      }
    },
    setQueue: (state, action: PayloadAction<QueuedSong[]>) => {
      state.songQueue = action.payload;
    },
    updateCurrentTime: (state, action: PayloadAction<number>) => {
      state.currentTime = action.payload;
    },
    setCurrentLyricIndex: (state, action: PayloadAction<number>) => {
      state.currentLyricIndex = action.payload;
    },
    updateScores: (state, action: PayloadAction<PlayerScore[]>) => {
      state.scores = action.payload;
    },
    updateMyScore: (state, action: PayloadAction<{ score: number; combo: number }>) => {
      state.myScore = action.payload.score;
      state.myCombo = action.payload.combo;
    },
    updatePitch: (state, action: PayloadAction<{ frequency: number; accuracy: number }>) => {
      state.currentPitch = action.payload.frequency;
    },
    setQuizQuestions: (state, action: PayloadAction<QuizQuestion[]>) => {
      state.quizQuestions = action.payload;
    },
    nextQuestion: (state) => {
      state.currentQuestionIndex += 1;
      state.selectedAnswer = null;
      state.isAnswerRevealed = false;
      state.roundResults = [];
    },
    selectAnswer: (state, action: PayloadAction<number>) => {
      state.selectedAnswer = action.payload;
    },
    revealAnswer: (state, action: PayloadAction<{ odId: string; odName: string; isCorrect: boolean; points: number }[]>) => {
      state.isAnswerRevealed = true;
      state.roundResults = action.payload;
    },
    resetGame: () => initialState,
  },
});

export const {
  setGameMode,
  setGameStatus,
  setCurrentSong,
  addToQueue,
  removeFromQueue,
  updateQueueItem,
  playNextInQueue,
  setQueue,
  updateCurrentTime,
  setCurrentLyricIndex,
  updateScores,
  updateMyScore,
  updatePitch,
  setQuizQuestions,
  nextQuestion,
  selectAnswer,
  revealAnswer,
  resetGame,
} = gameSlice.actions;

export default gameSlice.reducer;
