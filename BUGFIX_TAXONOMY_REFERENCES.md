# Bugfix: Taxonomy Reference Fields

**Date:** 2025-10-29  
**Status:** ✅ **FIXED**

## Issue

When running `data:apply`, metaobjects with taxonomy reference fields were failing with:

```
[WARN] Failed to upsert metaobject one-size {"error":"Variable $metaobject of type MetaobjectUpsertInput! was provided invalid value for fields.1.value (Expected value to not be null)"}
```

## Root Cause

The `extractReferenceKey()` function in `dump.ts` was returning a `DumpedField` object with **empty strings** for `key` and `type` when processing references that don't have natural keys (like `TaxonomyValue`).

When `Object.assign(dumped, refKeys)` was called, it **overwrote** the original field's `key` and `type` with empty strings, resulting in invalid field data:

```typescript
// Before the bug:
{ key: "taxonomy_reference", type: "product_taxonomy_value_reference", value: "gid://..." }

// After Object.assign with buggy extractReferenceKey:
{ key: "", type: "", value: null }  // ❌ INVALID!
```

## Fix Applied

Changed `extractReferenceKey()` to return `Partial<DumpedField>` instead of `DumpedField`, and removed the initialization of `key`, `type`, and `value` properties:

**Before:**

```typescript
function extractReferenceKey(ref: Reference | undefined): DumpedField {
  const field: DumpedField = {
    key: "", // ❌ This overwrites the original key!
    type: "", // ❌ This overwrites the original type!
    value: null, // ❌ This overwrites the original value!
  };
  // ...
}
```

**After:**

```typescript
function extractReferenceKey(ref: Reference | undefined): Partial<DumpedField> {
  const field: Partial<DumpedField> = {}; // ✅ Only add ref* properties
  // ...
  // For unsupported types like TaxonomyValue, return empty object
}
```

Now `Object.assign(dumped, refKeys)` only adds reference metadata (like `refProduct`, `refMetaobject`) without overwriting the original `key`, `type`, and `value`.

## Result

Taxonomy reference fields are now preserved correctly:

```json
{
  "key": "taxonomy_reference",
  "type": "product_taxonomy_value_reference",
  "value": "gid://shopify/TaxonomyValue/6882"
}
```

## Testing

✅ Re-dumped all metaobjects - no more empty fields  
✅ Verified `shopify--accessory-size` entries have valid taxonomy_reference fields  
✅ Full data dump completed successfully

## Next Steps

1. Run `npm run cli -- data:apply -i ./dumps` to apply the fixed data
2. All metaobjects should now create successfully, including those with taxonomy references

## Files Changed

- `packages/core/src/migration/dump.ts` - Fixed `extractReferenceKey()` function signature and implementation

---

_Issue discovered and fixed: 2025-10-29 01:42 UTC_
