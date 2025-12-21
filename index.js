import express from "express";
import multer from "multer";

const app = express();
app.use(express.json({ limit: "50mb" }));

const upload = multer({ storage: multer.memoryStorage() });

/**
 * In-memory job store (PREP-ONLY)
 * key: job_id
 * value: { audios: Map<index, Buffer>, finalized: boolean }
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
 * COLLECTOR AUDIO (A3)
 * ============================
 * - Nhận job_id, index
 * - Lưu audio vào memory (theo index)
 */
app.post("/collector/audio", upload.any(), async (req, res) => {
  try {
    const { job_id, index } = req.body || {};
    if (!job_id || index === undefined) {
      return res.status(400).json({ status: "error", message: "job_id and index are required" });
    }
    if (!req.files?.length) {
      return res.status(400).json({ status: "error", message: "audio file is required" });
    }

    const audioFile = req.files.find(f => f.fieldname === "audio");
    if (!audioFile) {
      return res.status(400).json({ status: "error", message: "audio field missing" });
    }

    // Init job if not exists
    if (!JOBS.has(job_id)) {
      JOBS.set(job_id, { audios: new Map(), finalized: false });
    }

    const job = JOBS.get(job_id);
    job.audios.set(Number(index), audioFile.buffer);

    console.log(`A3: stored audio | job=${job_id} | index=${index} | size=${audioFile.size}`);

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
 * - Đánh dấu job đã sẵn sàng render
 */
app.post("/collector/finalize", async (req, res) => {
  try {
    const { job_id } = req.body || {};
    if (!job_id) {
      return res.status(400).json({ status: "error", message: "job_id is required" });
    }
    if (!JOBS.has(job_id)) {
      return res.status(404).json({ status: "error", message: "job not found" });
    }

    const job = JOBS.get(job_id);
    job.finalized = true;

    console.log(`A4: finalized job=${job_id} | audio_count=${job.audios.size}`);

    return res.json({
      status: "ok",
      step: "A4",
      job_id,
      audio_count: job.audios.size,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

/**
 * ============================
 * RENDER PREP (A5)
 * ============================
 * - Kiểm tra job đã finalized
 * - Kiểm tra audio đủ index liên tục
 * - CHƯA FFmpeg
 */
app.post("/render/prepare", async (req, res) => {
  try {
    const { job_id } = req.body || {};
    if (!job_id) {
      return res.status(400).json({ status: "error", message: "job_id is required" });
    }
    if (!JOBS.has(job_id)) {
      return res.status(404).json({ status: "error", message: "job not found" });
    }

    const job = JOBS.get(job_id);
    if (!job.finalized) {
      return res.status(409).json({ status: "error", message: "job not finalized yet" });
    }

    const indices = Array.from(job.audios.keys()).sort((a,b)=>a-b);
    const isContinuous = indices.every((v,i)=> i===0 || v===indices[i-1]+1);

    console.log(`A5: prepare job=${job_id} | indices=${indices.join(",")} | continuous=${isContinuous}`);

    return res.json({
      status: "ok",
      step: "A5",
      job_id,
      audio_indices: indices,
      continuous: isContinuous,
      message: "render prep ok (no ffmpeg yet)",
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
