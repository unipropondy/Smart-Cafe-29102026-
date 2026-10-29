async function testPut() {
  try {
    const res = await fetch("http://localhost:3000/api/tables/update-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tableId: "9234c3ca-8491-4792-9562-9b5b9318c9c2",
        seats: 4,
        tableType: "Rectangular",
        xSize: 100,
        ySize: 80,
      }),
    });
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch (err) {
    console.error("Test request failed:", err);
  }
}

testPut();
