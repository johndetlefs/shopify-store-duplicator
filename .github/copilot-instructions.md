# Project: Shopify Store ## Architectural principles

- ✅ **Idempotent:** All "apply" operations are safe to re-run (implemented with upsert patterns).
- ✅ **Deterministic remapping:** Never relies on source GIDs. All mappings use **natural keys**:
  - Metaobjects → `{type}:{handle}`
  - Products / Collections / Pages / Blogs → `handle`
  - Articles → `{blogHandle}:{articleHandle}` (composite key)
  - Variants → `{productHandle}:{sku}` (fallback to `{productHandle}:pos{position}` if SKU missing)
  - Markets → `handle`
  - Market Regions → 2-letter ISO `countryCode` (e.g., "AU", "GB", "US")
- ✅ **Strict ordering** - **Complete Migration Workflow**:
  1. **Definitions** (schema) - `defs:dump` → `defs:apply` (metaobject definitions, metafield definitions)
  2. **Data** (content) - `data:dump` → `data:apply` (10-phase workflow - see below)
  3. **Menus** - `menus:dump` → `menus:apply` (navigation with URL remapping)
  4. **Redirects** - `redirects:dump` → `redirects:apply` (SEO preservation)
  5. **Policies** - `policies:dump` → `policies:apply` (refund, privacy, terms, shipping, contact)
  6. **Discounts** - `discounts:dump` → `discounts:apply` (automatic + code-based)
  7. **Markets** - `markets:dump` → `markets:apply` (regions, currencies, web presences)
- ✅ **Data Apply 10-Phase Workflow** (internal phases within `data:apply`):
  1. Build destination index (handles → GIDs)
  2. Upload files & build file index (URL/GID → destination GID) - **IDEMPOTENT: queries existing files, updates if alt changed, skips unchanged**
  3. Apply products (with variants and publications) - so metaobjects can reference them
  4. Apply collections (with publications) - so metaobjects can reference them
  5. Apply blogs (handle-based) - so articles can reference them
  6. Apply articles (composite key with blog lookup) - so metaobjects can reference them
  7. Apply pages (with full HTML content) - so metaobjects can reference them
  8. Rebuild index (capture newly created resources)
  9. Apply metaobjects with file reference relinking (can now reference all resource types)
  10. Apply metafields to all resources (products, variants, collections, pages, blogs, articles, shop, metaobjects)
- ✅ **Rate limits & resilience:** Exponential backoff on 429/430; chunked writes (25-50 per batch); log and continue on per-record errors.
- ✅ **Security:** Tokens from `.env`; automatic redaction in logs; URLs with tokens redacted.
- ✅ **Observability:** Structured logs with configurable levels; detailed stats for created/updated/skipped/failed.

**Status:** ✅ **100% COMPLETE - PRODUCTION READY**

**Goal:** Programmatically duplicate a Shopify store's _custom data_ and content from a **source** to a **destination** store with high fidelity and repeatability, without making the destination non-transferable.

## Scope (All Features Implemented ✅)

- ✅ **Definitions (schema):** metaobject definitions + field definitions; metafield definitions (by owner type / namespace / key).
- ✅ **Data (content):** metaobject _entries_, metafields on core resources (products, variants, collections, pages, articles, blogs, shop), menus, redirects, policies, discounts, markets.
- ✅ **CMS content:** Pages, blogs, articles with full HTML content and metafields.
- ✅ **Files:** Upload files to destination, build file index, automatically relink file references in metaobjects/metafields. **100% idempotent** - matches by filename, updates alt text if changed, skips unchanged files.
- ✅ **Publications (Sales Channels):** Product and collection channel visibility (Online Store, Shop, POS, Inbox, custom channels). **100% idempotent** - unpublishes from all channels, then publishes only to matching source channels.
- ✅ **Shop policies:** Refund, privacy, terms of service, shipping, contact information.
- ✅ **Discounts:** Automatic and code-based discounts (Basic, BXGY, Free Shipping) with product/collection reference remapping.
- ✅ **Markets:** Multi-region selling configuration with regions (countries), currencies, and web presences (domains/subfolders/locales).
- ✅ **Validation:** Diff commands for definitions and data to verify completeness.
- **Non-goals:** orders, gift cards, analytics, customer data, theme code.

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
  /src/policies/    # ✅ Dump/apply shop policies
  /src/discounts/   # ✅ Dump/apply discounts (automatic + code-based)
  /src/markets/     # ✅ Dump/apply markets (regions, currencies, web presences)
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
- `defs:diff` → Compare definitions, report missing/changed (includes optional usage validation with `--no-usage-check` to skip)

### Data

