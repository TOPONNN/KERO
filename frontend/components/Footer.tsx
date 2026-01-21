"use client";

import { Github } from "lucide-react";

export default function Footer() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer className="w-full border-t border-white/10 bg-black py-12 px-6 md:px-20">
      <div className="flex flex-col md:flex-row items-center justify-between gap-8">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-white">KERO</h2>
          <span className="text-sm text-gray-500">© 2026 KERO. All rights reserved.</span>
        </div>
        
        <div className="flex items-center gap-8 text-sm text-gray-400">
          <button onClick={() => scrollTo('features')} className="hover:text-white transition-colors">Features</button>
          <button onClick={() => scrollTo('faq')} className="hover:text-white transition-colors">FAQ</button>
          <a href="https://github.com/TOPONNN" className="hover:text-white transition-colors flex items-center gap-2">
            <Github className="h-4 w-4" />
            GitHub
          </a>
        </div>
        
        <div className="text-xs text-gray-600">
          Built with passion by Team KERO
        </div>
      </div>
    </footer>
  );
}
