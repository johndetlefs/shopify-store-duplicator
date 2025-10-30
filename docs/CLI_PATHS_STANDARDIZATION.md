# CLI Default Paths Standardization

**Date:** 30 October 2025  
**Enhancement:** Standardized all CLI command default paths to use `./dumps`

## Problem

The CLI had inconsistent default paths across different commands:
- `data:dump` and `data:apply` used `data/dumps`
- `defs:dump` and `defs:apply` used `data/source-defs.json`
- `menus:dump` and `menus:apply` used `data/menus.json`
- `redirects:dump` and `redirects:apply` used `data/redirects.json`
- Some commands (like `defs:diff` and `data:diff`) were duplicated (one non-functional, one functional)

This was confusing for users and created unnecessary nested directories.

## Solution

Standardized ALL commands to use `./dumps` as the default directory with consistent naming:

### New Defaults

| Command | Old Default | New Default |
|---------|-------------|-------------|
| `defs:dump` | `data/source-defs.json` | `./dumps/definitions.json` |
| `defs:apply` | `data/source-defs.json` | `./dumps/definitions.json` |
| `defs:diff` | `./dumps/definitions.json` | `./dumps/definitions.json` ✅ (no change) |
| `data:dump` | `data/dumps` | `./dumps` |
| `data:apply` | `data/dumps` | `./dumps` |
| `data:diff` | `./dumps` | `./dumps` ✅ (no change) |
| `menus:dump` | `data/menus.json` | `./dumps/menus.json` |
| `menus:apply` | `data/menus.json` | `./dumps/menus.json` |
| `redirects:dump` | `data/redirects.json` | `./dumps/redirects.json` |
| `redirects:apply` | `data/redirects.json` | `./dumps/redirects.json` |
| `files:apply` | `./dumps/files.jsonl` | `./dumps/files.jsonl` ✅ (no change) |

### Additional Cleanup

- ✅ Removed duplicate non-functional `defs:diff` command (kept functional one)
- ✅ Removed duplicate non-functional `data:diff` command (kept functional one)

## Changes Made

**File: `apps/cli/src/index.ts`**

1. Updated `defs:dump` default output
2. Updated `defs:apply` default input
3. Removed duplicate `defs:diff` (non-functional at line ~294)
4. Updated `data:dump` default output directory
5. Updated `data:apply` default input directory
6. Removed duplicate `data:diff` (non-functional at line ~625)
7. Updated `menus:dump` default output
8. Updated `menus:apply` default input
9. Updated `redirects:dump` default output
10. Updated `redirects:apply` default input

## Usage

### Before (Inconsistent Paths)

```bash
# Old way - confusing nested paths
npm run cli -- defs:dump
# Saved to: data/source-defs.json

npm run cli -- data:dump
# Saved to: data/dumps/pages.jsonl, data/dumps/blogs.jsonl, etc.

npm run cli -- menus:dump
# Saved to: data/menus.json
```

### After (Consistent `./dumps`)

```bash
# New way - all in ./dumps
npm run cli -- defs:dump
# Saves to: ./dumps/definitions.json

npm run cli -- data:dump
# Saves to: ./dumps/pages.jsonl, ./dumps/blogs.jsonl, etc.

npm run cli -- menus:dump
# Saves to: ./dumps/menus.json

npm run cli -- redirects:dump
# Saves to: ./dumps/redirects.json
```

## Complete Workflow

### Full Migration with New Defaults

```bash
# 1. Dump definitions
npm run cli -- defs:dump
# → ./dumps/definitions.json

# 2. Dump all data
npm run cli -- data:dump
# → ./dumps/pages.jsonl
# → ./dumps/blogs.jsonl
# → ./dumps/articles.jsonl
# → ./dumps/products.jsonl
# → ./dumps/collections.jsonl
# → ./dumps/metaobjects.jsonl
# → ./dumps/files.jsonl
# → ./dumps/shop-metafields.jsonl

# 3. Dump menus
npm run cli -- menus:dump
# → ./dumps/menus.json

# 4. Dump redirects
npm run cli -- redirects:dump
# → ./dumps/redirects.json

# 5. Apply to destination (in order)
npm run cli -- defs:apply
# ← ./dumps/definitions.json

npm run cli -- data:apply
# ← ./dumps/*.jsonl

npm run cli -- menus:apply
# ← ./dumps/menus.json

npm run cli -- redirects:apply
# ← ./dumps/redirects.json
```

