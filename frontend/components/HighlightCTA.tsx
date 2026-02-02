"use client";

import Link from "next/link";
import SectionWrapper from "@/components/animations/SectionWrapper";
import { BlurIn } from "@/components/animations/RevealAnimation";
import RevealAnimation from "@/components/animations/RevealAnimation";

export default function HighlightCTA() {
  return (
    <SectionWrapper
      id="cta"
      className="flex flex-col md:flex-row min-h-screen md:h-screen w-full bg-black/60 backdrop-blur-md"
    >
      <div className="flex flex-1 flex-col justify-center p-6 sm:p-12 md:p-24">
        <BlurIn>
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-bold leading-tight text-white">
            THE <span className="text-[#C0C0C0]">REAL-TIME</span>
            <br /> KARAOKE
          </h2>
        </BlurIn>
        <RevealAnimation delay={0.3}>
          <p className="mt-8 max-w-lg text-base sm:text-lg text-gray-400 leading-relaxed">
            친구들과 함께 실시간으로 노래하고,
            <br />녹음하고, 공유하세요.
            <br /><br />
            지연 없는 WebRTC 기술로
            <br />마치 같은 공간에 있는 듯한 경험을 제공합니다.
          </p>
        </RevealAnimation>
        <RevealAnimation delay={0.5} className="mt-6 sm:mt-8 md:mt-12 w-fit">
          <Link href="/mode/normal">
            <button className="rounded-full bg-white px-6 py-3 sm:px-8 sm:py-4 text-black font-bold transition-transform hover:scale-105">
              지금 참여하기
            </button>
          </Link>
        </RevealAnimation>
      </div>
      <div className="relative h-[40vh] md:flex-1 md:h-auto bg-black/40 overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="none"
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        >
          <source src="/hero-video.webm" type="video/webm" />
          <source src="/hero-video.mp4" type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-l from-transparent to-[#0A0A0A]" />
      </div>
    </SectionWrapper>
  );
}
