"use client";

// Animated Spline background controller

import React, { Suspense, useEffect, useState } from "react";
import { Application, SPEObject, SplineEvent } from "@splinetool/runtime";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { AnimatePresence, motion } from "framer-motion";

const Spline = React.lazy(() => import("@splinetool/react-spline"));

import { Skill, SkillNames, SKILLS } from "./constants";
import { sleep } from "@/lib/utils";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useSounds } from "@/hooks/use-sounds";
import { usePreloader } from "@/hooks/use-preloader";
import { Section, getKeyboardState } from "./animated-background-config";

gsap.registerPlugin(ScrollTrigger);

// Helper: traverse parent chain to find a matching skill
const findSkillFromObject = (obj: { name: string; id: string } | null): Skill | null => {
  let current: any = obj;
  while (current) {
    const skill = SKILLS[current.name as SkillNames];
    if (skill) return skill;
    current = current.parent || null;
  }
  return null;
};

/*
 * getAllObjects() returns a flat list. Each skill (e.g. "react") is an Empty
 * container whose children are: keycap → { legend, keycap-desktop, keycap-mobile }
 * and a Text mesh. The colored meshes are keycap-desktop, keycap-mobile, and Text —
 * each has material.layers[0] of type "color". We walk the flat list to find
 * children by parentUuid and set the color layer directly.
 */
const applyBrandColors = async (app: Application) => {
  try {
    const allObjects = app.getAllObjects();

    const childrenMap = new Map<string, typeof allObjects>();
    for (const obj of allObjects) {
      const parentId = (obj as any).parentUuid as string | undefined;
      if (parentId) {
        if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
        childrenMap.get(parentId)!.push(obj);
      }
    }

    // Names of meshes that are keycap bodies (safe to recolor)
    const KEYCAP_BODY_NAMES = new Set(['keycap-desktop', 'keycap-mobile']);
    // Names of meshes that are icons/legends (must NOT recolor)
    const LEGEND_NAMES = new Set(['legend']);

    const collectKeycapBodies = (uuid: string, result: SPEObject[]) => {
      const children = childrenMap.get(uuid) || [];
      for (const child of children) {
        // Skip legend/icon meshes entirely (don't recurse into them either)
        if (LEGEND_NAMES.has(child.name)) continue;

        const mat = child.material;
        if (
          KEYCAP_BODY_NAMES.has(child.name) &&
          mat && mat.layers && mat.layers.length > 0 && mat.layers[0].type === 'color'
        ) {
          result.push(child);
        }
        collectKeycapBodies((child as any).uuid, result);
      }
    };

    for (const skill of Object.values(SKILLS)) {
      const skillRoot = allObjects.find(obj => obj.name === skill.name);
      if (!skillRoot) continue;

      const bodies: SPEObject[] = [];
      collectKeycapBodies((skillRoot as any).uuid, bodies);

      for (const mesh of bodies) {
        try {
          (mesh.material!.layers[0] as any).color = skill.keycapColor ?? skill.color;
        } catch (_) {}
      }
    }
  } catch (e) {
    console.error('[applyBrandColors] FATAL:', e);
  }
};

