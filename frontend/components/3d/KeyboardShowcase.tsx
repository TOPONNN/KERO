"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { Application, SPEObject, SplineEvent } from "@splinetool/runtime";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { motion } from "framer-motion";

const Spline = React.lazy(() => import("@splinetool/react-spline"));

import { Skill, SkillNames, SKILLS } from "./constants";
import { sleep } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSounds } from "@/hooks/use-sounds";

gsap.registerPlugin(ScrollTrigger);

type Phase = "skills" | "bongo" | "teardown";

const KeyboardShowcase = () => {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const sectionRef = useRef<HTMLDivElement>(null);
  const stickyRef = useRef<HTMLDivElement>(null);
  const splineContainer = useRef<HTMLDivElement>(null);
  const [splineApp, setSplineApp] = useState<Application>();
  const selectedSkillRef = useRef<Skill | null>(null);

  const { playPressSound, playReleaseSound } = useSounds();

  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [phase, setPhase] = useState<Phase>("skills");
  const [isLoaded, setIsLoaded] = useState(false);

  const bongoAnimationRef = useRef<{ start: () => void; stop: () => void } | undefined>(undefined);
  const keycapAnimationsRef = useRef<{ start: () => void; stop: () => void } | undefined>(undefined);

  // --- Event Handlers ---

  const handleMouseHover = (e: SplineEvent) => {
    if (!splineApp || selectedSkillRef.current?.name === e.target.name) return;

    if (e.target.name === "body" || e.target.name === "platform") {
      if (selectedSkillRef.current) playReleaseSound();
      setSelectedSkill(null);
      selectedSkillRef.current = null;
      splineApp.setVariable("heading", "");
      splineApp.setVariable("desc", "");
    } else {
      if (!selectedSkillRef.current || selectedSkillRef.current.name !== e.target.name) {
        const skill = SKILLS[e.target.name as SkillNames];
        if (skill) {
          if (selectedSkillRef.current) playReleaseSound();
          playPressSound();
          setSelectedSkill(skill);
          selectedSkillRef.current = skill;
          splineApp.setVariable("heading", skill.label);
          splineApp.setVariable("desc", skill.shortDescription);
        }
      }
    }
  };

  const handleSplineInteractions = () => {
    if (!splineApp) return;

    const isInputFocused = () => {
      const el = document.activeElement;
      return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);
    };

    splineApp.addEventListener("keyUp", () => {
      if (!splineApp || isInputFocused()) return;
      playReleaseSound();
    });

    splineApp.addEventListener("keyDown", (e) => {
      if (!splineApp || isInputFocused()) return;
      const skill = SKILLS[e.target.name as SkillNames];
      if (skill) {
        playPressSound();
        setSelectedSkill(skill);
        selectedSkillRef.current = skill;
      }
    });

    splineApp.addEventListener("mouseHover", handleMouseHover);
  };

  // --- Bongo Cat Animation ---

  const getBongoAnimation = () => {
    const framesParent = splineApp?.findObjectByName("bongo-cat");
    const frame1 = splineApp?.findObjectByName("frame-1");
    const frame2 = splineApp?.findObjectByName("frame-2");

    if (!frame1 || !frame2 || !framesParent) {
      return { start: () => {}, stop: () => {} };
    }

    let interval: NodeJS.Timeout;
    const start = () => {
      let i = 0;
      framesParent.visible = true;
      interval = setInterval(() => {
        if (i % 2) { frame1.visible = false; frame2.visible = true; }
        else { frame1.visible = true; frame2.visible = false; }
        i++;
      }, 100);
    };
    const stop = () => {
      clearInterval(interval);
      framesParent.visible = false;
      frame1.visible = false;
      frame2.visible = false;
    };
    return { start, stop };
  };

  // --- Keycap Float Animation ---

  const getKeycapsAnimation = () => {
    if (!splineApp) return { start: () => {}, stop: () => {} };

    let tweens: gsap.core.Tween[] = [];
    const removePrevTweens = () => tweens.forEach((t) => t.kill());

    const start = () => {
      removePrevTweens();
      Object.values(SKILLS)
        .sort(() => Math.random() - 0.5)
        .forEach((skill, idx) => {
          const keycap = splineApp.findObjectByName(skill.name);
          if (!keycap) return;
          const t = gsap.to(keycap.position, {
            y: Math.random() * 200 + 200,
            duration: Math.random() * 2 + 2,
            delay: idx * 0.6,
            repeat: -1,
            yoyo: true,
            yoyoEase: "none",
            ease: "elastic.out(1,0.3)",
          });
          tweens.push(t);
        });
    };

    const stop = () => {
      removePrevTweens();
      Object.values(SKILLS).forEach((skill) => {
        const keycap = splineApp.findObjectByName(skill.name);
        if (!keycap) return;
        const t = gsap.to(keycap.position, {
          y: 0, duration: 4, repeat: 1, ease: "elastic.out(1,0.7)",
        });
        tweens.push(t);
      });
      setTimeout(removePrevTweens, 1000);
    };

    return { start, stop };
  };

  // --- Keyboard reveal on load ---

  const revealKeyboard = async () => {
    if (!splineApp) return;
    const kbd = splineApp.findObjectByName("keyboard");
    if (!kbd) return;

    const scale = isMobile ? 0.3 : 0.25;
    kbd.visible = false;
    await sleep(300);
    kbd.visible = true;

    gsap.fromTo(
      kbd.scale,
      { x: 0.01, y: 0.01, z: 0.01 },
      { x: scale, y: scale, z: scale, duration: 1.5, ease: "elastic.out(1, 0.6)" }
    );
    gsap.set(kbd.position, { x: 0, y: -40, z: 0 });
    gsap.set(kbd.rotation, { x: 0, y: Math.PI / 12, z: 0 });

    const allObjects = splineApp.getAllObjects();
    await sleep(900);

    if (isMobile) {
      allObjects.filter((o: SPEObject) => o.name === "keycap-mobile").forEach((k: SPEObject) => { k.visible = true; });
    } else {
      allObjects.filter((o: SPEObject) => o.name === "keycap-desktop").forEach(async (k: SPEObject, i: number) => {
        await sleep(i * 70); k.visible = true;
      });
    }

    allObjects.filter((o: SPEObject) => o.name === "keycap").forEach(async (k: SPEObject, i: number) => {
      k.visible = false;
      await sleep(i * 70);
      k.visible = true;
      gsap.fromTo(k.position, { y: 200 }, { y: 50, duration: 0.5, delay: 0.1, ease: "bounce.out" });
    });
  };

  // --- Init interactions + scroll triggers ---

  useEffect(() => {
    if (!splineApp || !sectionRef.current) return;

    handleSplineInteractions();
    bongoAnimationRef.current = getBongoAnimation();
    keycapAnimationsRef.current = getKeycapsAnimation();

    const kbd = splineApp.findObjectByName("keyboard");
    if (!kbd) return;

    // Set initial keyboard state
    const scale = isMobile ? 0.3 : 0.25;
    gsap.set(kbd.scale, { x: scale, y: scale, z: scale });
    gsap.set(kbd.position, { x: 0, y: -40, z: 0 });
    gsap.set(kbd.rotation, { x: 0, y: Math.PI / 12, z: 0 });



    // Phase 2: Bongo cat — keyboard flips, bongo cat appears
    ScrollTrigger.create({
      trigger: sectionRef.current,
      start: "33% top",
      end: "34% top",
      onEnter: () => {
        setPhase("bongo");
        gsap.to(kbd.rotation, { x: Math.PI, y: Math.PI / 3, z: Math.PI, duration: 1.2, ease: "power2.inOut" });
        if (isMobile) {
          gsap.to(kbd.position, { y: 150, duration: 1 });
        }
        setTimeout(() => bongoAnimationRef.current?.start(), 400);
      },
      onLeaveBack: () => {
        setPhase("skills");
        bongoAnimationRef.current?.stop();
        gsap.to(kbd.rotation, { x: 0, y: Math.PI / 12, z: 0, duration: 1.2, ease: "power2.inOut" });
        gsap.to(kbd.position, { x: 0, y: -40, z: 0, duration: 1 });
      },
    });

    // Phase 3: Teardown — keycaps float
    ScrollTrigger.create({
      trigger: sectionRef.current,
      start: "66% top",
      end: "67% top",
      onEnter: () => {
        setPhase("teardown");
        bongoAnimationRef.current?.stop();
        keycapAnimationsRef.current?.start();
        gsap.to(kbd.rotation, { y: -Math.PI / 2, x: -Math.PI, z: 0, duration: 1.5, ease: "power2.inOut" });
        gsap.to(kbd.scale, {
          x: isMobile ? 0.25 : 0.2,
          y: isMobile ? 0.25 : 0.2,
          z: isMobile ? 0.25 : 0.2,
          duration: 1,
        });
      },
      onLeaveBack: () => {
        setPhase("bongo");
        keycapAnimationsRef.current?.stop();
        const s = isMobile ? 0.3 : 0.25;
        gsap.to(kbd.scale, { x: s, y: s, z: s, duration: 1 });
        gsap.to(kbd.rotation, { x: Math.PI, y: Math.PI / 3, z: Math.PI, duration: 1.2, ease: "power2.inOut" });
        setTimeout(() => bongoAnimationRef.current?.start(), 400);
      },
    });

    return () => {
      bongoAnimationRef.current?.stop();
      keycapAnimationsRef.current?.stop();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splineApp, isMobile]);

   // Reveal keyboard on load
   useEffect(() => {
     if (!splineApp || isLoaded) return;
     setIsLoaded(true);
     revealKeyboard();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [splineApp]);

   // Handle text visibility for skill hover display
   useEffect(() => {
     if (!splineApp) return;
     const textDesktopDark = splineApp.findObjectByName("text-desktop-dark");
     const textDesktopLight = splineApp.findObjectByName("text-desktop");
     const textMobileDark = splineApp.findObjectByName("text-mobile-dark");
     const textMobileLight = splineApp.findObjectByName("text-mobile");

     if (!textDesktopDark || !textDesktopLight || !textMobileDark || !textMobileLight) return;

     const hideAll = () => {
       textDesktopDark.visible = false;
       textDesktopLight.visible = false;
       textMobileDark.visible = false;
       textMobileLight.visible = false;
     };

     if (phase !== "skills") {
       hideAll();
     } else if (isMobile) {
       hideAll();
       textMobileLight.visible = true;
     } else {
       hideAll();
       textDesktopLight.visible = true;
     }
   }, [splineApp, isMobile, phase]);

   // Set Spline text variables when skill selection changes
   useEffect(() => {
     if (!selectedSkill || !splineApp) return;
     splineApp.setVariable("heading", selectedSkill.label);
     splineApp.setVariable("desc", selectedSkill.shortDescription);
   }, [selectedSkill, splineApp]);

   return (
    <section ref={sectionRef} className="relative bg-black" style={{ height: "400vh" }}>
      {/* Sticky container - stays pinned while user scrolls through the 400vh */}
      <div ref={stickyRef} className="sticky top-0 h-screen w-full overflow-hidden bg-black">
        {/* Spline 3D canvas */}
        <Suspense fallback={
          <div className="flex items-center justify-center h-full">
            <div className="text-white/30 text-lg">Loading 3D...</div>
          </div>
        }>
          <Spline
            className="absolute inset-0 w-full h-full"
            ref={splineContainer}
            onLoad={(app: Application) => {
              setSplineApp(app);
              try {
                const renderer = (app as any)._renderer;
                if (renderer && renderer.setPixelRatio) {
                  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
                }
              } catch (e) {
                // ignore
              }
            }}
            scene="/assets/skills-keyboard.spline"
          />
        </Suspense>

        {/* Text overlay - phase dependent */}
        <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-start pt-16 md:pt-24 z-10">
           <motion.div
             animate={{ opacity: phase === "skills" ? 1 : 0 }}
             transition={{ duration: 0.5 }}
             className="text-center"
           >
             <h2 className="text-4xl md:text-7xl font-bold text-white/90">
               Tech Stack
             </h2>
             <p className="mt-4 text-base text-white/50">(hint: press a key)</p>
           </motion.div>

           <motion.div
             animate={{ opacity: phase === "bongo" ? 1 : 0 }}
             transition={{ duration: 0.5 }}
             className="absolute top-16 md:top-24 text-center"
           >
             <h2 className="text-4xl md:text-7xl font-bold text-white/90">
               Bongo Cat
             </h2>
             <p className="mt-4 text-base text-white/50">keep scrolling...</p>
           </motion.div>

           <motion.div
             animate={{ opacity: phase === "teardown" ? 1 : 0 }}
             transition={{ duration: 0.5 }}
             className="absolute top-16 md:top-24 text-center"
           >
             <h2 className="text-4xl md:text-7xl font-bold text-white/90">
               Floating Keys
             </h2>
           </motion.div>
        </div>

         {/* Scroll progress indicator */}

        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-3 z-10">
          {(["skills", "bongo", "teardown"] as Phase[]).map((p) => (
            <div
              key={p}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                phase === p ? "bg-white scale-125" : "bg-white/30"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default KeyboardShowcase;
