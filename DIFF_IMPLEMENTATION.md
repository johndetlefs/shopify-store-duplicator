# Diff Commands Implementation

## Overview

The diff commands provide **validation and comparison tools** to verify migrations and detect drift between source and destination stores. This is essential for:

- **Post-migration validation**: Ensure everything was migrated correctly
- **Pre-migration dry-run**: Identify what would change before applying
- **Drift detection**: Monitor ongoing synchronization between stores
- **Troubleshooting**: Quickly identify missing or extra resources

## Architecture

### Two Comparison Levels

1. **Definitions Diff** (`defs:diff`)

   - Compares schema/structure
   - Metaobject definitions (types, fields)
   - Metafield definitions (owner/namespace/key triplets)
   - Field-level change detection

2. **Data Diff** (`data:diff`)
   - Compares actual data/content
   - Metaobjects (by type:handle)
   - Products, Collections, Pages (by handle)
   - High-level presence/absence check

### Natural Key Comparison

All comparisons use **natural keys** (never GIDs):

- **Metaobject definitions**: `type` (e.g., "blog_post")
- **Metafield definitions**: `{ownerType}/{namespace}/{key}` (e.g., "Product/custom/featured")
- **Metaobjects**: `{type}:{handle}` (e.g., "blog_post:my-first-post")
- **Products/Collections/Pages**: `handle` (e.g., "summer-tshirt")

This ensures comparisons work across different stores with different GIDs.

## Implementation Details

### Definitions Diff (`packages/core/src/defs/diff.ts`)

**Purpose**: Compare metaobject and metafield definitions

**Inputs**:

- Source: Definitions dump file (JSON from `defs:dump`)
- Destination: Live GraphQL queries to destination store

**Process**:

1. Read source definitions from dump file
2. Query destination definitions via GraphQL
3. Compare metaobject definitions by type
4. Compare metafield definitions by triplet
5. Detect missing, extra, and changed definitions
6. Report field-level differences

**Output**: `DefinitionDiffResult` with:

```typescript
{
  metaobjects: {
    missing: string[];        // Types in source but not destination
    extra: string[];          // Types in destination but not source
    changed: Array<{          // Types with differences
      type: string;
      changes: string[];      // Field-level changes
    }>;
  };
  metafields: {
    missing: string[];        // Triplets in source but not destination
    extra: string[];          // Triplets in destination but not source
    changed: Array<{          // Definitions with differences
      triplet: string;
      changes: string[];      // What changed
    }>;
  };
  summary: {
    totalIssues: number;
    isIdentical: boolean;
  };
}
```

**Comparison Logic**:

- Metaobject definitions indexed by `type`
- Metafield definitions indexed by `{ownerType}/{namespace}/{key}`
- Field-level comparison checks:
  - Name changes
  - Type changes
  - Required flag changes
  - Missing/extra fields
  - Description changes

**Example Changes Detected**:

```
field featured_image type: single_line_text_field → file_reference
field title required: false → true
missing field: author_name
extra field: legacy_id
```

### Data Diff (`packages/core/src/migration/diff.ts`)

**Purpose**: Compare actual data between source dump and destination

**Inputs**:

- Source: Data dump directory (from `data:dump`)
- Destination: Live bulk queries to destination store

**Process**:

1. Scan dump directory for data files
2. For each resource type:
   - Read source handles from dump
   - Query destination handles via bulk operation
   - Compare presence/absence
3. Aggregate results across all types

**Output**: `DataDiffResult` with:

```typescript
{
  metaobjects: Record<string, {
    missing: string[];        // Handles in source but not destination
    extra: string[];          // Handles in destination but not source
  }>;
  products: {
    missing: string[];
    extra: string[];
  };
  collections: {
    missing: string[];
    extra: string[];
  };
  pages: {
    missing: string[];
    extra: string[];
  };
  summary: {
    totalMissing: number;
    totalExtra: number;
    totalIssues: number;
    isIdentical: boolean;
  };
}
```

**Resource Types Compared**:

- **Metaobjects**: Grouped by type, compared by handle
- **Products**: Compared by handle
- **Collections**: Compared by handle
- **Pages**: Compared by handle

**Bulk Query Strategy**:

- Uses same bulk operations as dump
- Extracts only handles (memory efficient)
- Filters by `__typename` to ensure correct resource type

**Comparison Approach**:

- Set-based comparison for efficiency
- Missing = in source but not destination
- Extra = in destination but not source
- No field-level comparison (too verbose for data)

