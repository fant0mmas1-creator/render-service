import express from "express";
import multer from "multer";

const app = express();
app.use(express.json({ limit: "50mb" }));

const upload = multer({ storage: multer.memoryStorage() });

/**
 * In-memory job store
 * job_id -> { audios: Map<index, Buffer>, finalized: boolean }
 */
const JOBS = new Map();

/**
 * Health
 */
app.get("/", (req, res) => {
  res.send("Render service is running");
});

/**
 * ============================
 * COLLECTOR AUDIO
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

    if (!JOBS.has(job_id)) {
      JOBS.set(job_id, { audios: new Map(), finalized: false });
    }

    const job = JOBS.get(job_id);
    job.audios.set(Number(index), audioFile.buffer);

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
 * COLLECTOR FINALIZE
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

    if (!JOBS.has(job_id)) {
      return res.status(404).json({
        status: "error",
        message: "job not found",
      });
    }

    JOBS.get(job_id).finalized = true;

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

    if (!JOBS.has(job_id)) {
      return res.status(404).json({
        status: "error",
        message: "job not found",
      });
    }

    const job = JOBS.get(job_id);

    if (!job.finalized) {
      return res.status(409).json({
        status: "error",
        message: "job not finalized yet",
      });
    }

    const indices = Array.from(job.audios.keys()).sort((a, b) => a - b);
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
