import * as fs from "fs";
import * as path from "path";
import { redis } from "../config/redis";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Kuroshiro = require("kuroshiro").default || require("kuroshiro");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const KuromojiAnalyzer = require("kuroshiro-analyzer-kuromoji").default || require("kuroshiro-analyzer-kuromoji");

const KATAKANA_HANGUL: Record<string, string> = {
  "ア": "아", "イ": "이", "ウ": "우", "エ": "에", "オ": "오",
  "カ": "카", "キ": "키", "ク": "쿠", "ケ": "케", "コ": "코",
  "サ": "사", "シ": "시", "ス": "스", "セ": "세", "ソ": "소",
  "タ": "타", "チ": "치", "ツ": "츠", "テ": "테", "ト": "토",
  "ナ": "나", "ニ": "니", "ヌ": "누", "ネ": "네", "ノ": "노",
  "ハ": "하", "ヒ": "히", "フ": "후", "ヘ": "헤", "ホ": "호",
  "マ": "마", "ミ": "미", "ム": "무", "メ": "메", "モ": "모",
  "ヤ": "야", "ユ": "유", "ヨ": "요",
  "ラ": "라", "リ": "리", "ル": "루", "レ": "레", "ロ": "로",
  "ワ": "와", "ヲ": "오", "ン": "ㄴ",
  "ガ": "가", "ギ": "기", "グ": "구", "ゲ": "게", "ゴ": "고",
  "ザ": "자", "ジ": "지", "ズ": "즈", "ゼ": "제", "ゾ": "조",
  "ダ": "다", "ヂ": "지", "ヅ": "즈", "デ": "데", "ド": "도",
  "バ": "바", "ビ": "비", "ブ": "부", "ベ": "베", "ボ": "보",
  "パ": "파", "ピ": "피", "プ": "푸", "ペ": "페", "ポ": "포",
  "キャ": "캬", "キュ": "큐", "キョ": "쿄",
  "シャ": "샤", "シュ": "슈", "ショ": "쇼",
  "チャ": "차", "チュ": "추", "チョ": "초",
  "ニャ": "냐", "ニュ": "뉴", "ニョ": "뇨",
  "ヒャ": "햐", "ヒュ": "휴", "ヒョ": "효",
  "ミャ": "먀", "ミュ": "뮤", "ミョ": "묘",
  "リャ": "랴", "リュ": "류", "リョ": "료",
  "ギャ": "갸", "ギュ": "규", "ギョ": "교",
  "ジャ": "자", "ジュ": "주", "ジョ": "조",
  "ビャ": "뱌", "ビュ": "뷰", "ビョ": "뵤",
  "ピャ": "퍄", "ピュ": "퓨", "ピョ": "표",
  "ッ": "ㅅ",
  "ー": "",
  "ァ": "아", "ィ": "이", "ゥ": "우", "ェ": "에", "ォ": "오",
  "ヴ": "부",
  "ヴァ": "바", "ヴィ": "비", "ヴェ": "베", "ヴォ": "보",
  "ファ": "파", "フィ": "피", "フェ": "페", "フォ": "포",
  "ティ": "티", "ディ": "디",
  "トゥ": "투", "ドゥ": "두",
  "ウィ": "위", "ウェ": "웨", "ウォ": "워",
};

class JapaneseService {
  private artistAliases: Map<string, string> = new Map();
  private kuroshiro: typeof Kuroshiro | null = null;
  private initPromise: Promise<void> | null = null;
  private aliasesLoaded = false;

  private loadArtistAliases() {
    if (this.aliasesLoaded) return;
    try {
      const tsvPath = path.join(process.cwd(), "src/data/artist_aliases.tsv");
      const content = fs.readFileSync(tsvPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [ja, ko] = trimmed.split("\t");
        if (ja && ko) {
          this.artistAliases.set(ja.trim(), ko.trim());
        }
      }
      this.aliasesLoaded = true;
      console.log(`[JapaneseService] Loaded ${this.artistAliases.size} artist aliases`);
    } catch (e) {
      console.error("[JapaneseService] Failed to load artist aliases:", e instanceof Error ? e.message : e);
    }
  }

  private async initKuroshiro() {
    if (this.kuroshiro) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = (async () => {
      try {
        const instance = new Kuroshiro();
        await instance.init(new KuromojiAnalyzer());
        this.kuroshiro = instance;
        console.log("[JapaneseService] Kuroshiro initialized");
      } catch (e) {
        console.error("[JapaneseService] Kuroshiro init failed:", e instanceof Error ? e.message : e);
        this.initPromise = null;
      }
    })();
    await this.initPromise;
  }

  getKoreanArtistName(japaneseArtist: string): string | null {
    this.loadArtistAliases();
    return this.artistAliases.get(japaneseArtist) || null;
  }

  katakanaToHangul(katakana: string): string {
    let result = "";
    let i = 0;
    while (i < katakana.length) {
      if (i + 1 < katakana.length) {
        const twoChar = katakana.substring(i, i + 2);
        if (KATAKANA_HANGUL[twoChar] !== undefined) {
          result += KATAKANA_HANGUL[twoChar];
          i += 2;
          continue;
        }
      }
      const oneChar = katakana[i];
      if (KATAKANA_HANGUL[oneChar] !== undefined) {
        result += KATAKANA_HANGUL[oneChar];
      } else if (oneChar === " " || oneChar === "　") {
        result += " ";
      } else {
        result += oneChar;
      }
      i++;
    }
    return result;
  }

  async toKoreanPronunciation(japaneseText: string): Promise<string> {
    const cacheKey = `jpn:pron:${japaneseText}`;
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return cached;
    } catch (_) { /* ignore cache miss */ }

    await this.initKuroshiro();
    if (!this.kuroshiro) return japaneseText;

    try {
      const katakana = await this.kuroshiro.convert(japaneseText, { to: "katakana" });
      const hangul = this.katakanaToHangul(katakana);

      try {
        await redis.setex(cacheKey, 86400 * 7, hangul);
      } catch (_) { /* ignore cache error */ }

      return hangul;
    } catch (e) {
      console.error("[JapaneseService] Conversion error:", e instanceof Error ? e.message : e);
      return japaneseText;
    }
  }

  async convertLyricsLines(lines: Array<{ text: string; words?: Array<{ text: string }> }>): Promise<Array<{ text: string; pronunciation: string; words?: Array<{ text: string; pronunciation: string }> }>> {
    await this.initKuroshiro();
    return Promise.all(
      lines.map(async (line) => {
        const pronunciation = await this.toKoreanPronunciation(line.text);
        let words: Array<{ text: string; pronunciation: string }> | undefined;
        if (line.words && line.words.length > 0) {
          words = await Promise.all(
            line.words.map(async (w) => ({
              text: w.text,
              pronunciation: await this.toKoreanPronunciation(w.text),
            }))
          );
        }
        return { text: line.text, pronunciation, words };
      })
    );
  }

  isJapaneseText(text: string): boolean {
    const jpPattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;
    return jpPattern.test(text);
  }
}

export const japaneseService = new JapaneseService();
