/**
 * File upload and management for seeding destination file library.
 *
 * PURPOSE: Upload files from source URLs to destination store.
 * APPROACH: Use stagedUploadsCreate → PUT → fileCreate workflow.
 * IDEMPOTENCY: Track by original URL/filename to avoid duplicates.
 * RELINKING: Returns source URL → destination GID mapping for reference updates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../utils/logger.js";
import { withBackoff } from "../utils/retry.js";
import { type GraphQLClient } from "../graphql/client.js";
import { STAGED_UPLOADS_CREATE, FILE_CREATE } from "../graphql/queries.js";
import { type Result, ok, err, ShopifyApiError } from "../utils/types.js";

export interface FileToUpload {
  url: string;
  filename: string;
  alt?: string;
  contentType?: string;
}

export interface UploadedFile {
  sourceUrl: string;
  destinationId: string;
  destinationUrl?: string;
}

export interface FileIndex {
  // Maps source file URL → destination file GID
  urlToGid: Map<string, string>;
  // Maps source file GID → destination file GID
  gidToGid: Map<string, string>;
  // Maps source file GID → destination file URL
  gidToUrl: Map<string, string>;
}

/**
 * Apply files from dump to destination store.
 * Reads files.jsonl and uploads each file, building a mapping for relinking.
 */
export async function applyFiles(
  client: GraphQLClient,
  inputFile: string
): Promise<Result<FileIndex, Error>> {
  logger.info("=== Applying Files ===");

  const fileIndex: FileIndex = {
    urlToGid: new Map(),
    gidToGid: new Map(),
    gidToUrl: new Map(),
  };

  if (!fs.existsSync(inputFile)) {
    logger.warn(`Files dump not found: ${inputFile}`);
    return ok(fileIndex);
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const filesToUpload: Array<FileToUpload & { sourceId: string }> = [];

  for (const line of lines) {
    try {
      const file = JSON.parse(line) as {
        id: string;
        url: string;
        alt?: string;
        type: string;
        mimeType?: string;
      };

      filesToUpload.push({
        sourceId: file.id,
        url: file.url,
        filename: extractFilename(file.url),
        alt: file.alt,
        contentType: file.type,
      });
    } catch (error) {
      logger.warn("Failed to parse file line", { error: String(error) });
    }
  }

  logger.info(`Uploading ${filesToUpload.length} files...`);

  let uploaded = 0;
  let failed = 0;

  for (const file of filesToUpload) {
    try {
      // Try direct URL first for CDN files
      let result: Result<UploadedFile, ShopifyApiError>;

      if (file.url.includes("cdn.shopify.com")) {
        result = await createFileFromUrl(client, file);
      } else {
        result = await stagedUpload(client, file);
      }

      if (result.ok) {
        // Build index for relinking
        fileIndex.urlToGid.set(file.url, result.data.destinationId);
        fileIndex.gidToGid.set(file.sourceId, result.data.destinationId);
        if (result.data.destinationUrl) {
          fileIndex.gidToUrl.set(file.sourceId, result.data.destinationUrl);
        }
        uploaded++;

        if (uploaded % 10 === 0) {
          logger.info(`Uploaded ${uploaded}/${filesToUpload.length} files`);
        }
      } else {
        failed++;
        logger.warn(`Failed to upload ${file.filename}`, {
          error: result.error.message,
        });
      }
    } catch (error) {
      failed++;
      logger.warn(`Exception uploading ${file.filename}`, {
        error: String(error),
      });
    }
  }

  logger.info(`✓ Uploaded ${uploaded} files (${failed} failed)`);
  logger.info(
    `Built file index: ${fileIndex.urlToGid.size} URL mappings, ${fileIndex.gidToGid.size} GID mappings`
  );

  return ok(fileIndex);
}

/**
 * Extract filename from URL.
 */
function extractFilename(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const parts = pathname.split("/");
    return parts[parts.length - 1] || "file";
  } catch {
    return "file";
  }
}

/**
 * Upload files to destination store.
 * Uses staged uploads for large files, direct URL for CDN-hosted files when possible.
 */
