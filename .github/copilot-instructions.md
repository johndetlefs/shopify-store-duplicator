# Project: Shopify Store ## Architectural principles

- ✅ **Idempotent:** All "apply" operations are safe to re-run (implemented with upsert patterns).
- ✅ **Deterministic remapping:** Never relies on source GIDs. All mappings use **natural keys**:
  - Metaobjects → `{type}:{handle}`
  - Products / Collections / Pages / Blogs → `handle`
  - Articles → `{blogHandle}:{articleHandle}` (composite key)
  - Variants → `{productHandle}:{sku}` (fallback to `{productHandle}:pos{position}` if SKU missing)
- ✅ **Strict ordering** (7-phase apply workflow):
  1. Build destination index (handles → GIDs)
  2. Upload files & build file index (URL/GID → destination GID)
  3. Apply metaobjects with file reference relinking
  4. Apply blogs (handle-based)
  5. Apply articles (composite key with blog lookup)
  6. Apply pages (with full HTML content)
  7. Apply metafields to all resources (products, variants, collections, pages, blogs, articles, shop)
- ✅ **Rate limits & resilience:** Exponential backoff on 429/430; chunked writes (25-50 per batch); log and continue on per-record errors.
- ✅ **Security:** Tokens from `.env`; automatic redaction in logs; URLs with tokens redacted.
- ✅ **Observability:** Structured logs with configurable levels; detailed stats for created/updated/skipped/failed.TypeScript, Node)

**Status:** ✅ **100% COMPLETE - PRODUCTION READY**

**Goal:** Programmatically duplicate a Shopify store's _custom data_ and content from a **source** to a **destination** store with high fidelity and repeatability, without making the destination non-transferable.

## Scope (All Features Implemented ✅)

- ✅ **Definitions (schema):** metaobject definitions + field definitions; metafield definitions (by owner type / namespace / key).
- ✅ **Data (content):** metaobject _entries_, metafields on core resources (products, variants, collections, pages, articles, blogs, shop), menus, redirects.
- ✅ **CMS content:** Pages, blogs, articles with full HTML content and metafields.
- ✅ **Files:** Upload files to destination, build file index, automatically relink file references in metaobjects/metafields.
- ✅ **Validation:** Diff commands for definitions and data to verify completeness.
- **Non-goals:** orders, discounts, gift cards, analytics, customer data, theme code.

Uses **Shopify Admin GraphQL** with **Bulk Operations** for efficient large-scale reads/writes. Bulk queries return JSONL; parsed robustly with streaming for memory efficiency.: Shopify Store Duplicator (TypeScript, Node)

**Goal:** Programmatically duplicate a Shopify store’s _custom data_ and content from a **source** to a **destination** store with high fidelity and repeatability, without making the destination non-transferable. Scope includes:

- **Definitions (schema):** metaobject definitions + field definitions; metafield definitions (by owner type / namespace / key).
- **Data (content):** metaobject _entries_, metafields on core resources (products, variants, collections, pages, articles, blogs, shop), menus, redirects, pages/articles/blogs content, and files (seed file library; relink by handle/type).
- **Non-goals:** orders, discounts, gift cards, analytics.

Use **Shopify Admin GraphQL** with **Bulk Operations** for large reads/writes where possible. Bulk queries return JSONL; parse robustly; handle pagination implicitly.

## Architectural principles

- **Idempotent:** All “apply” operations must be safe to re-run.
- **Deterministic remapping:** Never rely on source GIDs. Build mappings by **natural keys**:
  - Metaobjects → `{type}:{handle}`
  - Products / Collections / Blogs / Pages / Articles → `handle`
  - Variants → `(productHandle, sku)` (fallback to position if sku missing)
- **Strict ordering:**
  1. Definitions → 2) Files → 3) Metaobjects (entries) → 4) Resource metafields → 5) CMS (pages/articles/blogs) → 6) Menus → 7) Redirects.
- **Rate limits & resilience:** Exponential backoff on 429/430; chunk writes; log and continue on per-record errors.
- **Security:** Read tokens from `.env`; never log secrets; redact URLs with tokens.
- **Observability:** Structured logs; progress bars; counters for created/updated/skipped/failed.

## Repo layout (monorepo-lite)

