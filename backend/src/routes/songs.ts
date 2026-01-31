import { Router, Request, Response } from "express";
import multer from "multer";
import { songService } from "../services/SongService";
import { youtubeService } from "../services/YouTubeService";
import { ProcessingStatus } from "../entities";
import { redis } from "../config/redis";
import { v4 as uuidv4 } from "uuid";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/search/youtube", async (req: Request, res: Response) => {
  try {
    const query = req.query.query as string;
    if (!query) {
      return res.status(400).json({ success: false, message: "검색어가 필요합니다." });
    }

    const results = await youtubeService.searchVideos(query, 10);
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/search/tj", async (req: Request, res: Response) => {
  try {
    const query = req.query.query as string;
    if (!query) {
      return res.status(400).json({ success: false, message: "검색어가 필요합니다." });
    }

    const results = await youtubeService.searchVideos(`${query} official audio`, 10);
    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/upload", upload.single("audio"), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "파일이 없습니다." });
    }

    const { title, artist, uploadedBy } = req.body;
    const song = await songService.uploadSong(
      req.file.buffer,
      req.file.originalname,
      title,
      artist,
      uploadedBy
    );

    res.status(201).json({ success: true, data: song });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/youtube", async (req: Request, res: Response) => {
  try {
    const { videoId, title, artist } = req.body;
    if (!videoId) {
      return res.status(400).json({ success: false, message: "videoId가 필요합니다." });
    }

    const songId = uuidv4();
    const song = await songService.createFromYouTube(songId, videoId, title, artist);
    res.status(201).json({ success: true, data: song });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/:id/processing-callback", async (req: Request, res: Response) => {
  try {
    const secret = req.headers['x-processing-secret'];
    const expectedSecret = process.env.PROCESSING_SECRET || '***REDACTED_PROCESSING_SECRET***';
    if (secret !== expectedSecret) {
      return res.status(403).json({ success: false, message: "Unauthorized callback" });
    }

    const id = req.params.id as string;
    const { vocalsUrl, instrumentalUrl, lyrics, duration, status } = req.body;

    console.log(`[Callback] Song ${id}: duration=${duration}, lyrics=${lyrics?.length || 0} lines`);

    // words 필드 포함하여 매핑
    const mappedLyrics = lyrics?.map((line: any) => ({
      startTime: line.start_time ?? line.startTime,
      endTime: line.end_time ?? line.endTime,
      text: line.text,
        words: line.words?.map((w: any) => ({
          startTime: w.start_time ?? w.startTime,
          endTime: w.end_time ?? w.endTime,
          text: w.text,
          energy: w.energy,
          pitch: w.pitch,
          note: w.note,
          midi: w.midi,
          voiced: w.voiced,
          energyCurve: w.energy_curve ?? w.energyCurve,
        })),
    }));

    await songService.updateProcessingResult(id, {
      vocalsUrl,
      instrumentalUrl,
      lyrics: mappedLyrics,
      duration,
      status: status as ProcessingStatus,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error(`[Callback] Error for song ${req.params.id}:`, error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/quiz/generate", async (req: Request, res: Response) => {
  try {
    const count = parseInt(req.query.count as string) || 10;
    const questions = await songService.generateTJEnhancedQuiz(count);
    
    if (questions.length === 0) {
      return res.status(400).json({ success: false, message: "퀴즈에 사용할 수 있는 데이터가 없습니다." });
    }
    
    res.json({ success: true, data: { questions } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/random-mv", async (req: Request, res: Response) => {
  try {
    let tjSongs: { number: string; title: string; artist: string }[] = [];
    const cacheKey = "tj:chart:monthly";
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      tjSongs = JSON.parse(cached);
    } else {
      const { tjKaraokeService } = await import("../services/TJKaraokeService");
      tjSongs = await tjKaraokeService.searchPopular("monthly", "KOR", 100);
      if (tjSongs.length > 0) {
        await redis.setex(cacheKey, 3600, JSON.stringify(tjSongs));
      }
    }
    
    if (tjSongs.length === 0) {
      return res.json({ success: false, message: "No songs available" });
    }
    
    const randomSong = tjSongs[Math.floor(Math.random() * tjSongs.length)];
     const searchQuery = `${randomSong.artist} ${randomSong.title} 공식 MV 4K`;
    const results = await youtubeService.searchVideos(searchQuery, 1);
    
    if (results.length === 0) {
      return res.json({ success: false, message: "No YouTube result found" });
    }
    
    res.json({
      success: true,
      data: {
        videoId: results[0].videoId,
        title: randomSong.title,
        artist: randomSong.artist,
      }
    });
  } catch (error: any) {
    console.error("Random MV error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const songs = await songService.getAllSongs();
    res.json({ success: true, data: songs });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const song = await songService.getSongById(id);
    if (!song) {
      return res.status(404).json({ success: false, message: "곡을 찾을 수 없습니다." });
    }

    const needsRedisFallback = !song.lyrics || song.lyrics.length === 0 || !song.instrumentalUrl;
    if (needsRedisFallback) {
      const redisData = await redis.get(`song:processing:${id}`);
      if (redisData) {
        const parsed = JSON.parse(redisData);
        if (parsed.status === "completed" && parsed.results) {
          const results = parsed.results;
          if (results.separation) {
            song.vocalsUrl = song.vocalsUrl || results.separation.vocals_url;
            song.instrumentalUrl = song.instrumentalUrl || results.separation.instrumental_url;
          }
          if (results.lyrics?.lyrics && (!song.lyrics || song.lyrics.length === 0)) {
            song.lyrics = results.lyrics.lyrics.map((l: any, idx: number) => ({
              id: `redis-${idx}`,
              songId: id,
              startTime: l.start_time ?? l.startTime,
              endTime: l.end_time ?? l.endTime,
              text: l.text,
              lineOrder: idx,
                words: l.words?.map((w: any) => ({
                  startTime: w.start_time ?? w.startTime,
                  endTime: w.end_time ?? w.endTime,
                  text: w.text,
                  energy: w.energy,
                  pitch: w.pitch,
                  note: w.note,
                  midi: w.midi,
                  voiced: w.voiced,
                  energyCurve: w.energy_curve ?? w.energyCurve,
                })),
            }));
          }
          if (results.lyrics?.duration) {
            song.duration = song.duration || results.lyrics.duration;
          }
        }
      }
    }

    res.json({ success: true, data: song });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:id/quiz", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const data = await songService.getSongWithQuiz(id);
    if (!data) {
      return res.status(404).json({ success: false, message: "곡을 찾을 수 없습니다." });
    }
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:id/status", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    
    const redisStatus = await redis.get(`song:processing:${id}`);
    if (redisStatus) {
      const statusData = JSON.parse(redisStatus);
      return res.json({ success: true, data: statusData });
    }

    const song = await songService.getSongById(id);
    if (!song) {
      return res.status(404).json({ success: false, message: "곡을 찾을 수 없습니다." });
    }

    res.json({
      success: true,
      data: {
        song_id: id,
        status: song.processingStatus,
        message: song.processingStatus === ProcessingStatus.COMPLETED ? "처리 완료" : "처리 중...",
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/:id/pitch", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    
    const pitchData = await redis.get(`song:pitch:${id}`);
    if (pitchData) {
      return res.json({ success: true, data: JSON.parse(pitchData) });
    }

    res.json({ success: true, data: [] });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await songService.deleteSong(id);
    res.json({ success: true, message: "Song deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/:id/reprocess", async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const song = await songService.reprocessSong(id);
    res.json({ success: true, data: song });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
