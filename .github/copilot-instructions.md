# Project: Shopify Store Duplicator (TypeScript, Node)

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

```

/packages/core
/src/bulk/ # bulk launcher, poller, downloader, JSONL parser
/src/defs/ # dump/apply metaobject & metafield definitions
/src/migration/ # dump/apply metaobjects (entries), metafields, pages/articles/blogs
/src/files/ # stagedUploadsCreate + fileCreate helpers
/src/menus/ # dump/apply menus
/src/redirects/ # dump/apply redirects
/src/map/ # handle/type mapping + gid resolvers
/src/graphql/ # typed queries/mutations (strings + minimal types)
/src/utils/ # throttling, retries, chunking, logger

```

/apps/cli
/src/index.ts # commander-based CLI wiring commands
```

## Commands (CLI)

- `defs:dump` → JSON of metaobject/metafield **definitions** (source)
- `defs:apply` → upsert definitions (destination)
- `defs:diff` → report missing/changed definitions
- `data:dump` → bulk export data payloads (source)
- `data:apply` → import data (destination) in safe order
- `data:diff` → compare source dump vs destination live
- `files:apply` → seed destination Files from source URLs (staged upload when needed)
- `menus:dump|apply`, `redirects:dump|apply`

## Coding standards

- **Language:** TypeScript (ES2022 modules). Node 20+.
- **Style:** Small, pure functions; no static singletons; DI via parameters.
- **Error handling:** Return discriminated unions: `{ ok: true, data } | { ok: false, error }`.
- **Logging:** Single `logger.ts` with levels; JSON lines in CI; human-friendly in local.
- **Testing:** Light unit tests around mappers/parsers; snapshot tests for JSON transforms.
- **Packages:** `commander`, `zod`. Use native `fetch` (Node 20+), fall back to `node-fetch` only if needed.
- **Env:** `.env` with `SRC_SHOP_DOMAIN`, `SRC_ADMIN_TOKEN`, `DST_SHOP_DOMAIN`, `DST_ADMIN_TOKEN`, `SHOPIFY_API_VERSION`.
- **Docs:** Each command has a header comment with _purpose_, _inputs_, _outputs_, _idempotency notes_.

## Shopify specifics Copilot must respect

- Use **GraphQL Admin** mutations for definitions:
  - `metaobjectDefinitionCreate` / `metaobjectDefinitionUpdate` (with `fieldDefinitions.create|update|delete`)
  - `metafieldDefinitionCreate` / `metafieldDefinitionUpdate` (definition-level)
- Use **Bulk Operations** for large reads/writes; poll status; upon `COMPLETED` download JSONL from `url`.
- **Files:** use `stagedUploadsCreate` → upload → `fileCreate` with `originalSource` (or direct URL where allowed).
- Preserve metaobject/metafield **type parity** (e.g., `list.single_line_text_field`).

## Data modeling & mapping rules

- Always carry both **raw scalar values** and resolved **natural keys** for references (e.g., a metaobject field that references a product should include `{type:"product_reference", value:GID, refHandle}` in the dump).
- On apply, **resolve handles → GIDs** in the destination before writes.
- For metafields, enforce **definition type parity** to avoid validation failures.

## Performance & reliability

- Bulk queries split by type (e.g., per metaobject type, per resource class).
- Chunk writes (e.g., 50–100 mutations per second), adaptive backoff.
- If a bulk job fails, retry with reduced shape; be robust.

## Acceptance criteria

- Fresh destination store with only theme installed: running `defs:apply`, `files:apply`, then `data:apply` yields a site where all metaobject-driven blocks render and navigation works; `data:diff` shows zero missing handles and zero unmatched metafield triplets.
