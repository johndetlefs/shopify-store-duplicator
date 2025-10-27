# Redirects Implementation

## Overview

The redirects module enables exporting and importing URL redirects between Shopify stores. This is critical for maintaining SEO value and preventing broken links when restructuring or migrating store content.

## Implementation Summary

**Files:**

- `packages/core/src/redirects/dump.ts` (~120 lines)
- `packages/core/src/redirects/apply.ts` (~195 lines)

**GraphQL Operations:**

- `REDIRECTS_BULK` - Bulk query to fetch all redirects
- `REDIRECT_CREATE` - Mutation to create individual redirects

**CLI Commands:**

- `redirects:dump` - Export redirects from source store
- `redirects:apply` - Import redirects into destination store

## How It Works

### Dump Process

1. **Bulk Query**: Fetches all URL redirects using Shopify's bulk operations API
2. **Simple Extraction**: Each redirect has just two fields:
   - `path` - The old/source path (e.g., `/old-product`)
   - `target` - The new/destination path (e.g., `/products/new-product`)
3. **JSON Export**: Saves to a simple JSON structure

### Apply Process

1. **Read Dump**: Loads redirects from JSON file
2. **Fetch Existing**: Queries destination store for existing redirects to avoid duplicates
3. **Idempotent Creation**: Only creates redirects that don't already exist
4. **Throttled Execution**: Creates redirects one at a time with 500ms delay (2/second) to respect rate limits
5. **Stats Tracking**: Reports created, skipped, and failed counts

## Example Data Structure

### Dump Output Format

```json
{
  "redirects": [
    {
      "path": "/old-collection",
      "target": "/collections/new-collection"
    },
    {
      "path": "/discontinued-product",
      "target": "/products/replacement-product"
    },
    {
      "path": "/legacy-page",
      "target": "/pages/updated-page"
    }
  ]
}
```

## Key Features

### Idempotency

The apply operation is fully idempotent:

- Fetches all existing redirects before creating new ones
- Compares by `path` (the source URL)
- Skips redirects that already exist
- Safe to re-run multiple times

### Rate Limit Handling

- Creates redirects sequentially (not in parallel)
- 500ms delay between requests (2 per second)
- Conservative throttling to avoid API rate limits

**Note**: Shopify doesn't provide a bulk redirect creation mutation, so each redirect must be created individually. For stores with thousands of redirects, this process may take several minutes.

### Error Handling

- Individual redirect failures don't stop the process
- All errors are collected and reported at the end
- Failed redirects are logged with specific error messages
- Exit code reflects whether any failures occurred

## Usage

### Basic Workflow

```bash
# 1. Dump redirects from source store
npm run cli -- redirects:dump \
  --src-shop source.myshopify.com \
  --src-token scapi_xxx

# 2. Apply to destination store
npm run cli -- redirects:apply \
  --dst-shop destination.myshopify.com \
  --dst-token scapi_yyy

# Output example:
# ✅ Created redirect: /old-page → /pages/new-page
# ⏭  Skipped existing redirect: /already-exists
# ❌ Failed to create redirect: /bad-target (Invalid target URL)
#
# ✓ Redirects apply complete
#   Created: 45
#   Skipped: 12
#   Failed: 3
```

### Custom File Paths

```bash
# Dump to custom location
npm run cli -- redirects:dump -o ./backups/redirects-2025-10-27.json

# Apply from custom location
npm run cli -- redirects:apply -f ./backups/redirects-2025-10-27.json
```

## Integration with Full Migration

Redirects should be applied **late in the migration process**, after all content exists:

```bash
# Complete migration workflow
npm run cli -- defs:apply        # 1. Create metaobject/metafield definitions
npm run cli -- files:apply       # 2. Seed file library
npm run cli -- data:apply        # 3. Import products, collections, pages, metaobjects
npm run cli -- menus:apply       # 4. Create navigation menus
npm run cli -- redirects:apply   # 5. Finally, create redirects
```

**Why apply redirects last?**

- Redirects reference products, collections, and pages
- Those resources must exist before redirects can point to them
- Shopify validates redirect targets

## Common Redirect Patterns

### Product URL Changes

```json
{
  "path": "/products/old-handle",
  "target": "/products/new-handle"
}
```