const AnimatedBackground = () => {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [splineApp, setSplineApp] = useState<Application>();
  const selectedSkillRef = React.useRef<Skill | null>(null);

  const { playPressSound, playReleaseSound } = useSounds();
  const { isLoading, bypassLoading } = usePreloader();

  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("hero");
  const activeSectionRef = React.useRef<Section>("hero");

  const [bongoAnimation, setBongoAnimation] = useState({
    start: () => {},
    stop: () => {},
  });
  const [keycapAnimations, setKeycapAnimations] = useState({
    start: () => {},
    stop: () => {},
  });

  const [keyboardRevealed, setKeyboardRevealed] = useState(false);

  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  // --- Event Handlers ---

  const isSoundEnabled = () => activeSectionRef.current !== "hero";

  const handleMouseHover = (e: SplineEvent) => {
    if (!splineApp || selectedSkillRef.current?.name === e.target.name) return;

    if (e.target.name === "body" || e.target.name === "platform") {
      if (selectedSkillRef.current) {
        const prevKeycap = splineApp.findObjectByName(selectedSkillRef.current.name);
        if (prevKeycap) {
          gsap.to(prevKeycap.position, { y: 0, duration: 0.3, ease: "elastic.out(1, 0.5)" });
        }
        if (isSoundEnabled()) playReleaseSound();
      }
      setSelectedSkill(null);
      selectedSkillRef.current = null;
      if (splineApp.getVariable("heading") && splineApp.getVariable("desc")) {
        splineApp.setVariable("heading", "");
        splineApp.setVariable("desc", "");
      }
    } else {
      if (!selectedSkillRef.current || selectedSkillRef.current.name !== e.target.name) {
        const skill = SKILLS[e.target.name as SkillNames];
        if (skill) {
          if (selectedSkillRef.current) {
            const prevKeycap = splineApp.findObjectByName(selectedSkillRef.current.name);
            if (prevKeycap) {
              gsap.to(prevKeycap.position, { y: 0, duration: 0.2, ease: "power2.out" });
            }
            if (isSoundEnabled()) playReleaseSound();
          }
          const newKeycap = splineApp.findObjectByName(skill.name);
          if (newKeycap) {
            gsap.to(newKeycap.position, { y: -40, duration: 0.1, ease: "power2.in" });
          }
          if (isSoundEnabled()) playPressSound();
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
      return (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          (el as HTMLElement).isContentEditable)
      );
    };

     splineApp.addEventListener("keyUp", () => {
       if (!splineApp || isInputFocused()) return;
       if (selectedSkillRef.current) {
         const keycap = splineApp.findObjectByName(selectedSkillRef.current.name);
         if (keycap) {
           gsap.to(keycap.position, { y: 0, duration: 0.3, ease: "elastic.out(1, 0.5)" });
         }
       }
       if (isSoundEnabled()) playReleaseSound();
       splineApp.setVariable("heading", "");
       splineApp.setVariable("desc", "");
     });

     splineApp.addEventListener("keyDown", (e) => {
       if (!splineApp || isInputFocused()) return;
       const skill = SKILLS[e.target.name as SkillNames];
       if (skill) {
         const keycap = splineApp.findObjectByName(skill.name);
         if (keycap) {
           gsap.to(keycap.position, { y: -40, duration: 0.1, ease: "power2.in" });
         }
         if (isSoundEnabled()) playPressSound();
         setSelectedSkill(skill);
         selectedSkillRef.current = skill;
         splineApp.setVariable("heading", skill.label);
         splineApp.setVariable("desc", skill.shortDescription);
       }
     });

     splineApp.addEventListener("mouseHover", handleMouseHover);
   };

  // --- Animation Setup Helpers ---

  const createSectionTimeline = (
    triggerId: string,
    targetSection: Section,
    prevSection: Section,
    start: string = "top 50%",
    end: string = "bottom bottom"
  ) => {
    if (!splineApp) return null;
    const kbd = splineApp.findObjectByName("keyboard");
    if (!kbd) return null;

    return gsap.timeline({
      scrollTrigger: {
        trigger: triggerId,
        start,
        end,
        scrub: true,
        onEnter: () => {
          setActiveSection(targetSection);
          const state = getKeyboardState({ section: targetSection, isMobile });
          gsap.to(kbd.scale, { ...state.scale, duration: 1 });
          gsap.to(kbd.position, { ...state.position, duration: 1 });
          gsap.to(kbd.rotation, { ...state.rotation, duration: 1 });
        },
        onLeaveBack: () => {
          setActiveSection(prevSection);
          const state = getKeyboardState({ section: prevSection, isMobile });
          gsap.to(kbd.scale, { ...state.scale, duration: 1 });
          gsap.to(kbd.position, { ...state.position, duration: 1 });
          gsap.to(kbd.rotation, { ...state.rotation, duration: 1 });
        },
      },
    });
  };

  const setupScrollAnimations = () => {
    if (!splineApp) return [];
    const kbd = splineApp.findObjectByName("keyboard");
    if (!kbd) return [];

    const heroState = getKeyboardState({ section: "hero", isMobile });
    gsap.set(kbd.scale, heroState.scale);
    gsap.set(kbd.position, heroState.position);
    gsap.set(kbd.rotation, heroState.rotation);

    return [
      createSectionTimeline("#team", "team", "hero"),
      createSectionTimeline("#skills", "skills", "team"),
      createSectionTimeline("#architecture", "architecture", "skills"),
      createSectionTimeline("#features", "features", "architecture", "top 70%"),
      createSectionTimeline("#cta", "cta", "features", "top 30%"),
    ].filter(Boolean) as gsap.core.Timeline[];
  };

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
      framesParent.position.x = 50;
      framesParent.position.z = 0;
      interval = setInterval(() => {
        if (i % 2) {
          frame1.visible = false;
          frame2.visible = true;
        } else {
          frame1.visible = true;
          frame2.visible = false;
        }
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
          y: 0,
          duration: 4,
          repeat: 1,
          ease: "elastic.out(1,0.7)",
        });
        tweens.push(t);
      });
      setTimeout(removePrevTweens, 1000);
    };

    return { start, stop };
  };

  const revealKeyboard = async () => {
    if (!splineApp) return;
    const kbd = splineApp.findObjectByName("keyboard");
    if (!kbd) return;

    kbd.visible = false;
    await sleep(300);
    kbd.visible = true;

    const currentState = getKeyboardState({ section: activeSectionRef.current, isMobile });
    gsap.fromTo(
      kbd.scale,
      { x: 0.01, y: 0.01, z: 0.01 },
      {
        ...currentState.scale,
        duration: 1.5,
        ease: "elastic.out(1, 0.6)",
      }
    );
    gsap.set(kbd.position, currentState.position);
    gsap.set(kbd.rotation, currentState.rotation);

    const allObjects = splineApp.getAllObjects();
    await sleep(900);

    if (isMobile) {
      allObjects
        .filter((o: SPEObject) => o.name === "keycap-mobile")
        .forEach((k: SPEObject) => {
          k.visible = true;
        });
    } else {
      allObjects
        .filter((o: SPEObject) => o.name === "keycap-desktop")
        .forEach(async (k: SPEObject, i: number) => {
          await sleep(i * 70);
          k.visible = true;
        });
    }

    allObjects
      .filter((o: SPEObject) => o.name === "keycap")
      .forEach(async (k: SPEObject, i: number) => {
        k.visible = false;
        await sleep(i * 70);
        k.visible = true;
        gsap.fromTo(
          k.position,
          { y: 200 },
          { y: 50, duration: 0.5, delay: 0.1, ease: "bounce.out" }
        );
      });
  };

  // --- Effects ---

  useEffect(() => {
    if (!splineApp) return;
    handleSplineInteractions();
    setBongoAnimation(getBongoAnimation());
    setKeycapAnimations(getKeycapsAnimation());
  }, [splineApp]);

  useEffect(() => {
    return () => {
      bongoAnimation.stop();
      keycapAnimations.stop();
    };
  }, [bongoAnimation, keycapAnimations]);

  useEffect(() => {
    if (!splineApp) return;
    const timelines = setupScrollAnimations();
    return () => {
      timelines.forEach((timeline) => {
        timeline.scrollTrigger?.kill();
        timeline.kill();
      });
    };
  }, [splineApp, isMobile]);

  useEffect(() => {
    if (!splineApp) return;
    const textDesktopDark = splineApp.findObjectByName("text-desktop-dark");
    const textDesktopLight = splineApp.findObjectByName("text-desktop");
    const textMobileDark = splineApp.findObjectByName("text-mobile-dark");
    const textMobileLight = splineApp.findObjectByName("text-mobile");

    if (textDesktopDark) textDesktopDark.visible = false;
    if (textDesktopLight) textDesktopLight.visible = false;
    if (textMobileDark) textMobileDark.visible = false;
    if (textMobileLight) textMobileLight.visible = false;
  }, [activeSection, splineApp, isMobile]);

  useEffect(() => {
    if (!selectedSkill || !splineApp) return;
    splineApp.setVariable("heading", selectedSkill.label);
    splineApp.setVariable("desc", selectedSkill.shortDescription);
  }, [selectedSkill, splineApp]);

  useEffect(() => {
    if (!splineApp) return;

    let rotateKeyboard: gsap.core.Tween | undefined;
    let teardownKeyboard: gsap.core.Tween | undefined;

    const kbd = splineApp.findObjectByName("keyboard");

    if (kbd) {
      rotateKeyboard = gsap.to(kbd.rotation, {
        y: Math.PI * 2 + kbd.rotation.y,
        duration: 10,
        repeat: -1,
        yoyo: true,
        yoyoEase: true,
        ease: "back.inOut",
        delay: 2.5,
        paused: true,
      });

      teardownKeyboard = gsap.fromTo(
        kbd.rotation,
        { y: 0, x: -Math.PI, z: 0 },
        {
          y: -Math.PI / 2,
          duration: 5,
          repeat: -1,
          yoyo: true,
          yoyoEase: true,
          delay: 2.5,
          immediateRender: false,
          paused: true,
        }
      );
    }

    const manageAnimations = async () => {
      if (activeSection !== "skills") {
        if (selectedSkillRef.current) {
          const keycap = splineApp.findObjectByName(selectedSkillRef.current.name);
          if (keycap) {
            gsap.to(keycap.position, { y: 0, duration: 0.3, ease: "elastic.out(1, 0.5)" });
          }
        }
        splineApp.setVariable("heading", "");
        splineApp.setVariable("desc", "");
        setSelectedSkill(null);
        selectedSkillRef.current = null;
      }

      if (activeSection === "hero" || activeSection === "team") {
        rotateKeyboard?.play();
        teardownKeyboard?.pause();
      } else {
        rotateKeyboard?.pause();
        teardownKeyboard?.pause();
      }

       if (activeSection === "features") {
        await sleep(300);
        bongoAnimation.start();
      } else {
        bongoAnimation.stop();
      }

       if (activeSection === "cta" || activeSection === "faq") {
        await sleep(600);
        teardownKeyboard?.restart();
        keycapAnimations.start();
      } else {
        await sleep(600);
        teardownKeyboard?.pause();
        keycapAnimations.stop();
      }
    };

    manageAnimations();

    return () => {
      rotateKeyboard?.kill();
      teardownKeyboard?.kill();
    };
  }, [activeSection, bongoAnimation, keycapAnimations, splineApp]);

  useEffect(() => {
    if (!splineApp || keyboardRevealed || isLoading) return;
    setKeyboardRevealed(true);
    revealKeyboard();
  }, [splineApp, keyboardRevealed, isMobile, isLoading]);



  return (
    <>
      <Suspense fallback={<div>Loading...</div>}>
        <Spline
          className="w-full h-full fixed"
          onLoad={(app: Application) => {
            setSplineApp(app);
            applyBrandColors(app);
            bypassLoading();
          }}
          scene="/assets/skills-keyboard.spline"
        />
      </Suspense>

      <AnimatePresence>
        {selectedSkill && activeSection === "skills" && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="fixed inset-0 z-50 pointer-events-none flex items-end justify-center pb-4 md:pb-6"
          >
            <div className="pointer-events-auto backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-4 md:p-6 max-w-md w-[90%] md:w-auto flex items-center gap-4 shadow-2xl">
              <div className="flex-shrink-0 bg-white/10 rounded-lg p-2">
                <img
                  src={selectedSkill.icon}
                  alt={selectedSkill.label}
                  className="w-10 h-10 md:w-12 md:h-12 object-contain"
                />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold text-white font-display">
                  {selectedSkill.label}
                </h3>
                <p className="text-sm md:text-base text-white/60 mt-1 font-display leading-tight">
                  {selectedSkill.shortDescription}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};

export default AnimatedBackground;
