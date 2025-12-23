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
import { spawn } from "child_process";

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

function streamToFile(readable, filePath) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(filePath);
    readable.pipe(ws);
    ws.on("finish", resolve);
    ws.on("error", reject);
  });
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr));
    });
  });
}

async function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", (code) => {
      if (code === 0) resolve(Number(out.trim()));
      else reject(new Error("ffprobe failed"));
    });
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
   Finalize audio
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
   Render video (AUDIO CONCAT ONLY)
========================= */
app.post("/render/video", async (req, res) => {
  const { job_id, audio_keys, preset } = req.body;

  if (!job_id || !Array.isArray(audio_keys) || audio_keys.length === 0) {
    return res.status(400).json({ status: "error", job_id, message: "invalid_input" });
  }
  if (preset !== "static-image") {
    return res.status(400).json({ status: "error", job_id, message: "unsupported_preset" });
  }

  const workDir = path.join("/tmp", `render-${job_id}`);
  fs.mkdirSync(workDir, { recursive: true });

  try {
    // 1) Fetch audio chunks
    const localFiles = [];
    for (let i = 0; i < audio_keys.length; i++) {
      const key = audio_keys[i];
      const local = path.join(workDir, `${i}.mp3`);
      const obj = await r2.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: key })
      );
      await streamToFile(obj.Body, local);
      localFiles.push(local);
    }

    // 2) Create concat list
    const listFile = path.join(workDir, "list.txt");
    fs.writeFileSync(
      listFile,
      localFiles.map((f) => `file '${f}'`).join("\n")
    );

    // 3) Concat audio
    const finalAudio = path.join(workDir, "final_audio.mp3");
    await run("ffmpeg", [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c",
      "copy",
      finalAudio,
    ]);

    // 4) Probe duration
    const duration = await probeDuration(finalAudio);

    // 5) Return (video chưa render)
    return res.json({
      status: "ok",
      job_id,
      video_key: `video/${job_id}/final.mp4`,
      duration_sec: Number(duration.toFixed(2)),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "error",
      job_id,
      message: "audio_concat_failed",
    });
  } finally {
    // cleanup
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

/* =========================
   Start server
========================= */
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