export async function uploadFiles(
  client: GraphQLClient,
  files: FileToUpload[]
): Promise<Result<UploadedFile[], ShopifyApiError>> {
  logger.info(`Uploading ${files.length} files`);

  const uploaded: UploadedFile[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      // For Shopify CDN URLs, attempt direct fileCreate
      if (file.url.includes("cdn.shopify.com")) {
        const result = await createFileFromUrl(client, file);
        if (result.ok) {
          uploaded.push(result.data);
          continue;
        }
      }

      // Otherwise use staged upload
      const result = await stagedUpload(client, file);
      if (result.ok) {
        uploaded.push(result.data);
      } else {
        errors.push(`${file.filename}: ${result.error.message}`);
      }
    } catch (error: any) {
      errors.push(`${file.filename}: ${error.message}`);
    }
  }

  logger.info(`Uploaded ${uploaded.length}/${files.length} files`, {
    errors: errors.length,
  });

  if (errors.length > 0) {
    logger.warn("File upload errors", { errors });
  }

  return ok(uploaded);
}

/**
 * Create a file from a URL (for CDN-hosted files).
 */
async function createFileFromUrl(
  client: GraphQLClient,
  file: FileToUpload
): Promise<Result<UploadedFile, ShopifyApiError>> {
  const result = await client.request({
    query: FILE_CREATE,
    variables: {
      files: [
        {
          alt: file.alt || file.filename,
          contentType: file.contentType || "IMAGE",
          originalSource: file.url,
        },
      ],
    },
  });

  if (!result.ok) {
    return err(result.error);
  }

  const response = result.data.data?.fileCreate;
  if (response?.userErrors && response.userErrors.length > 0) {
    const errorMsg = response.userErrors.map((e: any) => e.message).join(", ");
    return err(new ShopifyApiError(errorMsg));
  }

  const createdFile = response?.files?.[0];
  if (!createdFile) {
    return err(new ShopifyApiError("No file created"));
  }

  return ok({
    sourceUrl: file.url,
    destinationId: createdFile.id,
    destinationUrl: createdFile.image?.url || createdFile.url,
  });
}

/**
 * Upload via staged upload (for non-CDN files).
 */
async function stagedUpload(
  client: GraphQLClient,
  file: FileToUpload
): Promise<Result<UploadedFile, ShopifyApiError>> {
  // Step 1: Create staged upload target
  const stagedResult = await client.request({
    query: STAGED_UPLOADS_CREATE,
    variables: {
      input: [
        {
          filename: file.filename,
          mimeType: file.contentType || "image/jpeg",
          resource: "FILE",
          httpMethod: "PUT",
        },
      ],
    },
  });

  if (!stagedResult.ok) {
    return err(stagedResult.error);
  }

  const target =
    stagedResult.data.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target) {
    return err(new ShopifyApiError("No staged upload target created"));
  }

  // Step 2: Download from source
  const sourceResponse = await withBackoff(async () => {
    const res = await fetch(file.url);
    if (!res.ok) {
      throw new ShopifyApiError(
        `Failed to download: ${res.statusText}`,
        res.status
      );
    }
    return res;
  });

  // withBackoff returns the Response directly (not a Result)
  const fileData = await sourceResponse.arrayBuffer();

  // Step 3: Upload to staged target
  const formData = new FormData();
  for (const param of target.parameters) {
    formData.append(param.name, param.value);
  }
  formData.append("file", new Blob([fileData]));

  const uploadResponse = await withBackoff(async () => {
    const res = await fetch(target.url, {
      method: "PUT",
      body: formData,
    });
    if (!res.ok) {
      throw new ShopifyApiError(
        `Failed to upload: ${res.statusText}`,
        res.status
      );
    }
    return res;
  });

  // withBackoff returns the Response directly (not a Result)
  // Step 4: Create file from staged upload
  const fileResult = await client.request({
    query: FILE_CREATE,
    variables: {
      files: [
        {
          alt: file.alt || file.filename,
          contentType: "FILE",
          originalSource: target.resourceUrl,
        },
      ],
    },
  });

  if (!fileResult.ok) {
    return err(fileResult.error);
  }

  const response = fileResult.data.data?.fileCreate;
  const createdFile = response?.files?.[0];
  if (!createdFile) {
    return err(new ShopifyApiError("Failed to create file from staged upload"));
  }

  return ok({
    sourceUrl: file.url,
    destinationId: createdFile.id,
    destinationUrl: createdFile.url,
  });
}
