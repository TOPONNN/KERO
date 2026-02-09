"use client";

import React from "react";
import SectionWrapper from "@/components/animations/SectionWrapper";
import RevealAnimation from "@/components/animations/RevealAnimation";
import { Music, Target, Mic, FileText, MessageSquareText, Globe, Gamepad2 } from "lucide-react";

const FEATURES = [
  {
    icon: Music,
    title: "실시간 노래방",
    description: "WebRTC + LiveKit SFU로 지연 없는 실시간 스트리밍. 최대 6명이 함께 노래하고 화상으로 소통할 수 있습니다.",
    accent: "#C0C0C0",
  },
  {
    icon: Target,
    title: "AI 음정 분석",
    description: "FCPE 모델이 실시간으로 음정을 분석하고, 콤보·스트릭 기반 점수를 계산합니다. 퍼펙트 스코어에 도전하세요!",
    accent: "#FFD700",
  },
  {
    icon: Mic,
    title: "보컬 분리",
    description: "Mel-band Roformer가 원곡에서 보컬과 MR을 고품질로 분리합니다. 어떤 노래든 MR로 만들 수 있습니다.",
    accent: "#FF6B6B",
  },
  {
    icon: FileText,
    title: "가사 자동 싱크",
    description: "SOFA가 노래에서 가사를 음소 단위로 정확하게 싱크합니다. 실시간 색채움 효과로 노래를 따라가세요.",
    accent: "#74AA9C",
  },
  {
    icon: Gamepad2,
    title: "노래 퀴즈 6종",
    description: "가사 빈칸, 제목 맞추기, 가수 맞추기, 초성 퀴즈, 가사 순서, O/X 퀴즈. TJ 차트 연동, Kahoot 스타일 실시간 대결!",
    accent: "#A855F7",
  },
  {
    icon: Globe,
    title: "한국곡·일본곡·팝송",
    description: "TJ 노래방 차트 기반 3개국 카테고리 지원. 일본곡은 한국어 발음 가사와 아티스트 번역을 자동으로 제공합니다.",
    accent: "#F97316",
  },
];

const FeaturesSection = () => {
  return (
    <SectionWrapper
      id="features"
      className="md:h-[130vh] py-16 sm:py-24 md:py-32 px-6 md:px-20 relative z-10"
    >
      <div className="max-w-6xl mx-auto relative z-10 rounded-3xl p-8 md:p-12">
        {/* Header */}
        <RevealAnimation>
          <div className="mb-8 md:mb-12">
            <h2 className="font-display text-4xl text-center md:text-7xl font-bold text-white">
              Features
            </h2>
            <p className="font-display mx-auto mt-4 max-w-3xl font-normal text-base text-center text-white/50">
              KERO가 제공하는 핵심 기능들. 최신 AI 기술과 실시간 통신 기술이 만나 새로운 노래방 경험을 선사합니다.
            </p>
          </div>
        </RevealAnimation>

        {/* Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
          {FEATURES.map((feature, i) => (
            <RevealAnimation key={i} delay={i * 0.1}>
              <div 
                className="group relative h-full rounded-2xl border border-white/10 bg-[#020817]/80 backdrop-blur-sm p-6 md:p-8 transition-all duration-500 hover:border-white/20 hover:bg-[#020817]/90 hover:-translate-y-2 overflow-hidden"
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
