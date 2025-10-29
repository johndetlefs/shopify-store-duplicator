# Idempotent File Handling

## Problem

Previously, running `data:apply` multiple times would upload the same files repeatedly, creating duplicates in the destination store. This violated the project's core idempotency principle.

## Solution

Files are now fully idempotent using a **filename-based matching** strategy:

### How It Works

1. **Query Existing Files**

   - Before uploading, query all existing files from destination
   - Build a filename → file map for fast lookup
   - Extract filename from URL path (e.g., `image.jpg` from `https://cdn.shopify.com/.../image.jpg`)

2. **Match & Decide**

   - For each source file, check if a file with the same filename exists
   - **If exists + alt text differs**: Update with `fileUpdate` mutation
   - **If exists + unchanged**: Skip (already correct)
   - **If doesn't exist**: Create with `fileCreate` mutation

3. **Track Statistics**
   - `uploaded`: New files created
   - `updated`: Existing files updated (alt text changed)
   - `skipped`: Files that are already correct
   - `failed`: Errors during create/update

### Why Filename?

Files in Shopify don't have handles (natural keys) like products or collections. We had three options:

- ❌ **URL matching**: Unreliable - URLs change between stores
- ❌ **Alt text matching**: Can be empty or duplicate
- ✅ **Filename matching**: Stable, extracted from URL path, reliable identifier

### GraphQL Mutations Used

```graphql
# Create new files
mutation fileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files {
      id
      alt
      image {
        url
      }
    }
    userErrors {
      field
      message
    }
  }
}

# Update existing files
mutation fileUpdate($files: [FileUpdateInput!]!) {
  fileUpdate(files: $files) {
    files {
      id
      alt
      image {
        url
      }
    }
    userErrors {
      field
      message
    }
  }
}

# Query existing files
query files($first: Int!, $after: String) {
  files(first: $first, after: $after) {
    edges {
      node {
        id
        alt
        fileStatus
        image {
          url
        }
        url
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```

## Implementation Details

### Key Files

- `packages/core/src/files/apply.ts` - Main implementation
- `packages/core/src/graphql/queries.ts` - GraphQL queries/mutations

### Functions

#### `queryExistingFiles(client)`

- Queries all files from destination (paginated, 250 per page)
- Returns `Map<filename, ExistingFile>`
- Handles all file types: MediaImage, Video, GenericFile

#### `updateFile(client, { id, alt })`

- Updates file metadata using `fileUpdate` mutation
- Returns updated file GID and URL
- Handles userErrors from Shopify API

#### `applyFiles(client, inputFile)`

- Main orchestration function
- **Step 1**: Query existing files
- **Step 2**: Parse source files from dump
- **Step 3**: Process each file (create/update/skip)
- **Step 4**: Build file index for relinking
- Returns FileIndex with URL/GID mappings

### Stats Tracking

```typescript
interface UploadStats {
  total: number;
  uploaded: number; // New files created
  updated: number; // Existing files updated
  skipped: number; // Unchanged files
  failed: number;
  errors: string[];
}
```

## Usage

Running `data:apply` multiple times is now safe:

```bash
# First run - uploads all files
npm run cli -- data:apply -i ./dumps
# Files: 50 uploaded, 0 updated, 0 skipped, 0 failed

# Second run - skips unchanged files
npm run cli -- data:apply -i ./dumps
# Files: 0 uploaded, 0 updated, 50 skipped, 0 failed

# After changing alt text in source dump
npm run cli -- data:apply -i ./dumps
# Files: 0 uploaded, 5 updated, 45 skipped, 0 failed
```

## Benefits

1. **Idempotent**: Safe to re-run without duplicates
2. **Efficient**: Skips unchanged files, only updates what changed
3. **Trackable**: Clear stats show what happened
4. **Resilient**: Continues on errors, reports all failures
5. **Complete**: Still builds file index for reference relinking

## Future Enhancements

Possible improvements:

- **Content hash matching**: Detect file content changes (not just metadata)
- **Batch updates**: Group fileUpdate calls (currently one-by-one)
- **Filename collision handling**: Detect multiple files with same name
- **Preview image updates**: Support updating preview images
- **Product reference sync**: Update product associations
