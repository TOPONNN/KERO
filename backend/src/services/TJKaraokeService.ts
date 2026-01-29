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

type Country = "KOR" | "JPN" | "ENG" | "ALL";
type ChartPeriod = "daily" | "weekly" | "monthly";

const CACHE_TTL: Record<ChartPeriod, number> = {
  daily: 3600,      // 1 hour
  weekly: 21600,    // 6 hours
  monthly: 86400,   // 24 hours
};

export class TJKaraokeService {
  private readonly tjMediaApiUrl = "https://www.tjmedia.com/legacy/api/topAndHot100";
  private readonly tjSearchUrl = "https://www.tjmedia.com/song/accompaniment_search";
  private readonly userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  // Map our Country type to TJ Media strType codes
  private readonly STRTYPE_MAP: Record<Country, string> = {
    ALL: "",    // 종합
    KOR: "1",   // 가요
    ENG: "2",   // POP
    JPN: "3",   // JPOP
  };

  private stripHtml(html: string): string {
    return html.replace(/<[^>]+>/g, "").trim();
  }

  private parseTJSearchHTML(html: string): TJSong[] {
    const songs: TJSong[] = [];

    // Split HTML by each song entry using the num2 marker.
    // The outer <ul class="grid-container list ico"> contains a nested <ul> for icons,
    // so a simple /<ul>...<\/ul>/ regex breaks on the inner </ul>. Splitting by num2 avoids this.
    const songSections = html.split(/<span\s+class="num2">/);

    for (let i = 1; i < songSections.length; i++) {
      const section = songSections[i];

      const numEndIdx = section.indexOf("</span>");
      const rawNum = numEndIdx >= 0 ? section.substring(0, numEndIdx) : "";
      const number = this.stripHtml(rawNum);

      // Title is in the <p> after the icon <ul>...</ul> block inside title3
      const titleMatch = section.match(/<\/ul>\s*<p[^>]*><span>([\s\S]*?)<\/span><\/p>/);
      const title = titleMatch ? this.stripHtml(titleMatch[1]) : "";

      const artistMatch = section.match(/<li\s+class="grid-item title4 singer"><p><span>([\s\S]*?)<\/span><\/p><\/li>/);
      const artist = artistMatch ? this.stripHtml(artistMatch[1]) : "";

      const composerMatch = section.match(/<li\s+class="grid-item title5"><p><span[^>]*>([\s\S]*?)<\/span><\/p><\/li>/);
      const composer = composerMatch ? this.stripHtml(composerMatch[1]) : "";

      const lyricistMatch = section.match(/<li\s+class="grid-item title6"><p><span[^>]*>([\s\S]*?)<\/span><\/p><\/li>/);
      const lyricist = lyricistMatch ? this.stripHtml(lyricistMatch[1]) : "";

      if (number && title) {
        songs.push({ number, title, artist, composer, lyricist });
      }
    }

    return songs;
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

  private async fetchTJChart(country: Country, period: ChartPeriod): Promise<TJSong[]> {
    try {
      const strType = this.STRTYPE_MAP[country];

      const response = await axios.post(
        this.tjMediaApiUrl,
        {
          chartType: "TOP",
          strType: strType,
          searchStartDate: "",
          searchEndDate: "",
        },
        {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": this.userAgent,
            "Referer": "https://www.tjmedia.com/chart/top100",
          },
        }
      );

      const data = response.data;
      if (data.resultCode !== "99" || !data.resultData?.items) {
        console.error("TJ Media API error:", data.resultCode, data.resultMsg);
        return [];
      }

      const songs = data.resultData.items.map((item: any) => ({
        number: String(item.pro),
        title: String(item.indexTitle || ""),
        artist: String(item.indexSong || ""),
        composer: String(item.com || ""),
        lyricist: "",
      })).filter((song: TJSong) => song.number && song.title);

      // Deduplicate by normalized title+artist (keep first/higher-ranked entry)
      const seen = new Set<string>();
      return songs.filter((song: TJSong) => {
        const key = (song.title + '|' + song.artist).replace(/\s/g, '').toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (error) {
      console.error("TJ Media chart fetch error:", error);
      return [];
    }
  }

  async getChartByCountry(country: Country, period: ChartPeriod = "monthly"): Promise<TJSong[]> {
    const cacheKey = `chart:${country}:${period}`;
    const ttl = CACHE_TTL[period];

    return this.getCachedOrFetch(cacheKey, ttl, async () => {
      return this.fetchTJChart(country, period);
    });
  }

  async searchPopular(type: ChartPeriod = "monthly", country: Country = "ALL", limit: number = 100): Promise<TJSong[]> {
    const songs = await this.getChartByCountry(country, type);
    return songs.slice(0, limit);
  }

  async searchByTitle(title: string, page: number = 1): Promise<SearchResult> {
    try {
      const searchTerm = title.trim().replace(/\s/g, "");
      const params = new URLSearchParams({
        nationType: "",
        strType: "1",
        searchTxt: searchTerm,
        pageNo: String(page),
        pageRowCnt: "20",
        strSotrGubun: "ASC",
        strSortType: "",
      });

      const response = await axios.get(
        `${this.tjSearchUrl}?${params.toString()}`,
        {
          headers: {
            "User-Agent": this.userAgent,
          },
        }
      );

      const songs = this.parseTJSearchHTML(response.data);
      return {
        songs,
        total: songs.length,
        page,
        hasMore: songs.length >= 20,
      };
    } catch (error) {
      console.error("TJ title search error:", error);
      return { songs: [], total: 0, page, hasMore: false };
    }
  }

  async searchByArtist(artist: string, page: number = 1): Promise<SearchResult> {
    try {
      const searchTerm = artist.trim().replace(/\s/g, "");
      const params = new URLSearchParams({
        nationType: "",
        strType: "2",
        searchTxt: searchTerm,
        pageNo: String(page),
        pageRowCnt: "20",
        strSotrGubun: "ASC",
        strSortType: "",
      });

      const response = await axios.get(
        `${this.tjSearchUrl}?${params.toString()}`,
        {
          headers: {
            "User-Agent": this.userAgent,
          },
        }
      );

      const songs = this.parseTJSearchHTML(response.data);
      return {
        songs,
        total: songs.length,
        page,
        hasMore: songs.length >= 20,
      };
    } catch (error) {
      console.error("TJ artist search error:", error);
      return { songs: [], total: 0, page, hasMore: false };
    }
  }

  async searchByNumber(number: string): Promise<TJSong | null> {
    try {
      const params = new URLSearchParams({
        nationType: "",
        strType: "16",
        searchTxt: number.trim(),
        pageNo: "1",
        pageRowCnt: "20",
        strSotrGubun: "ASC",
        strSortType: "",
      });

      const response = await axios.get(
        `${this.tjSearchUrl}?${params.toString()}`,
        {
          headers: {
            "User-Agent": this.userAgent,
          },
        }
      );

      const songs = this.parseTJSearchHTML(response.data);
      // Find exact match by number
      const exactMatch = songs.find(s => s.number === number.trim());
      return exactMatch || (songs.length > 0 ? songs[0] : null);
    } catch (error) {
      console.error("TJ number search error:", error);
      return null;
    }
  }

  async getNewReleases(country: Country = "ALL", limit: number = 100): Promise<TJSong[]> {
    // New song page is under maintenance, use chart as fallback
    return this.getChartByCountry(country, "monthly");
  }
}

export const tjKaraokeService = new TJKaraokeService();
