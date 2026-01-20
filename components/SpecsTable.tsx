export default function SpecsTable() {
  const specs = [
    { component: "실시간 통신", tech: "WebRTC", desc: "P2P 기반 초저지연 오디오/비디오 스트리밍" },
    { component: "시그널링 서버", tech: "Socket.io", desc: "실시간 연결 관리 및 방 생성" },
    { component: "음성 처리", tech: "Web Audio API", desc: "에코 제거, 노이즈 캔슬링, 믹싱" },
    { component: "가사 동기화", tech: "WebSocket", desc: "실시간 가사 스크롤 및 타이밍" },
    { component: "점수 시스템", tech: "Pitch Detection", desc: "실시간 음정 분석 및 점수 계산" },
    { component: "프론트엔드", tech: "Next.js 15", desc: "React 기반 서버 사이드 렌더링" },
  ];

  return (
    <section id="features" className="relative w-full py-32 bg-black text-white px-6 md:px-20">
      <div className="max-w-7xl mx-auto">
        <h2 className="mb-16 text-xs font-bold tracking-[0.2em] text-white/50 uppercase">
          Technical Specification
        </h2>
        
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/20">
                <th className="py-6 text-sm font-medium text-white/60">Component</th>
                <th className="py-6 text-sm font-medium text-white/60">Technology</th>
                <th className="py-6 text-sm font-medium text-white/60">Description</th>
              </tr>
            </thead>
            <tbody>
              {specs.map((row, i) => (
                <tr key={i} className="border-b border-white/10 transition-colors hover:bg-white/5">
                  <td className="py-6 pr-8 font-medium text-white">{row.component}</td>
                  <td className="py-6 pr-8 font-mono text-[#C0C0C0]">{row.tech}</td>
                  <td className="py-6 text-gray-400">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
