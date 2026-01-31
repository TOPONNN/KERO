import { Server, Socket } from "socket.io";
import { songService } from "../../services/SongService";
import { roomService } from "../../services/RoomService";
import { RoomStatus } from "../../entities";

interface QuizState {
  currentQuestionIndex: number;
  questions: any[];
  answers: Map<number, { participantId: number; answer: any; time: number }[]>;
  streaks: Map<number, number>;
  scores: Map<number, number>;
  answeredQuestions: Set<number>;
}

export class LyricsQuizHandler {
  private quizStates: Map<string, QuizState> = new Map();

  constructor(private io: Server) {}

  registerEvents(socket: Socket): void {
    socket.on("quiz:submit-answer", async (data: { roomCode: string; answer: any; questionIndex: number; timeLeft?: number }) => {
      const state = this.quizStates.get(data.roomCode);
      if (!state || data.questionIndex < 0 || data.questionIndex >= state.questions.length) return;

      if (data.questionIndex > state.currentQuestionIndex) {
        state.currentQuestionIndex = data.questionIndex;
      }

      const question = state.questions[data.questionIndex];
      const isCorrect = this.validateAnswer(question, data.answer);

      const answers = state.answers.get(data.questionIndex) || [];
      const existingAnswer = answers.find((a) => a.participantId === socket.data.participantId);
      if (existingAnswer) return;

      answers.push({
        participantId: socket.data.participantId,
        answer: data.answer,
        time: Date.now(),
      });
      state.answers.set(data.questionIndex, answers);

      const currentStreak = state.streaks.get(socket.data.participantId) || 0;
      const newStreak = isCorrect ? currentStreak + 1 : 0;
      state.streaks.set(socket.data.participantId, newStreak);

      let points = 0;
      if (isCorrect) {
        const timeLeft = data.timeLeft || 0;
        points = this.calculatePoints(question, timeLeft, newStreak);
        const currentScore = state.scores.get(socket.data.participantId) || 0;
        state.scores.set(socket.data.participantId, currentScore + points);
        await roomService.updateParticipantScore(socket.data.participantId, points);

        // If this question hasn't been answered correctly yet, broadcast force-advance
        if (!state.answeredQuestions.has(data.questionIndex)) {
          state.answeredQuestions.add(data.questionIndex);

          // Tell all OTHER clients to advance to next question
          socket.to(data.roomCode).emit("quiz:force-advance", {
            questionIndex: data.questionIndex,
            totalQuestions: state.questions.length,
            answeredBy: socket.data.nickname || "누군가",
            answeredById: socket.data.participantId,
            correctAnswer: question.correctAnswer,
            points,
          });
        }
      }

      socket.emit("quiz:answer-result", {
        isCorrect,
        points,
        correctAnswer: question.correctAnswer,
        streak: newStreak,
      });

      this.io.to(data.roomCode).emit("quiz:participant-answered", {
        participantId: socket.data.participantId,
        nickname: socket.data.nickname,
        isCorrect,
        points,
        streak: newStreak,
      });
    });

    socket.on("quiz:start", async (data: { roomCode: string }) => {
      const quizRoomCode = data.roomCode || socket.data.roomCode;
      if (!quizRoomCode) return;

      const room = await roomService.getRoomByCode(quizRoomCode);
      if (!room) return;

      const participant = room.participants.find((p: any) => p.id === socket.data.participantId);
      if (!participant?.isHost) {
        socket.emit("error", { message: "호스트만 퀴즈를 시작할 수 있습니다." });
        return;
      }

      await this.startGame(quizRoomCode);
    });
  }

  public initializeQuizState(roomCode: string, questions: any[]): void {
    if (this.quizStates.has(roomCode)) return;

    const state: QuizState = {
      currentQuestionIndex: 0,
      questions,
      answers: new Map(),
      streaks: new Map(),
      scores: new Map(),
      answeredQuestions: new Set(),
    };
    this.quizStates.set(roomCode, state);
  }

  async startGame(roomCode: string, songId?: string): Promise<void> {
    const quizQuestionCount = songId ? 10 : 10;
    const questions = await songService.generateTJEnhancedQuiz(quizQuestionCount);
    if (questions.length === 0) {
      this.io.to(roomCode).emit("error", { message: "퀴즈 문제를 생성할 수 없습니다." });
      return;
    }

    await roomService.updateRoomStatus(roomCode, RoomStatus.PLAYING);

    const state: QuizState = {
      currentQuestionIndex: 0,
      questions,
      answers: new Map(),
      streaks: new Map(),
      scores: new Map(),
      answeredQuestions: new Set(),
    };
    this.quizStates.set(roomCode, state);

    this.io.to(roomCode).emit("game:started", {
      song: { id: "quiz", title: "노래 퀴즈", artist: "" },
    });
    const questionsData = questions.map((q: any, idx: number) => {
      const options = q.wrongAnswers && q.wrongAnswers.length > 0
        ? this.shuffleArray([q.correctAnswer, ...q.wrongAnswers])
        : undefined;
      const correctIndex = options ? options.indexOf(q.correctAnswer) : undefined;
      let lines: { idx: number; text: string }[] | undefined;
      if (q.type === "lyrics_order" && Array.isArray(q.wrongAnswers)) {
        lines = [];
        for (let i = 0; i < q.wrongAnswers.length; i++) {
          lines.push({ idx: i, text: q.wrongAnswers[i] });
        }
        lines = lines.sort(() => Math.random() - 0.5);
      }
      return {
        id: String(idx),
        type: q.type,
        questionText: q.questionText,
        options,
        correctIndex,
        correctAnswer: q.correctAnswer,
        timeLimit: q.timeLimit,
        points: q.points,
        metadata: q.metadata,
        lines,
      };
    });

    this.io.to(roomCode).emit("quiz:questions-data", questionsData);
  }

