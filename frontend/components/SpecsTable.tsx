export default function SpecsTable() {
  const specs = [
    { component: "실시간 통신", tech: "WebRTC + LiveKit", desc: "P2P 기반 초저지연 오디오/비디오 스트리밍" },
    { component: "백엔드", tech: "Express.js", desc: "Node.js 기반 RESTful API 서버" },
    { component: "실시간 이벤트", tech: "Socket.io", desc: "양방향 실시간 통신 및 방 관리" },
    { component: "메시지 큐", tech: "RabbitMQ + Redis", desc: "비동기 작업 처리 및 캐싱" },
    { component: "AI 음원 분리", tech: "Demucs", desc: "보컬/MR 자동 분리 (Meta AI)" },
    { component: "AI 가사 추출", tech: "Whisper", desc: "음성→텍스트 자동 변환 (OpenAI)" },
    { component: "AI 음정 분석", tech: "CREPE", desc: "실시간 음정 추적 및 점수 계산" },
    { component: "AI Worker", tech: "Flask + Celery", desc: "GPU 기반 AI 작업 비동기 처리" },
    { component: "스토리지", tech: "AWS S3", desc: "음원 및 미디어 파일 저장" },
    { component: "상태 관리", tech: "Redux", desc: "클라이언트 전역 상태 관리" },
    { component: "모니터링", tech: "ELK Stack", desc: "로그 수집, 분석, 시각화" },
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
