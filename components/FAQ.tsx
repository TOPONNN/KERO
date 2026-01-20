"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";

const FAQS = [
  { q: "어떤 기술스택을 사용했나요?", a: "KERO는 Next.js 15, WebRTC, Socket.io, Web Audio API 등 최신 웹 기술을 활용하여 개발되었습니다." },
  { q: "프로젝트 개발기간은?", a: "2026.01.12 ~ 2026.02.09, 약 4주간의 기획, 디자인, 개발 과정을 거쳐 완성되었습니다." },
  { q: "어떻게 구현했나요?", a: "WebRTC를 통한 P2P 연결로 실시간 오디오 스트리밍을, Socket.io로 시그널링과 방 관리를 구현했습니다." },
  { q: "동시 접속 인원은 몇 명인가요?", a: "한 방에 최대 8명까지 동시 접속하여 함께 노래할 수 있습니다." },
  { q: "지원하는 브라우저는?", a: "Chrome, Firefox, Safari, Edge 등 WebRTC를 지원하는 모든 최신 브라우저에서 사용 가능합니다." },
  { q: "모바일에서도 사용 가능한가요?", a: "네, 반응형 디자인으로 모바일 브라우저에서도 원활하게 사용할 수 있습니다." }
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="w-full py-32 bg-black px-6 md:px-20">
      <div className="max-w-4xl mx-auto">
        <h2 className="mb-20 text-4xl font-bold text-white">FAQ</h2>
        <div className="flex flex-col divide-y divide-white/10">
          {FAQS.map((faq, i) => (
            <div key={i} className="py-6">
              <button 
                onClick={() => setOpenIndex(openIndex === i ? null : i)}
                className="flex w-full items-center justify-between py-4 text-left"
              >
                <span className="text-xl font-medium text-white">{faq.q}</span>
                <motion.div
                  animate={{ rotate: openIndex === i ? 45 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <Plus className="h-6 w-6 text-white/50" />
                </motion.div>
              </button>
              <AnimatePresence>
                {openIndex === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <p className="pb-4 text-gray-400">{faq.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
