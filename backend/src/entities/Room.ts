import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne, JoinColumn } from "typeorm";
import { RoomParticipant } from "./RoomParticipant";
import { Song } from "./Song";

export enum GameMode {
  NORMAL = "normal",
  PERFECT_SCORE = "perfect_score",
  LYRICS_QUIZ = "lyrics_quiz",
  BATTLE = "battle",
  DUET = "duet"
}

export enum RoomStatus {
  WAITING = "waiting",
  PLAYING = "playing",
  FINISHED = "finished"
}

@Entity("rooms")
export class Room {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ length: 6, unique: true })
  code!: string;

  @Column({ length: 100 })
  name!: string;

  @Column({ type: "enum", enum: GameMode })
  gameMode!: GameMode;

  @Column({ type: "enum", enum: RoomStatus, default: RoomStatus.WAITING })
  status!: RoomStatus;

  @Column({ type: "int", default: 8 })
  maxParticipants!: number;

  @Column("uuid")
  hostId!: string;

  @Column("uuid", { nullable: true })
  currentSongId?: string;

  @Column({ type: "int", default: 0 })
  currentRound!: number;

  @Column({ type: "int", default: 5 })
  totalRounds!: number;

  @Column({ default: false })
  isPrivate!: boolean;

  @Column({ nullable: true })
  password?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @OneToMany(() => RoomParticipant, (participant) => participant.room)
  participants!: RoomParticipant[];

  @ManyToOne(() => Song, { nullable: true })
  @JoinColumn({ name: "currentSongId" })
  currentSong?: Song;
}
