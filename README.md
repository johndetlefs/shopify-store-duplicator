# Shopify Store Duplicator

Programmatically duplicate a Shopify store's custom data and content from a **source** to a **destination** store with high fidelity and repeatability.

## Features

- **Definitions (schema)**: Metaobject definitions, metafield definitions
- **Data (content)**: Metaobject entries, metafields on resources, pages/articles/blogs, menus, redirects
- **Files**: Seed file library and relink by handle/type
- **Idempotent**: Safe to re-run apply operations
- **Deterministic**: Uses natural keys (handles, type+handle) for reliable mapping
- **Bulk Operations**: Leverages Shopify's GraphQL Bulk API for efficiency

## Prerequisites

- Node.js 20+
- Shopify Admin API access tokens for both source and destination stores
- Shopify API version 2025-10 or later

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and configure:

```env
SRC_SHOP_DOMAIN=my-source-store.myshopify.com
SRC_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
DST_SHOP_DOMAIN=my-destination-store.myshopify.com
DST_ADMIN_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_API_VERSION=2025-10
```

## Usage

### 1. Dump and Apply Definitions

```bash
# Dump source store definitions
npm run dev -- defs:dump > defs.json

# Apply definitions to destination store
npm run dev -- defs:apply --file defs.json

# Compare definitions
npm run dev -- defs:diff --file defs.json
```

### 2. Seed Files

```bash
npm run dev -- files:apply --input files.json
```

### 3. Dump and Apply Data

```bash
# Dump source store data
npm run dev -- data:dump --output ./dumps

# Apply data to destination store
npm run dev -- data:apply --input ./dumps

# Compare data
npm run dev -- data:diff --input ./dumps
```

### 4. Menus and Redirects

```bash
# Menus
npm run dev -- menus:dump > menus.json
npm run dev -- menus:apply --file menus.json

# Redirects
npm run dev -- redirects:dump > redirects.json
npm run dev -- redirects:apply --file redirects.json
```

## Architecture

### Monorepo Structure

```
/packages/core          # Core library
  /src/bulk            # Bulk operations launcher, poller, JSONL parser
  /src/defs            # Metaobject & metafield definition handlers
  /src/data            # Data dump/apply for metaobjects, metafields, CMS
  /src/files           # File upload and management
  /src/menus           # Menu dump/apply
  /src/redirects       # Redirect dump/apply
  /src/map             # Handle/type mapping and GID resolvers
  /src/graphql         # GraphQL queries and mutations
  /src/utils           # Utilities (logger, retry, chunking, etc.)

/apps/cli              # CLI application
  /src/index.ts        # Commander-based CLI
```

### Execution Order

1. **Definitions** → Create/update schema definitions
2. **Files** → Seed file library
3. **Metaobjects** → Create metaobject entries
4. **Resource Metafields** → Attach metafields to products, variants, collections, etc.
5. **CMS** → Pages, articles, blogs
6. **Menus** → Navigation menus
7. **Redirects** → URL redirects

### Key Principles

- **Idempotent**: All apply operations can be safely re-run
- **Deterministic mapping**: Uses natural keys (handles) instead of GIDs
- **Rate limiting**: Automatic retry with exponential backoff on 429/430
- **Security**: Tokens from `.env`, never logged
- **Observability**: Structured logging with progress tracking

## CLI Options

Global options available for all commands:

- `--src-shop <domain>`: Override source shop domain
- `--src-token <token>`: Override source admin token
- `--dst-shop <domain>`: Override destination shop domain
- `--dst-token <token>`: Override destination admin token
- `--api-version <version>`: Override Shopify API version
- `--dry-run`: Preview mutations without executing
- `--verbose`: Enable debug logging

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run CLI in development
npm run dev -- <command>

# Watch mode for development
npm run watch -w @shopify-duplicator/core
```

## License

MIT
