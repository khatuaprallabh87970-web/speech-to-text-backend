// server/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

// --- Ensure uploads directory exists (permanent fix) ---
const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("Created uploads directory at:", uploadDir);
}

// CORS (restrict to your Vite origin in dev)
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  })
);

// --- Multer: keep the original filename so extension is preserved ---
// Use the absolute uploadDir we created above
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const original = file.originalname || "audio.webm";
    const safe = original.replace(/[^\w.\-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/health", (_req, res) => res.send("ok"));

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  const cleanup = () => {
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error("Failed to delete temp file:", err);
      });
    }
  };

  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // IMPORTANT: pass a path that includes an extension
    const result = await openai.audio.transcriptions.create({
      file: fs.createReadStream(req.file.path),
      model: "whisper-1",
      // You can set: language: "en"
    });

    cleanup();
    return res.json({ text: result.text ?? "" });
  } catch (err) {
    console.error("Transcribe error:", err);

    const status = err?.status || err?.statusCode || 500;
    if (status === 429) {
      cleanup();
      return res.status(429).json({
        error:
          "OpenAI quota exceeded or billing not enabled. Check your account limits.",
      });
    }
    if (status === 401) {
      cleanup();
      return res
        .status(401)
        .json({ error: "Invalid or missing OPENAI_API_KEY." });
    }
    if (status === 400) {
      cleanup();
      return res.status(400).json({
        error:
          "Unrecognized/unsupported audio format. Try mp3, m4a, wav, webm, ogg, or flac.",
      });
    }

    cleanup();
    return res
      .status(502)
      .json({ error: "Upstream error calling OpenAI.", details: err?.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
