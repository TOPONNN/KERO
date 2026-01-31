import { AppDataSource } from "../config/database";
import { Room, RoomParticipant, GameMode, RoomStatus } from "../entities";
import { redis } from "../config/redis";
import { v4 as uuidv4 } from "uuid";

const roomRepository = AppDataSource.getRepository(Room);
const participantRepository = AppDataSource.getRepository(RoomParticipant);

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export class RoomService {
  async createRoom(data: {
    name: string;
    gameMode: GameMode;
    hostId: string;
    maxParticipants?: number;
    isPrivate?: boolean;
    password?: string;
  }): Promise<Room> {
    const code = generateRoomCode();

    const room = roomRepository.create({
      id: uuidv4(),
      code,
      name: data.name,
      gameMode: data.gameMode,
      hostId: data.hostId,
      maxParticipants: data.maxParticipants || 6,
      isPrivate: data.isPrivate || false,
      password: data.password,
      status: RoomStatus.WAITING,
    });

    const savedRoom = await roomRepository.save(room);
    await redis.set(`room:${code}`, JSON.stringify(savedRoom), "EX", 86400);

    return savedRoom;
  }

  async joinRoom(code: string, nickname: string, userId?: string, socketId?: string): Promise<RoomParticipant> {
    const room = await roomRepository.findOne({
      where: { code },
      relations: ["participants"],
    });

    if (!room) {
      throw new Error("방을 찾을 수 없습니다.");
    }

    if (room.status === RoomStatus.FINISHED) {
      throw new Error("이미 종료된 방입니다.");
    }

    const participants = room.participants || [];

    if (userId) {
      const existingParticipant = participants.find(
        (p) => p.userId === userId
      );
      if (existingParticipant) {
        existingParticipant.isConnected = true;
        existingParticipant.socketId = socketId;
        return participantRepository.save(existingParticipant);
      }
    }

    const activeParticipants = participants.filter((p) => p.isConnected);
    if (activeParticipants.length >= room.maxParticipants) {
      throw new Error("방이 가득 찼습니다.");
    }

    const participant = participantRepository.create({
      roomId: room.id,
      userId,
      nickname,
      isHost: room.hostId === userId,
      socketId,
      isConnected: true,
    });

    return participantRepository.save(participant);
  }

  async leaveRoom(roomCode: string, participantId: number): Promise<void> {
    await participantRepository.update(participantId, { isConnected: false });

    const room = await roomRepository.findOne({
      where: { code: roomCode },
      relations: ["participants"],
    });

    if (room) {
      const activeParticipants = room.participants.filter((p) => p.isConnected);
      if (activeParticipants.length === 0) {
        room.status = RoomStatus.FINISHED;
        await roomRepository.save(room);
      }
    }
  }

  async getRoomByCode(code: string): Promise<Room | null> {
    const cached = await redis.get(`room:${code}`);
    if (cached) {
      return JSON.parse(cached);
    }

    return roomRepository.findOne({
      where: { code },
      relations: ["participants", "currentSong"],
    });
  }

  async getRoomWithUsers(code: string): Promise<Room | null> {
    return roomRepository.findOne({
      where: { code },
      relations: ["participants", "participants.user"],
    });
  }

  async getPublicRooms(gameMode?: GameMode): Promise<Room[]> {
    const query = roomRepository
      .createQueryBuilder("room")
      .leftJoinAndSelect("room.participants", "participants", "participants.isConnected = :isConnected", { isConnected: true })
      .where("room.isPrivate = :isPrivate", { isPrivate: false })
      .andWhere("room.status = :status", { status: RoomStatus.WAITING });

    if (gameMode) {
      query.andWhere("room.gameMode = :gameMode", { gameMode });
    }

    return query.getMany();
  }

  async updateRoomStatus(roomId: string, status: RoomStatus): Promise<void> {
    await roomRepository.update(roomId, { status });
  }

  async updateParticipantScore(participantId: number, score: number): Promise<void> {
    await participantRepository.increment({ id: participantId }, "score", score);
  }

  async deleteRoom(code: string, userId: string): Promise<boolean> {
    const room = await roomRepository.findOne({
      where: { code },
      relations: ["participants"],
    });

    if (!room) {
      throw new Error("방을 찾을 수 없습니다.");
    }

    if (room.hostId !== userId) {
      throw new Error("방장만 방을 삭제할 수 있습니다.");
    }

    await participantRepository.delete({ roomId: room.id });
    await roomRepository.delete({ id: room.id });
    await redis.del(`room:${code}`);

    return true;
  }
}

export const roomService = new RoomService();
