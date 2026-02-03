"use client";

import React from "react";
import SectionWrapper from "@/components/animations/SectionWrapper";
import RevealAnimation from "@/components/animations/RevealAnimation";
import { ArrowDown } from "lucide-react";

const architectureLayers = [
  {
    id: "frontend",
    name: "Frontend Layer",
    role: "Client & Interaction",
    color: "bg-blue-400",
    shadow: "shadow-blue-500/20",
    techs: [
      { name: "Next.js 15", desc: "App Router + SSR" },
      { name: "React 19", desc: "UI Components" },
      { name: "WebRTC", desc: "P2P/SFU Media" },
      { name: "Socket.io", desc: "Real-time Events" },
      { name: "Tailwind CSS", desc: "Styling System" },
    ],
  },
  {
    id: "backend",
    name: "Backend Layer",
    role: "Server & Signaling",
    color: "bg-emerald-400",
    shadow: "shadow-emerald-500/20",
    techs: [
      { name: "Express.js", desc: "REST API Gateway" },
      { name: "LiveKit", desc: "Media Server" },
      { name: "Redis", desc: "Pub/Sub & Cache" },
      { name: "RabbitMQ", desc: "Task Queue" },
      { name: "MySQL", desc: "Persistent Data" },
    ],
  },
  {
    id: "ai",
    name: "AI Worker Layer",
    role: "GPU Processing",
    color: "bg-purple-400",
    shadow: "shadow-purple-500/20",
    techs: [
      { name: "Flask", desc: "Model Serving" },
      { name: "Celery", desc: "Task Management" },
      { name: "Demucs", desc: "Vocal Separation" },
      { name: "Whisper", desc: "Lyrics Alignment" },
      { name: "CREPE", desc: "Pitch Analysis" },
    ],
  },
];

const TechCard = ({ name, desc }: { name: string; desc: string }) => (
  <div className="group relative flex flex-col items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center backdrop-blur-sm transition-all duration-300 hover:border-white/20 hover:bg-white/10 hover:shadow-lg hover:shadow-white/5">
    <span className="text-sm font-semibold text-white md:text-base">{name}</span>
    <span className="text-[10px] text-white/40 md:text-xs">{desc}</span>
  </div>
);

const Connector = () => (
  <div className="flex justify-center py-4 md:py-8">
    <div className="relative flex h-8 w-8 items-center justify-center md:h-12 md:w-12">
      <div className="absolute inset-0 animate-pulse rounded-full bg-white/5 blur-md" />
      <ArrowDown className="relative h-5 w-5 text-white/30 md:h-6 md:w-6" />
    </div>
  </div>
);

const ArchitectureSection = () => {
  return (
    <SectionWrapper id="architecture" className="min-h-[120vh] py-16 sm:py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 md:mb-12">
          <RevealAnimation>
            <h2 className="font-display text-4xl text-center font-bold text-white md:text-7xl">
              Architecture
            </h2>
          </RevealAnimation>
          <RevealAnimation delay={0.2}>
            <p className="font-display mx-auto mt-4 max-w-3xl text-base text-center text-white/50">
              실시간 노래방 경험을 완성하는 3단계 기술 파이프라인.
              <br className="hidden md:block" />
              미디어 처리부터 AI 분석까지 끊김 없는 데이터 흐름을 설계했습니다.
            </p>
          </RevealAnimation>
        </div>

        {/* Architecture Diagram */}
        <div className="relative mx-auto flex max-w-5xl flex-col">
          {architectureLayers.map((layer, layerIndex) => (
            <React.Fragment key={layer.id}>
              {/* Layer Section */}
              <RevealAnimation delay={0.1 + layerIndex * 0.15}>
                <div className="relative rounded-3xl border border-white/5 bg-white/[0.02] p-6 backdrop-blur-sm transition-colors duration-500 hover:bg-white/[0.04] md:p-10">
                  {/* Layer Header */}
                  <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex items-center gap-3">
                      <div className={`h-3 w-3 rounded-full ${layer.color} ${layer.shadow} shadow-[0_0_10px]`} />
                      <span className="text-sm font-bold uppercase tracking-widest text-white/80">
                        {layer.name}
                      </span>
                    </div>
                    <div className="hidden h-px w-8 bg-white/10 sm:block" />
                    <span className="text-sm text-white/40">{layer.role}</span>
                  </div>

                  {/* Tech Grid */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 md:gap-4">
                    {layer.techs.map((tech) => (
                      <TechCard key={tech.name} name={tech.name} desc={tech.desc} />
                    ))}
                  </div>

                  {/* Decorative Background Glow */}
                  <div
                    className={`absolute -right-4 -top-4 -z-10 h-32 w-32 rounded-full ${layer.color} opacity-[0.03] blur-3xl`}
                  />
                </div>
              </RevealAnimation>

              {/* Connector (except after last item) */}
              {layerIndex < architectureLayers.length - 1 && (
                <RevealAnimation delay={0.2 + layerIndex * 0.15}>
                  <Connector />
                </RevealAnimation>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </SectionWrapper>
  );
};

export default ArchitectureSection;
