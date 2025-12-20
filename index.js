import express from "express";

const app = express();
app.use(express.json({ limit: "50mb" }));

app.get("/", (req, res) => {
  res.send("Render service is running");
});

app.post("/render", async (req, res) => {
  try {
    const { audio_count, providers } = req.body;

    console.log("Render request received");
    console.log("Audio count:", audio_count);
    console.log("Providers:", providers);

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
