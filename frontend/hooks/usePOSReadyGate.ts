import { useEffect, useRef, useState } from "react";
import { socket } from "../constants/socket";
import { useCompanySettingsStore } from "../stores/companySettingsStore";
import { usePaymentSettingsStore } from "../stores/paymentSettingsStore";

/**
 * usePOSReadyGate
 *
 * Returns true only when the POS has finished initialisation and it is safe to
 * show the customer-facing display. This prevents the secondary screen from
 * appearing with blank/stale data immediately after a boot or cold start.
 *
 * Resolution conditions (ALL must be true):
 *   1. Fonts are loaded (passed in from RootLayout via the fontsLoaded param)
 *   2. companySettings have been fetched (companyLoading is false)
 *   3. paymentSettings are not currently loading
 *   4. Socket is connected  —OR—  5 seconds have elapsed since mount
 *      (graceful timeout so a slow backend never blocks the display)
 *
 * Additionally:
 *   5. Absolute 10-second timeout: if fonts load but settings are still
 *      pending after 10s (e.g. slow network on first boot), the gate opens
 *      anyway so the display doesn't stay blank indefinitely.
 *
 * Once the gate opens it never closes; the display stays mounted for the
 * lifetime of the app and the CustomerDisplayManager handles hot-reconnect.
 */
export function usePOSReadyGate(fontsLoaded: boolean): boolean {
  const [isPOSReady, setIsPOSReady] = useState(false);
  const [socketReady, setSocketReady] = useState(socket.connected);
  const absoluteTimeoutFired = useRef(false);
  const readyRef = useRef(false);

  type CompanyState = ReturnType<typeof useCompanySettingsStore.getState>;
  type PaymentState = ReturnType<typeof usePaymentSettingsStore.getState>;

  const companyName = useCompanySettingsStore((s: CompanyState) => s.settings?.name ?? "");
  const companyLoading = useCompanySettingsStore((s: CompanyState) => s.loading);
  const paymentLoading = usePaymentSettingsStore((s: PaymentState) => s.loading);

  const fontsLoadedRef = useRef(fontsLoaded);
  const companyLoadingRef = useRef(companyLoading);
  const paymentLoadingRef = useRef(paymentLoading);

  // Sync refs with latest state/props to avoid stale closure in setTimeout
  useEffect(() => {
    readyRef.current = isPOSReady;
  }, [isPOSReady]);

  useEffect(() => {
    fontsLoadedRef.current = fontsLoaded;
  }, [fontsLoaded]);

  useEffect(() => {
    companyLoadingRef.current = companyLoading;
  }, [companyLoading]);

  useEffect(() => {
    paymentLoadingRef.current = paymentLoading;
  }, [paymentLoading]);

  // ── Socket readiness: connected or 5 s timeout ──
  useEffect(() => {
    if (socket.connected) {
      setSocketReady(true);
      return;
    }

    const handleConnect = () => setSocketReady(true);
    socket.on("connect", handleConnect);

    // Graceful fallback: if the backend is still waking up on boot,
    // don't block the customer display indefinitely.
    const timeout = setTimeout(() => {
      console.log(
        "⏱️ [POSReadyGate] Socket timeout reached — proceeding without socket connection."
      );
      setSocketReady(true);
    }, 5000);

    return () => {
      socket.off("connect", handleConnect);
      clearTimeout(timeout);
    };
  }, []);

  // ── Absolute 10-second fallback: open gate even if settings are slow ──
  useEffect(() => {
    const absoluteTimeout = setTimeout(() => {
      if (!readyRef.current && !absoluteTimeoutFired.current) {
        absoluteTimeoutFired.current = true;
        console.warn(
          "⏱️ [POSReadyGate] Absolute 10s timeout reached — opening gate regardless of settings state. " +
            `(fontsLoaded=${fontsLoadedRef.current}, companyLoading=${companyLoadingRef.current}, paymentLoading=${paymentLoadingRef.current})`
        );
        setIsPOSReady(true);
      }
    }, 10000);

    return () => clearTimeout(absoluteTimeout);
  }, []);

  // ── Resolve the gate when all conditions are met ──
  useEffect(() => {
    if (isPOSReady) return; // Already open, never re-close

    const settingsReady = !companyLoading && !paymentLoading;

    if (fontsLoaded && socketReady && settingsReady) {
      console.log(
        "✅ [POSReadyGate] All conditions met — customer display enabled.",
        { fontsLoaded, socketReady, companyName, settingsReady }
      );
      setIsPOSReady(true);
    }
  }, [fontsLoaded, socketReady, companyLoading, paymentLoading, companyName, isPOSReady]);

  return isPOSReady;
}
