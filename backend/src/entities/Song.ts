import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, OneToMany } from "typeorm";
import { Score } from "./Score";
import { LyricsLine } from "./LyricsLine";

export enum ProcessingStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed"
}

@Entity("songs")
export class Song {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ length: 255 })
  artist!: string;

  @Column({ nullable: true })
  videoId?: string;

  @Column({ nullable: true })
  originalUrl?: string;

  @Column({ nullable: true })
  vocalsUrl?: string;

  @Column({ nullable: true })
  instrumentalUrl?: string;

  @Column({ type: "int", nullable: true })
  duration?: number;

  @Column({ type: "enum", enum: ProcessingStatus, default: ProcessingStatus.PENDING })
  processingStatus!: ProcessingStatus;

  @Column({ nullable: true })
  uploadedBy?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @OneToMany(() => Score, (score) => score.song)
  scores!: Score[];

  @OneToMany(() => LyricsLine, (line) => line.song)
  lyrics!: LyricsLine[];
}
