"use client";

import { useRef, ReactNode } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

interface SectionWrapperProps {
  children: ReactNode;
  id?: string;
  className?: string;
  disableScale?: boolean;
}

export default function SectionWrapper({ children, id, className, disableScale }: SectionWrapperProps) {
  const containerRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  const opacity = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.2, 0.8, 1], [0.8, 1, 1, 0.8]);

  return (
    <section id={id} ref={containerRef} className={cn("relative", className)}>
      <motion.div style={disableScale ? { opacity } : { opacity, scale }}>
        {children}
      </motion.div>
    </section>
  );
}
