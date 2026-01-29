import { Server, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { NormalModeHandler } from "./handlers/NormalModeHandler";
import { PerfectScoreHandler } from "./handlers/PerfectScoreHandler";
import { LyricsQuizHandler } from "./handlers/LyricsQuizHandler";
import { roomService } from "../services/RoomService";
import { RoomParticipant } from "../entities";
import { redisPubSub } from "../services/RedisPubSubService";

interface JoinRoomData {
  code: string;
  nickname?: string;
  userId?: string;
}

interface LeaveRoomData {
  code?: string;
}

interface StartGameData {
  roomCode?: string;
  songId: string;
}

export function initializeSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST"],
    },
    transports: ["polling", "websocket"],
    allowUpgrades: true,
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const normalModeHandler = new NormalModeHandler(io);
  const perfectScoreHandler = new PerfectScoreHandler(io);
  const lyricsQuizHandler = new LyricsQuizHandler(io);

  redisPubSub.setSocketServer(io);

  io.on("connection", (socket: Socket) => {
    console.log(`Client connected: ${socket.id}`);

    socket.on("room:join", async (data: JoinRoomData) => {
      try {
        const room = await roomService.getRoomByCode(data.code);
        if (!room) {
          socket.emit("error", { message: "방을 찾을 수 없습니다." });
          return;
        }

        const nickname = data.nickname || socket.data.user?.name || `Guest_${socket.id.substring(0, 4)}`;
        const userId = data.userId || socket.data.user?.id;

        const participant = await roomService.joinRoom(
          data.code,
          nickname,
          userId,
          socket.id
        );

        socket.join(data.code);
        socket.data.roomCode = data.code;
        socket.data.participantId = participant.id;
        socket.data.nickname = nickname;
        socket.data.gameMode = room.gameMode;

        const participantData = {
          id: participant.id,
          nickname: participant.nickname,
          isHost: participant.isHost,
          score: participant.score,
        };
        
        socket.to(data.code).emit("room:participant:joined", participantData);
        await redisPubSub.publishParticipantJoined(data.code, participantData);

        const connectedParticipants = (room.participants || [])
          .filter((p: RoomParticipant) => p.isConnected);

        socket.emit("room:joined", { 
          room: {
            id: room.id,
            code: room.code,
            name: room.name,
            gameMode: room.gameMode,
            status: room.status,
            hostId: room.hostId,
            participants: connectedParticipants.map((p: RoomParticipant) => ({
              id: p.id,
              nickname: p.nickname,
              isHost: p.isHost,
              score: p.score,
            })),
          },
          participant: {
            id: participant.id,
            nickname: participant.nickname,
            isHost: participant.isHost,
          }
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        socket.emit("error", { message });
      }
    });

    socket.on("room:leave", async (data?: LeaveRoomData) => {
      const roomCode = data?.code || socket.data.roomCode;
      const participantId = socket.data.participantId;
      
      if (roomCode && participantId) {
        await roomService.leaveRoom(roomCode, participantId);
        socket.leave(roomCode);
        io.to(roomCode).emit("room:participant:left", participantId);
        await redisPubSub.publishParticipantLeft(roomCode, participantId);
      }
    });

    socket.on("game:start", async (data: StartGameData) => {
      const roomCode = data.roomCode || socket.data.roomCode;
      if (!roomCode) return;

      const room = await roomService.getRoomByCode(roomCode);
      if (!room || !room.participants) return;

      const participant = room.participants.find((p: RoomParticipant) => p.id === socket.data.participantId);
      if (!participant?.isHost) {
        socket.emit("error", { message: "호스트만 게임을 시작할 수 있습니다." });
        return;
      }

      switch (room.gameMode) {
        case "normal":
          await normalModeHandler.startGame(roomCode, data.songId);
          break;
        case "perfect_score":
          await perfectScoreHandler.startGame(roomCode, data.songId);
          break;
        case "lyrics_quiz":
          await lyricsQuizHandler.startGame(roomCode, data.songId);
          break;
        case "battle":
          await normalModeHandler.startGame(roomCode, data.songId);
          break;
        case "duet":
          await normalModeHandler.startGame(roomCode, data.songId);
          break;
      }
    });

    socket.on("game:pause", () => {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;
      io.to(roomCode).emit("game:paused");
    });

    socket.on("game:resume", () => {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;
      io.to(roomCode).emit("game:resumed");
    });

    socket.on("game:end", () => {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;
      io.to(roomCode).emit("game:finished");
    });

    normalModeHandler.registerEvents(socket);
    perfectScoreHandler.registerEvents(socket);
    lyricsQuizHandler.registerEvents(socket);

    socket.on("disconnect", async () => {
      const { roomCode, participantId } = socket.data;
      if (roomCode && participantId) {
        await roomService.leaveRoom(roomCode, participantId);
        io.to(roomCode).emit("room:participant:left", participantId);
        await redisPubSub.publishParticipantLeft(roomCode, participantId);
      }
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  return io;
}
