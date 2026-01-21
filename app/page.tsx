import HeroSection from "@/components/HeroSection";
import TeamMarquee from "@/components/TeamMarquee";
import SpecsTable from "@/components/SpecsTable";
import HighlightCTA from "@/components/HighlightCTA";
import FAQ from "@/components/FAQ";
import Footer from "@/components/Footer";
import Header from "@/components/Header";

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-white selection:bg-[#C0C0C0] selection:text-black">
      <Header />
      <HeroSection />
      <TeamMarquee />
      <SpecsTable />
      <HighlightCTA />
      <FAQ />
      <Footer />
    </main>
  );
}
// Auto-deploy test: Tue Jan 20 23:51:02 KST 2026
// Build: 1768920767
// v1768920823