### Collection Reorganization

```json
{
  "path": "/collections/deprecated",
  "target": "/collections/new-category"
}
```

### Page Migrations

```json
{
  "path": "/pages/old-about",
  "target": "/pages/about-us"
}
```

### External Redirects

```json
{
  "path": "/promo",
  "target": "https://external-site.com/campaign"
}
```

## Edge Cases & Limitations

### Duplicate Paths

If the source store has multiple redirects with the same `path`:

- Only the last one encountered will be preserved in the dump
- Shopify enforces unique paths per store

### Invalid Targets

Shopify validates redirect targets:

- Must be a valid URL (relative or absolute)
- Relative URLs should start with `/`
- If target doesn't exist, Shopify will still create the redirect but it will lead to a 404

### Circular Redirects

The implementation doesn't detect circular redirect chains:

- Source: `/a` → `/b`
- Source: `/b` → `/a`

These will be created successfully but won't work as expected in the store.

### Rate Limits

With 500ms between requests:

- 100 redirects ≈ 50 seconds
- 1,000 redirects ≈ 8-9 minutes
- 10,000 redirects ≈ 83 minutes

For very large redirect sets, consider breaking into smaller batches.

## Implementation Details

### Why No Bulk Creation?

Shopify's Admin GraphQL API provides:

- ✅ Bulk query for reading redirects
- ❌ No bulk mutation for creating redirects

Therefore, we must create redirects one at a time using `urlRedirectCreate`.

### Comparison with Menus

Both modules follow similar patterns but with key differences:

| Feature        | Menus                            | Redirects               |
| -------------- | -------------------------------- | ----------------------- |
| Structure      | Hierarchical (nested)            | Flat                    |
| URL Remapping  | Yes (products/collections/pages) | No (paths copied as-is) |
| Bulk Creation  | No                               | No                      |
| Index Required | Yes                              | No                      |
| Complexity     | Higher                           | Lower                   |

Redirects are simpler because:

- No nested structure
- No reference remapping needed
- Paths are literal strings, not GID-based references

## Future Enhancements

Potential improvements:

1. **Bulk Creation**: If Shopify adds a bulk redirect mutation, update to use it
2. **Circular Detection**: Validate redirect chains before applying
3. **Target Validation**: Check if redirect targets actually exist in destination
4. **Batch Grouping**: Group redirects by target domain/path for better logging
5. **Progress Bar**: Visual progress indicator for large redirect sets

## Testing

To test redirects implementation:

```bash
# 1. Create test redirects in source store
# Via Shopify Admin: Online Store > Navigation > URL Redirects

# 2. Dump from source
npm run cli -- redirects:dump

# 3. Verify dumps/redirects.json
cat dumps/redirects.json

# 4. Apply to clean destination store
npm run cli -- redirects:apply

# 5. Verify in destination store Admin
# Check: Online Store > Navigation > URL Redirects

# 6. Re-run apply (idempotency test)
npm run cli -- redirects:apply
# Should show: Created: 0, Skipped: X, Failed: 0
```

## Troubleshooting

### "Failed to create redirect: Invalid target"

**Cause**: Target URL is malformed or doesn't follow Shopify's URL rules

**Solution**: Check the redirect target in the dump file. Ensure it's either:

- A relative path starting with `/` (e.g., `/products/example`)
- An absolute URL with protocol (e.g., `https://example.com`)

### "Bulk operation failed"

**Cause**: GraphQL bulk operation error during dump

**Solution**:

- Check API credentials and permissions
- Verify store is accessible
- Check Shopify API status

### Apply taking too long

**Cause**: Large number of redirects + 500ms throttling

**Solution**:

- This is expected behavior (intentional rate limiting)
- For 1000+ redirects, consider running overnight
- Or split dump file into smaller chunks and apply separately

## Summary

The redirects module provides a simple, reliable way to migrate URL redirects between Shopify stores:

- **Simple data structure** (path → target pairs)
- **Idempotent apply** (safe to re-run)
- **Rate-limited creation** (respects API limits)
- **Complete error reporting** (tracks successes/failures)

While not as complex as menus or data migration, redirects are critical for SEO and user experience during store migrations.
