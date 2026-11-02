const express = require("express");
const cors = require("cors");
const path = require("node:path");
const fs = require("node:fs");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const frontendDir = path.resolve(__dirname, "../Frontend/dist/public");

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));

const SIGHTENGINE_API_USER = process.env.SIGHTENGINE_API_USER;
const SIGHTENGINE_API_SECRET = process.env.SIGHTENGINE_API_SECRET;
const HIVE_API_KEY = process.env.HIVE_API_KEY;
const SIGHTENGINE_ENDPOINT = "https://api.sightengine.com/1.0/check.json";
const HIVE_ENDPOINT = "https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection";

function isValidImageBase64(value) {
  if (typeof value !== "string") return false;
  const header = /^data:image\/(?:jpeg|png|webp|gif);base64,/.exec(value);
  if (!header) return false;

  // Preserve whitespace and optional-padding support, but do not rely on
  // Buffer.from: Node silently decodes malformed base64 (including empty data).
  const encoded = value.slice(header[0].length).replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  if (encoded.includes("=")) return encoded.length % 4 === 0;
  return encoded.length % 4 !== 1;
}

app.get(["/", "/api/healthz"], (req, res) => {
  if (req.path === "/" && req.headers.accept?.includes("text/html") &&
      fs.existsSync(path.join(frontendDir, "index.html"))) {
    return res.sendFile(path.join(frontendDir, "index.html"));
  }
  res.json({
    status: "ok",
    engine: "DeepShield AI Engine Active",
    hive_ready: Boolean(HIVE_API_KEY),
    sightengine_ready: Boolean(SIGHTENGINE_API_USER && SIGHTENGINE_API_SECRET)
  });
});

