const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { createRequire } = require("node:module");
const vm = require("node:vm");
const { test } = require("node:test");

const serverPath = path.resolve(__dirname, "../server.js");
const serverSource = readFileSync(serverPath, "utf8");
const serverRequire = createRequire(serverPath);
const IMAGE_URL = "https://example.com/photo.png";
// Deliberately fake credentials: dotenv and process.env are isolated below.
const credentials = {
  HIVE_API_KEY: "offline-hive-key",
  SIGHTENGINE_API_USER: "offline-user",
  SIGHTENGINE_API_SECRET: "offline-secret",
};
const hiveResult = (ai, notAi) => ({
  output: [{
    classes: [
      { class: "ai_generated", value: ai },
      { class: "not_ai_generated", value: notAi },
      // Independent heads must not affect the AI-generation result.
      { class: "deepfake", value: 0.99 },
    ],
  }],
});
const sightengineResult = (score) => ({
  status: "success",
  type: { ai_generated: score },
});
const reply = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => typeof body === "string" ? body : JSON.stringify(body),
});

// Exercise the actual Express endpoint, not a reimplementation of its parser.
// Only loopback HTTP is real. All provider fetches are fail-closed stubs in a VM,
// with no access to the host process's credentials or dotenv configuration.
async function fixture(t, { responses = [], env = credentials } = {}) {
  const calls = [];
  const warnings = [];
  const deadlines = [];
  const mockedModule = { exports: {} };
  vm.runInNewContext(serverSource, {
    __dirname: path.dirname(serverPath),
    module: mockedModule,
    require: (name) => name === "dotenv"
      ? { config() {} }
      : serverRequire(name),
    process: { env: { ...env } },
    console: { warn: (...args) => warnings.push(args), log() {} },
    URL,
    URLSearchParams,
    FormData,
    Blob,
    Buffer,
    AbortSignal: {
      timeout(ms) {
        deadlines.push(ms);
        // Keep the real abort mechanism, but never wait 15–45 seconds in tests.
        return AbortSignal.timeout(5);
      },
    },
    fetch: async (url, options) => {
      const index = calls.length;
      calls.push({ url, options });
      assert.ok(index < responses.length, "Unexpected provider fetch (network forbidden)");
      const response = responses[index];
      return typeof response === "function" ? response(url, options) : response;
    },
  }, { filename: serverPath });

  const server = mockedModule.exports.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return {
    calls,
    warnings,
    deadlines,
    request(body, route = "/detect", method = "POST") {
      return new Promise((resolve, reject) => {
        const req = http.request({
          hostname: "127.0.0.1",
          port: server.address().port,
          path: route,
          method,
          headers: { "Content-Type": "application/json" },
        }, (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { text += chunk; });
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, body: JSON.parse(text) });
            } catch (error) {
              reject(error);
            }
          });
        });
        req.on("error", reject);
        req.end(JSON.stringify(body));
      });
    },
  };
}

function assertDetection(result, { ai, notAi, provider = "Hive" }) {
  const isAI = ai >= notAi;
  assert.equal(result.status, 200);
  // Exact shape also forbids simulated flags, made-up forensic explanations,
  // extra certainty claims, or any scores other than the supplied model output.
  assert.deepEqual(result.body, {
    success: true,
    score: Math.round(ai * 100),
    label: isAI ? "AI-Generated" : "Not AI-Generated",
    provider,
    model: provider === "Hive"
      ? "hive/ai-generated-and-deepfake-content-detection"
      : "genai",
    confidence: isAI ? ai : notAi,
    scores: { ai_generated: ai, not_ai_generated: notAi },
    note: "Detection scores are estimates, not proof of image origin.",
  });
}

function assertUnavailable(result) {
  assert.equal(result.status, 502);
  // A failure must never masquerade as a genuine photo or a zero score.
  assert.deepEqual(result.body, {
    error: "No configured detection provider returned a valid result",
  });
}

test("health endpoint reports configuration without calling a provider", async (t) => {
  const f = await fixture(t);
  const result = await f.request(undefined, "/", "GET");
  assert.equal(result.status, 200);
  assert.equal(result.body.hive_ready, true);
  assert.equal(result.body.sightengine_ready, true);
  assert.equal(f.calls.length, 0);
});

