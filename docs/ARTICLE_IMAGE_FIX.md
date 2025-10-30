# Article Image Support

**Date:** 30 October 2025  
**Issue:** Images weren't being brought across for articles/blogs  
**Status:** ✅ Fixed

## Problem

When dumping and applying articles, the `image` field was not being captured or migrated. This meant that article featured images (and their alt text) were lost during the migration process.

**Note:** Blogs do NOT have an `image` field in the Shopify API - only Articles have this field.

## Root Cause

The implementation was missing the `image` field in several places:
1. GraphQL query (`ARTICLES_BULK`) didn't fetch the image
2. TypeScript interfaces didn't include the image field
3. Dump processing didn't extract the image
4. Apply operations didn't set the image

## Solution

Added complete support for article images across the entire pipeline.

### Changes Made

#### 1. GraphQL Query (`packages/core/src/graphql/queries.ts`)

**Added `image` field to `ARTICLES_BULK` query:**

```graphql
export const ARTICLES_BULK = `
  {
    articles {
      edges {
        node {
          id
          handle
          title
          body
          templateSuffix
          image {
            altText
            url
          }
          blog {
            handle
          }
          metafields(first: 250) {
            ...
          }
        }
      }
    }
  }
`;
```

#### 2. Dump Interfaces (`packages/core/src/migration/dump.ts`)

**Updated `ArticleNode` interface:**

```typescript
interface ArticleNode {
  id: string;
  handle: string;
  title: string;
  body?: string;
  templateSuffix?: string;
  image?: {
    altText?: string;
    url?: string;
  };
  blog: {
    handle: string;
  };
  metafields?: MetafieldEdge[];
}
```

**Updated `DumpedArticle` interface:**

```typescript
interface DumpedArticle {
  id: string;
  handle: string;
  title: string;
  body?: string;
  templateSuffix?: string;
  image?: {
    altText?: string;
    url?: string;
  };
  blogHandle: string;
  metafields: DumpedMetafield[];
}
```

#### 3. Dump Processing (`packages/core/src/migration/dump.ts`)

**Updated `dumpArticles()` function to extract image:**

```typescript
const article: DumpedArticle = {
  id: obj.id,
  handle: obj.handle,
  title: obj.title,
  body: obj.body,
  templateSuffix: obj.templateSuffix,
  image: obj.image,  // ← Added this line
  blogHandle: obj.blog?.handle || "",
  metafields: [],
};
```

#### 4. Apply Interface (`packages/core/src/migration/apply.ts`)

**Updated `DumpedArticle` interface:**

```typescript
interface DumpedArticle {
  id: string;
  handle: string;
  blogHandle: string;
  title: string;
  body?: string;
  templateSuffix?: string;
  image?: {
    altText?: string;
    url?: string;
  };
  author?: string;
  tags?: string[];
  publishedAt?: string;
  metafields: DumpedMetafield[];
}
```

#### 5. Apply Operations (`packages/core/src/migration/apply.ts`)

**Updated `applyArticles()` function - UPDATE operation:**

```typescript
const articleInput: any = {
  title: article.title,
  body: article.body || "",
  tags: article.tags || [],
  templateSuffix: article.templateSuffix || null,
};

// Author is an object with a name property
if (article.author) {
  articleInput.author = { name: article.author };
}

// Add image if present
if (article.image) {
  articleInput.image = article.image;  // ← Added this
}
```

**Updated `applyArticles()` function - CREATE operation:**

```typescript
const articleInput: any = {
  blogId: blogGid,
  title: article.title,
  handle: article.handle,
  body: article.body || "",
  author: article.author ? { name: article.author } : { name: "Staff" },
  tags: article.tags || [],
  publishedAt: article.publishedAt,
  templateSuffix: article.templateSuffix || null,
};

// Add image if present
if (article.image) {
  articleInput.image = article.image;  // ← Added this
}
```

## Image Field Structure

According to Shopify's GraphQL API documentation:

### Article Image Object

```typescript
{
  altText?: string;  // Alt text for accessibility
  url: string;       // URL of the image (can be external)
}
```

### Setting Image on Create/Update

The `ArticleCreateInput` and `ArticleUpdateInput` accept an `image` object with:
- `altText` (optional): String for alt text
- `url` (required): URL of the image (can be external URL or Shopify CDN URL)

Example:
```json
{
  "image": {
    "altText": "Featured article image",
    "url": "https://cdn.shopify.com/s/files/1/0001/2345/articles/my-image.jpg"
  }
}
```

## Testing

### 1. Dump Articles

```bash
# Dump articles from source store
npm run cli -- data:dump --articles-only

# Verify image data is captured
cat ./dumps/articles.jsonl | jq '.image' | head -20
```

**Expected output:**
```json
{
  "altText": "Some alt text",
  "url": "https://cdn.shopify.com/s/files/..."
}
null  // For articles without images
```

### 2. Apply Articles

```bash
# Apply articles to destination store
npm run cli -- data:apply --articles-only

# Check destination store admin:
# Online Store → Blog posts → [Select blog] → [Select article]
# Verify featured image and alt text are present
```

### 3. Verify in Destination

1. Go to Shopify Admin → Online Store → Blog posts
2. Select a blog
3. Open an article that had a featured image in the source
4. Verify:
   - ✅ Featured image is displayed
   - ✅ Alt text matches source
   - ✅ Image URL points to correct resource

## Important Notes

### 1. Blogs vs Articles

- ✅ **Articles** have an `image` field (featured image)
- ❌ **Blogs** do NOT have an `image` field

This is why the fix only applies to articles.

### 2. External URLs Supported

Shopify allows external image URLs in the `image.url` field. You don't need to upload the image to Shopify first - you can reference any publicly accessible image URL.

### 3. Image Upload vs Reference

This implementation **references** the image URL from the source. The image itself is not re-uploaded. This means:

- ✅ **Pro:** Fast migration, no file uploads needed
- ⚠️ **Consideration:** Image URLs must remain accessible

If you need to re-upload images (copy files to destination store), that would require:
1. Downloading the image from source URL
2. Uploading to destination using `stagedUploadsCreate` + `fileCreate`
3. Updating the article with the new destination CDN URL

This more complex approach is not implemented in this fix but could be added if needed.

### 4. Idempotency

The image field is set on both CREATE and UPDATE operations:
- First run: Creates article with image
- Re-run: Updates existing article, preserving or updating image

## Backward Compatibility

✅ This change is backward compatible:
- Old dumps without `image` field will still work (image is optional)
- New dumps will include `image` field when present
- Apply operations handle both cases gracefully

## Related Files

- `packages/core/src/graphql/queries.ts` - GraphQL queries
- `packages/core/src/migration/dump.ts` - Dump operations
- `packages/core/src/migration/apply.ts` - Apply operations

## Status

✅ **Complete and tested**
- Build successful
- All TypeScript interfaces updated
- Dump captures image data
- Apply sets image on create/update
- Backward compatible
