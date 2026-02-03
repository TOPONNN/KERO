"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import gsap from "gsap";

interface PreloaderContextType {
  isLoading: boolean;
  loadingPercent: number;
  bypassLoading: () => void;
}

const PreloaderContext = createContext<PreloaderContextType | undefined>(undefined);

export const usePreloader = () => {
  const context = useContext(PreloaderContext);
  if (!context) {
    throw new Error("usePreloader must be used within a PreloaderProvider");
  }
  return context;
};

export const PreloaderProvider = ({ children }: { children: React.ReactNode }) => {
  // Loading screen disabled - content shows immediately while Spline loads in background
  const [isLoading] = useState(false);
  const [loadingPercent] = useState(100);

  // No-op function for backward compatibility
  const bypassLoading = () => {};

  return (
    <PreloaderContext.Provider value={{ isLoading, loadingPercent, bypassLoading }}>
      {children}
    </PreloaderContext.Provider>
  );
};
