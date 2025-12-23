import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
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

async function downloadObject(key, outPath) {
  const res = await r2.send(
    new GetObjectCommand({ Bucket: BUCKET, Key: key })
  );
  const stream = res.Body;
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(outPath);
    stream.pipe(w);
    w.on("finish", resolve);
    w.on("error", reject);
  });
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
   Render video (AUDIO-ONLY)
========================= */
app.post("/render/video", async (req, res) => {
  const { job_id } = req.body;
  if (!job_id)
    return res.status(400).json({ status: "error", message: "missing job_id" });

  const indexes = await listAudioIndexes(job_id);
  if (indexes.length === 0)
    return res.status(404).json({ status: "error", message: "job not found" });

  const workDir = `/tmp/${job_id}`;
  fs.mkdirSync(workDir, { recursive: true });

  // download audio
  for (const i of indexes) {
    await downloadObject(audioKey(job_id, i), `${workDir}/${i}.mp3`);
  }

  // concat audio
  const listFile = `${workDir}/list.txt`;
  fs.writeFileSync(
    listFile,
    indexes.map((i) => `file '${i}.mp3'`).join("\n")
  );

  const audioOut = `${workDir}/final.mp3`;
  execSync(`ffmpeg -y -f concat -safe 0 -i ${listFile} -c copy ${audioOut}`);

  // create static video
  const videoOut = `${workDir}/final.mp4`;
  execSync(
    `ffmpeg -y -loop 1 -i /usr/share/ffmpeg/black.png -i ${audioOut} -c:v libx264 -c:a copy -shortest ${videoOut}`
  );

  // duration
  const duration = Number(
    execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${videoOut}`
    ).toString()
  );

  // 🔥 UPLOAD VIDEO
  await r2.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: videoKey(job_id),
      Body: fs.readFileSync(videoOut),
      ContentType: "video/mp4",
    })
  );

  res.json({
    status: "ok",
    job_id,
    video_key: videoKey(job_id),
    duration_sec: Number(duration.toFixed(2)),
  });
});

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
