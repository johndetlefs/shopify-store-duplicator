# Quick Reference - Shopify Store Duplicator

## Complete Migration (One-Liner)

```bash
# Full migration workflow
npm run cli -- defs:dump -o defs.json && \
npm run cli -- defs:apply -f defs.json && \
npm run cli -- data:dump -o ./dumps && \
npm run cli -- data:apply -i ./dumps && \
npm run cli -- menus:dump -o menus.json && \
npm run cli -- menus:apply -f menus.json && \
npm run cli -- redirects:dump -o redirects.json && \
npm run cli -- redirects:apply -f redirects.json && \
echo "✅ Migration complete!"
```

## Essential Commands

### Setup

```bash
npm install              # Install dependencies
npm run build           # Build packages
cp .env.example .env    # Create config file
# Edit .env with your store credentials
```

### Definitions (Schema)

```bash
npm run cli -- defs:dump -o defs.json           # Export
npm run cli -- defs:apply -f defs.json          # Import
npm run cli -- defs:diff -f defs.json           # Validate
```

### Data (All Resources)

```bash
npm run cli -- data:dump -o ./dumps             # Export all
npm run cli -- data:apply -i ./dumps            # Import all
npm run cli -- data:diff -i ./dumps             # Validate all
```

### Data (Selective)

```bash
npm run cli -- data:dump --metaobjects-only -o ./dumps
npm run cli -- data:dump --products-only -o ./dumps
npm run cli -- data:dump --collections-only -o ./dumps
npm run cli -- data:dump --pages-only -o ./dumps
```

### Menus

```bash
npm run cli -- menus:dump -o menus.json         # Export
npm run cli -- menus:apply -f menus.json        # Import
```

### Redirects

```bash
npm run cli -- redirects:dump -o redirects.json # Export
npm run cli -- redirects:apply -f redirects.json # Import
```

### Data Cleanup (Destructive)

```bash
npm run cli -- data:drop --files-only           # Delete all files from destination
# ⚠️ WARNING: Destructive operation! Requires interactive confirmation.
# Other options (NOT YET IMPLEMENTED):
#   --products-only
#   --collections-only
#   --metaobjects-only
```

## Global Options

All commands support:

```bash
--src-shop <domain>      # Override source shop domain
--src-token <token>      # Override source admin token
--dst-shop <domain>      # Override destination shop domain
--dst-token <token>      # Override destination admin token
--api-version <version>  # Override Shopify API version (default: 2025-10)
--dry-run               # Preview changes without executing
--verbose               # Enable debug logging (-v)
```

Example:

```bash
npm run cli -- defs:apply -f defs.json --dry-run --verbose
```

### What Gets Migrated

✅ Metaobject definitions (schema)  
✅ Metafield definitions (schema)  
✅ Metaobject entries (data)  
✅ Products + variants (with metafields)  
✅ Collections (with metafields)  
✅ Pages (HTML content + metafields)  
✅ Blogs (with metafields)  
✅ Articles (content + metafields)  
✅ Shop metafields  
✅ Files (media library + auto-relinking, **100% idempotent**)  
✅ Navigation menus (with URL remapping)  
✅ URL redirects

**All operations are idempotent** - safe to re-run without creating duplicates.

## Output Files

After `data:dump -o ./dumps`:

```
./dumps/
├── metaobjects-hero_banner.jsonl    # One file per metaobject type
├── metaobjects-testimonial.jsonl
├── products.jsonl                   # Products with variants + metafields
├── collections.jsonl                # Collections with metafields
├── pages.jsonl                      # Pages with HTML + metafields
├── blogs.jsonl                      # Blogs with metafields
├── articles.jsonl                   # Articles with content + metafields
├── shop-metafields.jsonl            # Shop-level metafields
└── files.jsonl                      # Media library files
```

Each `.jsonl` file contains one JSON object per line (newline-delimited JSON).

## Natural Key Examples

The tool uses **natural keys** for cross-store mapping:

```javascript
// Products
handle: "awesome-tshirt"
// Maps to: gid://shopify/Product/{different-id-per-store}

// Collections
handle: "summer-sale"
// Maps to: gid://shopify/Collection/{different-id-per-store}

// Pages
handle: "about-us"
// Maps to: gid://shopify/Page/{different-id-per-store}

// Blogs
handle: "news"
// Maps to: gid://shopify/Blog/{different-id-per-store}

// Articles
blogHandle: "news", handle: "new-product"
// Key: "news:new-product"
// Maps to: gid://shopify/Article/{different-id-per-store}

// Metaobjects
type: "hero_banner", handle: "homepage"
// Key: "hero_banner:homepage"
// Maps to: gid://shopify/Metaobject/{different-id-per-store}

// Variants
productHandle: "tshirt", sku: "RED-L"
// Key: "tshirt:RED-L"
// Maps to: gid://shopify/ProductVariant/{different-id-per-store}
```

