# Page Content Migration - Implementation Summary

## What Was Added

Implemented complete page content migration in `data/apply.ts` - pages are now fully created/updated, not just their metafields.

## New Function

### `applyPages(client, inputFile, index)`

**Purpose**: Create and update page content (title, body, handle) in destination store.

**Logic**:
```typescript
for each page in pages.jsonl:
  if page exists in destination (by handle):
    → PAGE_UPDATE with new title and body
    → stats.updated++
  else:
    → PAGE_CREATE with handle, title, body
    → Add to index for subsequent metafield operations
    → stats.created++
```

**Idempotency**: Safe to re-run
- Creates pages that don't exist
- Updates content for existing pages
- Handle cannot change after creation (Shopify constraint)

**Stats**: Separate tracking for created vs updated pages

## Updated Workflow

### Before (Old)
```
1. Build index
2. Apply metaobjects
3. Rebuild index
4. Apply metafields (including page metafields)
   └─ PROBLEM: Page metafields fail if page doesn't exist!
```

### After (New)
```
1. Build index
2. Apply metaobjects
3. Rebuild index
4. Apply pages (create/update content) ← NEW
5. Rebuild index (include new pages)
6. Apply metafields (now pages exist!)
```

## Migration Flow

```
pages.jsonl
  ↓
┌─────────────────────────────────┐
│ For each page:                  │
│                                 │
│ Handle: "about-us"              │
│ Exists? → Check index           │
│   ↓                             │
│   ├─ YES → PAGE_UPDATE          │
│   │        (title, body)        │
│   │                             │
│   └─ NO → PAGE_CREATE           │
│            (handle, title, body)│
│            Add to index         │
└─────────────────────────────────┘
  ↓
Destination store has page content
  ↓
applyPageMetafields can now attach metafields
```

## Code Changes

### 1. New Function Added
**File**: `/packages/core/src/migration/apply.ts`
- Lines ~710-845: New `applyPages()` function
- Creates pages with `PAGE_CREATE` mutation
- Updates pages with `PAGE_UPDATE` mutation
- Tracks created/updated separately

### 2. Updated Main Function
**File**: `/packages/core/src/migration/apply.ts`
- `applyAllData()` now calls `applyPages()` before metafields
- Returns 3 stats objects: `{ metaobjects, pages, metafields }`
- Rebuilds index after page creation

### 3. CLI Updated
**File**: `/apps/cli/src/index.ts`
- `data:apply` command now shows page stats
- Displays created/updated counts separately
- Includes page errors in error reporting

### 4. Exports
**File**: `/packages/core/src/index.ts`
- `applyPages` automatically exported via `export * from "./migration/apply.js"`

## Example Output

```bash
$ shopify-duplicator data:apply -i ./dumps

=== Starting Data Apply ===
Step 1: Building destination index...
Indexed 245 products, 12 collections, 3 pages

Step 2: Applying metaobjects...
✓ Applied 45 metaobjects (0 failed)

Rebuilding index...

Step 3: Applying pages...
✓ Applied 8 pages (5 created, 3 updated, 0 failed)

Rebuilding index...

Step 4: Applying metafields...
✓ Applied 156 product metafields (0 failed)
✓ Applied 24 collection metafields (0 failed)
✓ Applied 16 page metafields (0 failed)

=== Data Apply Complete ===
{
  metaobjects: { total: 45, created: 45, failed: 0 },
  pages: { total: 8, created: 5, updated: 3, failed: 0 },
  metafields: { total: 196, created: 196, failed: 0 }
}
```

## Benefits

1. **Complete Migration**: Pages are now fully migrated, not just their metafields
2. **Content Preserved**: Page title and body HTML content transferred
3. **Idempotent**: Re-running updates existing pages instead of failing
4. **Transparent**: Stats show exactly what happened (created vs updated)
5. **Resilient**: Page metafields no longer fail due to missing pages

## What's Migrated

### Page Properties
- ✅ `handle` - Used for natural key mapping
- ✅ `title` - Page title
- ✅ `body` - Full HTML content
- ✅ `metafields` - Custom metafields (via separate function)

### Not Migrated (Shopify Limitations)
- ❌ `bodySummary` - Not writable via GraphQL API
- ❌ Published status - Pages created as published by default
- ❌ SEO fields - Would need separate mutations

## Edge Cases Handled

1. **Duplicate handles**: GraphQL returns error, logged and continues
2. **Invalid HTML**: Shopify sanitizes, no validation errors
3. **Missing pages in dump**: Skips gracefully
4. **Network failures**: Retry logic from GraphQL client applies

## Testing Checklist

- [x] Pages created when missing in destination
- [x] Page content updated when exists in destination
- [x] Newly created pages added to index
- [x] Page metafields apply after page creation
- [x] Stats accurately reflect created vs updated
- [x] Errors reported without halting process
- [x] CLI displays all stats correctly
- [x] No TypeScript compilation errors

## Documentation Updated

- ✅ `/DATA_APPLY_IMPLEMENTATION.md` - Added `applyPages()` details
- ✅ `/WORKFLOW.md` - Updated data flow diagram
- ✅ Both docs marked "Pages content" limitation as FIXED

## Impact

**Before**: Pages had to exist manually in destination for metafields to work.

**After**: Complete automated migration including page creation and content updates.

This closes a major gap in the migration workflow! 🎉
