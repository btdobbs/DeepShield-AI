# Shared project files

This folder groups the shared source packages and configuration files from the working DeepShield project. It does not contain API keys.

## Contents

- `lib/api-client-react/`: React API client used by the frontend.
- `lib/api-spec/`: API specification and client-generation configuration.
- `lib/api-zod/`: shared validation schemas and API types.
- `lib/db/`: existing database scaffold referenced by the TypeScript project configuration; the image detector does not require a database.
- `pnpm-workspace.yaml`: workspace package locations and dependency versions.
- `pnpm-lock.yaml`: locked dependency versions.
- `tsconfig.json` and `tsconfig.base.json`: TypeScript project configuration.
- `.npmrc`: package-manager settings.
- `.gitignore`: files excluded from Git.

## Important: grouped source, not a runnable layout

The configuration files are copied unchanged from the working project. Putting them inside `Shared` does not automatically connect the separately arranged `Frontend` and `Backend` folders.

To use the original configuration without changing paths:

1. Place this folder's `lib/` directory and configuration files at the repository root.
2. Keep the backend's root `package.json` and `server.js` at that root.
3. Place the full frontend at `artifacts/deepshield/`, with its source files inside `src/`.

Alternatively, adapt workspace globs, TypeScript references, frontend aliases, and backend static-file paths to the `Frontend` / `Backend` / `Shared` layout before running it.

There is no additional shared root `package.json`; the project's existing root package file already serves that role. Each library's own `package.json` is required to identify that library.

Never commit real API credentials or a populated `.env` file.
