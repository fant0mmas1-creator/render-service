import express from "express";
import multer from "multer";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   Middleware
========================= */
app.use(express.json());

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
});

/* =========================
   Finalize
========================= */
app.post("/collector/finalize", async (req, res) => {
  const { job_id } = req.body;
  if (!job_id)
    return res.status(400).json({ status: "error", message: "missing job_id" });

  const indexes = await listAudioIndexes(job_id);
  if (indexes.length === 0)
    return res.status(404).json({ status: "error", message: "job not found" });

  res.json({ status: "ok", job_id, chunks: indexes.length });
});

/* =========================
   Render prepare
========================= */
app.post("/render/prepare", async (req, res) => {
  const { job_id } = req.body;
  if (!job_id)
    return res.status(400).json({ status: "error", message: "missing job_id" });

  const indexes = await listAudioIndexes(job_id);
  if (indexes.length === 0)
    return res.status(404).json({ status: "error", message: "job not found" });

  res.json({
    status: "ok",
    job_id,
    audio_indexes: indexes,
    audio_keys: indexes.map((i) => audioKey(job_id, i)),
  });
});

/* =========================
   Render video (STATIC IMAGE = FFmpeg COLOR)
========================= */
app.post("/render/video", async (req, res) => {
  const { job_id, audio_keys } = req.body;
  if (!job_id)
    return res.status(400).json({ status: "error", message: "missing job_id" });

  const workDir = `/tmp/${job_id}`;
  fs.mkdirSync(workDir, { recursive: true });

  // Download audio chunks
  for (let i = 0; i < audio_keys.length; i++) {
    const out = await r2.send(
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: audio_keys[i],
      })
    );

    const buf = Buffer.from(await out.Body.transformToByteArray());
    fs.writeFileSync(path.join(workDir, `${i}.mp3`), buf);
  }

  // Create concat list
  const listPath = path.join(workDir, "list.txt");
  fs.writeFileSync(
    listPath,
    audio_keys.map((_, i) => `file '${i}.mp3'`).join("\n")
  );

  // Concat audio
  execSync(
    `ffmpeg -y -f concat -safe 0 -i ${listPath} -c copy ${workDir}/final.mp3`
  );

  // Get duration
  const duration = Number(
    execSync(
      `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 ${workDir}/final.mp3`
    )
      .toString()
      .trim()
  );

  // 🔥 CREATE VIDEO WITH COLOR FILTER (NO IMAGE FILE)
  execSync(
    `ffmpeg -y -f lavfi -i color=c=black:s=1080x1920:d=${duration} -i ${workDir}/final.mp3 -c:v libx264 -c:a copy -shortest ${workDir}/final.mp4`
  );

  // Upload video
  const videoBuffer = fs.readFileSync(`${workDir}/final.mp4`);
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: videoKey(job_id),
      Body: videoBuffer,
      ContentType: "video/mp4",
    })
  );

  res.json({
    status: "ok",
    job_id,
    video_key: videoKey(job_id),
    duration_sec: duration,
  });
});

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