for (const [ai, notAi] of [[0.93, 0.07], [0.12, 0.88], [0, 1], [1, 0], [0.5, 0.5]]) {
  test(`Hive V3 values ${ai}/${notAi} produce the actual binary result`, async (t) => {
    const f = await fixture(t, { responses: [reply(hiveResult(ai, notAi))] });
    assertDetection(await f.request({ imageUrl: IMAGE_URL }), { ai, notAi });
    assert.equal(f.calls.length, 1, "Hive success must not call fallback");
    const { url, options } = f.calls[0];
    assert.equal(url, "https://api.thehive.ai/api/v3/hive/ai-generated-and-deepfake-content-detection");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer offline-hive-key");
    assert.deepEqual(JSON.parse(options.body), {
      media_metadata: true,
      input: [{ media_url: IMAGE_URL }],
    });
    assert.deepEqual(f.deadlines, [45000]);
  });
}

test("Hive compares both classes rather than assuming a 50% threshold", async (t) => {
  const f = await fixture(t, { responses: [reply(hiveResult(0.4, 0.3))] });
  assertDetection(await f.request({ imageUrl: IMAGE_URL }), { ai: 0.4, notAi: 0.3 });
});

test("Hive ignores obsolete score fields when V3 value fields exist", async (t) => {
  const data = hiveResult(0, 1);
  data.output[0].classes[0].score = 1;
  data.output[0].classes[1].score = 0;
  const f = await fixture(t, { responses: [reply(data)] });
  assertDetection(await f.request({ imageUrl: IMAGE_URL }), { ai: 0, notAi: 1 });
});

const malformedHive = [
  ["invalid JSON", "{broken"],
  ["empty body", ""],
  ["null body", "null"],
  ["missing output", {}],
  ["empty output", { output: [] }],
  ["non-array classes", { output: [{ classes: {} }] }],
  ["empty classes", { output: [{ classes: [] }] }],
  ["null class", { output: [{ classes: [null] }] }],
  ["missing binary class", { output: [{ classes: [{ class: "ai_generated", value: 0.9 }] }] }],
  ["only deepfake head", { output: [{ classes: [{ class: "deepfake", value: 1 }] }] }],
  ["legacy score-only response", { output: [{ classes: [
    { class: "ai_generated", score: 0.9 },
    { class: "not_ai_generated", score: 0.1 },
  ] }] }],
  ...[null, "0.8", -0.1, 1.1, undefined].flatMap((value) => [
    [`invalid AI value ${value}`, hiveResult(value, 0.2)],
    [`invalid non-AI value ${value}`, hiveResult(0.8, value)],
  ]),
];

for (const [name, data] of malformedHive) {
  test(`malformed Hive ${name} is an error, never a genuine-photo result`, async (t) => {
    const f = await fixture(t, {
      env: { HIVE_API_KEY: credentials.HIVE_API_KEY },
      responses: [reply(data)],
    });
    assertUnavailable(await f.request({ imageUrl: IMAGE_URL }));
    assert.equal(f.calls.length, 1);
  });
}

for (const status of [401, 403, 429]) {
  test(`Hive HTTP ${status} cannot return a detection even with scores in the body`, async (t) => {
    const f = await fixture(t, {
      env: { HIVE_API_KEY: credentials.HIVE_API_KEY },
      responses: [reply(hiveResult(0, 1), status)],
    });
    assertUnavailable(await f.request({ imageUrl: IMAGE_URL }));
  });

  test(`Hive HTTP ${status} successfully falls back to Sightengine`, async (t) => {
    const f = await fixture(t, {
      responses: [reply({ error: "provider unavailable" }, status), reply(sightengineResult(0.87))],
    });
    assertDetection(await f.request({ imageUrl: IMAGE_URL }), {
      ai: 0.87, notAi: 1 - 0.87, provider: "Sightengine (Fallback)",
    });
    assert.equal(f.calls.length, 2);
    const fallbackUrl = new URL(f.calls[1].url);
    assert.equal(fallbackUrl.origin + fallbackUrl.pathname, "https://api.sightengine.com/1.0/check.json");
    assert.deepEqual(Object.fromEntries(fallbackUrl.searchParams), {
      url: IMAGE_URL, models: "genai",
      api_user: "offline-user", api_secret: "offline-secret",
    });
    assert.deepEqual(f.deadlines, [45000, 15000]);
  });
}

