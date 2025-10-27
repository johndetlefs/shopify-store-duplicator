# Setup Instructions

## Prerequisites

- Node.js 20.0.0 or higher
- npm 9.0.0 or higher
- Shopify Admin API access tokens for both source and destination stores

## Installation

### 1. Clone and Install

```bash
cd shopify-store-duplicator
npm install
```

This will install all dependencies for the monorepo workspaces:

- **packages/core**: Core library with `zod`, `@types/node`, `undici-types`, `typescript`
- **apps/cli**: CLI application with `commander`, `dotenv`, `tsx`, `typescript`

**Note**: The code uses Node.js 20+ native APIs (`fetch`, `FormData`, `Blob`) - no runtime fetch library needed!

### 2. Build the Project

```bash
npm run build
```

This compiles TypeScript for both `packages/core` and `apps/cli`.

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your store credentials:

```env
# Source Store
SRC_SHOP_DOMAIN=your-source-store.myshopify.com
SRC_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Destination Store
DST_SHOP_DOMAIN=your-destination-store.myshopify.com
DST_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# API Configuration
SHOPIFY_API_VERSION=2025-10

# Logging
LOG_LEVEL=info
LOG_FORMAT=pretty
```

### 4. Verify Setup

```bash
# Run a simple command to verify
npm run dev -- --help
```

You should see the CLI help output.

## Getting Admin API Tokens

### For Private Apps (Recommended for Development)

1. Go to your Shopify admin
2. Navigate to **Apps** → **App development** → **Create an app**
3. Name your app (e.g., "Store Duplicator")
4. Go to **API credentials** tab
5. Click **Configure Admin API scopes**
6. Enable these scopes:
   - `read_products`, `write_products`
   - `read_collections`, `write_collections`
   - `read_metaobjects`, `write_metaobjects`
   - `read_content`, `write_content`
   - `read_files`, `write_files`
   - `read_navigation`, `write_navigation`
   - `read_online_store_pages`, `write_online_store_pages`
7. Click **Save**
8. Click **Install app**
9. Copy the **Admin API access token** (starts with `shpat_`)
10. Repeat for both source and destination stores

### For Production

Consider using OAuth for production deployments. See [Shopify OAuth documentation](https://shopify.dev/docs/apps/auth/oauth).

## First Run

### Test with Definitions

The safest first operation is dumping and applying definitions (schema):

```bash
# 1. Dump definitions from source
npm run dev -- defs:dump > defs.json

# 2. Review the output
cat defs.json | jq .

# 3. Apply to destination (dry run first)
npm run dev -- defs:apply --file defs.json --dry-run

# 4. Apply for real
npm run dev -- defs:apply --file defs.json
```

Expected output:

```
[INFO] Applying all definitions
[INFO] Applying X metaobject definitions
[DEBUG] Indexed Y existing metaobject types
[INFO] Metaobject definitions applied { created: X, updated: 0, skipped: Y, failed: 0 }
[INFO] Applying Z metafield definitions
[INFO] Metafield definitions applied { created: A, updated: 0, skipped: B, failed: 0 }
[INFO] All definitions applied
```

## Troubleshooting

### `Cannot find module` errors

```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

### TypeScript errors during development

The project uses TypeScript with strict mode. Some scaffolded files may have intentional type errors that will be resolved as you implement the remaining features.

To see current errors:

```bash
npm run build 2>&1 | less
```

### API Permission errors

If you see errors like `"insufficient access scopes"`:

1. Check your app's API scopes in Shopify admin
2. Ensure all required scopes are enabled
3. Reinstall the app to apply new scopes
4. Generate a new access token

### Rate Limiting

If you're hitting rate limits frequently:

1. Reduce the number of concurrent operations
2. Increase backoff delays in `packages/core/src/utils/retry.ts`
3. Use smaller batch sizes

### CORS errors

This tool uses direct GraphQL API calls, not browser-based requests. CORS should not be an issue. If you see CORS errors, check that you're running the CLI from the terminal, not a browser.

## Development Workflow

### Watch Mode

For active development:

```bash
# Terminal 1: Watch and rebuild core on changes
npm run watch -w @shopify-duplicator/core

# Terminal 2: Run CLI commands
npm run dev -- defs:dump
```

### Adding New Features

1. Implement in `packages/core/src/`
2. Export from `packages/core/src/index.ts`
3. Add CLI command in `apps/cli/src/index.ts`
4. Rebuild: `npm run build`

See `DEVELOPMENT.md` for detailed architecture and guidelines.

## Next Steps

Once setup is complete:

1. ✅ Test `defs:dump` and `defs:apply`
2. Implement `data:dump` (see `IMPLEMENTATION.md`)
3. Implement `data:apply`
4. Add remaining commands (files, menus, redirects)

## Security Checklist

- [ ] Never commit `.env` file
- [ ] Use test/development stores for testing
- [ ] Rotate API tokens regularly
- [ ] Review logs for accidentally logged tokens (should be redacted)
- [ ] Limit API scopes to minimum required

## Getting Help

- Check `README.md` for usage examples
- See `DEVELOPMENT.md` for architecture details
- Review `IMPLEMENTATION.md` for implementation status
- Read inline code comments for Shopify-specific gotchas

## Uninstalling

```bash
# Remove dependencies
npm run clean
rm -rf node_modules
rm -rf packages/*/node_modules
rm -rf apps/*/node_modules

# Remove build artifacts
rm -rf packages/*/dist
rm -rf apps/*/dist

# Remove env file (keep your tokens safe!)
rm .env
```

---

**Happy duplicating! 🚀**
