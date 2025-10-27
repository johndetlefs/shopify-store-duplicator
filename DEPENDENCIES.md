# Dependency Installation Note

## Current Status

The `packages/core/package.json` has been updated with all required dependencies:

### Runtime Dependencies

- ✅ `zod@^3.22.4` - Schema validation (used in future implementations)

### Development Dependencies

- ✅ `@types/node@^20.10.0` - TypeScript type definitions for Node.js APIs
- ✅ `typescript@^5.3.3` - TypeScript compiler
- ✅ `undici-types@^6.19.8` - TypeScript types for fetch API in Node.js

## Node.js Native APIs Used

The code uses the following Node.js 20+ native globals (no external packages needed):

- `fetch()` - Native fetch API (Node 18.0.0+, stable in 20+)
- `FormData` - For file uploads (Node 18.0.0+)
- `Blob` - For binary data (Node 18.0.0+)
- `TextDecoder` - For streaming text decoding (Node built-in)
- `setTimeout`, `setInterval` - Timers (Node built-in)
- `process.env` - Environment variables (Node built-in)
- `console` - Logging (Node built-in)

## Why undici-types?

Node.js 20+ includes native `fetch` from the `undici` package, but TypeScript needs type definitions. The `undici-types` package provides these without adding runtime dependencies.

Alternative: You could also use `node-fetch` if you need to support Node < 18, but per the spec, we're targeting Node 20+.

## Installation

To install all dependencies and resolve TypeScript errors:

```bash
# From the root of the monorepo
npm install

# This will install dependencies for all workspaces
# including packages/core and apps/cli
```

## Verifying Installation

After running `npm install`, verify everything is installed:

```bash
# Check node_modules
ls packages/core/node_modules/@types/node
ls packages/core/node_modules/undici-types

# Try building
npm run build -w @shopify-duplicator/core
```

## Expected TypeScript Errors Before Installation

Before running `npm install`, you'll see errors like:

- ❌ `Cannot find type definition file for 'node'`
- ❌ `Cannot find type definition file for 'undici-types'`
- ❌ `Cannot find name 'fetch'`
- ❌ `Cannot find name 'FormData'`

These will all resolve after installation.

## CLI Package Dependencies

The `apps/cli/package.json` also needs to be checked. It should have:

- `commander` - CLI framework ✅ (already in package.json)
- `dotenv` - Environment variable loading ✅ (already in package.json)
- `@shopify-duplicator/core` - Core library ✅ (workspace dependency)

No additional dependencies are needed for the CLI.