test("malformed Hive response can recover using Sightengine", async (t) => {
  const f = await fixture(t, { responses: [reply({}), reply(sightengineResult(0.2))] });
  assertDetection(await f.request({ imageUrl: IMAGE_URL }), {
    ai: 0.2, notAi: 0.8, provider: "Sightengine (Fallback)",
  });
});

for (const score of [0, 1]) {
  test(`Sightengine preserves a legitimate ${score} score without Hive configured`, async (t) => {
    const { HIVE_API_KEY, ...env } = credentials;
    const f = await fixture(t, { env, responses: [reply(sightengineResult(score))] });
    assertDetection(await f.request({ imageUrl: IMAGE_URL }), {
      ai: score, notAi: 1 - score, provider: "Sightengine (Fallback)",
    });
    assert.equal(f.calls.length, 1);
  });
}

for (const [ai, label] of [
  [0.495, "Not AI-Generated"],
  [0.499999, "Not AI-Generated"],
  [0.5, "AI-Generated"],
  [0.500001, "AI-Generated"],
  [0.504, "AI-Generated"],
]) {
  test(`Sightengine and Hive agree at raw AI probability ${ai} despite a displayed 50%`, async (t) => {
    const notAi = 1 - ai;
    const hive = await fixture(t, { responses: [reply(hiveResult(ai, notAi))] });
    const hiveResultBody = await hive.request({ imageUrl: IMAGE_URL });
    assertDetection(hiveResultBody, { ai, notAi });
    assert.equal(hiveResultBody.body.label, label);
    assert.equal(hiveResultBody.body.score, 50);
    assert.equal(hive.calls.length, 1);

    const { HIVE_API_KEY, ...sightengineOnly } = credentials;
    for (const fallback of [false, true]) {
      const f = await fixture(t, {
        env: fallback ? credentials : sightengineOnly,
        responses: [
          ...(fallback ? [reply({}, 503)] : []),
          reply(sightengineResult(ai)),
        ],
      });
      const result = await f.request({ imageUrl: IMAGE_URL });
      assertDetection(result, { ai, notAi, provider: "Sightengine (Fallback)" });
      assert.equal(result.body.label, hiveResultBody.body.label);
      assert.equal(result.body.confidence, hiveResultBody.body.confidence);
      assert.equal(result.body.score, 50);
      assert.equal(f.calls.length, fallback ? 2 : 1);
    }
  });
}

const malformedSightengine = [
  ["invalid JSON", reply("{broken")],
  ["empty body", reply("")],
  ["missing score", reply({ status: "success", type: {} })],
  ["null score", reply(sightengineResult(null))],
  ["string score", reply(sightengineResult("0"))],
  ["negative score", reply(sightengineResult(-0.1))],
  ["out-of-range score", reply(sightengineResult(1.1))],
  ["provider failure status", reply({ ...sightengineResult(0), status: "failure" })],
  ...[401, 403, 429].map((status) => [`HTTP ${status}`, reply(sightengineResult(0), status)]),
];

for (const [name, response] of malformedSightengine) {
  test(`all providers failing with Sightengine ${name} returns only an explicit error`, async (t) => {
    const f = await fixture(t, { responses: [reply({}, 401), response] });
    assertUnavailable(await f.request({ imageUrl: IMAGE_URL }));
    assert.equal(f.calls.length, 2);
  });
}