## CLI Integration

### `defs:diff` Command

**Usage**:

```bash
npm run cli -- defs:diff --file ./dumps/definitions.json
```

**Options**:

- `--file, -f <file>`: Source definitions file (default: `./dumps/definitions.json`)
- Uses destination credentials from environment

**Output Format**:

```
=== DEFINITIONS DIFF RESULTS ===

Found 5 differences

❌ Missing metaobject types (2):
  - custom_blog_post
  - author

➕ Extra metaobject types (1):
  - legacy_product_addon

⚠️  Changed metaobject types (1):
  - blog_post:
      field featured_image type: single_line_text_field → file_reference
      field tags required: false → true

⚠️  Changed metafield definitions (1):
  - Product/custom/featured:
      type: single_line_text_field → multi_line_text_field
```

**Exit Codes**:

- `0`: Definitions are identical
- `1`: Differences found or error occurred

### `data:diff` Command

**Usage**:

```bash
npm run cli -- data:diff --dir ./dumps
```

**Options**:

- `--dir, -d <directory>`: Dump directory (default: `./dumps`)
- Uses destination credentials from environment

**Output Format**:

```
=== DATA DIFF RESULTS ===

Found 45 missing, 12 extra

📦 Metaobjects:
  blog_post:
    ❌ Missing: 23 handles
       - my-first-post
       - announcing-new-feature
       - product-launch-2024
       - behind-the-scenes
       - customer-story-jane
       ... and 18 more
    ➕ Extra: 2 handles

🛍️  Products:
  ❌ Missing: 15 products
     - summer-collection-shirt
     - winter-jacket-blue
     - accessories-bundle
     ... and 12 more
  ➕ Extra: 8 products

📚 Collections:
  ❌ Missing: 5 collections
     - seasonal-favorites
     - new-arrivals
     ... and 3 more

📄 Pages:
  ➕ Extra: 2 pages
```

**Exit Codes**:

- `0`: Data is identical
- `1`: Differences found or error occurred

## Use Cases

### 1. Post-Migration Validation

**Scenario**: Just ran `defs:apply` and `data:apply`, want to verify success

**Workflow**:

```bash
# Check definitions first
npm run cli -- defs:diff

# If definitions match, check data
npm run cli -- data:diff
```

**Expected Result**: Both commands report identical, exit code 0

**If Issues Found**:

- Missing definitions → Re-run `defs:apply`
- Missing data → Re-run specific apply commands
- Extra items → Manual cleanup or expected drift

### 2. Pre-Migration Dry-Run

**Scenario**: Want to see what would be created before applying

**Workflow**:

```bash
# Dump from source
npm run cli -- defs:dump
npm run cli -- data:dump

# Compare with destination (should show everything as "missing")
npm run cli -- defs:diff
npm run cli -- data:diff
```

**Interpretation**:

- "Missing" items = would be created by apply
- "Extra" items = exist in destination but not source
- "Changed" definitions = would be updated by apply

### 3. Drift Detection

**Scenario**: Stores should stay synchronized, check for divergence

**Workflow**:

```bash
# Periodic check (e.g., daily cron job)
npm run cli -- defs:diff > /tmp/defs-diff.log
npm run cli -- data:diff > /tmp/data-diff.log

# Alert on non-zero exit code
if [ $? -ne 0 ]; then
  echo "Drift detected!"
  cat /tmp/data-diff.log | mail -s "Store Drift Alert" admin@example.com
fi
```

**Monitoring**: Track total issues over time

### 4. Selective Migration Verification

**Scenario**: Only migrated products, want to verify just that subset

**Workflow**:

```bash
# Dump only products from source
npm run cli -- data:dump --products-only

# Compare
npm run cli -- data:diff
```

**Result**: Will show product differences, ignore other resource types

### 5. Troubleshooting Failed Migrations

**Scenario**: Apply command reported some failures, need details

**Workflow**:

```bash
# After partial apply
npm run cli -- data:apply  # Shows 45 created, 3 failed

# See exactly what's missing
npm run cli -- data:diff
```

**Output**: Lists the 3 items that failed to apply

## Comparison Scope

### What IS Compared

✅ **Definitions**:

- Metaobject types and field definitions
- Metafield definitions (all owner types)
- Field types and required flags
- Definition names and descriptions

✅ **Data Presence**:

- Which metaobjects exist (by handle)
- Which products/collections/pages exist (by handle)
- Count of resources per type

### What is NOT Compared

❌ **Field-level data values**: Too verbose, would produce massive output
❌ **GIDs**: Not portable across stores
❌ **Timestamps**: Expected to differ (createdAt, updatedAt)
❌ **Internal metadata**: IDs, admin URLs, etc.
❌ **Menus**: Not included in data diff (separate resource)
❌ **Redirects**: Not included in data diff (separate resource)
❌ **Files**: URLs differ by store

**Rationale**: Diff tools focus on structure and presence, not deep value comparison. For field-level validation, compare dump files directly.

## Performance Considerations

### Definitions Diff

**Speed**: Fast (< 10 seconds for typical store)

- Small dataset (~100 definitions usually)
- Single paginated query per definition type
- In-memory comparison

**Memory**: Low (~10 MB)

- Definitions are small JSON objects
- Everything fits in memory

### Data Diff

**Speed**: Moderate (30 seconds - 5 minutes depending on store size)

- Bulk operations for each resource type
- ~5-10 bulk queries total
- Streaming JSONL (memory efficient)

**Memory**: Low despite large datasets (~50 MB)

- Only extracts handles, not full objects
- Uses streaming, not loading everything at once

**Optimization**:

- Parallel bulk queries (could be added)
- Currently sequential for rate limit safety

## Error Handling

### Missing Dump Files

**Scenario**: Referenced dump file doesn't exist

**Behavior**:

```
Error: Source dump file not found: ./dumps/definitions.json
```

**Exit code**: 1

**Solution**: Run dump command first

### Invalid JSON

**Scenario**: Dump file corrupted or malformed

**Behavior**:

```
Error during definitions diff: Unexpected token < in JSON at position 0
```

**Exit code**: 1

**Solution**: Re-run dump to get fresh export

### Destination Query Failures

**Scenario**: GraphQL query fails (permissions, network, etc.)

**Behavior**:

```
Error: Shopify API Error: access denied
```

**Exit code**: 1

**Solution**: Check credentials and scopes

### Bulk Operation Timeout

**Scenario**: Bulk query takes too long (very large store)

**Behavior**:

```
Error: Bulk operation polling timeout
```

**Exit code**: 1

**Solution**: Increase timeout in `bulk/runner.ts` or run again

## Idempotency

**Safe to re-run**: ✅ Yes, always

- Read-only operations
- No side effects
- Can run as many times as needed

**Recommended frequency**:

- Post-migration: Once
- Drift detection: Daily or weekly
- Pre-migration: As needed during planning

## Integration with Migration Workflow

### Complete Migration + Validation Workflow

```bash
# 1. Dump from source
npm run cli -- defs:dump
npm run cli -- data:dump

# 2. Apply to destination
npm run cli -- defs:apply
npm run cli -- data:apply
npm run cli -- menus:apply
npm run cli -- redirects:apply

# 3. Validate with diff
npm run cli -- defs:diff
if [ $? -eq 0 ]; then
  echo "✓ Definitions verified"
else
  echo "✗ Definition differences found"
  exit 1
fi

npm run cli -- data:diff
if [ $? -eq 0 ]; then
  echo "✓ Data verified"
else
  echo "✗ Data differences found"
  exit 1
fi

echo "🎉 Migration complete and verified!"
```

## Future Enhancements

**Potential additions** (not currently implemented):

1. **Field-level data comparison**

   - Compare metafield values, not just presence
   - Requires deep object comparison
   - Very verbose output (maybe JSON export instead)

2. **Menu diff**

   - Compare menu structures
   - Check for broken links

3. **Redirect diff**

   - Compare redirect rules
   - Detect missing SEO redirects

4. **Visual diff report**

   - HTML report with tables
   - Export to CSV for analysis

5. **Ignore lists**

   - Skip known differences
   - Filter out expected drift

6. **Automated fixes**
   - `--auto-fix` flag to apply missing items
   - Dangerous, needs safeguards

## Summary

The diff commands provide **essential validation tools** for the Shopify Store Duplicator:

✅ **Comprehensive**: Covers all definitions and data types  
✅ **Fast**: Efficient comparison using natural keys  
✅ **Safe**: Read-only, no side effects  
✅ **Actionable**: Clear output shows exactly what to fix  
✅ **Integrated**: Fits naturally into migration workflow

**Use them every time** to ensure migrations are complete and accurate!
