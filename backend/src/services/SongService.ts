import { AppDataSource } from "../config/database";
import { Song, LyricsLine, LyricsQuizQuestion, ProcessingStatus } from "../entities";
import { uploadFile } from "../config/s3";
import { publishMessage, QUEUES } from "../config/rabbitmq";
import { v4 as uuidv4 } from "uuid";
import { youtubeService } from "./YouTubeService";

const songRepository = AppDataSource.getRepository(Song);
const lyricsRepository = AppDataSource.getRepository(LyricsLine);
const quizRepository = AppDataSource.getRepository(LyricsQuizQuestion);

export class SongService {
  async uploadSong(
    file: Buffer,
    filename: string,
    title: string,
    artist: string,
    uploadedBy?: string
  ): Promise<Song> {
    const songId = uuidv4();
    const key = `songs/${songId}/${filename}`;
    const url = await uploadFile(key, file, "audio/mpeg");

    const song = songRepository.create({
      id: songId,
      title,
      artist,
      originalUrl: url,
      uploadedBy,
      processingStatus: ProcessingStatus.PENDING,
    });

    const savedSong = await songRepository.save(song);

    await publishMessage(QUEUES.AUDIO_PROCESSING, {
      songId: savedSong.id,
      audioUrl: url,
      callbackUrl: `${process.env.API_URL}/api/songs/${savedSong.id}/processing-callback`,
    });

    return savedSong;
  }

  async updateProcessingResult(
    songId: string,
    data: {
      vocalsUrl?: string;
      instrumentalUrl?: string;
      lyrics?: Array<{ 
        startTime: number; 
        endTime: number; 
        text: string;
        words?: Array<{ startTime: number; endTime: number; text: string }>;
      }>;
      duration?: number;
      status: ProcessingStatus;
    }
  ): Promise<void> {
    await songRepository.update(songId, {
      vocalsUrl: data.vocalsUrl,
      instrumentalUrl: data.instrumentalUrl,
      duration: data.duration,
      processingStatus: data.status,
    });

    if (data.lyrics && data.lyrics.length > 0) {
      const lyricsLines = data.lyrics.map((line, index) =>
        lyricsRepository.create({
          songId,
          startTime: line.startTime,
          endTime: line.endTime,
          text: line.text,
          lineOrder: index,
          words: line.words,
        })
      );
      await lyricsRepository.save(lyricsLines);
      await this.generateQuizQuestions(songId);
    }
  }

  async generateQuizQuestions(songId: string): Promise<void> {
    const lyrics = await lyricsRepository.find({
      where: { songId },
      order: { lineOrder: "ASC" },
    });

    const questions: LyricsQuizQuestion[] = [];

    for (let i = 0; i < lyrics.length; i += 3) {
      const targetLine = lyrics[i];
      const words = targetLine.text.split(" ");

      if (words.length < 2) continue;

      const blankIndex = Math.floor(Math.random() * words.length);
      const correctAnswer = words[blankIndex];
      const questionWords = [...words];
      questionWords[blankIndex] = "______";

      const wrongAnswers = this.generateWrongAnswers(correctAnswer, lyrics);

      const question = quizRepository.create({
        songId,
        questionText: questionWords.join(" "),
        correctAnswer,
        wrongAnswers,
        startTime: targetLine.startTime,
        endTime: targetLine.endTime,
        timeLimit: 10,
        points: 1000,
      });

      questions.push(question);
    }

    if (questions.length > 0) {
      await quizRepository.save(questions);
    }
  }

  private generateWrongAnswers(correctAnswer: string, lyrics: LyricsLine[]): string[] {
    const allWords = new Set<string>();
    lyrics.forEach((line) => {
      line.text.split(" ").forEach((word) => {
        if (word !== correctAnswer && word.length > 1) {
          allWords.add(word);
        }
      });
    });

    const wrongAnswers = Array.from(allWords)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3);

    while (wrongAnswers.length < 3) {
      wrongAnswers.push(`보기${wrongAnswers.length + 1}`);
    }

