import "reflect-metadata";
import express from "express";
import cors from "cors";
import http from "http";
import dotenv from "dotenv";
import { AppDataSource } from "./config/database";
import { connectRabbitMQ } from "./config/rabbitmq";
import { initializeSocket } from "./socket";
import jwt from "jsonwebtoken";
import { redis } from "./config/redis";
import authRoutes from "./routes/auth";
import roomRoutes from "./routes/rooms";
import songRoutes from "./routes/songs";
import searchRoutes from "./routes/search";
import livekitRoutes from "./routes/livekit";
import { songService } from "./services/SongService";

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/songs", songRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/livekit", livekitRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Heartbeat - frontend sends every 10s to register as online
app.post("/api/online/heartbeat", async (req, res) => {
  try {
    const { visitorId, nickname, profileImage, currentPage } = req.body;
    if (!visitorId) {
      return res.status(400).json({ success: false, message: "visitorId required" });
    }
    
    // Try to extract userId from JWT if present
    let userId: string | undefined;
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || "secret") as { userId: string };
        userId = decoded.userId;
      } catch {}
    }
    
    const key = `online:${userId || visitorId}`;
    const data = { visitorId, userId, nickname, profileImage, currentPage, lastSeen: Date.now() };
    await redis.setex(key, 15, JSON.stringify(data));
    
    res.json({ success: true });
  } catch {
    res.json({ success: true });
  }
});

// Get all online visitors
app.get("/api/online", async (req, res) => {
  try {
    // Use scan instead of keys to avoid blocking Redis
    const keys: string[] = [];
    let cursor = "0";
    
    do {
      const [nextCursor, resultKeys] = await redis.scan(
        cursor,
        "MATCH",
        "online:*",
        "COUNT",
        100
      );
      cursor = nextCursor;
      keys.push(...resultKeys);
    } while (cursor !== "0");
    
    if (keys.length === 0) {
      return res.json({ success: true, data: { count: 0, users: [] } });
    }
    
    const values = await redis.mget(...keys);
    const users: Array<{ nickname?: string; profileImage?: string | null; currentPage?: string; lastSeen: number }> = [];
    const seen = new Set<string>();
    
    for (const val of values) {
      if (!val) continue;
      try {
        const parsed = JSON.parse(val);
        // Deduplicate by visitorId or userId
        const dedupeKey = parsed.userId || parsed.visitorId;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        users.push({
          nickname: parsed.nickname,
          profileImage: parsed.profileImage,
          currentPage: parsed.currentPage,
          lastSeen: parsed.lastSeen,
        });
      } catch {}
    }
    
    res.json({ success: true, data: { count: users.length, users } });
  } catch {
    res.json({ success: true, data: { count: 0, users: [] } });
  }
});

const PORT = process.env.PORT || 4000;

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    console.log("Database connected");

    try {
      await connectRabbitMQ();
    } catch (err) {
      console.warn("RabbitMQ not available, continuing without it");
    }

    initializeSocket(server);
    console.log("Socket.io initialized");

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Pre-cache quiz data on startup (5s delay) and every hour
    setTimeout(() => {
      songService.warmupQuizCache().catch(e => console.error("[QuizCache] Startup warmup failed:", e));
      songService.warmupRandomMVPool().catch(e => console.error("[MVPool] Startup warmup failed:", e));
    }, 5000);
    setInterval(() => {
      songService.warmupQuizCache().catch(e => console.error("[QuizCache] Scheduled warmup failed:", e));
      songService.warmupRandomMVPool().catch(e => console.error("[MVPool] Scheduled warmup failed:", e));
    }, 3600000);
  } catch (error) {
    console.error("Bootstrap error:", error);
    process.exit(1);
  }
}

bootstrap();

export { app, server };
