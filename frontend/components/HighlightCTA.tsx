import Link from "next/link";

export default function HighlightCTA() {
  return (
    <section className="flex flex-col md:flex-row h-screen w-full bg-[#0A0A0A]">
      <div className="flex flex-1 flex-col justify-center p-12 md:p-24">
        <h2 className="text-5xl font-bold leading-tight text-white md:text-7xl">
          THE <span className="text-[#C0C0C0]">REAL-TIME</span>
          <br /> KARAOKE
        </h2>
        <p className="mt-8 max-w-lg text-lg text-gray-400 leading-relaxed">
          친구들과 함께 실시간으로 노래하고,
          <br />녹음하고, 공유하세요.
          <br /><br />
          지연 없는 WebRTC 기술로
          <br />마치 같은 공간에 있는 듯한 경험을 제공합니다.
        </p>
        <Link href="/mode/normal" className="mt-12 w-fit">
          <button className="rounded-full bg-white px-8 py-4 text-black font-bold transition-transform hover:scale-105">
            지금 참여하기
          </button>
        </Link>
      </div>
      <div className="relative flex-1 bg-black overflow-hidden">
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
    </section>
  );
}