    return wrongAnswers;
  }

  async getSongById(id: string): Promise<Song | null> {
    return songRepository.findOne({
      where: { id },
      relations: ["lyrics"],
    });
  }

  async getSongWithQuiz(id: string): Promise<{ song: Song; questions: LyricsQuizQuestion[] } | null> {
    const song = await songRepository.findOne({ where: { id } });
    if (!song) return null;

    const questions = await quizRepository.find({
      where: { songId: id },
      order: { startTime: "ASC" },
    });

    return { song, questions };
  }

  async getAllSongs(): Promise<Song[]> {
    return songRepository.find({
      where: { processingStatus: ProcessingStatus.COMPLETED },
      order: { createdAt: "DESC" },
    });
  }

  async findByVideoId(videoId: string): Promise<Song | null> {
    return songRepository.findOne({
      where: { videoId },
      relations: ["lyrics"],
    });
  }

  async createFromYouTube(
    songId: string,
    videoId: string,
    title: string,
    artist: string
  ): Promise<Song> {
    console.log(`[createFromYouTube] Request: videoId=${videoId}, title=${title}, artist=${artist}`);
    
    const existingSong = await this.findByVideoId(videoId);
    console.log(`[createFromYouTube] existingSong:`, existingSong ? `id=${existingSong.id}, status=${existingSong.processingStatus}` : 'null');
    
    if (existingSong) {
      if (existingSong.processingStatus === ProcessingStatus.COMPLETED) {
        console.log(`[createFromYouTube] Returning existing COMPLETED song: ${existingSong.id}`);
        return existingSong;
      }
      
      if (existingSong.processingStatus === ProcessingStatus.PROCESSING || 
          existingSong.processingStatus === ProcessingStatus.PENDING) {
        console.log(`[createFromYouTube] Returning existing ${existingSong.processingStatus} song: ${existingSong.id}`);
        return existingSong;
      }
      
      // FAILED — reprocess the existing song
      console.log(`[createFromYouTube] Reprocessing FAILED song: ${existingSong.id}`);
      existingSong.processingStatus = ProcessingStatus.PENDING;
      existingSong.vocalsUrl = undefined;
      existingSong.instrumentalUrl = undefined;
      existingSong.duration = undefined;
      await songRepository.save(existingSong);
      
      // Clean up old lyrics
      await lyricsRepository.delete({ songId: existingSong.id });
      await quizRepository.delete({ songId: existingSong.id });
      
      await publishMessage(QUEUES.AUDIO_PROCESSING, {
        songId: existingSong.id,
        videoId: videoId,
        title: title,
        artist: artist,
        source: "youtube",
        tasks: ["download", "separate", "lyrics", "pitch"],
        callbackUrl: `${process.env.API_URL}/api/songs/${existingSong.id}/processing-callback`,
      });
      
      return existingSong;
    }

    console.log(`[createFromYouTube] Creating NEW song with id=${songId}`);
    
    const song = songRepository.create({
      id: songId,
      title,
      artist,
      videoId,
      processingStatus: ProcessingStatus.PENDING,
    });

    const savedSong = await songRepository.save(song);
    console.log(`[createFromYouTube] Saved new song, publishing to RabbitMQ...`);

    await publishMessage(QUEUES.AUDIO_PROCESSING, {
      songId: savedSong.id,
      videoId: videoId,
      title: title,
      artist: artist,
      source: "youtube",
      tasks: ["download", "separate", "lyrics", "pitch"],
      callbackUrl: `${process.env.API_URL}/api/songs/${savedSong.id}/processing-callback`,
    });

    return savedSong;
  }

  async getProcessingStatus(songId: string): Promise<{ status: ProcessingStatus; progress?: string } | null> {
    const song = await songRepository.findOne({ where: { id: songId } });
    if (!song) return null;
    return { status: song.processingStatus };
  }

  async deleteSong(songId: string): Promise<void> {
    await lyricsRepository.delete({ songId });
    await quizRepository.delete({ songId });
    await songRepository.delete({ id: songId });
  }

  async reprocessSong(songId: string): Promise<Song> {
    const song = await songRepository.findOne({ where: { id: songId } });
    if (!song) {
      throw new Error("Song not found");
    }

    await lyricsRepository.delete({ songId });
    await quizRepository.delete({ songId });

    song.processingStatus = ProcessingStatus.PENDING;
    song.vocalsUrl = undefined;
    song.instrumentalUrl = undefined;
    song.duration = undefined;
    await songRepository.save(song);

    await publishMessage(QUEUES.AUDIO_PROCESSING, {
      songId: song.id,
      videoId: song.videoId,
      title: song.title,
      artist: song.artist,
      source: "youtube",
      tasks: ["download", "separate", "lyrics", "pitch"],
      callbackUrl: `${process.env.API_URL}/api/songs/${song.id}/processing-callback`,
    });

    return song;
  }
}

export const songService = new SongService();
