import { useRef, useCallback, useEffect } from 'react';
import { Platform } from 'react-native';
import { API_URL } from '@/constants/Config';
import { useAuthStore } from '@/stores/authStore';

interface UseBarcodeScannerOptions {
  /** Called with the full dish object when the scan resolves successfully */
  onSuccess?: (dish: any) => void;
  /** Called with a human-readable error message on any failure */
  onError?: (message: string) => void;
}

/**
 * useBarcodeScanner
 *
 * Captures keystrokes emitted by a USB/Bluetooth hardware barcode scanner.
 * Scanners behave like a keyboard that types the barcode string and then
 * presses Enter very rapidly (< 50 ms between chars). This hook:
 *
 *  1. Buffers every printable character typed globally.
 *  2. Treats Enter as "end of barcode" and fires a lookup.
 *  3. Ignores keystrokes that land inside <input> or <textarea> elements
 *     so it doesn't interfere with the search box or any other text field.
 *  4. Auto-clears the buffer after 100 ms of silence (prevents stale garbage
 *     from manual typing leaking into a future scan).
 *
 * Only active on web/Electron (Platform.OS === 'web'). On native (Android /
 * iOS), wiring a scanner typically requires an SDK; this hook is a no-op there
 * so native code paths are unaffected.
 */
export function useBarcodeScanner({
  onSuccess,
  onError,
}: UseBarcodeScannerOptions = {}) {
  const bufferRef = useRef('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Fire the HTTP lookup for a finalized barcode string */
  const lookup = useCallback(
    async (code: string) => {
      if (!code || code.length < 3) return;

      const token = useAuthStore.getState().token;

      try {
        const res = await fetch(
          `${API_URL}/api/menu/barcode/${encodeURIComponent(code)}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          },
        );

        if (res.status === 404) {
          onError?.(`Barcode "${code}" not found in menu`);
          return;
        }

        if (res.status === 409) {
          // Sold-out
          const data = await res.json().catch(() => ({}));
          onError?.(`"${data?.dish?.Name || 'Item'}" is sold out`);
          return;
        }

        if (!res.ok) {
          onError?.('Scanner error — please try again');
          return;
        }

        const data = await res.json();
        if (data?.success && data?.dish) {
          onSuccess?.(data.dish);
        } else {
          onError?.('Unexpected response from server');
        }
      } catch (_err) {
        onError?.('Network error during scan — check connection');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onSuccess, onError],
  );

  /** Web keyboard listener — wired only when Platform.OS === 'web' */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when the user is actively typing in a form field
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'Enter') {
        // End of barcode stream
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        if (code.length >= 3) {
          lookup(code);
        }
        return;
      }

      // Only buffer printable single characters (scanner output)
      if (e.key.length === 1) {
        bufferRef.current += e.key;

        // Reset the idle-clear timer on every new character
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          // If Enter never came within 100 ms of the last char, discard
          bufferRef.current = '';
          timerRef.current = null;
        }, 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lookup]);

  return { lookup };
}
