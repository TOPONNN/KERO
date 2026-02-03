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

const onlineUsers = new Map<string, { nickname: string; profileImage: string | null; currentPage: string; connectedAt: number; posX: number; posY: number; color: string }>();

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

   const broadcastPresence = () => {
     const users = Array.from(onlineUsers.entries()).map(([socketId, user]) => ({
       socketId,
       ...user,
     }));
     io.emit("presence:update", { count: users.length, users });
   };

    io.on("connection", (socket: Socket) => {
      console.log(`Client connected: ${socket.id}`);

       socket.on("presence:join", (data: { nickname?: string; profileImage?: string | null; currentPage?: string }) => {
         const randomColor = `hsl(${Math.random() * 360}, 70%, 50%)`;
         onlineUsers.set(socket.id, {
           nickname: data.nickname || "게스트",
           profileImage: data.profileImage || null,
           currentPage: data.currentPage || "/",
           connectedAt: Date.now(),
           posX: 0,
           posY: 0,
           color: randomColor,
         });
         broadcastPresence();
       });

       socket.on("presence:page", (data: { currentPage: string }) => {
         const user = onlineUsers.get(socket.id);
         if (user) {
           user.currentPage = data.currentPage;
           broadcastPresence();
         }
       });

       socket.on("cursor:move", (data: { x: number; y: number }) => {
         const user = onlineUsers.get(socket.id);
         if (user) {
           user.posX = data.x;
           user.posY = data.y;
           socket.broadcast.emit("cursor:update", {
             socketId: socket.id,
             nickname: user.nickname,
             profileImage: user.profileImage,
             currentPage: user.currentPage,
             connectedAt: user.connectedAt,
             posX: data.x,
             posY: data.y,
             color: user.color,
           });
         }
       });

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

          // Get room with user data for profile images
          const roomWithUsers = await roomService.getRoomWithUsers(data.code);
          
          // Get profile image for the joining participant
          const joiningParticipantWithUser = roomWithUsers?.participants.find((p: RoomParticipant) => p.id === participant.id);
          const profileImage = joiningParticipantWithUser?.user?.profileImage || null;

         const participantData = {
           id: participant.id,
           nickname: participant.nickname,
           isHost: participant.isHost,
           score: participant.score,
           profileImage,
         };
         
         socket.to(data.code).emit("room:participant:joined", participantData);
         await redisPubSub.publishParticipantJoined(data.code, participantData);

         const connectedParticipants = (roomWithUsers?.participants || [])
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
                profileImage: p.user?.profileImage || null,
              })),
            },
            participant: {
              id: participant.id,
              nickname: participant.nickname,
              isHost: participant.isHost,
            }
          });

         // Send quiz state if game is in progress (for rejoin)
         const quizState = lyricsQuizHandler.getQuizState(data.code);
         if (quizState && quizState.currentQuestionIndex < quizState.questions.length) {
           const remainingQuestions = quizState.questions.slice(quizState.currentQuestionIndex);
           socket.emit("quiz:sync-state", {
             questions: remainingQuestions,
           });
         }
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

    // Queue synchronization events
    socket.on("queue:add", (data: { roomCode: string; song: any }) => {
      const roomCode = data.roomCode || socket.data.roomCode;
      if (!roomCode) return;
      socket.to(roomCode).emit("queue:song-added", data.song);
    });

    socket.on("queue:remove", (data: { roomCode: string; songId: string }) => {
      const roomCode = data.roomCode || socket.data.roomCode;
      if (!roomCode) return;
      socket.to(roomCode).emit("queue:song-removed", { songId: data.songId });
    });

    socket.on("queue:update", (data: { roomCode: string; songId: string; updates: any }) => {
      const roomCode = data.roomCode || socket.data.roomCode;
      if (!roomCode) return;
      socket.to(roomCode).emit("queue:song-updated", { songId: data.songId, updates: data.updates });
    });

    // Quiz broadcast — host sends generated questions to all other players
    socket.on("quiz:broadcast-questions", (data: { roomCode: string; questions: any[] }) => {
      const roomCode = data.roomCode || socket.data.roomCode;
      if (!roomCode) return;
      lyricsQuizHandler.initializeQuizState(roomCode, data.questions);
      socket.to(roomCode).emit("quiz:questions-data", data.questions);
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
        onlineUsers.delete(socket.id);
        broadcastPresence();
        console.log(`Client disconnected: ${socket.id}`);
     });
  });

  return io;
}