function waitForTimeout(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("Hive timeout triggers a successful fallback", async (t) => {
  const f = await fixture(t, { responses: [waitForTimeout, reply(sightengineResult(0.76))] });
  assertDetection(await f.request({ imageUrl: IMAGE_URL }), {
    ai: 0.76, notAi: 1 - 0.76, provider: "Sightengine (Fallback)",
  });
  assert.deepEqual(f.deadlines, [45000, 15000]);
});

test("both providers timing out return an error rather than simulated scores", async (t) => {
  const f = await fixture(t, { responses: [waitForTimeout, waitForTimeout] });
  assertUnavailable(await f.request({ imageUrl: IMAGE_URL }));
  assert.deepEqual(f.deadlines, [45000, 15000]);
});

test("network failures from both providers return an explicit error", async (t) => {
  const fail = () => { throw new TypeError("offline network failure"); };
  const f = await fixture(t, { responses: [fail, fail] });
  assertUnavailable(await f.request({ imageUrl: IMAGE_URL }));
});

for (const env of [{}, { SIGHTENGINE_API_USER: "offline-user" }, { SIGHTENGINE_API_SECRET: "offline-secret" }]) {
  test(`missing or partial provider configuration fails without fetch (${Object.keys(env)})`, async (t) => {
    const f = await fixture(t, { env });
    assertUnavailable(await f.request({ imageUrl: IMAGE_URL }));
    assert.equal(f.calls.length, 0);
  });
}

for (const mime of ["jpeg", "png", "webp", "gif"]) {
  test(`supported ${mime} base64 data URL is sent unchanged to Hive`, async (t) => {
    const imageBase64 = `data:image/${mime};base64,AQIDBA==`;
    const f = await fixture(t, { responses: [reply(hiveResult(0.82, 0.18))] });
    assertDetection(await f.request({ imageBase64 }), { ai: 0.82, notAi: 0.18 });
    assert.deepEqual(JSON.parse(f.calls[0].options.body).input, [{ media_base64: imageBase64 }]);
    assert.equal(f.calls.length, 1);
  });
}

test("base64 provider failure cannot invent a result when both providers fail", async (t) => {
  const f = await fixture(t, { responses: [reply({}, 403), reply({}, 403)] });
  assertUnavailable(await f.request({ imageBase64: "data:image/png;base64,AQIDBA==" }));
  assert.equal(f.calls.length, 2);
});

test("Sightengine-only configuration uploads base64 pixels as multipart media", async (t) => {
  const { HIVE_API_KEY, ...env } = credentials;
  const f = await fixture(t, { env, responses: [reply(sightengineResult(0.8))] });
  assertDetection(await f.request({ imageBase64: "data:image/png;base64,AQIDBA==" }), {
    ai: 0.8, notAi: 1 - 0.8, provider: "Sightengine (Fallback)",
  });
  assert.equal(f.calls.length, 1);
  const { url, options } = f.calls[0];
  assert.equal(url, "https://api.sightengine.com/1.0/check.json");
  assert.equal(options.method, "POST");
  assert.equal(options.body.get("models"), "genai");
  assert.equal(options.body.get("api_user"), "offline-user");
  assert.equal(options.body.get("api_secret"), "offline-secret");
  const media = options.body.get("media");
  assert.equal(media.type, "image/png");
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from([1, 2, 3, 4]));
});

// Whitespace is ignored for validation/decoding; Hive still receives the
// original data URL. Padding may be omitted entirely, but not partially.
const supportedEncodings = [
  ["one byte with padding", "AQ==", [1]],
  ["two bytes with padding", "AQI=", [1, 2]],
  ["complete quartet without padding", "AQID", [1, 2, 3]],
  ["one byte without padding", "AQ", [1]],
  ["two bytes without padding", "AQI", [1, 2]],
  ["standard plus and slash alphabet", "+/8=", [251, 255]],
  ["whitespace around and inside payload/padding", " \tA Q\r\nI D B A =\t= \n", [1, 2, 3, 4]],
  ["whitespace with omitted padding", " A Q\tI \r\n", [1, 2]],
];

