import { useEffect, useRef } from 'react';

/**
 * Custom React hook to profile component mount/render counts and durations.
 * Only runs in __DEV__ mode.
 */
export function useRenderProfiler(componentName: string) {
  if (!__DEV__) return;

  const renderCount = useRef(0);
  const mountTime = useRef(0);

  renderCount.current += 1;
  const renderStart = typeof performance !== 'undefined' ? performance.now() : Date.now();

  // Mount/Unmount tracking
  useEffect(() => {
    mountTime.current = Date.now();
    console.log(`[PROFILER] 🚀 <${componentName}> MOUNTED`);
    return () => {
      const activeDuration = Date.now() - mountTime.current;
      console.log(`[PROFILER] 🧹 <${componentName}> UNMOUNTED after ${activeDuration}ms`);
    };
  }, []);

  // Render timing tracking
  useEffect(() => {
    const renderEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const duration = renderEnd - renderStart;
    console.log(
      `[PROFILER] ⏱️ <${componentName}> RENDER #${renderCount.current} | Duration: ${duration.toFixed(2)}ms`
    );
  });
}

/**
 * Instrument Zustand store updates to log state changes.
 */
export function logZustandUpdate(storeName: string, changedKeys: string[]) {
  if (__DEV__) {
    console.log(`[PROFILER] 📦 Store [${storeName}] updated keys: [${changedKeys.join(', ')}]`);
  }
}

/**
 * Profile socket event latency and timing.
 */
export function profileSocketEvent(eventName: string, processingTimeMs: number) {
  if (__DEV__) {
    console.log(`[PROFILER] 🔌 Socket event [${eventName}] processed in ${processingTimeMs.toFixed(2)}ms`);
  }
}
