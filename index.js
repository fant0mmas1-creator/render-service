import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(express.json());

// Multer: nhận audio binary từ n8n
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB / chunk
  },
});

// ---------- Utils ----------
function jobDir(jobId) {
  return path.join("/tmp", jobId);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function listAudioIndexes(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".mp3"))
    .map((f) => Number(f.replace(".mp3", "")))
    .sort((a, b) => a - b);
}

// ---------- Health ----------
app.get("/", (req, res) => {
  res.json({ status: "ok" });
});

// ---------- Upload audio chunk ----------
app.post("/collector/audio", upload.single("audio"), (req, res) => {
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

    const dir = jobDir(job_id);
    ensureDir(dir);

    const filePath = path.join(dir, `${index}.mp3`);
    fs.writeFileSync(filePath, req.file.buffer);

    console.log(
      `AUDIO STORED | job=${job_id} | index=${index} | size=${req.file.buffer.length}`
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

// ---------- Finalize job ----------
app.post("/collector/finalize", (req, res) => {
  try {
    const { job_id } = req.body;

    if (!job_id) {
      return res.status(400).json({
        status: "error",
        message: "missing job_id",
      });
    }

    const dir = jobDir(job_id);
    if (!fs.existsSync(dir)) {
      return res.status(404).json({
        status: "error",
        message: "job not found",
      });
    }

    const indexes = listAudioIndexes(dir);
    if (indexes.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "no audio chunks found",
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

// ---------- Render prepare ----------
app.post("/render/prepare", (req, res) => {
  try {
    const { job_id } = req.body;

    if (!job_id) {
      return res.status(400).json({
        status: "error",
        message: "missing job_id",
      });
    }

    const dir = jobDir(job_id);
    if (!fs.existsSync(dir)) {
      return res.status(404).json({
        status: "error",
        message: "job not found",
      });
    }

    const indexes = listAudioIndexes(dir);
    if (indexes.length === 0) {
      return res.status(400).json({
        status: "error",
        message: "no audio to render",
      });
    }

    console.log(
      `RENDER PREPARE | job=${job_id} | indexes=${indexes.join(",")}`
    );

    res.json({
      status: "ok",
      job_id,
      audio_indexes: indexes,
      audio_dir: dir,
    });
  } catch (err) {
    console.error("RENDER PREPARE ERROR:", err);
    res.status(500).json({
      status: "error",
      message: "internal error",
    });
  }
});

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
