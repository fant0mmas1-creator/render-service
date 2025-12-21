import express from "express";
import multer from "multer";

const app = express();

/**
 * Giữ JSON middleware cho các route JSON khác
 */
app.use(express.json({ limit: "50mb" }));

/**
 * Multer: memoryStorage (chỉ log, chưa lưu disk)
 */
const upload = multer({
  storage: multer.memoryStorage(),
});

/**
 * Health check
 */
app.get("/", (req, res) => {
  res.send("Render service is running");
});

/**
 * Render endpoint (giữ nguyên)
 */
app.post("/render", upload.any(), async (req, res) => {
  try {
    console.log("=== /render HIT ===");
    console.log("Content-Type:", req.headers["content-type"]);
    console.log("Body keys:", Object.keys(req.body || {}));

    if (req.files?.length) {
      console.log(
        "Files:",
        req.files.map((f) => ({
          fieldname: f.fieldname,
          size: f.size,
          mimetype: f.mimetype,
        }))
      );
    } else {
      console.log("NO FILES");
    }

    return res.json({ status: "ok", route: "/render" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ status: "error", message: err.message });
  }
});

/**
 * ============================
 * COLLECTOR AUDIO (A3 – FIX)
 * ============================
 * - NHẬN job_id, index
 * - LOG file
 * - TRẢ LẠI job_id, index
 */
app.post("/collector/audio", upload.any(), async (req, res) => {
  try {
    console.log("=== /collector/audio HIT ===");
    console.log("Content-Type:", req.headers["content-type"]);

    const { job_id, index } = req.body || {};

    console.log("Body:", req.body || {});

    if (!job_id || index === undefined) {
      return res.status(400).json({
        status: "error",
        message: "job_id and index are required",
      });
    }

    if (req.files?.length) {
      console.log(
        "Files received:",
        req.files.map((f) => ({
          fieldname: f.fieldname,
          size: f.size,
          mimetype: f.mimetype,
        }))
      );
    } else {
      console.log("NO FILES RECEIVED");
    }

    /**
     * ⚠️ QUAN TRỌNG:
     * TRẢ LẠI job_id + index
     * để n8n GIỮ ĐƯỢC DỮ LIỆU
     */
    return res.json({
      status: "ok",
      step: "A3",
      job_id,
      index: Number(index),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

/**
 * ============================
 * COLLECTOR FINALIZE (A4 – SẼ DÙNG SAU)
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

    console.log("=== /collector/finalize HIT ===");
    console.log("Job ID:", job_id);

    return res.json({
      status: "ok",
      step: "A4",
      message: "collector job finalized",
      job_id,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      status: "error",
      message: err.message,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Render service listening on port", PORT);
});