for (const mime of ["jpeg", "png", "webp", "gif"]) {
  for (const [name, encoded, bytes] of supportedEncodings) {
    test(`${mime} accepts ${name} through Hive and Sightengine`, async (t) => {
      const imageBase64 = `data:image/${mime};base64,${encoded}`;
      const hive = await fixture(t, { responses: [reply(hiveResult(0.82, 0.18))] });
      assertDetection(await hive.request({ imageBase64 }), { ai: 0.82, notAi: 0.18 });
      assert.equal(hive.calls.length, 1);
      assert.deepEqual(JSON.parse(hive.calls[0].options.body).input, [{ media_base64: imageBase64 }]);

      const { HIVE_API_KEY, ...env } = credentials;
      const fallback = await fixture(t, { env, responses: [reply(sightengineResult(0.8))] });
      assertDetection(await fallback.request({ imageBase64 }), {
        ai: 0.8, notAi: 1 - 0.8, provider: "Sightengine (Fallback)",
      });
      assert.equal(fallback.calls.length, 1);
      const media = fallback.calls[0].options.body.get("media");
      assert.equal(media.type, `image/${mime}`);
      assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from(bytes));
    });
  }
}

const malformedEncodings = [
  "", " ", "\t\r\n", "\u00a0", // No encoded bytes, even after whitespace removal.
  "=", "==", "====", "A=", "A==", "A===", // Padding without a complete quantum.
  "A", "AAAAA", "AAAAAAAAA", // Impossible unpadded lengths.
  "AQ=", "AQI==", "AQID=", "AQID==", "AQIDBA=", // Partial/excess padding.
  "=AQI", "A=QI", "AQ==ID", "AQ==AQ==", "AQ===", // Nonterminal padding.
  " \tA Q =\n", "AQ==\nID", // Whitespace must not hide invalid structure.
  "AQ-_", "AQ%3D%3D", "AQ==,AQ==", "AQ==\0", // Nonstandard alphabet/junk.
];

for (const mime of ["jpeg", "png", "webp", "gif"]) {
  for (const encoded of malformedEncodings) {
    test(`${mime} rejects malformed base64 without provider calls: ${JSON.stringify(encoded)}`, async (t) => {
      const f = await fixture(t);
      const result = await f.request({ imageBase64: `data:image/${mime};base64,${encoded}` });
      assert.equal(result.status, 400);
      assert.deepEqual(result.body, {
        error: "imageBase64 must be a JPEG, PNG, WebP or GIF base64 data URL",
      });
      assert.equal(f.calls.length, 0);
      assert.deepEqual(f.deadlines, []);
    });
  }
}

const invalidInputs = [
  {}, { unrelated: "value" }, { imageUrl: "" }, { imageUrl: "   " },
  ...[42, true, [], {}].map((imageUrl) => ({ imageUrl })),
  ...["not a URL", "/photo.png", "ftp://example.com/image.png",
    "file:///tmp/photo.png", "javascript:alert(1)",
    "data:image/png;base64,AQIDBA==", "https://user:password@example.com/photo.png",
  ].map((imageUrl) => ({ imageUrl })),
  ...[42, true, {}, [], "AQIDBA==", "data:image/png;base64,",
    "data:image/svg+xml;base64,AQIDBA==", "data:text/plain;base64,AQIDBA==",
    "data:image/png,AQIDBA==", "data:image/png;base64,%%%not-base64",
  ].map((imageBase64) => ({ imageBase64 })),
];

for (const input of invalidInputs) {
  test(`invalid image input is rejected before any provider call: ${JSON.stringify(input)}`, async (t) => {
    const f = await fixture(t);
    const result = await f.request(input);
    assert.equal(result.status, 400);
    assert.deepEqual(Object.keys(result.body), ["error"]);
    assert.equal(typeof result.body.error, "string");
    assert.equal(f.calls.length, 0);
  });
}

for (const imageUrl of [IMAGE_URL, "http://example.com/photo.jpg?size=small"]) {
  test(`valid HTTP(S) imageUrl is accepted: ${imageUrl}`, async (t) => {
    const f = await fixture(t, { responses: [reply(hiveResult(0.91, 0.09))] });
    assertDetection(await f.request({ imageUrl }), { ai: 0.91, notAi: 0.09 });
    assert.equal(JSON.parse(f.calls[0].options.body).input[0].media_url, imageUrl);
  });
}
