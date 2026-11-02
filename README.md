# DeepShield AI

A student project exploring whether AI-generated images can still be detected after social-media transformations, including compression and screenshots.

The project includes a React web interface, an Express backend, shared API packages, and a Chrome extension.

## Project structure

```text
DeepShield-AI/
├── Frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── public/
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css
│       ├── pages/          # Upload, cropping, results, and not-found page
│       ├── components/     # Reusable interface components
│       ├── hooks/          # Supporting React hooks
│       └── lib/            # Interface utilities
├── Backend/
│   ├── server.js          # Provider calls and serving the built frontend
│   ├── package.json
│   ├── test/              # Offline endpoint tests
│   └── index.html         # Earlier standalone dashboard, kept for reference
├── Shared/
│   └── lib/
│       ├── api-client-react/
│       ├── api-spec/
│       ├── api-zod/
│       └── db/            # Unused scaffold; no database required
├── Chrome Extension/     # Existing Manifest V3 extension
├── docs/
│   └── PROJECT-HISTORY.md # Original project narrative and progress notes
├── package.json          # Commands for the whole project
├── pnpm-workspace.yaml   # Connects Frontend, Backend, and Shared packages
├── pnpm-lock.yaml        # Locked dependencies
├── tsconfig.json
├── tsconfig.base.json
└── .env.example          # Credential names only, never actual keys
```

## Technologies used

| Part | Technologies |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Radix UI, Lucide icons |
| Client state and navigation | TanStack Query and Wouter |
| Backend | Node.js, Express, CORS, dotenv |
| Detection | Hive AI V3; Sightengine `genai` when Hive fails |
| Shared contract and types | OpenAPI, Orval, Zod |
| Extension | JavaScript, HTML/CSS, Chrome Manifest V3 |
| Dependency management | pnpm workspaces |
| Tests | Node.js built-in test runner with mocked provider responses |

## Requirements

- Node.js 22.12 or newer; Node.js 24 LTS is recommended.
- pnpm 10.26.1. With Corepack available, run `corepack enable` and `corepack prepare pnpm@10.26.1 --activate`. Otherwise install that pnpm version using the official pnpm installation instructions.
- Your own Hive credentials for live detection. Sightengine credentials enable the fallback.

No Python, Flask, or database is needed to run the detector.

## Download and run

```sh
git clone https://github.com/rngari-byte/DeepShield-AI.git
cd DeepShield-AI
pnpm install --frozen-lockfile
```

Copy `.env.example` to `.env` in this top-level folder. Enter your own credentials there. Leave unavailable provider credentials blank; never put keys in frontend files or commit `.env`.

Then, from the top-level folder:

```sh
pnpm build
pnpm start
```

Open **http://localhost:3000**. Express serves both the built web interface and the API, so a second frontend server is not required. If you change `PORT` in `.env`, use that port in the address.

After changing frontend code, run `pnpm build` again and refresh the browser. After changing backend code or credentials, restart `pnpm start`.

The interface loads without API credentials. Detection requests will fail explicitly if no configured provider can return a valid response. Health flags indicate whether credentials are present, not whether a provider has accepted them.

## Check the project

```sh
pnpm typecheck
pnpm test
```

The backend tests mock external provider calls and do not consume detection quota. Real detection sends an image to an external provider and may consume credits.

## How image analysis works

1. Select or drop a JPEG, PNG, or WebP image up to 10 MB.
2. Optionally crop away browser controls or social-media page borders. Cropping is performed locally.
3. Press **Analyze image**. The previewed image is sent to the backend.
4. The backend calls Hive. If Hive fails, it tries Sightengine when configured.
5. The interface displays the returned score, provider, and model. It does not invent an authenticity result when analysis fails.

The backend exposes `GET /api/healthz`, `POST /api/detect`, and the compatibility endpoint `POST /detect`. Detection accepts `imageBase64` or a public HTTP(S) `imageUrl`.

## Chrome extension

The existing extension files are preserved under `Chrome Extension/`. They currently reference the project's hosted backend, not your local server. The web app does not require the extension.

To inspect the extension, open Chrome's extension management page, enable Developer mode, choose **Load unpacked**, and select `Chrome Extension/`. Detection may send images to the backend configured in those scripts. The extension has not been verified as part of the repository-structure changes.

To target another backend, review the URL settings in `background.js` and `content.js`, and the matching `host_permissions` in `manifest.json`. Do not insert provider API keys into extension code.

## Limitations and research status

- A detection score is a model estimate, not proof of image origin.
- Low scores do not establish that an image is genuine.
- Screenshots and surrounding page elements can change a detector's response. Cropping helped in individual examples, but does not guarantee a correct result.
- Individual scores near 99% are not a measured 99% accuracy rate.
- This repository does not include a completed, balanced accuracy benchmark for social-media transformations.
- The interface does not provide evidence heatmaps or verified generator attribution.
- Hive and Sightengine are used as primary and fallback providers, not as a simultaneous comparison.
- The backend has no authentication or rate limiting. Use it locally for review; add access and quota controls before exposing a public service with paid API keys.

The original project narrative is retained in [docs/PROJECT-HISTORY.md](docs/PROJECT-HISTORY.md). It is a historical record, not a statement that all earlier claims or planned features have been validated.
