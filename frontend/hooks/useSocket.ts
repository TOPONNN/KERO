"use client";

import { useEffect, useCallback } from "react";
import { useDispatch } from "react-redux";
import { getSocket, connectSocket, disconnectSocket } from "@/lib/socket";
import { setRoom, addParticipant, removeParticipant, setRoomStatus, setConnected } from "@/store/slices/roomSlice";
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
          nickname = user.name;
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

    socket.on("game:started", (data) => {
      dispatch(setGameStatus("playing"));
      dispatch(setCurrentSong(data.song));
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
      socket.emit(event, data);
    }
  }, []);

  return { emitEvent };
}
