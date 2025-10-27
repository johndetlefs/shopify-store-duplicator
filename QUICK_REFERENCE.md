# Quick Reference

## Common Commands

```bash
# Setup
npm install
npm run build

# Definitions
npm run dev -- defs:dump > defs.json
npm run dev -- defs:apply --file defs.json
npm run dev -- defs:diff --file defs.json

# Data (to be implemented)
npm run dev -- data:dump --output ./dumps
npm run dev -- data:apply --input ./dumps
npm run dev -- data:diff --input ./dumps

# Files
npm run dev -- files:apply --input files.json

# Menus
npm run dev -- menus:dump > menus.json
npm run dev -- menus:apply --file menus.json

# Redirects
npm run dev -- redirects:dump > redirects.json
npm run dev -- redirects:apply --file redirects.json
```

## Command Options

### Global Options (all commands)

```bash
--src-shop <domain>      # Source shop domain
--src-token <token>      # Source admin token
--dst-shop <domain>      # Destination shop domain
--dst-token <token>      # Destination admin token
--api-version <version>  # Shopify API version (default: 2025-10)
--dry-run               # Preview changes without applying
--verbose               # Enable debug logging
```

### Environment Variables

```env
SRC_SHOP_DOMAIN=source.myshopify.com
SRC_ADMIN_TOKEN=shpat_xxx...
DST_SHOP_DOMAIN=dest.myshopify.com
DST_ADMIN_TOKEN=shpat_yyy...
SHOPIFY_API_VERSION=2025-10
LOG_LEVEL=info          # debug | info | warn | error
LOG_FORMAT=pretty       # pretty | json
```

## File Structure

```
shopify-store-duplicator/
├── packages/core/src/
│   ├── bulk/           # Bulk operations (launch, poll, download JSONL)
│   ├── defs/           # Definitions (dump, apply)
│   ├── data/           # Data operations (to implement)
│   ├── files/          # File uploads
│   ├── menus/          # Menu management (to implement)
│   ├── redirects/      # Redirect management (to implement)
│   ├── map/            # Natural key → GID mapping
│   ├── graphql/        # GraphQL client and queries
│   └── utils/          # Logger, retry, chunk, redact, types
├── apps/cli/src/
│   └── index.ts        # CLI commands
└── dumps/              # Default output directory
```

## Data Flow

### Definitions

```
Source Store
    ↓ (defs:dump)
defs.json
    ↓ (defs:apply)
Destination Store
```

### Full Duplication

```
1. defs:dump    → Extract schema from source
2. defs:apply   → Create schema in destination
3. files:apply  → Seed file library
4. data:dump    → Extract data from source
5. data:apply   → Import data to destination (with reference remapping)
6. menus:apply  → Recreate navigation
7. redirects:apply → Recreate URL redirects
```

## Natural Key Examples

### Products

```typescript
handle: "awesome-product";
// Mapped to: gid://shopify/Product/123456789
```

### Metaobjects

```typescript
type: "hero_section";
handle: "homepage-hero";
// Key: "hero_section:homepage-hero"
// Mapped to: gid://shopify/Metaobject/987654321
```

### Variants

```typescript
productHandle: "awesome-product";
sku: "SKU-001";
// Key: "awesome-product:SKU-001"
// Mapped to: gid://shopify/ProductVariant/111222333
```

### Collections

```typescript
handle: "featured-collection";
// Mapped to: gid://shopify/Collection/444555666
```

## GraphQL Cost Monitoring

The CLI automatically monitors GraphQL cost:

```
[DEBUG] GraphQL request cost {
  actualCost: 45,
  available: 1955,
  maximum: 2000,
  duration: 234
}
```

Warning when approaching limit:

```
[WARN] Approaching GraphQL cost limit {
  availablePercent: 15.5,
  currentlyAvailable: 310
}
```

## Error Handling

All operations use Result types:

```typescript
type Result<T, E> = { ok: true; data: T } | { ok: false; error: E };
```

CLI exits with:

- `0` on success
- `1` on failure

## Rate Limiting

Automatic retry on:

- HTTP 429 (Rate Limited)
- HTTP 430 (GraphQL Throttled)

Backoff strategy:

- Initial delay: 1s
- Max delay: 32s
- Exponential growth with jitter
- Max attempts: 5

## Logging Levels

```bash
LOG_LEVEL=debug   # All messages
LOG_LEVEL=info    # Info, warn, error (default)
LOG_LEVEL=warn    # Warnings and errors
LOG_LEVEL=error   # Errors only
```

## Development

```bash
# Watch mode (auto-rebuild)
npm run watch -w @shopify-duplicator/core

# Run without building
npm run dev -- <command>

# Build and run
npm run build
./apps/cli/dist/index.js <command>
```

## Shopify API Scopes Required

```
read_products, write_products
read_collections, write_collections
read_metaobjects, write_metaobjects
read_content, write_content
read_files, write_files
read_navigation, write_navigation
read_online_store_pages, write_online_store_pages
```

## Security

✅ Tokens automatically redacted in logs
✅ `.env` excluded from git
⚠️ Use test stores for development
⚠️ Rotate tokens regularly

## Performance Tips

1. **Use bulk operations** for large datasets (automatic for most operations)
2. **Chunk mutations** (50-100 items per batch)
3. **Monitor costs** in logs and adjust if needed
4. **Use --dry-run** to preview changes
5. **Run during off-peak** hours for large migrations

## Troubleshooting Quick Fixes

```bash
# Module not found
npm install && npm run build

# TypeScript errors
npm run clean && npm run build

# Permission errors
# → Check API scopes in Shopify admin

# Rate limit errors
# → Reduce batch size or add delays

# Out of memory
# → Use streaming operations (already implemented for bulk)
```

## Common Patterns

### Dump and Apply

```bash
# Single file
npm run dev -- defs:dump > defs.json
npm run dev -- defs:apply --file defs.json

# With pipes
npm run dev -- defs:dump | npm run dev -- defs:apply
```

### Dry Run

```bash
# Preview without changes
npm run dev -- defs:apply --file defs.json --dry-run
```

### Override Credentials

```bash
# Override via CLI (ignores .env)
npm run dev -- defs:dump \
  --src-shop source.myshopify.com \
  --src-token shpat_xxx
```

## Help

```bash
# Main help
npm run dev -- --help

# Command help
npm run dev -- defs:dump --help
```

---

For detailed information:

- **Setup**: See `SETUP.md`
- **Architecture**: See `DEVELOPMENT.md`
- **Status**: See `IMPLEMENTATION.md`
- **Usage**: See `README.md`