### Custom Paths Still Work

```bash
# You can still specify custom paths
npm run cli -- defs:dump -o ./my-backup/defs.json
npm run cli -- data:dump -o ./my-dumps
npm run cli -- menus:dump -o ./custom/menus.json

# Apply from custom paths
npm run cli -- defs:apply -f ./my-backup/defs.json
npm run cli -- data:apply -i ./my-dumps
npm run cli -- menus:apply -f ./custom/menus.json
```

## Benefits

1. **Consistency** - All dumps go to `./dumps` directory
2. **Simplicity** - No more nested `data/` directory
3. **Predictability** - Users know where to find dumps
4. **Less Typing** - Default works for most use cases
5. **Clean Structure** - Project root stays organized

## File Structure

After running dumps, your project will have:

```
shopify-store-duplicator/
├── dumps/                      ← All dumps here!
│   ├── definitions.json        ← Metaobject/metafield definitions
│   ├── pages.jsonl             ← Pages data
│   ├── blogs.jsonl             ← Blogs data
│   ├── articles.jsonl          ← Articles data
│   ├── products.jsonl          ← Products data
│   ├── collections.jsonl       ← Collections data
│   ├── metaobjects.jsonl       ← Metaobject entries
│   ├── files.jsonl             ← Files metadata
│   ├── shop-metafields.jsonl   ← Shop-level metafields
│   ├── menus.json              ← Navigation menus
│   └── redirects.json          ← URL redirects
├── packages/
├── apps/
└── ...
```

## Migration Guide

If you have existing dumps in old locations:

```bash
# If you have old dumps in data/ directory
mkdir -p ./dumps
mv data/source-defs.json ./dumps/definitions.json
mv data/menus.json ./dumps/menus.json
mv data/redirects.json ./dumps/redirects.json
mv data/dumps/* ./dumps/
rmdir data/dumps
rmdir data  # if empty

# Now all commands use ./dumps
npm run cli -- defs:apply
npm run cli -- data:apply
npm run cli -- menus:apply
npm run cli -- redirects:apply
```

## Verification

Check help output for any command to see new defaults:

```bash
npm run cli -- defs:dump --help
# Output file (default: "./dumps/definitions.json")

npm run cli -- data:dump --help
# Output directory (default: "./dumps")

npm run cli -- menus:dump --help
# Output file (default: "./dumps/menus.json")

npm run cli -- redirects:dump --help
# Output file (default: "./dumps/redirects.json")
```

## Removed Duplicates

### defs:diff
- ❌ Removed: Non-functional command at line ~294 (just showed warning)
- ✅ Kept: Functional command at line ~1035 (performs actual comparison)

### data:diff
- ❌ Removed: Non-functional command at line ~625 (just showed warning)
- ✅ Kept: Functional command at line ~1133 (performs actual comparison)

## Testing

```bash
# Test all dump commands use ./dumps
npm run cli -- defs:dump
ls -la ./dumps/definitions.json  # Should exist

npm run cli -- data:dump --pages-only
ls -la ./dumps/pages.jsonl  # Should exist

npm run cli -- menus:dump
ls -la ./dumps/menus.json  # Should exist

npm run cli -- redirects:dump
ls -la ./dumps/redirects.json  # Should exist
```

## Status

✅ Build successful  
✅ All defaults standardized to `./dumps`  
✅ Duplicate commands removed  
✅ Backward compatible (can still specify custom paths)  
✅ Ready for production use!
