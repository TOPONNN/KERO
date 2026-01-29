import axios from "axios";
import { redis } from "../config/redis";

interface TJSong {
  number: string;
  title: string;
  artist: string;
  composer?: string;
  lyricist?: string;
  release?: string;
  country?: string;
}

interface SearchResult {
  songs: TJSong[];
  total: number;
  page: number;
  hasMore: boolean;
}

type Brand = "tj" | "kumyoung" | "dam" | "joysound";
type Country = "KOR" | "JPN" | "ENG" | "ALL";
type ChartPeriod = "daily" | "weekly" | "monthly";

const KOREAN_PATTERN = /[가-힣]/;
const JAPANESE_KANA_PATTERN = /[\u3040-\u309F\u30A0-\u30FF]/;
const CJK_KANJI_PATTERN = /[\u4E00-\u9FFF]/;

const POPULAR_ENG_ARTISTS = [
  "Taylor Swift", "Ed Sheeran", "Bruno Mars", "Adele", "Maroon 5",
  "Billie Eilish", "The Weeknd", "Dua Lipa", "Harry Styles", "Ariana Grande",
  "Justin Bieber", "Beyonce", "Lady Gaga", "Coldplay", "Imagine Dragons",
  "Queen", "Michael Jackson", "Whitney Houston", "Celine Dion", "ABBA",
  "Backstreet Boys", "Westlife", "Oasis", "John Legend", "Sam Smith",
  "Olivia Rodrigo", "Sia", "Charlie Puth", "Shawn Mendes", "Post Malone",
];

const CACHE_TTL: Record<ChartPeriod, number> = {
  daily: 3600,      // 1 hour
  weekly: 21600,    // 6 hours
  monthly: 86400,   // 24 hours
};

export class TJKaraokeService {
  private readonly baseUrl = "https://api.manana.kr/karaoke";

  private detectCountry(song: TJSong): Country {
    const text = `${song.title} ${song.artist}`;
    if (KOREAN_PATTERN.test(text)) return "KOR";
    if (JAPANESE_KANA_PATTERN.test(text)) return "JPN";
    if (CJK_KANJI_PATTERN.test(text)) return "JPN";
    return "ENG";
  }

  private filterByCountry(songs: TJSong[], country: Country): TJSong[] {
    if (country === "ALL") return songs;
    return songs.filter(song => this.detectCountry(song) === country);
  }

  private async getCachedOrFetch(cacheKey: string, ttlSeconds: number, fetchFn: () => Promise<TJSong[]>): Promise<TJSong[]> {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { }

    const result = await fetchFn();
    try {
      await redis.setex(cacheKey, ttlSeconds, JSON.stringify(result));
    } catch { }
    return result;
  }

