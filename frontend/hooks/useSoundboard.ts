import { useEffect, useRef } from "react";
import { usePresence } from "../components/PresenceProvider";

export function useSoundboard() {
  const { registerSoundListener } = usePresence();
  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());

  const playSound = (soundFile: string) => {
    let audio = audioCache.current.get(soundFile);
    if (!audio) {
      audio = new Audio(`/sounds/${soundFile}`);
      audioCache.current.set(soundFile, audio);
    }
    audio.currentTime = 0;
    audio.volume = 0.5;
    audio.play().catch(() => {});
  };

  useEffect(() => {
    const unregister = registerSoundListener((data) => {
      playSound(data.soundFile);
    });
    return unregister;
  }, [registerSoundListener]);

  return { playSound };
}
