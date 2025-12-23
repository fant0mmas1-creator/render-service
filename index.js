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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB / chunk
  },
});

/* =========================
   R2 (S3-compatible) Client
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

  if (!res.Contents || res.Contents.length === 0) return [];

  return res.Contents
    .map((obj) => {
      const name = obj.Key.split("/").pop();
      return Number(name.replace(".mp3", ""));
    })
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
   Upload audio chunk
   POST /collector/audio
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

    if (!req.file || !req.file.buffer) {
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

    console.log(
      `AUDIO STORED (R2) | job=${job_id} | index=${index} | size=${req.file.buffer.length}`
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
   Finalize job
   POST /collector/finalize
========================= */
app.post("/collector/finalize", async (req, res) => {
  try {
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

    console.log(
      `JOB FINALIZED | job=${job_id} | chunks=${indexes.length}`
    );

    res.json({
      status: "ok",
      job_id,
      chunks: indexes.length,
    });
  } catch (err) {
    console.error("FINALIZE ERROR:", err);
    res.status(500).json({
      status: "error",
      message: "internal error",
    });
  }
});

/* =========================
   Render prepare
   POST /render/prepare
========================= */
app.post("/render/prepare", async (req, res) => {
  try {
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
  } catch (err) {
    console.error("RENDER PREPARE ERROR:", err);
    res.status(500).json({
      status: "error",
      message: "internal error",
    });
  }
});

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
