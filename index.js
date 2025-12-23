import express from "express";
import multer from "multer";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   Middleware
========================= */
app.use(express.json());

// CORS — BẮT BUỘC cho n8n
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
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

function videoKey(jobId) {
  return `video/${jobId}/final.mp4`;
}

async function downloadAudio(jobId, index, targetPath) {
  const res = await r2.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: audioKey(jobId, index),
    })
  );

  const buffer = Buffer.from(await res.Body.transformToByteArray());
  fs.writeFileSync(targetPath, buffer);
}

/* =========================
   Health
========================= */
app.get("/", (_, res) => {
  res.json({ status: "ok" });
});

/* =========================
   Upload audio chunk
========================= */
app.post("/collector/audio", upload.single("audio"), async (req, res) => {
  try {
    const { job_id, index } = req.body;
    if (!job_id || index === undefined)
      return res.status(400).json({ status: "error", message: "missing job_id or index" });
    if (!req.file)
      return res.status(400).json({ status: "error", message: "audio file missing" });

    await r2.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: audioKey(job_id, index),
        Body: req.file.buffer,
        ContentType: "audio/mpeg",
      })
    );

    res.json({ status: "ok", job_id, index });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: "internal error" });
  }
});

/* =========================
   Render Video (AUDIO + STATIC IMAGE)
========================= */
app.post("/render/video", async (req, res) => {
  const { job_id, audio_keys, preset } = req.body;

  if (!job_id)
    return res.status(400).json({ status: "error", message: "missing job_id" });

  if (!audio_keys || !Array.isArray(audio_keys) || audio_keys.length === 0)
    return res.status(400).json({ status: "error", message: "missing audio_keys" });

  const workDir = `/tmp/${job_id}`;
  fs.mkdirSync(workDir, { recursive: true });

  // 1️⃣ Download audio chunks
  for (let i = 0; i < audio_keys.length; i++) {
    await downloadAudio(job_id, i, `${workDir}/${i}.mp3`);
  }

  // 2️⃣ Create concat list
  const listFile = `${workDir}/list.txt`;
  fs.writeFileSync(
    listFile,
    audio_keys.map((_, i) => `file '${workDir}/${i}.mp3'`).join("\n")
  );

  // 3️⃣ Concat audio
  execSync(
    `ffmpeg -y -f concat -safe 0 -i ${listFile} -c copy ${workDir}/final.mp3`
  );

  // 4️⃣ Create video using COLOR FILTER (🔥 FIX CHÍNH)
  execSync(
    `ffmpeg -y \
      -f lavfi -i color=c=black:s=1080x1920:r=30 \
      -i ${workDir}/final.mp3 \
      -c:v libx264 -pix_fmt yuv420p \
      -c:a copy -shortest ${workDir}/final.mp4`
  );

  // 5️⃣ Upload video to R2
  const videoBuffer = fs.readFileSync(`${workDir}/final.mp4`);
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: videoKey(job_id),
      Body: videoBuffer,
      ContentType: "video/mp4",
    })
  );

  // 6️⃣ Get duration
  const duration = execSync(
    `ffprobe -i ${workDir}/final.mp4 -show_entries format=duration -v quiet -of csv="p=0"`
  )
    .toString()
    .trim();

  res.json({
    status: "ok",
    job_id,
    video_key: videoKey(job_id),
    duration_sec: Number(duration),
  });
});

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
