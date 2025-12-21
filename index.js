import express from "express";
import multer from "multer";

const app = express();

/**
 * NOTE:
 * - Giữ express.json để không phá các request JSON khác
 * - Multer sẽ xử lý multipart/form-data riêng
 */
app.use(express.json({ limit: "50mb" }));

/**
 * Multer config: dùng memoryStorage
 * (chưa ghi file ra disk ở bước này)
 */
const upload = multer({
  storage: multer.memoryStorage(),
});

app.get("/", (req, res) => {
  res.send("Render service is running");
});

/**
 * Render endpoint
 * - CHỈ nhận request
 * - CHỈ log body + files
 * - CHƯA parse timeline
 * - CHƯA render video
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

    // Tạm thời chỉ xác nhận OK
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Render service listening on port", PORT);
});
