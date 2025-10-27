/**
 * File dump operations: export file metadata from source store.
 *
 * Purpose:
 * - Extract all files (images, videos, generic files) from source store
 * - Preserve URLs, alt text, and metadata for re-upload
 * - Create mapping for reference relinking
 *
 * Output Format:
 * - files.jsonl with one file per line
 * - Each file includes: id, url, alt, type, mimeType
 *
 * Idempotency:
 * - Safe to re-run; overwrites previous dump
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runBulkQueryAndDownload } from "../bulk/runner.js";
import { FILES_BULK } from "../graphql/queries.js";
import { GraphQLClient } from "../graphql/client.js";
import { logger } from "../utils/logger.js";
import { type Result } from "../utils/types.js";

// ============================================================================
// Types
// ============================================================================

interface FileNode {
  id: string;
  alt?: string;
  createdAt?: string;
  fileStatus?: string;
  // MediaImage
  image?: { url: string };
  // Video
  sources?: Array<{ url: string }>;
  // GenericFile
  url?: string;
  mimeType?: string;
}

export interface DumpedFile {
  id: string;
  url: string;
  alt?: string;
  type: "IMAGE" | "VIDEO" | "FILE";
  mimeType?: string;
  createdAt?: string;
}

// ============================================================================
// Core Dump Function
// ============================================================================

/**
 * Dump all files from source store.
 */
export async function dumpFiles(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Files ===");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await runBulkQueryAndDownload(client, FILES_BULK);
  if (!result.ok) {
    logger.error("Failed to dump files:", result.error);
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream and transform
  const transformed: DumpedFile[] = [];

  for await (const entry of result.data) {
    try {
      const file = entry as FileNode;

      // Determine file type and extract URL
      let url: string | undefined;
      let type: "IMAGE" | "VIDEO" | "FILE";

      if (file.image?.url) {
        url = file.image.url;
        type = "IMAGE";
      } else if (file.sources && file.sources.length > 0) {
        url = file.sources[0].url;
        type = "VIDEO";
      } else if (file.url) {
        url = file.url;
        type = "FILE";
      } else {
        logger.warn("File missing URL, skipping:", { id: file.id });
        continue;
      }

      const dumped: DumpedFile = {
        id: file.id,
        url,
        alt: file.alt,
        type,
        mimeType: file.mimeType,
        createdAt: file.createdAt,
      };

      transformed.push(dumped);
    } catch (err) {
      logger.warn("Failed to parse file entry:", { error: String(err) });
    }
  }

  // Write to file
  const outputFile = path.join(outputDir, "files.jsonl");
  const content = transformed.map((file) => JSON.stringify(file)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} files to ${outputFile}`);
  return { ok: true, data: undefined };
}
