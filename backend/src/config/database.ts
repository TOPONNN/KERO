import { DataSource } from "typeorm";
import { User, Song, LyricsLine, Room, RoomParticipant, Score, LyricsQuizQuestion } from "../entities";
import dotenv from "dotenv";

dotenv.config();

export const AppDataSource = new DataSource({
  type: "mysql",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "3306"),
  username: process.env.DB_USERNAME || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_DATABASE || "kero",
  synchronize: true, // Auto-create tables (OK for demo project)
  logging: process.env.NODE_ENV === "development",
  entities: [User, Song, LyricsLine, Room, RoomParticipant, Score, LyricsQuizQuestion],
  migrations: ["src/migrations/**/*.ts"],
  subscribers: ["src/subscribers/**/*.ts"],
});
