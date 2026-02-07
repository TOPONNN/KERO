import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { uploadFile } from "../config/s3";

interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
}

interface DownloadResult {
  localPath: string;
  s3Url: string;
  duration: number;
}

export class YouTubeService {
  private readonly tempDir = "/tmp/kero-youtube";
  private readonly cookiesPath = "/app/cookies/youtube.txt";

  private getSearchArgs(): string[] {
    // Search operations should NOT use cookies to avoid polluting search history
    return ["--no-mark-watched"];
  }

  private async getCookiesArgs(): Promise<string[]> {
    try {
      await fs.access(this.cookiesPath);
      return ["--cookies", this.cookiesPath, "--no-mark-watched"];
    } catch {
      return ["--no-mark-watched"];
    }
  }

  private withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
    process?: ChildProcess
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        if (process) {
          process.kill();
        }
        reject(new Error(message));
      }, ms);
      promise.finally(() => clearTimeout(timer));
    });
    return Promise.race([promise, timeout]);
  }

  constructor() {
    fs.mkdir(this.tempDir, { recursive: true }).catch(() => {});
  }

  async searchVideos(query: string, maxResults: number = 10): Promise<YouTubeSearchResult[]> {
    const searchArgs = this.getSearchArgs();
    const promise = new Promise<YouTubeSearchResult[]>((resolve, reject) => {
      const args = [
        ...searchArgs,
        `ytsearch${maxResults}:${query}`,
        "--dump-json",
        "--flat-playlist",
        "--no-warnings",
      ];

      const process = spawn("yt-dlp", args);
      let output = "";
      let error = "";

      process.stdout.on("data", (data) => { output += data.toString(); });
      process.stderr.on("data", (data) => { error += data.toString(); });

      process.on("close", (code) => {
        if (code !== 0) {
          console.error("yt-dlp search error:", error);
          resolve([]);
          return;
        }

        try {
          const results: YouTubeSearchResult[] = output
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const data = JSON.parse(line);
              return {
                videoId: data.id,
                title: data.title,
                channel: data.channel || data.uploader || "",
                duration: this.formatDuration(data.duration),
                thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
              };
            });
          resolve(results);
        } catch (e) {
          console.error("Parse error:", e);
          resolve([]);
        }
      });
    });

    return this.withTimeout(promise, 30000, "YouTube search timed out after 30 seconds");
  }

   async downloadAudio(videoId: string, songId: string): Promise<DownloadResult> {
     const outputPath = path.join(this.tempDir, `${songId}.flac`);
    const cookiesArgs = await this.getCookiesArgs();

    const downloadPromise = new Promise<void>((resolve, reject) => {
       const args = [
         ...cookiesArgs,
         `https://www.youtube.com/watch?v=${videoId}`,
         "-x",
         "--audio-format", "flac",
        "-o", outputPath,
        "--no-playlist",
        "--no-warnings",
      ];

      const process = spawn("yt-dlp", args);
      let error = "";

      process.stderr.on("data", (data) => { error += data.toString(); });

      process.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`yt-dlp download failed: ${error}`));
        } else {
          resolve();
        }
      });
    });

    await this.withTimeout(downloadPromise, 300000, "YouTube download timed out after 300 seconds");

    const stats = await fs.stat(outputPath);
    const duration = await this.getAudioDuration(outputPath);

     const fileBuffer = await fs.readFile(outputPath);
     const s3Key = `songs/${songId}/original.flac`;
     const s3Url = await uploadFile(s3Key, fileBuffer, "audio/flac");

    await fs.unlink(outputPath).catch(() => {});

    return {
      localPath: outputPath,
      s3Url,
      duration,
    };
  }

  async searchMV4K(query: string): Promise<YouTubeSearchResult | null> {
    const searchArgs = this.getSearchArgs();
    const promise = new Promise<YouTubeSearchResult | null>((resolve) => {
      const args = [
        ...searchArgs,
        `ytsearch5:${query}`,
        "--dump-json",
        "--no-warnings",
        "--match-filter", "upload_date >= 20220101",
      ];

      const proc = spawn("yt-dlp", args);
      let output = "";
      let error = "";

      proc.stdout.on("data", (data: Buffer) => { output += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => { error += data.toString(); });

      proc.on("close", (code) => {
        try {
          const lines = output.trim().split("\n").filter(Boolean);
          for (const line of lines) {
            const data = JSON.parse(line);
            if (data.id) {
              resolve({
                videoId: data.id,
                title: data.title || "",
                channel: data.channel || data.uploader || "",
                duration: this.formatDuration(data.duration),
                thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${data.id}/hqdefault.jpg`,
              });
              return;
            }
          }
          resolve(null);
        } catch {
          resolve(null);
        }
      });
    });

    return this.withTimeout(promise, 30000, "YouTube MV search timed out").catch(() => null);
  }

  async getVideoInfo(videoId: string): Promise<{ title: string; artist: string; duration: number } | null> {
    const cookiesArgs = await this.getCookiesArgs();
    const promise = new Promise<{ title: string; artist: string; duration: number } | null>((resolve) => {
      const args = [
        ...cookiesArgs,
        `https://www.youtube.com/watch?v=${videoId}`,
        "--dump-json",
        "--no-warnings",
      ];

      const process = spawn("yt-dlp", args);
      let output = "";

      process.stdout.on("data", (data) => { output += data.toString(); });

      process.on("close", (code) => {
        if (code !== 0) {
          resolve(null);
          return;
        }

        try {
          const data = JSON.parse(output);
          const titleParts = this.parseTitle(data.title);
          resolve({
            title: titleParts.title,
            artist: titleParts.artist || data.channel || data.uploader || "Unknown",
            duration: data.duration || 0,
          });
        } catch {
          resolve(null);
        }
      });
    });

    return this.withTimeout(promise, 30000, "YouTube video info fetch timed out after 30 seconds").catch(() => null);
  }

  private parseTitle(title: string): { title: string; artist: string } {
    const patterns = [
      /^(.+?)\s*[-–—]\s*(.+)$/,
      /^(.+?)\s*[|｜]\s*(.+)$/,
      /^【(.+?)】\s*(.+)$/,
      /^\[(.+?)\]\s*(.+)$/,
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        return { artist: match[1].trim(), title: match[2].trim() };
      }
    }

    return { title: title.trim(), artist: "" };
  }

  private async getAudioDuration(filePath: string): Promise<number> {
    const promise = new Promise<number>((resolve) => {
      const process = spawn("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        filePath,
      ]);

      let output = "";
      process.stdout.on("data", (data) => { output += data.toString(); });

      process.on("close", () => {
        const duration = parseFloat(output.trim());
        resolve(isNaN(duration) ? 0 : Math.round(duration));
      });
    });

    return this.withTimeout(promise, 30000, "Audio duration probe timed out after 30 seconds").catch(() => 0);
  }

  async getAudioStreamUrl(videoId: string): Promise<string | null> {
    const cookiesArgs = await this.getCookiesArgs();
    const promise = new Promise<string | null>((resolve) => {
      const args = [
        ...cookiesArgs,
        `https://www.youtube.com/watch?v=${videoId}`,
        "-f", "bestaudio",
        "-g",
        "--no-playlist",
        "--no-warnings",
      ];

      const proc = spawn("yt-dlp", args);
      let output = "";
      let error = "";

      proc.stdout.on("data", (data: Buffer) => { output += data.toString(); });
      proc.stderr.on("data", (data: Buffer) => { error += data.toString(); });

      proc.on("close", (code) => {
        if (code !== 0 || !output.trim()) {
          console.error("[yt-dlp] audio URL extraction failed:", error);
          resolve(null);
          return;
        }
        resolve(output.trim().split("\n")[0]);
      });
    });

    return this.withTimeout(promise, 15000, "yt-dlp audio URL extraction timed out").catch(() => null);
  }

  private formatDuration(seconds: number | null): string {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }
}

export const youtubeService = new YouTubeService();
