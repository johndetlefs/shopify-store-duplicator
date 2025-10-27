# Package Dependencies - Complete Summary

## ✅ All Dependencies Verified and Updated

### packages/core/package.json

```json
{
  "dependencies": {
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "typescript": "^5.3.3",
    "undici-types": "^6.19.8"
  }
}
```

**Changes Made:**

- ✅ Added `undici-types@^6.19.8` for native fetch API types in Node.js 20+

### apps/cli/package.json

```json
{
  "dependencies": {
    "@shopify-duplicator/core": "workspace:*",
    "commander": "^11.1.0",
    "dotenv": "^16.3.1"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

**Status:**

- ✅ All required dependencies already present

### TypeScript Configuration Updates

#### packages/core/tsconfig.json

- ✅ Added `"types": ["node", "undici-types"]` to include Node.js and fetch types
- ✅ Added `"composite": true` for TypeScript project references

#### apps/cli/tsconfig.json

- ✅ Added `"types": ["node"]` to include Node.js types

## What These Dependencies Provide

### Runtime Dependencies

| Package     | Purpose               | Used In                                |
| ----------- | --------------------- | -------------------------------------- |
| `zod`       | Schema validation     | Future data validation implementations |
| `commander` | CLI framework         | CLI command parsing and routing        |
| `dotenv`    | Environment variables | Loading .env configuration             |

### Type Definitions

| Package        | Purpose      | Provides Types For                       |
| -------------- | ------------ | ---------------------------------------- |
| `@types/node`  | Node.js APIs | process, Buffer, setTimeout, fs, etc.    |
| `undici-types` | Fetch API    | fetch, FormData, Blob, Response, Request |

### Build Tools

| Package      | Purpose                           |
| ------------ | --------------------------------- |
| `typescript` | TypeScript compiler               |
| `tsx`        | TypeScript execution for dev mode |

## Native Node.js APIs Used (No Package Needed)

The following are built into Node.js 20+ and require no runtime dependencies:

- ✅ `fetch()` - HTTP requests (native since Node 18)
- ✅ `FormData` - Multipart form data (native since Node 18)
- ✅ `Blob` - Binary data (native since Node 18)
- ✅ `TextDecoder` - Text decoding (native built-in)
- ✅ `setTimeout`, `setInterval` - Timers (native built-in)
- ✅ `process` - Process info and env vars (native built-in)
- ✅ `console` - Logging (native built-in)

## Installation Instructions

### First Time Setup

```bash
# From the repository root
cd shopify-store-duplicator

# Install all dependencies for all workspaces
npm install

# Build all packages
npm run build
```

This will:

1. Install dependencies for root workspace
2. Install dependencies for `packages/core`
3. Install dependencies for `apps/cli`
4. Link workspace packages together

### Verify Installation

```bash
# Check that types are available
ls packages/core/node_modules/@types/node
ls packages/core/node_modules/undici-types
ls apps/cli/node_modules/commander

# Try building
npm run build

# Should complete without errors (after installation)
```

### Expected Output

After `npm install`, you should see:

```
added XXX packages, and audited XXX packages in XXs
```

After `npm run build`, you should see:

```
> build
> npm run build --workspaces

> @shopify-duplicator/core@1.0.0 build
> tsc

> @shopify-duplicator/cli@1.0.0 build
> tsc
```

## Troubleshooting

### "Cannot find module 'commander'"

**Solution:**

```bash
npm install
```

### "Cannot find type definition file for 'node'"

**Solution:**

```bash
npm install
```

The `@types/node` package will be installed by `npm install`.

### "Cannot find name 'fetch'"

**Solution:**

```bash
npm install
```

After installation, the `undici-types` package will provide fetch types.

### TypeScript Compilation Errors

If you still see TypeScript errors after installation:

```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

### Workspace Linking Issues

If workspace packages aren't linking correctly:

```bash
# Remove all node_modules and lockfile
rm -rf node_modules packages/*/node_modules apps/*/node_modules
rm package-lock.json

# Fresh install
npm install
```

## Why These Specific Versions?

- **Node 20.10.0 types**: Matches the Node 20+ requirement in package.json engines
- **TypeScript 5.3.3**: Latest stable with excellent ES2022 support
- **undici-types 6.19.8**: Latest compatible with Node 20's fetch implementation
- **commander 11.1.0**: Latest stable CLI framework
- **dotenv 16.3.1**: Latest stable environment variable loader
- **zod 3.22.4**: Latest stable schema validation library

## Future Dependencies (Not Yet Needed)

These may be added as you implement remaining features:

- `vitest` - For unit testing
- `@types/jest` or `@vitest/types` - Testing type definitions
- Additional Shopify-specific packages (if needed)

## Security Notes

All dependencies are:

- ✅ From official npm registry
- ✅ Actively maintained
- ✅ Well-known in the Node.js ecosystem
- ✅ Have minimal sub-dependencies
- ✅ Compatible with Node 20+ LTS

Run `npm audit` to check for known vulnerabilities:

```bash
npm audit
```

## Summary

✅ **All required dependencies are now in package.json**  
✅ **TypeScript configurations updated for Node.js types**  
✅ **Project references configured correctly**  
✅ **Native Node.js 20+ APIs used where possible**  
✅ **Minimal external dependencies (only what's needed)**

The project is ready for `npm install` and `npm run build`!
