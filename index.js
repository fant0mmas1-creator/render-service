import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "50mb" }));

const upload = multer({ storage: multer.memoryStorage() });

const JOB_ROOT = "/tmp/jobs";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function jobDir(job_id) {
  return path.join(JOB_ROOT, String(job_id));
}

function metaPath(job_id) {
  return path.join(jobDir(job_id), "meta.json");
}

/**
 * Health
 */
app.get("/", (req, res) => {
  res.send("Render service is running");
});

/**
 * ============================
 * COLLECTOR AUDIO (A3)
 * ============================
 */
app.post("/collector/audio", upload.any(), async (req, res) => {
  try {
    const { job_id, index } = req.body || {};

    if (!job_id || index === undefined) {
      return res.status(400).json({
        status: "error",
        message: "job_id and index are required",
      });
    }

    if (!req.files?.length) {
      return res.status(400).json({
        status: "error",
        message: "audio file is required",
      });
    }

    const audioFile = req.files.find((f) => f.fieldname === "audio");
    if (!audioFile) {
      return res.status(400).json({
        status: "error",
        message: "audio field missing",
      });
    }

    ensureDir(JOB_ROOT);
    ensureDir(jobDir(job_id));

    // save audio
    const audioFilePath = path.join(
      jobDir(job_id),
      `audio_${index}.mp3`
    );
    fs.writeFileSync(audioFilePath, audioFile.buffer);

    // init meta if not exists
    if (!fs.existsSync(metaPath(job_id))) {
      fs.writeFileSync(
        metaPath(job_id),
        JSON.stringify({ finalized: false }, null, 2)
      );
    }

    console.log(`A3 file store | job=${job_id} | index=${index}`);

    return res.json({
      status: "ok",
      step: "A3",
      job_id,
      index: Number(index),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

/**
 * ============================
 * COLLECTOR FINALIZE (A4)
 * ============================
 */
app.post("/collector/finalize", async (req, res) => {
  try {
    const { job_id } = req.body || {};

    if (!job_id) {
      return res.status(400).json({
        status: "error",
        message: "job_id is required",
      });
    }

    if (!fs.existsSync(jobDir(job_id))) {
      return res.status(404).json({
        status: "error",
        message: "job not found",
      });
    }

    fs.writeFileSync(
      metaPath(job_id),
      JSON.stringify({ finalized: true }, null, 2)
    );

    console.log(`A4 finalize | job=${job_id}`);

    return res.json({
      status: "ok",
      step: "A4",
      job_id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

/**
 * ============================
 * RENDER PREPARE (A5)
 * ============================
 */
app.post("/render/prepare", async (req, res) => {
  try {
    const { job_id } = req.body || {};

    if (!job_id) {
      return res.status(400).json({
        status: "error",
        message: "job_id is required",
      });
    }

    if (!fs.existsSync(jobDir(job_id))) {
      return res.status(404).json({
        status: "error",
        message: "job not found",
      });
    }

    const meta = JSON.parse(fs.readFileSync(metaPath(job_id), "utf-8"));
    if (!meta.finalized) {
      return res.status(409).json({
        status: "error",
        message: "job not finalized yet",
      });
    }

    const files = fs
      .readdirSync(jobDir(job_id))
      .filter((f) => f.startsWith("audio_"))
      .map((f) => Number(f.replace("audio_", "").replace(".mp3", "")))
      .sort((a, b) => a - b);

    const continuous = files.every(
      (v, i) => i === 0 || v === files[i - 1] + 1
    );

    console.log(
      `A5 prepare | job=${job_id} | indices=${files.join(",")} | continuous=${continuous}`
    );

    return res.json({
      status: "ok",
      step: "A5",
      job_id,
      audio_indices: files,
      continuous,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Render service listening on port", PORT);
});