  async nextQuestion(roomCode: string): Promise<void> {
    const state = this.quizStates.get(roomCode);
    if (!state) return;

    state.currentQuestionIndex++;

    if (state.currentQuestionIndex >= state.questions.length) {
      await this.endGame(roomCode);
      return;
    }

    const question = state.questions[state.currentQuestionIndex];
    const wrongAnswers = Array.isArray(question.wrongAnswers) ? (question.wrongAnswers as string[]) : [];

    let options: string[] | undefined;
    if (question.type === "lyrics_fill" || question.type === "title_guess" || question.type === "artist_guess") {
      options = this.shuffleArray([question.correctAnswer, ...wrongAnswers]);
    }

    this.io.to(roomCode).emit("quiz:nextQuestion");
    this.io.to(roomCode).emit("quiz:question", {
      questionIndex: state.currentQuestionIndex,
      totalQuestions: state.questions.length,
      type: question.type,
      questionText: question.questionText,
      options,
      timeLimit: question.timeLimit,
      points: question.points,
      metadata: question.metadata,
      ...(question.type === "lyrics_order" && {
        lines: this.shuffleArray((() => {
          const orderedLines: { idx: number; text: string }[] = [];
          for (let i = 0; i < wrongAnswers.length; i++) {
            orderedLines.push({ idx: i, text: wrongAnswers[i] });
          }
          return orderedLines;
        })()),
      }),
    });

    await this.delay(question.timeLimit * 1000 + 2000);

    this.io.to(roomCode).emit("quiz:answerRevealed", {
      questionIndex: state.currentQuestionIndex,
      correctAnswer: question.correctAnswer,
      type: question.type,
    });

    const leaderboard = Array.from(state.scores.entries())
      .map(([participantId, score]) => ({ participantId, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    this.io.to(roomCode).emit("quiz:leaderboard", { leaderboard });

    await this.delay(3000);
    await this.nextQuestion(roomCode);
  }

  private async endGame(roomCode: string): Promise<void> {
    const room = await roomService.getRoomByCode(roomCode);
    if (!room) return;

    const state = this.quizStates.get(roomCode);
    const results = room.participants
      .map((p: any) => ({
        participantId: p.id,
        nickname: p.nickname,
        score: state?.scores.get(p.id) || p.score || 0,
        streak: state?.streaks.get(p.id) || 0,
      }))
      .sort((a: any, b: any) => b.score - a.score);

    this.io.to(roomCode).emit("game:finished");
    this.io.to(roomCode).emit("game:scoresUpdate", results);

    this.quizStates.delete(roomCode);
    await roomService.updateRoomStatus(roomCode, RoomStatus.WAITING);
  }

  private validateAnswer(question: any, answer: any): boolean {
    switch (question.type) {
      case "lyrics_fill":
      case "title_guess":
      case "artist_guess": {
        const normalize = (s: string) => s.replace(/\s*[\(（\[].*?[\)）\]]/g, '').replace(/\s/g, "").toLowerCase();
        return normalize(String(answer)) === normalize(question.correctAnswer);
      }
      case "lyrics_order":
        try {
          const correctOrder = typeof question.correctAnswer === "string"
            ? JSON.parse(question.correctAnswer)
            : question.correctAnswer;
          return JSON.stringify(answer) === JSON.stringify(correctOrder);
        } catch {
          return false;
        }
      case "initial_guess": {
        const normalize = (s: string) => s.replace(/\s*[\(（\[].*?[\)）\]]/g, '').replace(/\s/g, "").toLowerCase();
        return normalize(String(answer)) === normalize(question.correctAnswer);
      }
      case "true_false":
        return String(answer) === question.correctAnswer;
      default:
        return false;
    }
  }

  private calculatePoints(question: any, timeLeft: number, streak: number): number {
    const speedBonus = Math.round(1000 * (timeLeft / (question.timeLimit || 15)));
    let multiplier = 1.0;
    if (streak >= 5) multiplier = 1.5;
    else if (streak >= 4) multiplier = 1.3;
    else if (streak >= 3) multiplier = 1.2;
    else if (streak >= 2) multiplier = 1.1;
    return Math.round(speedBonus * multiplier);
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