```
/packages/core
  /src/bulk/        # ✅ Bulk launcher, poller, downloader, streaming JSONL parser
  /src/defs/        # ✅ Dump/apply metaobject & metafield definitions
  /src/migration/   # ✅ Dump/apply metaobjects, metafields, pages, blogs, articles, shop metafields
  /src/files/       # ✅ File upload, index building, reference relinking
  /src/menus/       # ✅ Dump/apply navigation menus with URL remapping
  /src/redirects/   # ✅ Dump/apply URL redirects
  /src/map/         # ✅ Natural key → GID mapping with destination indexing
  /src/graphql/     # ✅ Complete GraphQL queries/mutations for all operations
  /src/utils/       # ✅ Retry, chunking, logger, redaction, types

/apps/cli
  /src/index.ts     # ✅ Commander-based CLI with all commands wired
```

## Commands (CLI) - All Implemented ✅

### Definitions

- `defs:dump` → Export metaobject/metafield **definitions** (schema) to JSON
- `defs:apply` → Upsert definitions to destination (idempotent)
- `defs:diff` → Compare definitions, report missing/changed

### Data

- `data:dump` → Bulk export all data (metaobjects, products, collections, pages, blogs, articles, shop metafields, files)
- `data:apply` → Import all data with automatic reference remapping and file relinking (7-phase workflow)
- `data:diff` → Compare source dump vs destination, report missing resources

### Menus & Redirects

- `menus:dump` → Export navigation menus
- `menus:apply` → Import menus with automatic URL remapping
- `redirects:dump` → Export URL redirects
- `redirects:apply` → Import redirects (idempotent)

### Files (Integrated into data:apply)

- Files are automatically uploaded and relinked during `data:apply`
- File references in metaobjects/metafields are automatically updated to destination GIDs

## Coding standards

- **Language:** TypeScript (ES2022 modules). Node 20+.
- **Style:** Small, pure functions; no static singletons; DI via parameters.
- **Error handling:** Return discriminated unions: `{ ok: true, data } | { ok: false, error }`.
- **Logging:** Single `logger.ts` with levels; JSON lines in CI; human-friendly in local.
- **Testing:** Light unit tests around mappers/parsers; snapshot tests for JSON transforms.
- **Packages:** `commander`, `zod`. Use native `fetch` (Node 20+), fall back to `node-fetch` only if needed.
- **Env:** `.env` with `SRC_SHOP_DOMAIN`, `SRC_ADMIN_TOKEN`, `DST_SHOP_DOMAIN`, `DST_ADMIN_TOKEN`, `SHOPIFY_API_VERSION`.
- **Docs:** Each command has a header comment with _purpose_, _inputs_, _outputs_, _idempotency notes_.

## Shopify specifics (All Implemented ✅)

- ✅ **GraphQL Admin** mutations for definitions:
  - `metaobjectDefinitionCreate` / `metaobjectDefinitionUpdate` (with `fieldDefinitions.create|update|delete`)
  - `metafieldDefinitionCreate` / `metafieldDefinitionUpdate`
- ✅ **Bulk Operations** for large reads/writes; poll status; upon `COMPLETED` download JSONL from `url`
- ✅ **Files:** `stagedUploadsCreate` → upload → `fileCreate` with `originalSource` (plus direct URL where allowed)
- ✅ **Metaobject/metafield type parity** preserved (e.g., `list.single_line_text_field`)
- ✅ **Blogs/Articles:** Handle hierarchical relationship; blogs created before articles
- ✅ **Pages:** Full HTML content migration with `PAGE_CREATE` / `PAGE_UPDATE`
- ✅ **Menus:** 3-level hierarchical structure with URL remapping
- ✅ **Redirects:** Individual creation with throttling (no bulk mutation available)
- ✅ **Shop metafields:** Query shop GID directly, apply with standard metafieldsSet

## Data modeling & mapping rules (All Implemented ✅)

- ✅ **Natural keys in dumps:** All references carry both raw scalar values AND resolved natural keys:
  - Product reference: `{type:"product_reference", value:GID, refProduct:{handle}}`
  - Collection reference: `{type:"collection_reference", value:GID, refCollection:{handle}}`
  - Page reference: `{type:"page_reference", value:GID, refPage:{handle}}`
  - Blog reference: `{type:"blog_reference", value:GID, refBlog:{handle}}`
  - Article reference: Composite key `{blogHandle}:{articleHandle}`
  - Metaobject reference: `{type:"metaobject_reference", value:GID, refMetaobject:{type,handle}}`
  - Variant reference: `{type:"variant_reference", value:GID, refVariant:{productHandle,sku,position}}`
  - File reference: `{type:"file_reference", value:GID, refFile:{url}}`
  - List references: Array with natural keys for each item
