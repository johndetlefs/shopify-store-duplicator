# Bulk Operations Error Fix

## Problem

When running `npm run cli -- data:dump -o ./dumps`, the metaobjects dump was failing with the error:

```
[ERROR] Failed to dump metaobjects for type shopify--gin-variety: {"name":"ShopifyApiError"}
```

The actual error message was not being displayed due to insufficient error logging.

## Root Cause

After improving error logging, the actual error was revealed:

```
"Queries that contain a connection field within a list field are not currently supported."
```

This is a **Shopify bulk operations limitation**. The query was structured as:

```graphql
{
  metaobjects(type: "...") {
    edges {
      node {
        fields {                    # This is a list
          references(first: 250) {  # This is a connection - NOT ALLOWED in bulk!
            edges {
              node { ... }
            }
          }
        }
      }
    }
  }
}
```

Shopify's bulk operations API does **not support nested connections within list fields**. According to the [bulk operations documentation](https://shopify.dev/docs/api/usage/bulk-operations/queries#operation-restrictions):

- Maximum of two levels deep for nested connections
- Connections within list fields are not supported

## Solution

### 1. Improved Error Logging

Enhanced error logging in three places to show full error details:

**`packages/core/src/migration/dump.ts`:**

```typescript
logger.error(`Failed to dump metaobjects for type ${type}:`, {
  error: result.error.message,
  status: result.error.status,
  response: result.error.response,
});
```

**`packages/core/src/bulk/runner.ts`:**

- Added logging when bulk operation submission fails
- Added logging when bulk operation status becomes "FAILED"

### 2. Removed Nested Connection from Query

Modified `METAOBJECTS_BY_TYPE_BULK` in `packages/core/src/graphql/queries.ts` to remove the `references` connection field:

**Before:**

```typescript
fields {
  key
  type
  value
  reference { ... }
  references(first: 250) {  // ❌ REMOVED - Not supported in bulk operations
    edges {
      node { ... }
    }
  }
}
```

**After:**

```typescript
fields {
  key
  type
  value
  reference { ... }
  // references field removed
}
```

### 3. Alternative Handling for List References

For list reference fields (e.g., `list.product_reference`), the `value` field contains a JSON array of GIDs:

```json
{
  "key": "related_products",
  "type": "list.product_reference",
  "value": "[\"gid://shopify/Product/123\", \"gid://shopify/Product/456\"]"
}
```

We now:

1. Keep the raw JSON `value` as-is (it will be used during apply)
2. Parse and extract GID types for debugging/logging purposes
3. Store in `refList` with extracted type information

**Implementation in `dump.ts`:**

```typescript
function extractGidType(gid: string): string {
  const match = gid.match(/gid:\/\/shopify\/([^\/]+)\//);
  return match ? match[1] : "Unknown";
}

// For list references, parse the JSON value
if (
  field.type.startsWith("list.") &&
  field.type.includes("_reference") &&
  field.value
) {
  const gids = JSON.parse(field.value);
  dumped.refList = gids.map((gid: string) => ({
    type: extractGidType(gid),
    gid: gid,
  }));
}
```

## Result

All metaobject types now dump successfully:

```
[INFO] ✓ Dumped 8 metaobjects of type ribbon
[INFO] ✓ Dumped 3 metaobjects of type vendor
[INFO] ✓ Dumped 5 metaobjects of type badge
[INFO] ✓ Dumped 3 metaobjects of type shopify--chocolate-type
[INFO] ✓ Dumped 18 metaobjects of type shopify--color-pattern
[INFO] ✓ Dumped 3 metaobjects of type shopify--gin-variety
...
```

## Trade-offs

**Previous approach (attempted):**

- ✅ Fetched full reference details (handles, types, etc.) in bulk query
- ❌ Not supported by Shopify bulk operations API

**Current approach:**

- ✅ Works within Shopify bulk operations limitations
- ✅ Single references still include full details (handle, type)
- ⚠️ List references stored as JSON GID arrays
- ⚠️ List reference natural keys resolved during apply phase (requires destination lookup)

**Note:** For non-remappable reference types (like `TaxonomyValue`), the GIDs can be used directly without modification, so this is not an issue.

## Apply Phase Handling

During `data:apply`, list references will be handled as follows:

1. For types that don't need remapping (TaxonomyValue, etc.): Use the raw JSON value as-is
2. For types that need remapping (Product, Collection, Metaobject, etc.):
   - Parse the JSON GID array
   - Look up each GID type
   - Resolve to destination GIDs using the destination index
   - Reconstruct JSON array with destination GIDs

This logic will be implemented in the apply phase.

## Files Modified

1. `packages/core/src/graphql/queries.ts` - Removed `references` connection from bulk query
2. `packages/core/src/migration/dump.ts` - Updated field transformation for list references
3. `packages/core/src/bulk/runner.ts` - Enhanced error logging

## Testing

Verified with:

```bash
npm run build
npm run cli -- data:dump -o ./dumps
```

All metaobject types now dump successfully without errors.