- `data:dump` → Bulk export all data (metaobjects, products, collections, pages, blogs, articles, shop metafields, files, publications)
- `data:apply` → Import all data with automatic reference remapping, file relinking, and publication syncing (7-phase workflow)
- `data:diff` → Compare source dump vs destination, report missing resources

### Menus, Redirects, Policies & Discounts

- `menus:dump` → Export navigation menus
- `menus:apply` → Import menus with automatic URL remapping
- `redirects:dump` → Export URL redirects
- `redirects:apply` → Import redirects (idempotent)
- `policies:dump` → Export shop policies (refund, privacy, terms, shipping, contact)
- `policies:apply` → Import shop policies (idempotent)
- `discounts:dump` → Export automatic and code-based discounts
- `discounts:apply` → Import discounts with product/collection reference remapping
- `markets:dump` → Export markets (regions, currencies, web presences)
- `markets:apply` → Import markets with region registration (requires write_markets scope)

### Files & Publications (Integrated into data:apply)

- **Files:** Automatically uploaded and relinked during `data:apply`. File references in metaobjects/metafields are updated to destination GIDs.
- **Publications (Sales Channels):** Product/collection channel visibility automatically synced during `data:apply`. Unpublishes from all channels, then publishes only to matching source channels (idempotent).

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
- ✅ **Publications:** `publishablePublish` / `publishableUnpublish` for sales channel visibility (Online Store, Shop, POS, Inbox, custom channels)
- ✅ **Metaobject/metafield type parity** preserved (e.g., `list.single_line_text_field`)
- ✅ **Blogs/Articles:** Handle hierarchical relationship; blogs created before articles
- ✅ **Pages:** Full HTML content migration with `PAGE_CREATE` / `PAGE_UPDATE`
- ✅ **Menus:** 3-level hierarchical structure with URL remapping
- ✅ **Redirects:** Individual creation with throttling (no bulk mutation available)
- ✅ **Shop metafields:** Query shop GID directly, apply with standard metafieldsSet
- ✅ **Discounts:** Automatic and code-based discounts (Basic, BXGY, Free Shipping) with product/collection reference remapping
- ✅ **Markets:** marketCreate/marketUpdate with conditions.regionsCondition for region management, web presences for domain configuration

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
- ✅ Files (media library with automatic relinking)
- ✅ Navigation menus (with URL remapping)
- ✅ URL redirects
- ✅ Shop policies (refund, privacy, terms, shipping, contact)
- ✅ Discounts (automatic + code-based: Basic, BXGY, Free Shipping)
- ✅ Markets (regions, currencies, web presences)
- ✅ Validation tools (defs:diff, data:diff)
- ✅ Complete CLI with all commands
- ✅ Comprehensive error handling and stats
- ✅ Production-ready logging and monitoring

### Key Files:

- `packages/core/src/migration/dump.ts` - 870+ lines, all dump operations
- `packages/core/src/migration/apply.ts` - 1,700+ lines, complete 10-phase apply workflow
- `packages/core/src/map/ids.ts` - Complete destination indexing for all resource types
- `packages/core/src/files/relink.ts` - 190 lines, automatic file reference relinking
- `packages/core/src/graphql/queries.ts` - 1,100+ lines, all GraphQL operations
- `apps/cli/src/index.ts` - 900+ lines, complete CLI implementation

### Migration Workflow (10 Phases within data:apply):

1. **Build Index** - Map all destination handles → GIDs
2. **Upload Files** - Create file index (URL/GID → destination GID)
3. **Apply Products** - With variants and publications (before metaobjects)
4. **Apply Collections** - With publications (before metaobjects)
5. **Apply Blogs** - Handle-based creation/update (before articles)
6. **Apply Articles** - With blog relationship lookup (before metaobjects)
7. **Apply Pages** - Full HTML content migration (before metaobjects)
8. **Rebuild Index** - Capture newly created resources
9. **Apply Metaobjects** - With file reference relinking (can now reference all resources)
10. **Apply Metafields** - To all resources (products, variants, collections, pages, blogs, articles, shop, metaobjects)

After each creation phase, index is rebuilt to ensure new resources are available for subsequent references.

## For AI Assistants

When working on this codebase:

- All features are implemented - focus on refinements, optimizations, or new related features
- Follow established patterns in `migration/dump.ts` and `migration/apply.ts`
- Use natural key mapping for all cross-store references
- Ensure idempotency for all write operations
- Add comprehensive error handling with detailed stats
- Test with real Shopify development stores
- Check the Shopify admin graphql API documentation at https://shopify.dev/docs/api/admin-graphql to see what Shopify expects before creating queries or mutations
- Update documentation in README.md, QUICK_REFERENCE.md, and IMPLEMENTATION.md
- **DO NOT create summary files or high-level overviews unless specifically requested**
- Focus on code changes and minimal documentation updates to existing files only