- ✅ **Apply-time resolution:** Handles → GIDs resolved via destination index before all writes
- ✅ **File relinking:** File references updated from source GIDs to destination GIDs automatically
- ✅ **Type parity enforcement:** Metafield definition types matched exactly to avoid validation failures
- ✅ **Destination indexing:** Complete index built for all resource types:
  - Products (by handle)
  - Collections (by handle)
  - Pages (by handle)
  - Blogs (by handle)
  - Articles (by composite key `{blogHandle}:{articleHandle}`)
  - Metaobjects (by `{type}:{handle}`)
  - Variants (by `{productHandle}:{sku}` or `{productHandle}:pos{position}`)
  - Files (by URL and GID for relinking)

## Performance & reliability (All Implemented ✅)

- ✅ **Bulk query strategy:** Split by resource type (per metaobject type, products, collections, pages, blogs, articles)
- ✅ **Chunked writes:** 25-50 mutations per batch with adaptive throttling
- ✅ **Exponential backoff:** Automatic retry on 429/430 with jitter
- ✅ **Streaming JSONL:** Memory-efficient processing of large datasets
- ✅ **Error resilience:** Continue on per-record failures, collect all errors in stats
- ✅ **Rate limit handling:** Automatic detection and backoff (1s → 32s max delay)
- ✅ **Bulk job monitoring:** Polling with exponential backoff, handles RUNNING/ACCESS_DENIED/FAILED states
- ✅ **Robust parsing:** Handles malformed JSONL lines, continues processing

## Acceptance criteria (✅ ACHIEVED)

- ✅ Fresh destination store with only theme installed: running `defs:apply`, then `data:apply` yields a site where:
  - All metaobject-driven blocks render correctly
  - All product/collection/page metafields are present
  - Blog and article content is fully migrated
  - Files are uploaded and all references point to destination file GIDs
  - Navigation menus work with remapped URLs
  - URL redirects are in place
  - Shop-level metafields are applied
- ✅ `data:diff` shows zero missing handles and zero unmatched metafield triplets
- ✅ All operations are idempotent and safe to re-run
- ✅ Complete error reporting with detailed stats

## Current Implementation Status

**✅ 100% COMPLETE - ALL FEATURES IMPLEMENTED**

### Completed Features:

- ✅ Metaobject definitions (dump/apply/diff)
- ✅ Metafield definitions (dump/apply/diff)
- ✅ Metaobject entries with full reference remapping
- ✅ Product metafields (including variants)
- ✅ Collection metafields
- ✅ Page content and metafields (full HTML)
- ✅ Blog content and metafields
- ✅ Article content and metafields (with blog relationship)
- ✅ Shop-level metafields
- ✅ Files (upload, indexing, automatic relinking)
- ✅ Navigation menus (with URL remapping)
- ✅ URL redirects
- ✅ Validation tools (defs:diff, data:diff)
- ✅ Complete CLI with all commands
- ✅ Comprehensive error handling and stats
- ✅ Production-ready logging and monitoring

### Key Files:

- `packages/core/src/migration/dump.ts` - 870+ lines, all dump operations
- `packages/core/src/migration/apply.ts` - 1,700+ lines, complete 7-phase apply workflow
- `packages/core/src/map/ids.ts` - Complete destination indexing for all resource types
- `packages/core/src/files/relink.ts` - 190 lines, automatic file reference relinking
- `packages/core/src/graphql/queries.ts` - 1,100+ lines, all GraphQL operations
- `apps/cli/src/index.ts` - 900+ lines, complete CLI implementation

### Migration Workflow (7 Phases):

1. **Build Index** - Map all destination handles → GIDs
2. **Upload Files** - Create file index (URL/GID → destination GID)
3. **Apply Metaobjects** - With file reference relinking
4. **Apply Blogs** - Handle-based creation/update
5. **Apply Articles** - With blog relationship lookup
6. **Apply Pages** - Full HTML content migration
7. **Apply Metafields** - To all resources (products, variants, collections, pages, blogs, articles, shop)

After each creation phase, index is rebuilt to ensure new resources are available for subsequent references.

## For AI Assistants

When working on this codebase:

- All features are implemented - focus on refinements, optimizations, or new related features
- Follow established patterns in `migration/dump.ts` and `migration/apply.ts`
- Use natural key mapping for all cross-store references
- Ensure idempotency for all write operations
- Add comprehensive error handling with detailed stats
- Test with real Shopify development stores
- Update documentation in README.md, QUICK_REFERENCE.md, and IMPLEMENTATION.md