app.post(["/detect", "/api/detect"], async (req, res) => {
  const { imageUrl, imageBase64 } = req.body || {};

  if (!imageUrl && !imageBase64) {
    return res.status(400).json({ error: "Provide either imageUrl or imageBase64" });
  }

  if (imageUrl !== undefined && (typeof imageUrl !== "string" || !imageUrl.trim())) {
    return res.status(400).json({ error: "imageUrl must be a nonempty string" });
  }
  if (!imageUrl && !isValidImageBase64(imageBase64)) {
    return res.status(400).json({
      error: "imageBase64 must be a JPEG, PNG, WebP or GIF base64 data URL",
    });
  }
  if (imageUrl) {
    try {
    const parsedUrl = new URL(imageUrl);
    if (!["http:", "https:"].includes(parsedUrl.protocol) ||
        parsedUrl.username || parsedUrl.password) {
      return res.status(400).json({ error: "Provide a public HTTP or HTTPS image URL without credentials" });
    }
  } catch {
    return res.status(400).json({ error: "imageUrl must be a valid URL" });
  }
  }

  // 1. PRIMARY SCANNER: HIVE AI
  if (HIVE_API_KEY) {
    try {
      const hivePayload = {
        media_metadata: true,
        input: [imageUrl
          ? { media_url: imageUrl }
          : { media_base64: imageBase64 }],
      };

      const hiveRes = await fetch(HIVE_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${HIVE_API_KEY.trim()}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(hivePayload),
        signal: AbortSignal.timeout(45000),
      });
      const hiveText = await hiveRes.text();
      let hiveData = {};
      try {
        hiveData = hiveText ? JSON.parse(hiveText) : {};
      } catch {
        throw new Error("Hive returned invalid JSON");
      }
      if (!hiveRes.ok) {
        const providerMessage = [
          hiveData?.message,
          hiveData?.error?.message,
          hiveData?.error,
        ].find((value) => typeof value === "string");
        const safeMessage = providerMessage
          ? providerMessage.split(HIVE_API_KEY.trim()).join("[redacted]").slice(0, 300)
          : "";
        throw new Error(`Hive returned HTTP ${hiveRes.status}${safeMessage ? `: ${safeMessage}` : ""}`);
      }

      const classes = hiveData?.output?.[0]?.classes;
      if (!Array.isArray(classes)) {
        throw new Error("Hive returned an unexpected detection response");
      }
      const aiClass = classes.find((cls) => cls.class === "ai_generated");
      const notAiClass = classes.find((cls) => cls.class === "not_ai_generated");
      const aiScore = aiClass?.value;
      const notAiScore = notAiClass?.value;
      if (!Number.isFinite(aiScore) || aiScore < 0 || aiScore > 1 ||
          !Number.isFinite(notAiScore) || notAiScore < 0 || notAiScore > 1) {
        throw new Error("Hive returned no valid AI-generated score");
      }
      const score = Math.round(aiScore * 100);
      const isAI = aiScore >= notAiScore;

      return res.json({
        success: true,
        score,
        label: isAI ? "AI-Generated" : "Not AI-Generated",
        provider: "Hive",
        model: "hive/ai-generated-and-deepfake-content-detection",
        confidence: isAI ? aiScore : notAiScore,
        scores: { ai_generated: aiScore, not_ai_generated: notAiScore },
        note: "Detection scores are estimates, not proof of image origin.",
      });
    } catch (err) {
      console.warn("Hive detection failed:", err.message);
    }
  }

  // 2. SECONDARY SCANNER: SIGHTENGINE FALLBACK
  if (SIGHTENGINE_API_USER && SIGHTENGINE_API_SECRET) {
    try {
      const params = new URLSearchParams({
        models: "genai",
        api_user: SIGHTENGINE_API_USER,
        api_secret: SIGHTENGINE_API_SECRET,
      });
      let endpoint = SIGHTENGINE_ENDPOINT;
      let options;
      if (imageUrl) {
        params.set("url", imageUrl);
        endpoint += `?${params.toString()}`;
        options = { headers: { Accept: "application/json" } };
      } else {
        const [header, encoded] = imageBase64.split(",");
        const mime = header.slice(5, header.indexOf(";"));
        const form = new FormData();
        for (const [key, value] of params) form.set(key, value);
        form.set("media", new Blob([Buffer.from(encoded, "base64")], { type: mime }), "image");
        options = { method: "POST", body: form, headers: { Accept: "application/json" } };
      }
      const seRes = await fetch(endpoint, {
        ...options,
        signal: AbortSignal.timeout(15000),
      });
      const seText = await seRes.text();
      let seData = {};
      try {
        seData = seText ? JSON.parse(seText) : {};
      } catch {
        throw new Error("Sightengine returned invalid JSON");
      }
      if (!seRes.ok || seData?.status !== "success") {
        throw new Error(`Sightengine returned HTTP ${seRes.status}`);
      }

      const genAi = seData?.type?.ai_generated;
      if (!Number.isFinite(genAi) || genAi < 0 || genAi > 1) {
        throw new Error("Sightengine returned no valid AI-generated score");
      }
      const score = Math.round(genAi * 100);
      const notAi = 1 - genAi;
      // Match Hive: compare raw probabilities; rounding is for display only.
      const isAI = genAi >= notAi;

      return res.json({
        success: true,
        score,
        label: isAI ? "AI-Generated" : "Not AI-Generated",
        provider: "Sightengine (Fallback)",
        model: "genai",
        confidence: isAI ? genAi : notAi,
        scores: { ai_generated: genAi, not_ai_generated: notAi },
        note: "Detection scores are estimates, not proof of image origin.",
      });
    } catch (err) {
      console.warn("Sightengine fallback error:", err.message);
    }
  }

  return res.status(502).json({
    error: "No configured detection provider returned a valid result",
  });
});

app.use(express.static(frontendDir));
app.use((err, _req, res, _next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Image is too large. Choose an image under 10 MB." });
  }
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid request. Please select the image again." });
  }
  console.warn("Request failed");
  return res.status(500).json({ error: "Unable to process this request." });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server active on port ${PORT}`));
}

module.exports = app;
