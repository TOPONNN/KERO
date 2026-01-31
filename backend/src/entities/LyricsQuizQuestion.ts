import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from "typeorm";
import { Song } from "./Song";

export enum QuizType {
  LYRICS_FILL = "lyrics_fill",
  TITLE_GUESS = "title_guess",
  ARTIST_GUESS = "artist_guess",
  LYRICS_ORDER = "lyrics_order",
  INITIAL_GUESS = "initial_guess",
  TRUE_FALSE = "true_false",
}

@Entity("lyrics_quiz_questions")
export class LyricsQuizQuestion {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("uuid")
  songId!: string;

  @Column({ type: "text" })
  questionText!: string;

  @Column({ type: "text" })
  correctAnswer!: string;

  @Column({ type: "simple-array" })
  wrongAnswers!: string[];

  @Column({ type: "float" })
  startTime!: number;

  @Column({ type: "float" })
  endTime!: number;

  @Column({ type: "int", default: 10 })
  timeLimit!: number;

  @Column({ type: "int", default: 1000 })
  points!: number;

  @Column({ type: "enum", enum: QuizType, default: QuizType.LYRICS_FILL })
  type!: QuizType;

  @Column({ type: "json", nullable: true })
  metadata?: Record<string, any>;

  @ManyToOne(() => Song, { onDelete: "CASCADE" })
  @JoinColumn({ name: "songId" })
  song!: Song;
}
