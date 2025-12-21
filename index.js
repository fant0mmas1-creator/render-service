import express from "express";
import multer from "multer";

const app = express();

/**
 * Giữ middleware JSON
 */
app.use(express.json({ limit: "50mb" }));

/**
 * Multer dùng memoryStorage
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
 * Audio Collector endpoint (LOG ONLY – STEP A2)
 * - Chỉ log
 * - Chưa xử lý file
 * - Chưa lưu disk
 */
app.post("/collector/audio", upload.any(), async (req, res) => {
  try {
    console.log("=== COLLECTOR AUDIO HIT ===");
    console.log("Content-Type:", req.headers["content-type"]);

    console.log("Body keys:", Object.keys(req.body || {}));

    if (req.files && req.files.length > 0) {
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

    return res.json({
      status: "ok",
      step: "A2",
      message: "collector/audio reached",
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
 * Render endpoint (giữ nguyên – chưa động tới)
 */
app.post("/render", upload.any(), async (req, res) => {
  try {
    console.log("=== RENDER REQUEST RECEIVED ===");
    console.log("Content-Type:", req.headers["content-type"]);
    console.log("Body keys:", Object.keys(req.body || {}));

    if (req.files && req.files.length > 0) {
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

    return res.json({
      status: "ok",
      message: "Render request accepted",
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
 * Start server
 */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Render service listening on port", PORT);
});
