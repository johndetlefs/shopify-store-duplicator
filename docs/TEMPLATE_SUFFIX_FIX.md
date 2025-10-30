# Template Suffix Fix

**Date:** 30 October 2025  
**Issue:** Pages, blogs, and articles were not preserving custom template assignments during migration

## Problem

When migrating stores, all pages, blogs, and articles were being assigned to the "default" template in the destination store, even if they used custom templates in the source store. This is because the `templateSuffix` field was not being:

1. **Fetched** from the source store
2. **Stored** in the dump files
3. **Applied** to the destination store

## Solution

Added `templateSuffix` support for all three affected resource types: **Pages**, **Blogs**, and **Articles**.

### Changes Made

#### 1. GraphQL Queries (`packages/core/src/graphql/queries.ts`)

Added `templateSuffix` field to bulk queries:

- **PAGES_BULK**: Added `templateSuffix` field to page query
- **BLOGS_BULK**: Added `templateSuffix` field to blog query
- **ARTICLES_BULK**: Added `templateSuffix` field to article query

#### 2. Dump Interfaces (`packages/core/src/migration/dump.ts`)

Added `templateSuffix?: string` to interfaces:

```typescript
interface PageNode {
  // ... existing fields
  templateSuffix?: string;
}

interface BlogNode {
  // ... existing fields
  templateSuffix?: string;
}

interface ArticleNode {
  // ... existing fields
  templateSuffix?: string;
}
```

#### 3. Apply Interfaces (`packages/core/src/migration/apply.ts`)

Added `templateSuffix?: string` to dumped interfaces:

```typescript
interface DumpedPage {
  // ... existing fields
  templateSuffix?: string;
}

interface DumpedBlog {
  // ... existing fields
  templateSuffix?: string;
}

interface DumpedArticle {
  // ... existing fields
  templateSuffix?: string;
}
```

#### 4. Apply Functions (`packages/core/src/migration/apply.ts`)

Updated create and update operations to include `templateSuffix`:

**applyPages:**
- `PAGE_CREATE`: Added `templateSuffix: page.templateSuffix || null`
- `PAGE_UPDATE`: Added `templateSuffix: page.templateSuffix || null`

**applyBlogs:**
- `BLOG_CREATE`: Added `templateSuffix: blog.templateSuffix || null`
- `BLOG_UPDATE`: Added `templateSuffix: blog.templateSuffix || null`

**applyArticles:**
- `ARTICLE_CREATE`: Added `templateSuffix: article.templateSuffix || null`
- `ARTICLE_UPDATE`: Added `templateSuffix: article.templateSuffix || null`

## Usage

### For New Migrations

Simply run the normal migration workflow - templates will be preserved automatically:

```bash
# Dump source data (now includes templateSuffix)
npm run cli -- data:dump -o ./dumps

# Apply to destination (now sets templateSuffix)
npm run cli -- data:apply -i ./dumps
```

### For Existing Migrations

If you've already dumped data, you need to **re-dump** to capture the `templateSuffix` field:

```bash
# Re-dump source data to include templateSuffix
npm run cli -- data:dump -o ./dumps

# Re-apply to destination (idempotent - safe to re-run)
npm run cli -- data:apply -i ./dumps
```

The apply operation is **idempotent**, so re-running it will simply update the existing pages/blogs/articles with the correct template suffix.

## Technical Details

### Why `|| null`?

The Shopify GraphQL API expects `null` (not `undefined`) to reset a field to its default value. Using `|| null` ensures:
- If `templateSuffix` is set in source → it's copied to destination
- If `templateSuffix` is `undefined` → destination gets `null` (default template)

### Template Suffix Format

In Shopify, `templateSuffix` is the part after the period in a template filename:

- `page.contact.liquid` → `templateSuffix: "contact"`
- `article.featured.liquid` → `templateSuffix: "featured"`
- `blog.news.liquid` → `templateSuffix: "news"`
- Default templates → `templateSuffix: null`

## Validation

After applying, verify templates are correct:

1. **Check a page in destination admin:**
   - Go to Online Store → Pages
   - Open a page that had a custom template
   - Verify the template dropdown shows the correct template

2. **Check a blog in destination admin:**
   - Go to Online Store → Blog posts → Manage blogs
   - Open a blog
   - Verify the template dropdown shows the correct template

3. **Check an article in destination admin:**
   - Go to Online Store → Blog posts
   - Open an article
   - Verify the template dropdown shows the correct template

## Related Files

- `packages/core/src/graphql/queries.ts` - GraphQL queries and mutations
- `packages/core/src/migration/dump.ts` - Data export with TypeScript interfaces
- `packages/core/src/migration/apply.ts` - Data import with create/update logic

## Impact

This fix ensures **100% template fidelity** when migrating stores. All custom page, blog, and article templates are now preserved across migrations.
