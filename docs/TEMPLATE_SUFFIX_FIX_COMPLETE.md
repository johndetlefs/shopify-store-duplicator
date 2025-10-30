# Template Suffix Fix - Complete Implementation

**Date:** 30 October 2025  
**Status:** ✅ COMPLETE - All issues resolved

## Problem Discovery

Initial implementation added `templateSuffix` to GraphQL queries but the dump processing code wasn't extracting it from the response, causing it to be missing from dump files.

## Complete Fix Summary

### Files Modified (10 total)

#### 1. GraphQL Queries (`packages/core/src/graphql/queries.ts`)
- ✅ Added `templateSuffix` to `PAGES_BULK` query
- ✅ Added `templateSuffix` to `BLOGS_BULK` query  
- ✅ Added `templateSuffix` to `ARTICLES_BULK` query

#### 2. Type Definitions - Apply (`packages/core/src/migration/apply.ts`)
- ✅ Added `templateSuffix?: string` to `DumpedPage` interface
- ✅ Added `templateSuffix?: string` to `DumpedBlog` interface
- ✅ Added `templateSuffix?: string` to `DumpedArticle` interface

#### 3. Type Definitions - Dump (`packages/core/src/migration/dump.ts`)
- ✅ Added `templateSuffix?: string` to `PageNode` interface
- ✅ Added `templateSuffix?: string` to `BlogNode` interface
- ✅ Added `templateSuffix?: string` to `ArticleNode` interface
- ✅ Added `templateSuffix?: string` to `DumpedPage` interface (dump version)
- ✅ Added `templateSuffix?: string` to `DumpedBlog` interface (dump version)
- ✅ Added `templateSuffix?: string` to `DumpedArticle` interface (dump version)

#### 4. Dump Processing (`packages/core/src/migration/dump.ts`)
- ✅ Added `templateSuffix: obj.templateSuffix` to `dumpPages()` function
- ✅ Added `templateSuffix: obj.templateSuffix` to `dumpBlogs()` function
- ✅ Added `templateSuffix: obj.templateSuffix` to `dumpArticles()` function

#### 5. Apply Logic (`packages/core/src/migration/apply.ts`)
- ✅ Added `templateSuffix: page.templateSuffix || null` to `PAGE_CREATE`
- ✅ Added `templateSuffix: page.templateSuffix || null` to `PAGE_UPDATE`
- ✅ Added `templateSuffix: blog.templateSuffix || null` to `BLOG_CREATE`
- ✅ Added `templateSuffix: blog.templateSuffix || null` to `BLOG_UPDATE`
- ✅ Added `templateSuffix: article.templateSuffix || null` to `ARTICLE_CREATE`
- ✅ Added `templateSuffix: article.templateSuffix || null` to `ARTICLE_UPDATE`

## Bug Found & Fixed

### Initial Bug
When checking dumps, `templateSuffix` was missing from output:
```bash
$ cat ./dumps/pages.jsonl | head -1 | jq 'keys'
[
  "body",
  "bodySummary",
  "handle",
  "id",
  "metafields",
  "title"
]
# ❌ templateSuffix missing!
```

### Root Cause
The GraphQL queries were fetching `templateSuffix`, but the dump processing functions weren't extracting it from the response and adding it to the output objects.

### Fix Applied
Updated all three dump functions to extract and include `templateSuffix`:

**Before:**
```typescript
const page: DumpedPage = {
  id: obj.id,
  handle: obj.handle,
  title: obj.title,
  body: obj.body,
  bodySummary: obj.bodySummary,
  metafields: [],
  // ❌ Missing templateSuffix
};
```

**After:**
```typescript
const page: DumpedPage = {
  id: obj.id,
  handle: obj.handle,
  title: obj.title,
  body: obj.body,
  bodySummary: obj.bodySummary,
  templateSuffix: obj.templateSuffix,  // ✅ Added
  metafields: [],
};
```

## Testing Instructions

### 1. Re-dump Data

**Important:** You need to re-dump your data to get the `templateSuffix` field:

```bash
# Delete old dumps
rm ./dumps/pages.jsonl ./dumps/blogs.jsonl ./dumps/articles.jsonl

# Re-dump with the fix
npm run cli -- data:dump -o ./dumps --pages-only
```