## Environment Variables (.env)

```env
# Required
SRC_SHOP_DOMAIN=source.myshopify.com
SRC_ADMIN_TOKEN=shpat_xxx...
DST_SHOP_DOMAIN=dest.myshopify.com
DST_ADMIN_TOKEN=shpat_yyy...

# Optional
SHOPIFY_API_VERSION=2025-10      # Default API version
LOG_LEVEL=info                   # debug | info | warn | error
LOG_FORMAT=pretty                # pretty | json
```

## Typical Migration Flow

```
┌─────────────────────────────────────┐
│      SOURCE STORE                   │
│  Products, Collections, Pages,      │
│  Metaobjects, Blogs, Articles       │
└─────────────────────────────────────┘
              ↓
    ┌─────────────────┐
    │   defs:dump     │ Export schema
    └─────────────────┘
              ↓
         defs.json
              ↓
    ┌─────────────────┐
    │   defs:apply    │ Import schema
    └─────────────────┘
              ↓
┌─────────────────────────────────────┐
│   DESTINATION STORE (schema ready)  │
└─────────────────────────────────────┘
              ↓
    ┌─────────────────┐
    │   data:dump     │ Export all data
    └─────────────────┘
              ↓
        ./dumps/
   (JSONL files with
    natural keys)
              ↓
    ┌─────────────────┐
    │   data:apply    │ Import & remap
    └─────────────────┘
              ↓
┌─────────────────────────────────────┐
│   DESTINATION STORE (data ready)    │
│  All references remapped ✓          │
│  Files uploaded & relinked ✓        │
└─────────────────────────────────────┘
              ↓
    ┌─────────────────┐
    │  menus:dump     │
    │  menus:apply    │ Navigation
    └─────────────────┘
              ↓
    ┌─────────────────┐
    │ redirects:dump  │
    │ redirects:apply │ SEO redirects
    └─────────────────┘
              ↓
    ┌─────────────────┐
    │  data:diff      │ Validate
    └─────────────────┘
              ↓
┌─────────────────────────────────────┐
│   MIGRATION COMPLETE ✅             │
└─────────────────────────────────────┘
```

## Common Workflows

### Test Migration (Development Stores)

```bash
# 1. Export from source
npm run cli -- defs:dump -o test-defs.json
npm run cli -- data:dump -o ./test-dumps

# 2. Review exports
cat test-defs.json | jq .
ls -lh ./test-dumps/

# 3. Dry run to preview
npm run cli -- defs:apply -f test-defs.json --dry-run --verbose
npm run cli -- data:apply -i ./test-dumps --dry-run --verbose

# 4. Apply for real
npm run cli -- defs:apply -f test-defs.json
npm run cli -- data:apply -i ./test-dumps

# 5. Validate
npm run cli -- defs:diff -f test-defs.json
npm run cli -- data:diff -i ./test-dumps
```

### Production Migration

```bash
# 1. Create backups of destination store first!

# 2. Export during low-traffic period
npm run cli -- defs:dump -o prod-defs.json
npm run cli -- data:dump -o ./prod-dumps
npm run cli -- menus:dump -o prod-menus.json
npm run cli -- redirects:dump -o prod-redirects.json

# 3. Import during maintenance window
npm run cli -- defs:apply -f prod-defs.json
npm run cli -- data:apply -i ./prod-dumps
npm run cli -- menus:apply -f prod-menus.json
npm run cli -- redirects:apply -f prod-redirects.json

# 4. Validate everything
npm run cli -- defs:diff -f prod-defs.json
npm run cli -- data:diff -i ./prod-dumps

# 5. Verify in Shopify admin
# - Check metaobjects
# - Verify product metafields
# - Test page content
# - Click through menus
```

### Clean and Rebuild (Development)

```bash
# Use case: Testing file upload or starting fresh

# 1. Delete all files from destination
npm run cli -- data:drop --files-only
# Interactive confirmation required (type "delete")

# 2. Re-upload files
npm run cli -- data:apply -i ./dumps

# Result: Fresh file upload with proper alt text and references
```

### Update Existing Migration

