import { AppDataSource } from "../config/database";
import { Song, LyricsLine, LyricsQuizQuestion, ProcessingStatus, QuizType } from "../entities";
import { uploadFile } from "../config/s3";
import { publishMessage, QUEUES } from "../config/rabbitmq";
import { v4 as uuidv4 } from "uuid";
import { youtubeService } from "./YouTubeService";
import { tjKaraokeService } from "./TJKaraokeService";
import { redis } from "../config/redis";
import axios from "axios";

const songRepository = AppDataSource.getRepository(Song);
const lyricsRepository = AppDataSource.getRepository(LyricsLine);
const quizRepository = AppDataSource.getRepository(LyricsQuizQuestion);

function getKoreanInitials(str: string): string {
  const INITIALS = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  return str.split('').map(ch => {
    const code = ch.charCodeAt(0) - 0xAC00;
    if (code < 0 || code > 11171) return ch;
    return INITIALS[Math.floor(code / 588)];
  }).join('');
}

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
    const song = await songRepository.findOne({ where: { id: songId } });
    const lyrics = await lyricsRepository.find({
      where: { songId },
      order: { lineOrder: "ASC" },
    });

    if (!lyrics.length) return;
    const questions: LyricsQuizQuestion[] = [];

    // LYRICS_FILL: Every 3rd line, blank a random word
    for (let i = 0; i < lyrics.length; i += 3) {
      const targetLine = lyrics[i];
      const words = targetLine.text.split(" ").filter((w: string) => w.length > 0);
      if (words.length < 3) continue;

      const blankIndex = Math.floor(Math.random() * words.length);
      const correctAnswer = words[blankIndex];
      const questionWords = [...words];
      questionWords[blankIndex] = "______";

      const wrongAnswers = this.generateWrongAnswers(correctAnswer, lyrics);
      questions.push(quizRepository.create({
        songId,
        type: QuizType.LYRICS_FILL,
        questionText: questionWords.join(" "),
        correctAnswer,
        wrongAnswers,
        startTime: targetLine.startTime,
        endTime: targetLine.endTime,
        timeLimit: 15,
        points: 1000,
      }));
    }

    // LYRICS_ORDER: Groups of 4 consecutive lines
    for (let i = 0; i + 3 < lyrics.length; i += 8) {
      const lines = lyrics.slice(i, i + 4);
      if (lines.length < 4) break;
      questions.push(quizRepository.create({
        songId,
        type: QuizType.LYRICS_ORDER,
        questionText: "다음 가사를 올바른 순서로 배열하세요",
        correctAnswer: JSON.stringify([0, 1, 2, 3]),
        wrongAnswers: lines.map((l: LyricsLine) => l.text),
        startTime: lines[0].startTime,
        endTime: lines[3].endTime,
        timeLimit: 25,
        points: 1000,
        metadata: { lineTexts: lines.map((l: LyricsLine) => l.text) },
      }));
    }

    // TRUE_FALSE: Random lines paired with correct or wrong song title
    if (song) {
      const otherSongs = await songRepository.find({
        where: { processingStatus: ProcessingStatus.COMPLETED },
        take: 20,
      });
      const otherTitles = otherSongs.filter((s: Song) => s.id !== songId).map((s: Song) => s.title);

      for (let i = 1; i < lyrics.length && i < 6; i += 2) {
        const line = lyrics[i];
        const isTrue = Math.random() > 0.5;
        if (!isTrue && otherTitles.length === 0) continue;
        const displayTitle = isTrue ? song.title : otherTitles[Math.floor(Math.random() * otherTitles.length)];

        questions.push(quizRepository.create({
          songId,
          type: QuizType.TRUE_FALSE,
          questionText: `이 가사는 '${displayTitle}'의 가사이다: "${line.text}"`,
          correctAnswer: String(isTrue),
          wrongAnswers: [],
          startTime: line.startTime,
          endTime: line.endTime,
          timeLimit: 12,
          points: 1000,
        }));
      }
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

  async generateMixedQuiz(songIds: string[], count: number = 10): Promise<LyricsQuizQuestion[]> {
    const songs: Song[] = [];
    for (const id of songIds) {
      const song = await songRepository.findOne({ where: { id }, relations: ["lyrics"] });
      if (song) songs.push(song);
    }
    if (songs.length === 0) return [];

    const allSongs = await songRepository.find({
      where: { processingStatus: ProcessingStatus.COMPLETED },
      take: 50,
    });

    const questions: LyricsQuizQuestion[] = [];
    const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const shuffle = <T>(arr: T[]): T[] => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };

     // TITLE_GUESS
     for (const song of shuffle(songs).slice(0, 4)) {
      const otherTitles = shuffle(allSongs.filter((s: Song) => s.id !== song.id).map((s: Song) => s.title)).slice(0, 3);
      if (otherTitles.length < 3) continue;
      const audioStart = song.duration ? Math.min(30, Math.floor(song.duration * 0.3)) : 30;
       questions.push(quizRepository.create({
         songId: song.id,
         type: QuizType.TITLE_GUESS,
         questionText: "이 노래의 제목은?",
         correctAnswer: song.title,
         wrongAnswers: otherTitles,
         startTime: audioStart,
         endTime: audioStart + 10,
         timeLimit: 20,
         points: 1000,
         metadata: { audioUrl: song.instrumentalUrl || song.originalUrl, audioStartTime: audioStart, audioEndTime: audioStart + 10 },
       }));
    }

     // ARTIST_GUESS
     for (const song of shuffle(songs).slice(0, 4)) {
      const otherArtists = shuffle(
        [...new Set(allSongs.filter((s: Song) => s.artist !== song.artist).map((s: Song) => s.artist))]
      ).slice(0, 3);
      if (otherArtists.length < 3) continue;
       questions.push(quizRepository.create({
         songId: song.id,
         type: QuizType.ARTIST_GUESS,
         questionText: `'${song.title}'을(를) 부른 가수는?`,
         correctAnswer: song.artist,
         wrongAnswers: otherArtists,
         startTime: 0,
         endTime: 0,
         timeLimit: 15,
         points: 1000,
         metadata: { audioUrl: song.instrumentalUrl || song.originalUrl },
       }));
    }

     // INITIAL_GUESS
     for (const song of shuffle(songs).slice(0, 3)) {
      const initials = getKoreanInitials(song.title);
      if (initials === song.title) continue;
      questions.push(quizRepository.create({
        songId: song.id,
        type: QuizType.INITIAL_GUESS,
        questionText: initials,
        correctAnswer: song.title,
        wrongAnswers: [],
        startTime: 0,
        endTime: 0,
        timeLimit: 20,
        points: 1000,
        metadata: { hint: `${song.title.length}글자` },
      }));
    }

     // LYRICS_FILL
     for (let q = 0; q < 4; q++) {
      const song = pickRandom(songs);
      const lyrics = song.lyrics || [];
      const validLines = lyrics.filter((l: LyricsLine) => l.text.split(" ").filter((w: string) => w.length > 0).length >= 3);
      if (validLines.length === 0) continue;
      const line = pickRandom(validLines);
      const words = line.text.split(" ").filter((w: string) => w.length > 0);
      const blankIdx = Math.floor(Math.random() * words.length);
      const correct = words[blankIdx];
      const qWords = [...words];
      qWords[blankIdx] = "______";
      questions.push(quizRepository.create({
        songId: song.id,
        type: QuizType.LYRICS_FILL,
        questionText: qWords.join(" "),
        correctAnswer: correct,
        wrongAnswers: this.generateWrongAnswers(correct, lyrics),
        startTime: line.startTime,
        endTime: line.endTime,
        timeLimit: 15,
        points: 1000,
      }));
    }

     // LYRICS_ORDER
     for (let lo = 0; lo < 2; lo++) {
       const orderSong = pickRandom(songs);
       const orderLyrics = orderSong.lyrics || [];
       if (orderLyrics.length >= 4) {
         const startIdx = Math.floor(Math.random() * Math.max(1, orderLyrics.length - 3));
         const lines = orderLyrics.slice(startIdx, startIdx + 4);
         if (lines.length === 4) {
           questions.push(quizRepository.create({
             songId: orderSong.id,
             type: QuizType.LYRICS_ORDER,
             questionText: "다음 가사를 올바른 순서로 배열하세요",
             correctAnswer: JSON.stringify([0, 1, 2, 3]),
             wrongAnswers: lines.map((l: LyricsLine) => l.text),
             startTime: lines[0].startTime,
             endTime: lines[3].endTime,
             timeLimit: 25,
             points: 1000,
             metadata: { lineTexts: lines.map((l: LyricsLine) => l.text) },
           }));
         }
       }
     }

     // TRUE_FALSE
     for (let tf = 0; tf < 2; tf++) {
       const tfSong = pickRandom(songs);
       const tfLyrics = tfSong.lyrics || [];
       if (tfLyrics.length > 0) {
         const line = pickRandom(tfLyrics);
         const isTrue = Math.random() > 0.5;
         const otherSongs = allSongs.filter((s: Song) => s.id !== tfSong.id);
         if (isTrue || otherSongs.length > 0) {
           const displayTitle = isTrue ? tfSong.title : pickRandom(otherSongs).title;
           questions.push(quizRepository.create({
             songId: tfSong.id,
             type: QuizType.TRUE_FALSE,
             questionText: `이 가사는 '${displayTitle}'의 가사이다: "${line.text}"`,
             correctAnswer: String(isTrue),
             wrongAnswers: [],
             startTime: line.startTime,
             endTime: line.endTime,
             timeLimit: 12,
             points: 1000,
           }));
         }
       }
     }

    return shuffle(questions).slice(0, count);
  }

  async warmupQuizCache(): Promise<void> {
    console.log("[QuizCache] Starting warmup...");
    try {
      // 1. Fetch and cache TJ chart
      const cacheKey = "tj:chart:monthly";
      let tjSongs: { number: string; title: string; artist: string }[] = [];
      
      const cached = await redis.get(cacheKey);
      if (cached) {
        tjSongs = JSON.parse(cached);
        console.log(`[QuizCache] TJ chart loaded from cache (${tjSongs.length} songs)`);
      } else {
        tjSongs = await tjKaraokeService.searchPopular("monthly", "KOR", 100);
        if (tjSongs.length > 0) {
          await redis.setex(cacheKey, 3600, JSON.stringify(tjSongs));
          console.log(`[QuizCache] TJ chart fetched and cached (${tjSongs.length} songs)`);
        }
      }

      if (tjSongs.length === 0) {
        console.warn("[QuizCache] No TJ songs available");
        return;
      }

      // 2. Pre-cache YouTube search results for all songs (batch of 5 at a time to avoid overload)
      const cleanTitle = (title: string): string => 
        title.replace(/\s*[\(（\[【].*?[\)）\]】]/g, '').replace(/[\(（\[【\)）\]】]/g, '').trim();

      let cachedCount = 0;
      let searchedCount = 0;

      for (let i = 0; i < tjSongs.length; i += 5) {
        const batch = tjSongs.slice(i, i + 5);
        await Promise.all(
          batch.map(async (song) => {
            const searchQuery = `${cleanTitle(song.artist)} ${cleanTitle(song.title)}`;
            const ytCacheKey = `yt:mv:${searchQuery}`;
            
            const existing = await redis.get(ytCacheKey);
            if (existing) {
              cachedCount++;
              return;
            }
            
            const videos = await youtubeService.searchVideos(searchQuery, 1).catch(() => []);
            if (videos.length > 0) {
              await redis.setex(ytCacheKey, 86400, JSON.stringify(videos));
            }
            searchedCount++;
          })
        );
      }
      
      console.log(`[QuizCache] Warmup complete: ${cachedCount} cached, ${searchedCount} searched`);
    } catch (e) {
      console.error("[QuizCache] Warmup error:", e);
    }
  }

  async warmupRandomMVPool(): Promise<void> {
    console.log("[MVPool] Starting warmup...");
    try {
      const cacheKey = "tj:chart:monthly";
      let tjSongs: { number: string; title: string; artist: string }[] = [];
      
      const cached = await redis.get(cacheKey);
      if (cached) {
        tjSongs = JSON.parse(cached);
      } else {
        tjSongs = await tjKaraokeService.searchPopular("monthly", "KOR", 100);
        if (tjSongs.length > 0) {
          await redis.setex(cacheKey, 3600, JSON.stringify(tjSongs));
        }
      }

      if (tjSongs.length === 0) {
        console.warn("[MVPool] No TJ songs available");
        return;
      }

      const pool: { videoId: string; title: string; artist: string }[] = [];

      for (let i = 0; i < tjSongs.length; i += 5) {
        const batch = tjSongs.slice(i, i + 5);
        await Promise.all(
          batch.map(async (song) => {
            try {
              const searchQuery = `${song.artist} ${song.title} 공식 MV 4K`;
              const ytCacheKey = `yt:mv:4k:2022:${song.artist}:${song.title}`;
              
              const existing = await redis.get(ytCacheKey);
              if (existing) {
                const data = JSON.parse(existing);
                pool.push({ videoId: data.videoId, title: song.title, artist: song.artist });
                return;
              }
              
              const video = await youtubeService.searchMV4K(searchQuery).catch(() => null);
              if (video) {
                const entry = { videoId: video.videoId, title: song.title, artist: song.artist };
                await redis.setex(ytCacheKey, 86400, JSON.stringify(entry));
                pool.push(entry);
              }
            } catch {}
          })
        );
      }

      if (pool.length > 0) {
        await redis.setex("random-mv:pool", 7200, JSON.stringify(pool));
        console.log(`[MVPool] Warmup complete: ${pool.length} MVs cached`);
      }
    } catch (e) {
      console.error("[MVPool] Warmup error:", e);
    }
  }

  private async fetchLyricsFromAPI(title: string, artist: string): Promise<string[]> {
    const cacheKey = `lyrics:${title}:${artist}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);

      const res = await axios.get("https://lyrics.lewdhutao.my.eu.org/v2/youtube/lyrics", {
        params: { title, artist },
        timeout: 8000,
      });

      const lyricsText = res.data?.data?.lyrics;
      if (!lyricsText || typeof lyricsText !== "string") return [];

      const lines = lyricsText
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0 && !l.startsWith("["));

      if (lines.length > 0) {
        await redis.setex(cacheKey, 86400, JSON.stringify(lines));
      }
      return lines;
    } catch (e) {
      console.error(`[lyrics-api] Failed for "${title}" - "${artist}":`, e instanceof Error ? e.message : e);
      return [];
    }
  }

  private generateWrongAnswersFromLines(correctAnswer: string, lines: string[]): string[] {
    const allWords = new Set<string>();
    for (const line of lines) {
      for (const word of line.split(/\s+/)) {
        if (word !== correctAnswer && word.length > 1) {
          allWords.add(word);
        }
      }
    }
    const candidates = Array.from(allWords).sort(() => Math.random() - 0.5).slice(0, 5);
    while (candidates.length < 5) {
      candidates.push(`보기${candidates.length + 1}`);
    }
    return candidates;
  }

  async generateTJEnhancedQuiz(count: number = 10, category: string = "KOR"): Promise<any[]> {
    const validCategories = ["KOR", "JPN", "ENG"];
    const cat = validCategories.includes(category) ? category : "KOR";

    let tjSongs: { number: string; title: string; artist: string }[] = [];
    try {
      const cacheKey = `tj:chart:monthly:${cat}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        tjSongs = JSON.parse(cached);
      } else {
        tjSongs = await tjKaraokeService.searchPopular("monthly", cat as "KOR" | "JPN" | "ENG", 100);
        if (tjSongs.length > 0) {
          await redis.setex(cacheKey, 3600, JSON.stringify(tjSongs));
        }
      }
    } catch (e) {
      console.error("Failed to fetch TJ chart:", e);
    }

    // 2. Generate TJ-based questions (no lyrics needed)
    const tjQuestions: any[] = [];
    const lyricsQuestions: any[] = [];
    const shuffle = <T>(arr: T[]): T[] => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const pickRandom = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

    // Strip parenthesized content from titles: "봄날 (Spring Day)" → "봄날"
    const cleanTitle = (title: string): string =>
      title.replace(/\s*[\(（\[【].*?[\)）\]】]/g, "").replace(/[\(（\[【\)）\]】]/g, "").trim();

    if (tjSongs.length >= 4) {
      const shuffledTJ = shuffle(tjSongs);

      const titleCount = Math.ceil(count * 0.25);
      for (let i = 0; i < Math.min(titleCount, shuffledTJ.length); i++) {
        const song = shuffledTJ[i];
        const otherTitles = shuffle(
          tjSongs.filter((s) => s.title !== song.title).map((s) => cleanTitle(s.title))
        ).slice(0, 5);
        if (otherTitles.length < 5) continue;
        tjQuestions.push({
          type: "title_guess",
          questionText: `이 노래의 제목은?`,
          correctAnswer: cleanTitle(song.title),
          wrongAnswers: otherTitles,
          timeLimit: 60,
          points: 1000,
          metadata: { source: "tj", tjNumber: song.number },
        });
      }

      const artistCount = Math.ceil(count * 0.20);
      for (let i = titleCount; i < Math.min(titleCount + artistCount, shuffledTJ.length); i++) {
        const song = shuffledTJ[i];
        const uniqueArtists = [...new Set(tjSongs.filter((s) => s.artist !== song.artist).map((s) => cleanTitle(s.artist)))];
        const otherArtists = shuffle(uniqueArtists).slice(0, 5);
        if (otherArtists.length < 5) continue;
        tjQuestions.push({
          type: "artist_guess",
          questionText: `'${cleanTitle(song.title)}'을(를) 부른 가수는?`,
          correctAnswer: cleanTitle(song.artist),
          wrongAnswers: otherArtists,
          timeLimit: 60,
          points: 1000,
          metadata: { source: "tj", tjNumber: song.number },
        });
      }

      const initialCount = Math.ceil(count * 0.15);
      const initialStart = titleCount + artistCount;
      for (let i = initialStart; i < Math.min(initialStart + initialCount, shuffledTJ.length); i++) {
        const song = shuffledTJ[i];
        const cleaned = cleanTitle(song.title);
        const initials = getKoreanInitials(cleaned);
        if (initials === cleaned) continue;
        tjQuestions.push({
          type: "initial_guess",
          questionText: initials,
          correctAnswer: cleaned,
          wrongAnswers: [],
          timeLimit: 90,
          points: 1000,
          metadata: { source: "tj", tjNumber: song.number, hint: `${cleanTitle(song.artist)}의 노래, ${cleaned.length}글자` },
        });
      }
    }

    const LYRICS_BATCH_SIZE = Math.min(15, tjSongs.length);
    const lyricsCandidates = shuffle(tjSongs).slice(0, LYRICS_BATCH_SIZE);

    interface SongWithLyrics {
      title: string;
      artist: string;
      tjNumber: string;
      lines: string[];
    }

    const songsWithLyrics: SongWithLyrics[] = [];

    const CONCURRENCY = 5;
    for (let batch = 0; batch < lyricsCandidates.length; batch += CONCURRENCY) {
      const batchSongs = lyricsCandidates.slice(batch, batch + CONCURRENCY);
      const results = await Promise.all(
        batchSongs.map(async (song) => {
          const lines = await this.fetchLyricsFromAPI(cleanTitle(song.title), cleanTitle(song.artist));
          return { song, lines };
        })
      );
      for (const { song, lines } of results) {
        if (lines.length >= 4) {
          songsWithLyrics.push({
            title: cleanTitle(song.title),
            artist: cleanTitle(song.artist),
            tjNumber: song.number,
            lines,
          });
        }
      }
    }

    console.log(`[quiz] Fetched lyrics for ${songsWithLyrics.length}/${LYRICS_BATCH_SIZE} songs (category: ${cat})`);

    if (songsWithLyrics.length > 0) {
      const lyricsFillCount = Math.ceil(count * 0.20);
      for (let q = 0; q < lyricsFillCount; q++) {
        const song = pickRandom(songsWithLyrics);
        const validLines = song.lines.filter((l) => l.split(/\s+/).filter((w) => w.length > 0).length >= 3);
        if (validLines.length === 0) continue;

        const line = pickRandom(validLines);
        const words = line.split(/\s+/).filter((w) => w.length > 0);
        const blankIdx = Math.floor(Math.random() * words.length);
        const correct = words[blankIdx];
        const qWords = [...words];
        qWords[blankIdx] = "______";

        lyricsQuestions.push({
          type: "lyrics_fill",
          questionText: qWords.join(" "),
          correctAnswer: correct,
          wrongAnswers: this.generateWrongAnswersFromLines(correct, song.lines),
          timeLimit: 15,
          points: 1000,
          metadata: { source: "lyrics-api", songTitle: song.title, songArtist: song.artist },
        });
      }

      const lyricsOrderCount = Math.ceil(count * 0.10);
      for (let lo = 0; lo < lyricsOrderCount; lo++) {
        const song = pickRandom(songsWithLyrics);
        if (song.lines.length < 4) continue;

        const startIdx = Math.floor(Math.random() * Math.max(1, song.lines.length - 3));
        const lines = song.lines.slice(startIdx, startIdx + 4);
        if (lines.length !== 4) continue;

        lyricsQuestions.push({
          type: "lyrics_order",
          questionText: "다음 가사를 올바른 순서로 배열하세요",
          correctAnswer: JSON.stringify([0, 1, 2, 3]),
          wrongAnswers: lines,
          timeLimit: 25,
          points: 1000,
          metadata: {
            lineTexts: lines,
            source: "lyrics-api",
            songTitle: song.title,
            songArtist: song.artist,
          },
        });
      }

      const trueFalseCount = Math.ceil(count * 0.10);
      for (let tf = 0; tf < trueFalseCount; tf++) {
        const song = pickRandom(songsWithLyrics);
        if (song.lines.length === 0) continue;

        const line = pickRandom(song.lines);
        const isTrue = Math.random() > 0.5;
        const otherSongs = songsWithLyrics.filter((s) => s.title !== song.title);
        if (!isTrue && otherSongs.length === 0) continue;

        const displayTitle = isTrue ? song.title : pickRandom(otherSongs).title;
        lyricsQuestions.push({
          type: "true_false",
          questionText: `이 가사는 '${displayTitle}'의 가사이다: "${line}"`,
          correctAnswer: String(isTrue),
          wrongAnswers: [],
          timeLimit: 12,
          points: 1000,
          metadata: { source: "lyrics-api", songTitle: song.title, songArtist: song.artist },
        });
      }
    }

    const audioQuestions = tjQuestions.filter((q) => q.type === "title_guess" || q.type === "artist_guess");
    if (audioQuestions.length > 0) {
      try {
        const searchResults = await Promise.all(
          audioQuestions.map(async (q) => {
            let searchQuery = "";
            if (q.type === "title_guess") {
              searchQuery = `${q.correctAnswer} ${q.metadata?.tjNumber || ""}`;
            } else {
              const titleMatch = q.questionText.match(/^'(.+?)'/);
              const title = titleMatch ? titleMatch[1] : q.correctAnswer;
              searchQuery = `${title} ${q.correctAnswer}`;
            }
            const ytCacheKey = `yt:mv:${searchQuery}`;
            const cached = await redis.get(ytCacheKey);
            if (cached) return JSON.parse(cached);
            const videos = await youtubeService.searchVideos(searchQuery, 1).catch(() => []);
            if (videos.length > 0) await redis.setex(ytCacheKey, 86400, JSON.stringify(videos));
            return videos;
          })
        );
        audioQuestions.forEach((q, idx) => {
          const videos = searchResults[idx];
          if (videos && videos.length > 0) {
            q.metadata = { ...q.metadata, youtubeVideoId: videos[0].videoId };
          }
        });
      } catch (e) {
        console.error("Failed to fetch YouTube videos for TJ quiz:", e);
      }
    }

    const allQuestions = shuffle([...tjQuestions, ...lyricsQuestions]);
    return allQuestions.slice(0, count);
  }

  async getSongPool(): Promise<Song[]> {
    return songRepository.find({
      where: { processingStatus: ProcessingStatus.COMPLETED },
      select: ["id", "title", "artist"],
    });
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
