"use client";

import React from "react";
import SectionWrapper from "@/components/animations/SectionWrapper";
import RevealAnimation from "@/components/animations/RevealAnimation";
import { Music, Target, Mic, FileText, MessageSquareText, Swords } from "lucide-react";

const FEATURES = [
  {
    icon: Music,
    title: "실시간 노래방",
    description: "WebRTC + LiveKit으로 지연 없는 실시간 스트리밍. 최대 8명이 함께 노래할 수 있습니다.",
    accent: "#C0C0C0", // Silver
  },
  {
    icon: Target,
    title: "AI 음정 분석",
    description: "CREPE 모델이 실시간으로 음정을 분석하고 점수를 계산합니다. 퍼펙트 스코어에 도전하세요!",
    accent: "#FFD700", // Gold
  },
  {
    icon: Mic,
    title: "보컬 분리",
    description: "Demucs AI가 원곡에서 보컬과 MR을 자동으로 분리합니다. 어떤 노래든 MR로 만들 수 있습니다.",
    accent: "#FF6B6B", // Red/Coral
  },
  {
    icon: FileText,
    title: "가사 자동 추출",
    description: "Whisper AI가 노래에서 가사를 자동으로 인식하고 타임스탬프와 함께 표시합니다.",
    accent: "#74AA9C", // Teal
  },
  {
    icon: MessageSquareText,
    title: "노래 퀴즈",
    description: "가사, 제목, 가수, 초성 등 6가지 유형의 퀴즈로 경쟁하세요. Kahoot 스타일 실시간 대결!",
    accent: "#A855F7", // Purple (Changed from duplicate #FF6B6B to enhance visual distinction as per Designer persona)
  },
  {
    icon: Swords,
    title: "배틀 모드",
    description: "같은 노래를 부르고 AI 점수로 승부합니다. 실력을 겨루는 실시간 노래 대결!",
    accent: "#FF4500", // Orange Red
  },
];

const FeaturesSection = () => {
  return (
    <SectionWrapper
      id="features"
      className="md:h-[130vh] py-16 sm:py-24 md:py-32 px-6 md:px-20 relative z-10"
    >
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <RevealAnimation>
          <div className="mb-8 md:mb-12">
            <h2 className="font-display text-4xl text-center md:text-7xl font-bold text-white">
              Features
            </h2>
            <p className="font-display mx-auto mt-4 max-w-3xl text-base text-center text-white/50">
              KERO가 제공하는 핵심 기능들. 최신 AI 기술과 실시간 통신 기술이 만나 새로운 노래방 경험을 선사합니다.
            </p>
          </div>
        </RevealAnimation>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {FEATURES.map((feature, i) => (
            <RevealAnimation key={i} delay={i * 0.1}>
              <div 
                className="group relative h-full rounded-2xl border border-white/10 bg-white/5 p-6 md:p-8 transition-all duration-500 hover:border-white/20 hover:bg-white/[0.08] hover:-translate-y-2 overflow-hidden"
              >
                {/* Glow Effect on Hover */}
                <div 
                  className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-500 blur-2xl"
                  style={{ backgroundColor: feature.accent }} 
                />

                <div className="relative z-10">
                  <div 
                    className="mb-6 flex h-14 w-14 items-center justify-center rounded-xl transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3" 
                    style={{ backgroundColor: `${feature.accent}20` }}
                  >
                    <feature.icon 
                      className="h-7 w-7" 
                      style={{ color: feature.accent }} 
                    />
                  </div>
                  
                  <h3 className="text-xl md:text-2xl font-bold text-white mb-3 group-hover:text-white/90 transition-colors">
                    {feature.title}
                  </h3>
                  
                  <p className="text-sm md:text-base text-white/50 leading-relaxed group-hover:text-white/70 transition-colors">
                    {feature.description}
                  </p>
                </div>
              </div>
            </RevealAnimation>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
};

export default FeaturesSection;
