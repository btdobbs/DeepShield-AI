# Shared code

`lib/api-client-react/` contains the React API client used by the frontend.
`lib/api-spec/` contains the OpenAPI contract and client-generation configuration.
`lib/api-zod/` contains generated API types and validation schemas.
`lib/db/` is an unused database scaffold retained for reference. The detector does not require a database, and no database migration is needed.

Workspace and TypeScript configuration files live at the repository root.
The root `pnpm-workspace.yaml` discovers packages under `Shared/lib/*`.
Each library has its own `package.json`; these are package definitions, not extra application servers.

Run `pnpm codegen` from the root only when intentionally regenerating the API client and schemas after changing the API specification.
