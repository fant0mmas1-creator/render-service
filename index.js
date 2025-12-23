import express from "express";
import multer from "multer";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   Middleware
========================= */
app.use(express.json());

// 🔥 CORS — BẮT BUỘC
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

/* =========================
   R2 Client
========================= */
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET;

/* =========================
   Helpers
========================= */
function audioKey(jobId, index) {
  return `audio/${jobId}/${index}.mp3`;
}

async function listAudioIndexes(jobId) {
  const res = await r2.send(
    new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: `audio/${jobId}/`,
    })
  );

  if (!res.Contents) return [];

  return res.Contents
    .map((o) => Number(o.Key.split("/").pop().replace(".mp3", "")))
    .filter((n) => !Number.isNaN(n))
    .sort((a, b) => a - b);
}

/* =========================
   Health
========================= */
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

/* =========================
   Upload audio
========================= */
app.post("/collector/audio", upload.single("audio"), async (req, res) => {
  try {
    const { job_id, index } = req.body;

    if (!job_id || index === undefined) {
      return res.status(400).json({
        status: "error",
        message: "missing job_id or index",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        status: "error",
        message: "audio file missing",
      });
    }

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: audioKey(job_id, index),
        Body: req.file.buffer,
        ContentType: "audio/mpeg",
      })
    );

    res.json({
      status: "ok",
      job_id,
      index,
    });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({
      status: "error",
      message: "internal error",
    });
  }
});

/* =========================
   Finalize audio
========================= */
app.post("/collector/finalize", async (req, res) => {
  const { job_id } = req.body;

  if (!job_id) {
    return res.status(400).json({
      status: "error",
      message: "missing job_id",
    });
  }

  const indexes = await listAudioIndexes(job_id);

  if (indexes.length === 0) {
    return res.status(404).json({
      status: "error",
      message: "job not found",
    });
  }

  res.json({
    status: "ok",
    job_id,
    chunks: indexes.length,
  });
});

/* =========================
   Render prepare
========================= */
app.post("/render/prepare", async (req, res) => {
  const { job_id } = req.body;

  if (!job_id) {
    return res.status(400).json({
      status: "error",
      message: "missing job_id",
    });
  }

  const indexes = await listAudioIndexes(job_id);

  if (indexes.length === 0) {
    return res.status(404).json({
      status: "error",
      message: "job not found",
    });
  }

  res.json({
    status: "ok",
    job_id,
    audio_indexes: indexes,
    audio_keys: indexes.map((i) => audioKey(job_id, i)),
  });
});

/* =========================
   Render video (SKELETON)
========================= */
app.post("/render/video", async (req, res) => {
  const { job_id, audio_keys, audio_indexes, preset } = req.body;

  if (!job_id || !Array.isArray(audio_keys) || audio_keys.length === 0) {
    return res.status(400).json({
      status: "error",
      job_id,
      message: "invalid_input",
    });
  }

  if (preset !== "static-image") {
    return res.status(400).json({
      status: "error",
      job_id,
      message: "unsupported_preset",
    });
  }

  // 🚧 Skeleton: chưa render thật (B2.2 sẽ xử lý)
  return res.json({
    status: "ok",
    job_id,
    video_key: `video/${job_id}/final.mp4`,
    duration_sec: 0,
  });
});

/* =========================
   Start server
========================= */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