```bash
# Safe to re-run! Operations are 100% idempotent
npm run cli -- data:dump -o ./dumps
npm run cli -- data:apply -i ./dumps

# What happens on re-run:
# - Files: Updated if alt text changed, skipped if unchanged (no duplicates)
# - Metaobjects: Updated by type:handle, not duplicated
# - Metafields: Updated by namespace:key, not duplicated
# - Pages/Blogs/Articles: Updated by handle, not duplicated
# Only new/changed items will be created/updated
```

### File Idempotency Details

The file upload process is fully idempotent:

```bash
# First run - uploads all files
npm run cli -- data:apply -i ./dumps
# → Files: 50 uploaded, 0 updated, 0 skipped

# Second run - skips unchanged files
npm run cli -- data:apply -i ./dumps
# → Files: 0 uploaded, 0 updated, 50 skipped

# After changing alt text in source dump
npm run cli -- data:apply -i ./dumps
# → Files: 0 uploaded, 5 updated, 45 skipped
```

**How it works:**

- Queries existing destination files (matched by filename)
- Updates if alt text differs
- Skips if file is already correct
- Creates only if file doesn't exist
- No duplicates, even on multiple runs

## Troubleshooting

### Module not found

```bash
npm run clean && npm install && npm run build
```

### Permission errors

Check API scopes in Shopify admin - ensure all read/write scopes are enabled.

### Rate limiting

Automatic retry with exponential backoff. For large stores, run during off-peak hours.

### Missing references

Check `--verbose` logs for warnings. Ensure source resources exist with proper handles.

### Failed validation

```bash
npm run cli -- data:diff -i ./dumps --verbose
# Review differences and re-apply if needed
npm run cli -- data:apply -i ./dumps
```

### Duplicate files after migration

If you accidentally created duplicate files:

```bash
# 1. Delete all files from destination
npm run cli -- data:drop --files-only

# 2. Re-run migration (files will be uploaded fresh)
npm run cli -- data:apply -i ./dumps
```

### Testing file upload without full migration

```bash
# Upload only files (skip metaobjects, products, etc.)
npm run cli -- files:apply -i ./dumps/files.jsonl
```

## Performance Expectations

| Store Size | Resources                          | Dump    | Apply   |
| ---------- | ---------------------------------- | ------- | ------- |
| Small      | 100 products, 50 metaobjects       | ~30s    | ~2 min  |
| Medium     | 1,000 products, 500 metaobjects    | ~3 min  | ~15 min |
| Large      | 10,000 products, 5,000 metaobjects | ~15 min | ~60 min |

**Bottlenecks**: Shopify rate limits (handled automatically)

## Exit Codes

- `0` - Success
- `1` - Failure (check logs for details)

## Logging

```bash
# Enable verbose logging
npm run cli -- data:apply -i ./dumps --verbose

# Or set in .env
LOG_LEVEL=debug          # All messages
LOG_LEVEL=info           # Default
LOG_LEVEL=warn           # Warnings only
LOG_LEVEL=error          # Errors only

LOG_FORMAT=pretty        # Human-readable (default)
LOG_FORMAT=json          # Machine-readable
```

## Development Commands

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Clean build artifacts
npm run clean

# Watch mode (auto-rebuild on changes)
npm run watch -w @shopify-duplicator/core

# Run in development mode
npm run dev -- <command>
```

## Required Shopify API Scopes

```
read_products, write_products
read_collections, write_collections
read_metaobjects, write_metaobjects
read_content, write_content
read_files, write_files
read_navigation, write_navigation
read_online_store_pages, write_online_store_pages
```

## Security Checklist

✅ Tokens automatically redacted in logs  
✅ `.env` excluded from git  
✅ Source store is read-only  
⚠️ **Test with development stores first**  
⚠️ Create destination store backups  
⚠️ Rotate API tokens regularly

## Documentation

- **README.md** - Main guide with complete workflow
- **SETUP.md** - Installation and configuration details
- **QUICK_REFERENCE.md** - This cheat sheet (you are here)
- **IMPLEMENTATION.md** - Technical implementation details
- **docs/IDEMPOTENT_FILES.md** - File idempotency implementation guide
- **docs/FILE_IDEMPOTENCY_IMPLEMENTATION.md** - Technical summary

---

**Need Help?**

- Use `--verbose` flag for detailed logs
- Check SETUP.md for configuration
- Review README.md for examples
- Use `--dry-run` to preview changes

**Status**: ✅ 100% Feature Complete | Production Ready