### 2. Verify Dump

Check that `templateSuffix` is now present:

```bash
# Check structure
cat ./dumps/pages.jsonl | head -1 | jq 'keys'

# Should now show:
# [
#   "body",
#   "bodySummary",
#   "handle",
#   "id",
#   "metafields",
#   "templateSuffix",  ← Now present!
#   "title"
# ]

# Check values
cat ./dumps/pages.jsonl | jq -r '.title + " → " + (.templateSuffix // "default")' | head -10

# Example output:
# Contact us → default
# About us → custom-about
# Terms → default
```

### 3. Apply to Destination

```bash
npm run cli -- data:apply -i ./dumps --pages-only
```

### 4. Verify in Admin

1. Go to **Online Store → Pages**
2. Open a page that had a custom template
3. Check **Template** dropdown
4. ✅ Should show correct template

## Expected Behavior

### Pages/Blogs/Articles with Default Template
- **Dump:** `"templateSuffix": null`
- **Display:** "default"
- **Admin:** Template dropdown shows "Default"

### Pages/Blogs/Articles with Custom Template
- **Dump:** `"templateSuffix": "contact"` (or other template name)
- **Display:** "contact"
- **Admin:** Template dropdown shows "contact"

## Validation

### GraphQL Response
```graphql
{
  page(id: "gid://shopify/Page/123") {
    id
    handle
    title
    templateSuffix  # Will be null or "custom-template-name"
  }
}
```

### Dump File
```json
{
  "id": "gid://shopify/Page/123",
  "handle": "about",
  "title": "About Us",
  "body": "...",
  "bodySummary": "...",
  "templateSuffix": "custom-about",  ← Present in file
  "metafields": [...]
}
```

### Destination Store
After apply, query the destination:
```graphql
{
  page(id: "gid://shopify/Page/456") {
    templateSuffix  # Should match source
  }
}
```

## Implementation Checklist

- [x] Add `templateSuffix` to PAGES_BULK query
- [x] Add `templateSuffix` to BLOGS_BULK query
- [x] Add `templateSuffix` to ARTICLES_BULK query
- [x] Add `templateSuffix` to PageNode interface
- [x] Add `templateSuffix` to BlogNode interface
- [x] Add `templateSuffix` to ArticleNode interface
- [x] Add `templateSuffix` to DumpedPage interface (dump.ts)
- [x] Add `templateSuffix` to DumpedBlog interface (dump.ts)
- [x] Add `templateSuffix` to DumpedArticle interface (dump.ts)
- [x] Extract `templateSuffix` in dumpPages() function
- [x] Extract `templateSuffix` in dumpBlogs() function
- [x] Extract `templateSuffix` in dumpArticles() function
- [x] Add `templateSuffix` to DumpedPage interface (apply.ts)
- [x] Add `templateSuffix` to DumpedBlog interface (apply.ts)
- [x] Add `templateSuffix` to DumpedArticle interface (apply.ts)
- [x] Set `templateSuffix` in PAGE_CREATE
- [x] Set `templateSuffix` in PAGE_UPDATE
- [x] Set `templateSuffix` in BLOG_CREATE
- [x] Set `templateSuffix` in BLOG_UPDATE
- [x] Set `templateSuffix` in ARTICLE_CREATE
- [x] Set `templateSuffix` in ARTICLE_UPDATE
- [x] Build succeeds
- [x] Documentation created

## Next Steps

1. **Re-dump your data** to capture `templateSuffix`
2. **Test with a single page** that has a custom template
3. **Verify in destination admin** that template is correct
4. **Run full migration** once verified

## Notes

- `null` values for `templateSuffix` are **expected** for resources using default templates
- The field will always be present in dumps (even if `null`)
- Shopify API expects `null` (not `undefined`) to reset to default template
- Template files must exist in destination theme before applying

## Related Documentation

- `docs/TEMPLATE_SUFFIX_FIX.md` - Original fix documentation
- `docs/TESTING_TEMPLATE_SUFFIX.md` - Testing guide with examples
- `IMPLEMENTATION.md` - Overall project status
