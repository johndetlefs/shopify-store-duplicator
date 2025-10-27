# Shopify Store Duplicator - Development Guide

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build Packages

```bash
npm run build
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your store credentials
```

### 4. Run CLI

```bash
# Using npm workspace
npm run dev -- defs:dump

# Or build and run directly
npm run build
./apps/cli/dist/index.js defs:dump
```

## Development Workflow

### Watch Mode

```bash
# Terminal 1: Watch core package
npm run watch -w @shopify-duplicator/core

# Terminal 2: Run CLI in dev mode
npm run dev -- <command>
```

### TypeScript Compilation

The project uses TypeScript with ES2022 modules. Each package has its own `tsconfig.json`:

- **packages/core**: Core library with all business logic
- **apps/cli**: CLI application that imports core library

### Adding New Commands

1. Add business logic to `packages/core/src/`
2. Export from `packages/core/src/index.ts`
3. Wire up command in `apps/cli/src/index.ts`
4. Rebuild: `npm run build`

## Project Structure

```
shopify-store-duplicator/
├── packages/
│   └── core/                # Core library
│       ├── src/
│       │   ├── bulk/       # Bulk operations
│       │   ├── defs/       # Definitions (schema)
│       │   ├── data/       # Data (metaobjects, metafields)
│       │   ├── files/      # File uploads
│       │   ├── menus/      # Menu management
│       │   ├── redirects/  # Redirects
│       │   ├── map/        # ID mapping
│       │   ├── graphql/    # GraphQL client & queries
│       │   └── utils/      # Utilities
│       ├── package.json
│       └── tsconfig.json
├── apps/
│   └── cli/                # CLI application
│       ├── src/
│       │   └── index.ts    # Commander CLI
│       ├── package.json
│       └── tsconfig.json
├── package.json            # Root workspace config
├── .env.example
└── README.md
```

## Implementation Status

### ✅ Completed

- [x] Repository structure and build system
- [x] Core utilities (logger, retry, chunking, redaction)
- [x] GraphQL client with rate limiting
- [x] Bulk operations (launch, poll, download JSONL)
- [x] Mapping/ID resolution (natural keys → GIDs)
- [x] Definitions dump (metaobjects + metafields)
- [x] Definitions apply (create/update with idempotency)
- [x] CLI framework with global options
- [x] `defs:dump` and `defs:apply` commands

### 🚧 To Implement

- [ ] `data:dump` - Bulk export metaobjects, metafields, CMS content
- [ ] `data:apply` - Apply data with reference remapping
- [ ] `files:apply` - Seed file library
- [ ] `menus:dump/apply` - Menu management
- [ ] `redirects:dump/apply` - Redirect management
- [ ] `defs:diff` - Compare definitions
- [ ] `data:diff` - Compare data
- [ ] Full variant mapping (SKU + position fallback)
- [ ] CMS content (pages, articles, blogs)
- [ ] Comprehensive error handling and validation

## Key Architectural Decisions

### 1. Natural Key Mapping

**Why**: GIDs are store-specific and can't be relied upon across stores.

**How**: Build deterministic maps using natural keys:

- Products/Collections/Pages → `handle`
- Metaobjects → `{type}:{handle}`
- Variants → `{productHandle}:{sku}` or `{productHandle}:pos{position}`

### 2. Bulk Operations

**Why**: Efficiently extract large datasets without hitting rate limits.

**How**: Use Shopify's bulk query API:

1. Launch bulk query → get operation ID
2. Poll until COMPLETED
3. Download JSONL stream
4. Parse line-by-line for memory efficiency

### 3. Idempotent Apply

**Why**: Safe to re-run; handles partial failures gracefully.

**How**:

- Query existing resources first
- Create only if missing
- Update only when safe (no destructive changes)
- Log warnings on drift

### 4. Rate Limiting

**Why**: Shopify has strict rate limits (429) and cost-based throttling (430).

**How**:

- Exponential backoff with jitter
- Monitor GraphQL cost in responses
- Chunk mutations (50-100/sec)
- Adaptive retry logic

## Shopify-Specific Gotchas

### 1. Definition Type Parity

Metafield and metaobject field types must match exactly between source and destination. Mismatches cause validation errors when applying data.

**Solution**: Always dump and apply definitions before data.

### 2. Reference Remapping

Source GIDs won't work in destination. Must resolve all references through natural keys.

**Solution**: Build destination index; remap during apply.

### 3. Bulk JSONL Structure

Shopify bulk queries return JSONL with parent-child relationships via `__parentId`.

**Solution**: Parse and reconstruct relationships in memory or streaming fashion.

### 4. File Uploads

Shopify CDN URLs may work directly with `fileCreate`, but external URLs require staged uploads.

**Solution**: Try direct URL first; fall back to staged upload workflow.

## Testing

Currently light on tests. To add:

```bash
# In packages/core
npm install --save-dev vitest
```

Add test files as `*.test.ts` alongside source files.

## Troubleshooting

### TypeScript Errors

The scaffold has some expected TypeScript errors due to missing Node types and DOM APIs. To fix:

```bash
# Already included in package.json, but ensure installed
npm install
```

Update `tsconfig.json` if needed to include Node types.

### Module Not Found

If you see import errors:

```bash
# Rebuild all packages
npm run clean
npm run build
```

### Rate Limiting

If you hit 429/430 errors frequently:

- Increase backoff delays in `utils/retry.ts`
- Reduce chunk sizes in batch operations
- Monitor cost in GraphQL responses

## Contributing

When adding new features:

1. Add business logic to `packages/core/src/`
2. Export from `packages/core/src/index.ts`
3. Add CLI command in `apps/cli/src/index.ts`
4. Update this README with implementation status
5. Add inline documentation (JSDoc style)
6. Test with real stores (use test/dev stores only!)

## Security

- **Never commit `.env` files**
- **Never log admin tokens** (use `redactToken` from `utils/redact.ts`)
- **Use test stores for development**
- **Rotate tokens regularly**

## License

MIT
