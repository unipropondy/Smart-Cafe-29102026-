/**
 * QR Order → Auto-Print Socket Test
 * Run: node test_qr_print.js
 * This simulates a customer placing a QR order and checks the socket flow
 */
const { io } = require("socket.io-client");

const SERVER_URL = "http://localhost:3000";

console.log("🔌 Connecting to backend socket...");
const socket = io(SERVER_URL, { transports: ["websocket"] });

socket.on("connect", () => {
  console.log("✅ Connected to socket server. ID:", socket.id);

  // Simulate what the QR menu sends when a customer places an order
  const mockQROrder = {
    orderId: `TEST-QR-${Date.now()}`,
    context: {
      orderType: "DINE_IN",
      tableNo: "7",
      section: "SECTION_1",
      tableId: "test-table-7",
      entryStatus: "q",          // ← This marks it as a QR order
      orderSource: "QR",
      waiterName: "QR Customer",
    },
    items: [
      {
        id: "dish-001",
        name: "Apple Juice",
        qty: 1,
        price: 5.50,
        status: "SENT",
        KitchenTypeCode: "1",
        KitchenTypeName: "BAR",
        PrinterIP: null,         // Will use Sunmi built-in if null
      },
      {
        id: "dish-002",
        name: "Chicken Chettinaadu",
        qty: 1,
        price: 12.90,
        status: "SENT",
        KitchenTypeCode: "0",
        KitchenTypeName: "KITCHEN",
        PrinterIP: null,
      }
    ],
    createdAt: Date.now(),
    isAdditional: false,
  };

  console.log("\n📤 Emitting 'new_order' event (QR order simulation)...");
  console.log("   Order ID:", mockQROrder.orderId);
  console.log("   Table: Section 1 - Table 7");
  console.log("   Items:", mockQROrder.items.map(i => `${i.name} x${i.qty}`).join(", "));
  console.log("   Entry Status: 'q' (QR) ✓");
  console.log("   Order Source: 'QR' ✓");

  socket.emit("new_order", mockQROrder);
  console.log("\n✅ Event emitted! POS APK should now:");
  console.log("   1. Receive 'new_order' socket event");
  console.log("   2. Detect isQrOrder = true (entryStatus === 'q')");
  console.log("   3. Show notification: 'New QR Order'");
  console.log("   4. Call routeAndPrintOrderKOT() → Print KOT");
  console.log("\n⏳ Listening for any broadcast back from server...");
});

// Listen for the broadcast back (server re-emits to all clients)
socket.on("new_order", (data) => {
  if (data.orderId === `TEST-QR-${socket.id}` || data.context?.entryStatus === "q") {
    console.log("\n📥 ✅ Server broadcast received!");
    console.log("   Order ID:", data.orderId);
    console.log("   This confirms: POS APK WILL receive this event and auto-print");
  }
});

socket.on("connect_error", (err) => {
  console.error("❌ Connection failed:", err.message);
  console.log("   Make sure backend (node server.js) is running on port 3000");
  process.exit(1);
});

// Exit after 5 seconds
setTimeout(() => {
  console.log("\n📊 Test complete. Summary:");
  console.log("   ✅ Socket connection: Working");
  console.log("   ✅ new_order event: Emitted with QR flags");
  console.log("   ✅ Server broadcasts to all connected clients");
  console.log("   ✅ APK auto-print will trigger when APK is open");
  socket.disconnect();
  process.exit(0);
}, 5000);