  private async fetchBrandPopular(brand: Brand, period: ChartPeriod): Promise<TJSong[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/popular/${brand}/${period}.json`);
      return this.parseResponse(response.data);
    } catch (error) {
      console.error(`${brand} popular fetch error:`, error);
      return [];
    }
  }

  private async fetchArtistSongs(artist: string): Promise<TJSong[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/singer/${encodeURIComponent(artist)}/tj.json`);
      return this.parseResponse(response.data);
    } catch (error) {
      console.error(`Artist search error (${artist}):`, error);
      return [];
    }
  }

  private async fetchKorChart(period: ChartPeriod): Promise<TJSong[]> {
    const tjSongs = await this.fetchBrandPopular("tj", period);
    const korSongs = this.filterByCountry(tjSongs, "KOR");

    if (korSongs.length >= 100) {
      return korSongs.slice(0, 100);
    }

    const kySongs = await this.fetchBrandPopular("kumyoung", period);
    const kyKorSongs = this.filterByCountry(kySongs, "KOR");

    const seenNumbers = new Set(korSongs.map(s => s.number));
    for (const song of kyKorSongs) {
      if (!seenNumbers.has(song.number)) {
        korSongs.push(song);
        seenNumbers.add(song.number);
      }
      if (korSongs.length >= 100) break;
    }

    return korSongs.slice(0, 100);
  }

  private async fetchJpnChart(period: ChartPeriod): Promise<TJSong[]> {
    const songs = await this.fetchBrandPopular("joysound", period);
    return songs.slice(0, 100);
  }

  private async fetchEngChart(period: ChartPeriod): Promise<TJSong[]> {
    const brands: Brand[] = ["tj", "kumyoung", "joysound", "dam"];
    const brandResults = await Promise.all(
      brands.map(brand => this.fetchBrandPopular(brand, period))
    );

    const seenNumbers = new Set<string>();
    const engSongs: TJSong[] = [];

    for (const songs of brandResults) {
      for (const song of songs) {
        if (this.detectCountry(song) === "ENG" && !seenNumbers.has(song.number)) {
          engSongs.push(song);
          seenNumbers.add(song.number);
        }
      }
    }

    if (engSongs.length >= 100) {
      return engSongs.slice(0, 100);
    }

    const batchSize = 10;
    for (let i = 0; i < POPULAR_ENG_ARTISTS.length; i += batchSize) {
      const batch = POPULAR_ENG_ARTISTS.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(artist => this.fetchArtistSongs(artist))
      );

      for (const artistSongs of batchResults) {
        for (const song of artistSongs) {
          if (!seenNumbers.has(song.number)) {
            engSongs.push(song);
            seenNumbers.add(song.number);
          }
        }
      }

      if (engSongs.length >= 100) break;
    }

    return engSongs.slice(0, 100);
  }

  private async fetchAllChart(period: ChartPeriod): Promise<TJSong[]> {
    const songs = await this.fetchBrandPopular("tj", period);
    return songs.slice(0, 100);
  }

  async getChartByCountry(country: Country, period: ChartPeriod = "monthly"): Promise<TJSong[]> {
    const cacheKey = `chart:${country}:${period}`;
    const ttl = CACHE_TTL[period];

    return this.getCachedOrFetch(cacheKey, ttl, async () => {
      switch (country) {
        case "KOR": return this.fetchKorChart(period);
        case "JPN": return this.fetchJpnChart(period);
        case "ENG": return this.fetchEngChart(period);
        case "ALL": return this.fetchAllChart(period);
        default: return this.fetchAllChart(period);
      }
    });
  }

  async searchPopular(type: ChartPeriod = "monthly", country: Country = "ALL", limit: number = 100): Promise<TJSong[]> {
    const songs = await this.getChartByCountry(country, type);
    return songs.slice(0, limit);
  }

  async searchByTitle(title: string, page: number = 1): Promise<SearchResult> {
    try {
      const searchTerm = title.trim();
      const response = await axios.get(`${this.baseUrl}/song/${encodeURIComponent(searchTerm)}/tj.json`);
      const songs = this.parseResponse(response.data);

      const pageSize = 20;
      const start = (page - 1) * pageSize;
      const paginatedSongs = songs.slice(start, start + pageSize);

      return {
        songs: paginatedSongs,
        total: songs.length,
        page,
        hasMore: start + pageSize < songs.length,
      };
    } catch (error) {
      console.error("TJ title search error:", error);
      return { songs: [], total: 0, page, hasMore: false };
    }
  }

  async searchByArtist(artist: string, page: number = 1): Promise<SearchResult> {
    try {
      const searchTerm = artist.trim();
      const response = await axios.get(`${this.baseUrl}/singer/${encodeURIComponent(searchTerm)}/tj.json`);
      const songs = this.parseResponse(response.data);

      const pageSize = 20;
      const start = (page - 1) * pageSize;
      const paginatedSongs = songs.slice(start, start + pageSize);

      return {
        songs: paginatedSongs,
        total: songs.length,
        page,
        hasMore: start + pageSize < songs.length,
      };
    } catch (error) {
      console.error("TJ artist search error:", error);
      return { songs: [], total: 0, page, hasMore: false };
    }
  }

  async searchByNumber(number: string): Promise<TJSong | null> {
    try {
      const response = await axios.get(`${this.baseUrl}/no/${number}/tj.json`);
      const songs = this.parseResponse(response.data);
      return songs.length > 0 ? songs[0] : null;
    } catch (error) {
      console.error("TJ number search error:", error);
      return null;
    }
  }

  async getNewReleases(country: Country = "ALL", limit: number = 100): Promise<TJSong[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/tj.json`);
      const songs = this.parseResponse(response.data);
      const filtered = this.filterByCountry(songs, country);
      return filtered.slice(0, limit);
    } catch (error) {
      console.error("TJ new releases error:", error);
      return [];
    }
  }

  private parseResponse(data: unknown): TJSong[] {
    if (!Array.isArray(data)) return [];

    return data.map((item: Record<string, unknown>) => ({
      number: String(item.no || ""),
      title: String(item.title || ""),
      artist: Array.isArray(item.singer) ? item.singer.join(", ") : String(item.singer || ""),
      composer: Array.isArray(item.composer) ? item.composer.join(", ") : String(item.composer || ""),
      lyricist: Array.isArray(item.lyricist) ? item.lyricist.join(", ") : String(item.lyricist || ""),
    })).filter(song => song.number && song.title);
  }
}

export const tjKaraokeService = new TJKaraokeService();
