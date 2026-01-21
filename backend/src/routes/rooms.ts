import { Router, Request, Response } from "express";
import { roomService } from "../services/RoomService";
import { GameMode } from "../entities";

const router = Router();

router.post("/", async (req: Request, res: Response) => {
  try {
    const { name, gameMode, hostId, maxParticipants, isPrivate, password } = req.body;
    const room = await roomService.createRoom({
      name,
      gameMode: gameMode as GameMode,
      hostId,
      maxParticipants,
      isPrivate,
      password,
    });
    res.status(201).json({ success: true, data: room });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const gameMode = req.query.gameMode as string | undefined;
    const rooms = await roomService.getPublicRooms(gameMode as GameMode | undefined);
    res.json({ success: true, data: rooms });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:code", async (req: Request, res: Response) => {
  try {
    const code = req.params.code as string;
    const room = await roomService.getRoomByCode(code);
    if (!room) {
      return res.status(404).json({ success: false, message: "방을 찾을 수 없습니다." });
    }
    res.json({ success: true, data: room });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
