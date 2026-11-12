import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const SoundContext = createContext(null);
const STORAGE_KEY = 'safe-mandate-sound-enabled';

function readPreference() {
  try { return window.localStorage.getItem(STORAGE_KEY) === 'true'; } catch { return false; }
}

export function SoundProvider({ children }) {
  const [enabled, setEnabled] = useState(readPreference);

  const toggle = useCallback(() => setEnabled((current) => {
    const next = !current;
    try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* Sound remains session-local if storage is unavailable. */ }
    return next;
  }), []);

  const play = useCallback((kind = 'tap') => {
    if (!enabled || typeof window === 'undefined') return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const context = new AudioContextClass();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(kind === 'success' ? 660 : 440, now);
      if (kind === 'success') oscillator.frequency.exponentialRampToValueAtTime(880, now + .09);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.018, now + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, now + (kind === 'success' ? .18 : .045));
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(now); oscillator.stop(now + (kind === 'success' ? .19 : .05));
      oscillator.onended = () => context.close().catch(() => {});
    } catch { /* Audio is optional and may be blocked by the browser. */ }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    const onClick = (event) => {
      if (event.target instanceof Element && event.target.closest('[data-ui-sound="tap"], button.button-lime:not(:disabled), a.button-lime')) play('tap');
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [enabled, play]);

  const value = useMemo(() => ({ enabled, toggle, play }), [enabled, toggle, play]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSound() {
  const value = useContext(SoundContext);
  if (!value) return { enabled: false, toggle: () => {}, play: () => {} };
  return value;
}
