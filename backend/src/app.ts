import "reflect-metadata";
import express from "express";
import cors from "cors";
import http from "http";
import dotenv from "dotenv";
import { AppDataSource } from "./config/database";
import { connectRabbitMQ } from "./config/rabbitmq";
import { initializeSocket } from "./socket";
import authRoutes from "./routes/auth";
import roomRoutes from "./routes/rooms";
import songRoutes from "./routes/songs";

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api/auth", authRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/songs", songRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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
  } catch (error) {
    console.error("Bootstrap error:", error);
    process.exit(1);
  }
}

bootstrap();

export { app, server };
