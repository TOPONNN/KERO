"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Search, Music, Loader2, Play, TrendingUp, Sparkles, 
  Globe, Hash, Mic2, ChevronRight
} from "lucide-react";

interface TJSong {
  number: string;
  title: string;
  artist: string;
  country?: string;
  composer?: string;
  lyricist?: string;
}

interface KaraokeSongSearchProps {
  onSelect: (song: TJSong) => void;
  isLoading?: boolean;
  accentColor?: string;
}

type Tab = "chart" | "new" | "search";
type Country = "ALL" | "KOR" | "JPN" | "ENG";
type ChartPeriod = "daily" | "weekly" | "monthly";
type SearchType = "title" | "artist" | "number";

const COUNTRY_CONFIG: Record<Country, { label: string; flag: string }> = {
  ALL: { label: "전체", flag: "🌏" },
  KOR: { label: "한국", flag: "🇰🇷" },
  JPN: { label: "일본", flag: "🇯🇵" },
  ENG: { label: "팝송", flag: "🇺🇸" },
};

const PERIOD_CONFIG: Record<ChartPeriod, string> = {
  daily: "일간",
  weekly: "주간",
  monthly: "월간",
};

export default function KaraokeSongSearch({ 
  onSelect, 
  isLoading = false,
  accentColor = "#C0C0C0"
}: KaraokeSongSearchProps) {
  const [activeTab, setActiveTab] = useState<Tab>("chart");
  const [country, setCountry] = useState<Country>("ALL");
  const [period, setPeriod] = useState<ChartPeriod>("monthly");
  const [searchType, setSearchType] = useState<SearchType>("title");
  const [searchQuery, setSearchQuery] = useState("");
  
  const [songs, setSongs] = useState<TJSong[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<string | null>(null);

  const fetchChartSongs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/search/tj/popular?period=${period}&country=${country}`
      );
      const data = await res.json();
      if (data.success) {
        setSongs(data.data.songs || []);
      }
    } catch (error) {
      console.error("Failed to fetch chart:", error);
    } finally {
      setLoading(false);
    }
  }, [period, country]);

  const fetchNewSongs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/search/tj/new?country=${country}`);
      const data = await res.json();
      if (data.success) {
        setSongs(data.data.songs || []);
      }
    } catch (error) {
      console.error("Failed to fetch new songs:", error);
    } finally {
      setLoading(false);
    }
  }, [country]);

  const searchSongs = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/search/tj?q=${encodeURIComponent(searchQuery)}&type=${searchType}`
      );
      const data = await res.json();
      if (data.success) {
        setSongs(data.data.songs || []);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, searchType]);

  useEffect(() => {
    if (activeTab === "chart") {
      fetchChartSongs();
    } else if (activeTab === "new") {
      fetchNewSongs();
    }
  }, [activeTab, fetchChartSongs, fetchNewSongs]);

  const handleSongSelect = (song: TJSong) => {
    setSelectedNumber(song.number);
    onSelect(song);
  };

  const handleNumberSearch = () => {
    if (searchType === "number" && searchQuery.trim()) {
      setLoading(true);
      fetch(`/api/search/tj?q=${searchQuery}&type=number`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data.songs.length > 0) {
            handleSongSelect(data.data.songs[0]);
          }
        })
        .finally(() => setLoading(false));
    } else {
      searchSongs();
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="flex gap-1 mb-4 bg-white/5 p-1 rounded-xl">
        <TabButton
          active={activeTab === "chart"}
          onClick={() => setActiveTab("chart")}
          icon={<TrendingUp className="w-4 h-4" />}
          label="인기차트"
          accentColor={accentColor}
        />
        <TabButton
          active={activeTab === "new"}
          onClick={() => setActiveTab("new")}
          icon={<Sparkles className="w-4 h-4" />}
          label="신곡"
          accentColor={accentColor}
        />
        <TabButton
          active={activeTab === "search"}
          onClick={() => setActiveTab("search")}
          icon={<Search className="w-4 h-4" />}
          label="검색"
          accentColor={accentColor}
        />
      </div>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-2 scrollbar-hide">
        {(Object.keys(COUNTRY_CONFIG) as Country[]).map((c) => (
          <button
            key={c}
            onClick={() => setCountry(c)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              country === c
                ? "bg-white/20 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            <span>{COUNTRY_CONFIG[c].flag}</span>
            <span>{COUNTRY_CONFIG[c].label}</span>
          </button>
        ))}
      </div>

      {activeTab === "chart" && (
        <div className="flex gap-2 mb-4">
          {(Object.keys(PERIOD_CONFIG) as ChartPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                period === p
                  ? "text-black"
                  : "bg-white/5 text-white/60 hover:bg-white/10"
              }`}
              style={period === p ? { backgroundColor: accentColor } : {}}
            >
              {PERIOD_CONFIG[p]}
            </button>
          ))}
        </div>
      )}

      {activeTab === "search" && (
        <div className="space-y-3 mb-4">
          <div className="flex gap-2">
            <SearchTypeButton
              active={searchType === "title"}
              onClick={() => setSearchType("title")}
              icon={<Music className="w-4 h-4" />}
              label="제목"
            />
            <SearchTypeButton
              active={searchType === "artist"}
              onClick={() => setSearchType("artist")}
              icon={<Mic2 className="w-4 h-4" />}
              label="가수"
            />
            <SearchTypeButton
              active={searchType === "number"}
              onClick={() => setSearchType("number")}
              icon={<Hash className="w-4 h-4" />}
              label="번호"
            />
          </div>
          
          <div className="relative">
            <input
              type={searchType === "number" ? "number" : "text"}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleNumberSearch()}
              placeholder={
                searchType === "number" 
                  ? "노래방 번호 입력 (예: 12345)" 
                  : searchType === "artist"
                  ? "가수명을 입력하세요"
                  : "노래 제목을 입력하세요"
              }
              className="w-full px-4 py-3 pr-12 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-white/40 transition-colors"
            />
            <button
              onClick={handleNumberSearch}
              disabled={loading || !searchQuery.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: accentColor, color: "black" }}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Search className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      )}

      <div className="relative min-h-[300px]">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-white/40" />
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar">
            <AnimatePresence mode="popLayout">
              {songs.length > 0 ? (
                songs.map((song, index) => (
                  <motion.button
                    key={`${song.number}-${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ delay: index * 0.02 }}
                    onClick={() => handleSongSelect(song)}
                    disabled={isLoading || selectedNumber === song.number}
                    className={`w-full p-3 rounded-xl text-left flex items-center gap-3 transition-all group ${
                      selectedNumber === song.number
                        ? "bg-white/20 border-2"
                        : "bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20"
                    }`}
                    style={selectedNumber === song.number ? { borderColor: accentColor } : {}}
                  >
                    {activeTab === "chart" && (
                      <div 
                        className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                          index < 3 ? "text-black" : "bg-white/10 text-white/60"
                        }`}
                        style={index < 3 ? { backgroundColor: accentColor } : {}}
                      >
                        {index + 1}
                      </div>
                    )}
                    
                    <div className="w-14 h-10 rounded-lg bg-gradient-to-br from-white/10 to-white/5 flex items-center justify-center">
                      <span className="text-xs font-mono text-white/60">{song.number}</span>
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white truncate">{song.title}</p>
                      <p className="text-sm text-white/50 truncate">{song.artist}</p>
                    </div>
                    
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      {selectedNumber === song.number && isLoading ? (
                        <Loader2 className="w-5 h-5 animate-spin" style={{ color: accentColor }} />
                      ) : (
                        <ChevronRight className="w-5 h-5 text-white/40" />
                      )}
                    </div>
                  </motion.button>
                ))
              ) : (
                <div className="text-center py-12 text-white/40">
                  {activeTab === "search" && !searchQuery 
                    ? "검색어를 입력하세요"
                    : "결과가 없습니다"}
                </div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({ 
  active, 
  onClick, 
  icon, 
  label, 
  accentColor 
}: { 
  active: boolean; 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string;
  accentColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-medium transition-all ${
        active ? "text-black" : "text-white/60 hover:text-white hover:bg-white/5"
      }`}
      style={active ? { backgroundColor: accentColor } : {}}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SearchTypeButton({ 
  active, 
  onClick, 
  icon, 
  label 
}: { 
  active: boolean; 
  onClick: () => void; 
  icon: React.ReactNode; 
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
        active 
          ? "bg-white/20 text-white" 
          : "bg-white/5 text-white/60 hover:bg-white/10"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
