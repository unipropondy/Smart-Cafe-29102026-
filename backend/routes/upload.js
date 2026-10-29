const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Ensure uploads directory exists (using project root for Railway/Docker compatibility)
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  console.log("📁 Creating uploads directory at:", uploadDir);
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, "qr-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp|gif/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype || extname) {
      return cb(null, true);
    }
    cb(new Error("Only images (jpeg, jpg, png, webp, gif) are allowed!"));
  },
});

// 🔹 POST Upload
router.post("/", (req, res) => {
  upload.single("image")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      console.error("❌ Multer Error:", err.message);
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      console.error("❌ Unknown Upload Error:", err);
      return res.status(500).json({ error: `Server error: ${err.message}` });
    }

    if (!req.file) {
      console.error("❌ No file received in request");
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
      const imageUrl = `/uploads/${req.file.filename}`;
      console.log("✅ File uploaded successfully:", imageUrl);
      res.json({ success: true, imageUrl });
    } catch (saveErr) {
      console.error("❌ Final Save Error:", saveErr);
      res.status(500).json({ error: "Failed to process uploaded file" });
    }
  });
});

module.exports = router;
