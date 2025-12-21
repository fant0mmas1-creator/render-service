import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "50mb" }));

const upload = multer({ storage: multer.memoryStorage() });

/**
 * ============================
 * FILESYSTEM JOB STORE (/tmp)
 * ============================
 */
const JOB_DIR = "/tmp/jobs";

function ensureJobDir() {
  if (!fs.existsSync(JOB_DIR)) {
    fs.mkdirSync(JOB_DIR, { recursive: true });
  }
}

function jobFilePath(job_id) {
  return path.join(JOB_DIR, `${job_id}.json`);
}

function loadJob(job_id) {
  const p = jobFilePath(job_id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function saveJob(job_id, job) {
  ensureJobDir();
  fs.writeFileSync(jobFilePath(job_id), JSON.stringify(job, null, 2));
}

/**
 * ============================
 * HEALTH
 * ============================
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

    let job = loadJob(job_id);
    if (!job) {
      job = {
        job_id,
        finalized: false,
        audios: {},
      };
    }

    job.audios[String(index)] = audioFile.buffer.toString("base64");
    saveJob(job_id, job);

    console.log(`A3 store audio | job=${job_id} | index=${index}`);

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

    const job = loadJob(job_id);
    if (!job) {
      return res.status(404).json({
        status: "error",
        message: "job not found",
      });
    }

    job.finalized = true;
    saveJob(job_id, job);

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

    const job = loadJob(job_id);
    if (!job) {
      return res.status(404).json({
        status: "error",
        message: "job not found",
      });
    }

    if (!job.finalized) {
      return res.status(409).json({
        status: "error",
        message: "job not finalized yet",
      });
    }

    const indices = Object.keys(job.audios)
      .map((n) => Number(n))
      .sort((a, b) => a - b);

    const continuous = indices.every(
      (v, i) => i === 0 || v === indices[i - 1] + 1
    );

    console.log(
      `A5 prepare | job=${job_id} | indices=${indices.join(",")} | continuous=${continuous}`
    );

    return res.json({
      status: "ok",
      step: "A5",
      job_id,
      audio_indices: indices,
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
