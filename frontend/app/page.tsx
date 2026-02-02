"use client";

import HeroSection from "@/components/HeroSection";
import TeamMarquee from "@/components/TeamMarquee";
import SpecsTable from "@/components/SpecsTable";
import HighlightCTA from "@/components/HighlightCTA";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import AnimatedBackground from "@/components/3d/AnimatedBackground";
import SkillsSection from "@/components/3d/SkillsSection";
import SmoothScroll from "@/components/animations/SmoothScroll";
import Particles from "@/components/effects/Particles";
import ShootingStars from "@/components/effects/ShootingStars";

export default function Home() {
  return (
    <SmoothScroll>
      <div className="fixed inset-0 -z-10">
        <Particles className="absolute inset-0" quantity={100} />
        <ShootingStars />
      </div>
      <AnimatedBackground />
      <main className="relative z-10 min-h-screen text-white selection:bg-[#C0C0C0] selection:text-black">
        <Header />
        <section id="hero">
          <HeroSection />
        </section>
        <TeamMarquee />
        <SkillsSection />
        <SpecsTable />
        <HighlightCTA />
        <FAQ />
        <Footer />
      </main>
    </SmoothScroll>
  );
}
// Auto-deploy test: Tue Jan 20 23:51:02 KST 2026
// Build: 1768920767
// v1768920823
// trigger-1770052212
