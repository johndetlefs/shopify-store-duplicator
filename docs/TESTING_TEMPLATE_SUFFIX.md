# Testing Template Suffix Fix

**Date:** 30 October 2025  
**Feature:** Template suffix preservation for pages, blogs, and articles

## Quick Answer

✅ **YES - You can test with flags!** You don't need to run a full dump and apply.

## Recommended Testing Approach

### Option 1: Test Individual Resources (Fastest) ⚡

Test each resource type separately to verify template preservation:

```bash
# 1. Dump only pages from source
npm run cli -- data:dump -o ./dumps --pages-only

# 2. Apply only pages to destination
npm run cli -- data:apply -i ./dumps --pages-only

# 3. Verify page templates in destination admin
# Go to: Online Store → Pages → Check template dropdown

# 4. Repeat for blogs
npm run cli -- data:dump -o ./dumps --blogs-only
npm run cli -- data:apply -i ./dumps --blogs-only

# 5. Repeat for articles (requires blogs to exist first)
npm run cli -- data:dump -o ./dumps --articles-only
npm run cli -- data:apply -i ./dumps --articles-only
```

### Option 2: Test All CMS Content Together (Recommended) ✨

Test pages, blogs, and articles in one go:

```bash
# 1. Dump all three resources (no products/collections/metaobjects)
npm run cli -- data:dump -o ./dumps --pages-only
npm run cli -- data:dump -o ./dumps --blogs-only  # Appends to same dir
npm run cli -- data:dump -o ./dumps --articles-only  # Appends to same dir

# 2. Apply all CMS content to destination
npm run cli -- data:apply -i ./dumps --pages-only
npm run cli -- data:apply -i ./dumps --blogs-only
npm run cli -- data:apply -i ./dumps --articles-only

# OR apply sequentially with one command each
```

### Option 3: Full Migration (Most Complete)

If you want to test the complete workflow:

```bash
# Dump everything (includes template suffix for all resources)
npm run cli -- data:dump -o ./dumps

# Apply everything
npm run cli -- data:apply -i ./dumps
```

## Available Flags

### Dump Command Flags

```bash
npm run cli -- data:dump [options]

Options:
  -o, --output <dir>        Output directory (default: "data/dumps")
  --metaobjects-only        Dump only metaobjects
  --products-only           Dump only products
  --collections-only        Dump only collections
  --pages-only              Dump only pages ← NEW: Now includes templateSuffix
  # Note: --blogs-only and --articles-only need to be checked in code
```

### Apply Command Flags

```bash
npm run cli -- data:apply [options]

Options:
  -i, --input <dir>         Input directory (default: "data/dumps")
  --products-only           Apply products only
  --collections-only        Apply collections only
  --metaobjects-only        Apply metaobjects only
  --pages-only              Apply pages only ← Now sets templateSuffix
  --blogs-only              Apply blogs only ← Now sets templateSuffix
  --articles-only           Apply articles only ← Now sets templateSuffix
  --product-metafields-only Apply product metafields only
```

## Verification Steps

### 1. Check Source Data (Before Applying)

Inspect the dumped JSONL files to verify `templateSuffix` was captured:

```bash
# Check pages dump
head -1 ./dumps/pages.jsonl | jq '.'

# Should see:
{
  "id": "gid://shopify/Page/...",
  "handle": "about",
  "title": "About Us",
  "body": "...",
  "bodySummary": "...",
  "templateSuffix": "contact",  ← Should be present if page has custom template
  "metafields": [...]
}

# Check blogs dump
head -1 ./dumps/blogs.jsonl | jq '.'

# Should see:
{
  "id": "gid://shopify/Blog/...",
  "handle": "news",
  "title": "News",
  "templateSuffix": "standard",  ← Should be present
  "metafields": [...]
}

# Check articles dump
head -1 ./dumps/articles.jsonl | jq '.'

# Should see:
{
  "id": "gid://shopify/Article/...",
  "handle": "my-article",
  "blogHandle": "news",
  "title": "My Article",
  "body": "...",
  "templateSuffix": "featured",  ← Should be present
  "metafields": [...]
}
```

### 2. Verify in Destination Admin (After Applying)

#### Pages
1. Go to **Online Store → Pages**
2. Click on a page that had a custom template in source
3. Check the **Template** dropdown
4. ✅ Should show the correct custom template (e.g., "contact", "about")
5. ❌ Should NOT show "Default"

#### Blogs
1. Go to **Online Store → Blog posts → Manage blogs**
2. Click on a blog
3. Check the **Template** dropdown
4. ✅ Should show the correct custom template
5. ❌ Should NOT show "Default"

