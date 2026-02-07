"use client";

import { useEffect, useCallback } from "react";
import { useDispatch } from "react-redux";
import { getSocket, connectSocket, disconnectSocket } from "@/lib/socket";
import { setRoom, addParticipant, removeParticipant, setRoomStatus, setConnected, leaveRoom as leaveRoomAction } from "@/store/slices/roomSlice";
import { 
  setGameStatus, 
  setCurrentSong, 
  updateCurrentTime, 
  updateScores, 
  updatePitch,
  setQuizQuestions,
  nextQuestion,
  revealAnswer,
  addToQueue,
  removeFromQueue,
  updateQueueItem,
  setQueue,
} from "@/store/slices/gameSlice";

export function useSocket(roomCode: string | null) {
  const dispatch = useDispatch();

  useEffect(() => {
    if (!roomCode) return;

    const token = localStorage.getItem("token");
    if (!token) return;

    const socket = connectSocket(token);

    socket.on("connect", () => {
      dispatch(setConnected(true));
      
      const userStr = localStorage.getItem("user");
      let userId: string | undefined;
      let nickname: string | undefined;
      
      if (userStr) {
        try {
          const user = JSON.parse(userStr);
          userId = user.id;
          nickname = sessionStorage.getItem("roomNickname") || user.name;
        } catch {}
      }
      
      socket.emit("room:join", { code: roomCode, userId, nickname });
    });

    socket.on("disconnect", () => {
      dispatch(setConnected(false));
    });

    socket.on("room:joined", (data) => {
      dispatch(setRoom(data.room));
    });

    socket.on("room:participant:joined", (participant) => {
      dispatch(addParticipant(participant));
    });

    socket.on("room:participant:left", (participantId) => {
      dispatch(removeParticipant(participantId));
    });

    socket.on("room:closed", (data: { reason: string }) => {
      // Only redirect if we're still on this room's page (not navigated away)
      if (window.location.pathname.includes(roomCode)) {
        dispatch(leaveRoomAction());
        alert(data.reason);
        window.location.href = "/lobby";
      }
    });

    socket.on("error", (data: { message: string }) => {
      console.error("[Socket Error]", data.message);
      // Only redirect if we're still on this room's page
      if (window.location.pathname.includes(roomCode)) {
        alert(data.message);
        window.location.href = "/lobby";
      }
    });

    socket.on("game:started", (data) => {
      console.log("[useSocket] game:started received:", data);
      dispatch(setGameStatus("playing"));
      dispatch(setCurrentSong(data.song));
      if (data.queueItemId) {
        dispatch(removeFromQueue(data.queueItemId));
      }
    });

    socket.on("game:sync-state", (data: { song: any; status: "playing" | "paused"; currentTime?: number; queue?: any[] }) => {
      console.log("[useSocket] game:sync-state received:", data);
      dispatch(setGameStatus(data.status));
      dispatch(setCurrentSong(data.song));
      if (typeof data.currentTime === "number") {
        dispatch(updateCurrentTime(data.currentTime));
        // Dispatch custom event for player to seek
        window.dispatchEvent(new CustomEvent("kero:syncTime", { detail: { time: data.currentTime } }));
      }
      if (Array.isArray(data.queue)) {
        dispatch(setQueue(data.queue));
      }
    });

    socket.on("game:paused", () => {
      dispatch(setGameStatus("paused"));
    });

    socket.on("game:resumed", () => {
      dispatch(setGameStatus("playing"));
    });

    socket.on("game:finished", () => {
      dispatch(setGameStatus("finished"));
    });

    socket.on("game:timeUpdate", (time) => {
      dispatch(updateCurrentTime(time));
    });

    socket.on("game:scoresUpdate", (scores) => {
      dispatch(updateScores(scores));
    });

    socket.on("game:pitchUpdate", (data) => {
      dispatch(updatePitch(data));
    });

    socket.on("quiz:questions", (questions) => {
      dispatch(setQuizQuestions(questions));
    });

    socket.on("quiz:nextQuestion", () => {
      dispatch(nextQuestion());
    });

    socket.on("quiz:answerRevealed", (results) => {
      dispatch(revealAnswer(results));
    });

    socket.on("quiz:questions-data", (questions: any[]) => {
      dispatch(setQuizQuestions(questions));
      dispatch(setGameStatus("playing"));
    });

    socket.on("quiz:force-advance", (data: { questionIndex: number; totalQuestions: number; answeredBy: string; answeredById: string; correctAnswer: string; points: number; isCorrect: boolean }) => {
      dispatch(revealAnswer([{
        odId: data.answeredById || "remote",
        odName: data.answeredBy || "누군가",
        isCorrect: data.isCorrect ?? true,
        points: data.points || 0,
      }]));
      // LyricsQuizGame's reveal effect handles advance timing
    });

    socket.on("quiz:sync-state", (data: { questions: any[] }) => {
      dispatch(setQuizQuestions(data.questions));
      dispatch(setGameStatus("playing"));
    });

    // Queue synchronization listeners
    socket.on("queue:song-added", (song: any) => {
      dispatch(addToQueue(song));
    });

    socket.on("queue:song-removed", (data: { songId: string }) => {
      dispatch(removeFromQueue(data.songId));
    });

    socket.on("queue:song-updated", (data: { songId: string; updates: any }) => {
      dispatch(updateQueueItem({ id: data.songId, updates: data.updates }));
    });

    return () => {
      socket.emit("room:leave", { code: roomCode });
      disconnectSocket();
    };
  }, [roomCode, dispatch]);

  const emitEvent = useCallback((event: string, data?: unknown) => {
    const socket = getSocket();
    if (socket.connected) {
      console.log("[emitEvent]", event, data);
      socket.emit(event, data);
    } else {
      console.warn("[emitEvent] Socket not connected, cannot emit:", event);
    }
  }, []);

  return { emitEvent };
}
