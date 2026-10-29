/**
 * customer-display.tsx — Route wrapper
 *
 * This is a thin route wrapper so the /customer-display screen continues to
 * work as before for staff navigation and diagnostics. All UI and business
 * logic now lives in components/CustomerDisplayContent.tsx.
 *
 * On the Sunmi D3, the actual customer-facing display is driven by
 * CustomerDisplayManager (mounted in _layout.tsx) which renders
 * CustomerDisplayContent on the secondary screen via Android's Presentation API.
 */
import CustomerDisplayContent from "../components/CustomerDisplayContent";

export default CustomerDisplayContent;