#### Articles
1. Go to **Online Store → Blog posts**
2. Click on an article
3. Check the **Template** dropdown
4. ✅ Should show the correct custom template
5. ❌ Should NOT show "Default"

### 3. Quick Verification with GraphQL

Query the destination store to verify `templateSuffix`:

```graphql
# Check a page
{
  page(id: "gid://shopify/Page/YOUR_PAGE_ID") {
    id
    handle
    title
    templateSuffix
  }
}

# Check a blog
{
  blog(id: "gid://shopify/Blog/YOUR_BLOG_ID") {
    id
    handle
    title
    templateSuffix
  }
}

# Check an article
{
  article(id: "gid://shopify/Article/YOUR_ARTICLE_ID") {
    id
    handle
    title
    templateSuffix
  }
}
```

## Test Cases

### Test Case 1: Page with Custom Template
- **Source:** Page using `page.contact.liquid`
- **Expected in dump:** `"templateSuffix": "contact"`
- **Expected in destination:** Template dropdown shows "contact"

### Test Case 2: Page with Default Template
- **Source:** Page using default `page.liquid`
- **Expected in dump:** `"templateSuffix": null` or field absent
- **Expected in destination:** Template dropdown shows "Default"

### Test Case 3: Blog with Custom Template
- **Source:** Blog using `blog.news.liquid`
- **Expected in dump:** `"templateSuffix": "news"`
- **Expected in destination:** Template dropdown shows "news"

### Test Case 4: Article with Custom Template
- **Source:** Article using `article.featured.liquid`
- **Expected in dump:** `"templateSuffix": "featured"`
- **Expected in destination:** Template dropdown shows "featured"

### Test Case 5: Re-apply (Idempotency Test)
- **Action:** Run apply command twice
- **Expected:** Second run updates templates again (no errors)
- **Verify:** Template still correct after second apply

## Troubleshooting

### Issue: `templateSuffix` not in dump file

**Cause:** Old dump created before this fix  
**Solution:** Re-dump with the updated code

```bash
# Delete old dump
rm ./dumps/pages.jsonl ./dumps/blogs.jsonl ./dumps/articles.jsonl

# Re-dump with new code
npm run cli -- data:dump -o ./dumps --pages-only
```

### Issue: Template showing as "Default" in destination

**Possible causes:**
1. Source page/blog/article actually uses default template (`templateSuffix` is null)
2. Destination theme doesn't have the custom template file
3. Template name mismatch (e.g., `page.contact.liquid` in source but `page.contact-us.liquid` in destination)

**Solution:** 
- Verify source has custom template
- Ensure destination theme has matching template file
- Check template names match exactly

### Issue: Apply fails with template error

**Error message:** "Template not found" or similar  
**Solution:** The destination theme must have the template file before applying. Upload theme with templates first.

## Performance

### Individual Resource Flags
- **Pages only:** ~5-30 seconds (depending on page count)
- **Blogs only:** ~5-15 seconds (usually fewer blogs)
- **Articles only:** ~10-60 seconds (can have many articles)

### Full Migration
- **Complete dump+apply:** 5-30 minutes (depending on store size)

## Best Practice

**For testing this specific fix:**
1. ✅ Use `--pages-only`, `--blogs-only`, `--articles-only` flags
2. ✅ Test with a small subset of pages/blogs/articles
3. ✅ Verify in admin UI before running full migration
4. ✅ Test idempotency by running apply twice

**For production migration:**
1. Run full dump/apply without flags
2. Verify all templates preserved
3. Keep dumps for rollback capability

## Example Test Session

```bash
# Clean start
rm -rf ./dumps
mkdir -p ./dumps

# Dump pages only
npm run cli -- data:dump -o ./dumps --pages-only

# Verify dump has templateSuffix
cat ./dumps/pages.jsonl | head -1 | jq '.templateSuffix'

# Apply to destination
npm run cli -- data:apply -i ./dumps --pages-only

# Check logs for success
# ✓ Applied X pages (Y created, Z updated, 0 failed)

# Verify in destination admin
# Go to Online Store → Pages → Check template dropdown

# Test idempotency
npm run cli -- data:apply -i ./dumps --pages-only
# Should succeed with same counts

# Repeat for blogs and articles...
```

## Summary

**Fastest testing method:** Use `--pages-only`, `--blogs-only`, `--articles-only` flags to test each resource type individually.

**Most thorough testing:** Run full dump/apply to ensure everything works together.

**Recommended:** Start with individual flags to verify the fix works, then do a full migration for production.
