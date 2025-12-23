import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

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
function audioPrefix(jobId) {
  return `audio/${jobId}/`;
}

function videoKey(jobId) {
  return `video/${jobId}/final.mp4`;
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
        Key: `${audioPrefix(job_id)}${index}.mp3`,
        Body: req.file.buffer,
        ContentType: "audio/mpeg",
      })
    );

    res.json({ status: "ok", job_id, index });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ status: "error", message: "internal error" });
  }
});

/* =========================
   Render Video (C1.2 — STABLE)
========================= */
app.post("/render/video", async (req, res) => {
  try {
    const { job_id } = req.body;
    if (!job_id)
      return res.status(400).json({ status: "error", message: "missing job_id" });

    const workDir = `/tmp/${job_id}`;
    fs.mkdirSync(workDir, { recursive: true });

    /* 1️⃣ LIST AUDIO FROM R2 */
    const list = await r2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: audioPrefix(job_id),
      })
    );

    if (!list.Contents || list.Contents.length === 0)
      return res.status(404).json({ status: "error", message: "no audio found" });

    const audioKeys = list.Contents
      .map((o) => o.Key)
      .filter((k) => k.endsWith(".mp3"))
      .sort((a, b) => {
        const ai = Number(a.split("/").pop().replace(".mp3", ""));
        const bi = Number(b.split("/").pop().replace(".mp3", ""));
        return ai - bi;
      });

    /* 2️⃣ DOWNLOAD AUDIO */
    for (let i = 0; i < audioKeys.length; i++) {
      const obj = await r2.send(
        new GetObjectCommand({
          Bucket: BUCKET,
          Key: audioKeys[i],
        })
      );
      const buffer = Buffer.from(await obj.Body.transformToByteArray());
      fs.writeFileSync(path.join(workDir, `${i}.mp3`), buffer);
    }

    /* 3️⃣ CONCAT AUDIO */
    const listFile = path.join(workDir, "list.txt");
    fs.writeFileSync(
      listFile,
      audioKeys.map((_, i) => `file '${i}.mp3'`).join("\n")
    );

    execSync(
      `ffmpeg -y -f concat -safe 0 -i ${listFile} -c copy ${workDir}/final.mp3`
    );

    /* 4️⃣ GET DURATION */
    const duration = Number(
      execSync(
        `ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 ${workDir}/final.mp3`
      )
        .toString()
        .trim()
    );

    /* 5️⃣ RENDER VIDEO (COLOR FILTER) */
    execSync(
      `ffmpeg -y -f lavfi -i color=c=black:s=1080x1920:r=30:d=${duration} \
       -i ${workDir}/final.mp3 \
       -c:v libx264 -pix_fmt yuv420p \
       -c:a copy -shortest ${workDir}/final.mp4`
    );

    /* 6️⃣ UPLOAD VIDEO */
    const videoBuffer = fs.readFileSync(path.join(workDir, "final.mp4"));
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
  } catch (err) {
    console.error("RENDER VIDEO ERROR:", err);
    res.status(500).json({ status: "error", message: "render failed" });
  }
});

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
