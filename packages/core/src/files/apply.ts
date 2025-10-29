/**
 * File upload and management for seeding destination file library.
 *
 * PURPOSE: Upload files from source URLs to destination store.
 * APPROACH: Use stagedUploadsCreate → PUT → fileCreate workflow.
 * IDEMPOTENCY: Check existing files by filename; update if exists, create if not.
 * RELINKING: Returns source URL → destination GID mapping for reference updates.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../utils/logger.js";
import { withBackoff } from "../utils/retry.js";
import { type GraphQLClient } from "../graphql/client.js";
import {
  STAGED_UPLOADS_CREATE,
  FILE_CREATE,
  FILE_UPDATE,
  FILES_QUERY,
} from "../graphql/queries.js";
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

export interface UploadStats {
  total: number;
  uploaded: number; // New files created
  updated: number; // Existing files updated
  skipped: number; // Unchanged files
  failed: number;
  errors: string[];
}

interface ExistingFile {
  id: string;
  alt?: string;
  url: string;
  filename: string;
  fileStatus?: string;
}

/**
 * Query all existing files from destination store.
 * Builds a filename → file map for idempotent checking.
 */
async function queryExistingFiles(
  client: GraphQLClient
): Promise<Result<Map<string, ExistingFile>, Error>> {
  logger.info("Querying existing files from destination...");

  const existingFiles = new Map<string, ExistingFile>();
  let hasNextPage = true;
  let cursor: string | null = null;
  let totalCount = 0;

  while (hasNextPage) {
    const variables = cursor ? { first: 250, after: cursor } : { first: 250 };

    const response = await withBackoff(() =>
      client.request({ query: FILES_QUERY, variables })
    );

    if (!response.ok) {
      return err(new Error(`Failed to query files: ${response.error.message}`));
    }

    const responseData = response.data as {
      data: {
        files: {
          edges: Array<{
            node: {
              id: string;
              alt?: string;
              fileStatus?: string;
              image?: { url: string };
              sources?: Array<{ url: string }>;
              url?: string;
            };
          }>;
          pageInfo: {
            hasNextPage: boolean;
            endCursor?: string;
          };
        };
      };
    };

    const data = responseData.data;

    for (const edge of data.files.edges) {
      const node = edge.node;
      const url = node.image?.url || node.sources?.[0]?.url || node.url || "";

      if (url) {
        const filename = extractFilename(url);
        existingFiles.set(filename, {
          id: node.id,
          alt: node.alt,
          url,
          filename,
          fileStatus: node.fileStatus,
        });
        totalCount++;
      }
    }

    hasNextPage = data.files.pageInfo.hasNextPage;
    cursor = data.files.pageInfo.endCursor || null;
  }

  logger.info(`Found ${totalCount} existing files in destination`);
  return ok(existingFiles);
}

/**
 * Update an existing file's metadata (alt text, etc).
 */
async function updateFile(
  client: GraphQLClient,
  update: { id: string; alt?: string }
): Promise<Result<{ id: string; url: string }, ShopifyApiError>> {
  const response = await withBackoff(() =>
    client.request({
      query: FILE_UPDATE,
      variables: {
        files: [update],
      },
    })
  );

  if (!response.ok) {
    return err(response.error);
  }

  const responseData = response.data as {
    data: {
      fileUpdate: {
        files: Array<{
          id: string;
          alt?: string;
          image?: { url: string };
          url?: string;
        }>;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    };
  };

  const data = responseData.data;

  if (data.fileUpdate.userErrors.length > 0) {
    return err(
      new ShopifyApiError(
        data.fileUpdate.userErrors[0].message,
        400,
        response.data
      )
    );
  }

  const file = data.fileUpdate.files[0];
  const url = file.image?.url || file.url || "";

  return ok({ id: file.id, url });
}

/**
 * Apply files from dump to destination store.
 * Idempotent: checks existing files, updates if changed, creates if new.
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

  // Step 1: Query existing files from destination
  const existingResult = await queryExistingFiles(client);
  if (!existingResult.ok) {
    return err(existingResult.error);
  }
  const existingFiles = existingResult.data;

  // Step 2: Parse source files from dump
  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const filesToProcess: Array<FileToUpload & { sourceId: string }> = [];

  for (const line of lines) {
    try {
      const file = JSON.parse(line) as {
        id: string;
        url: string;
        alt?: string;
        type: string;
        mimeType?: string;
      };

      filesToProcess.push({
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

  logger.info(`Processing ${filesToProcess.length} files...`);

  const stats: UploadStats = {
    total: filesToProcess.length,
    uploaded: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Step 3: Process each file (create or update)
  for (const file of filesToProcess) {
    try {
      const existing = existingFiles.get(file.filename);

      if (existing) {
        // File exists - check if update needed
        if (existing.alt !== file.alt) {
          // Update alt text
          const updateResult = await updateFile(client, {
            id: existing.id,
            alt: file.alt,
          });

          if (updateResult.ok) {
            stats.updated++;
            // Build index with existing file
            fileIndex.urlToGid.set(file.url, existing.id);
            fileIndex.gidToGid.set(file.sourceId, existing.id);
            fileIndex.gidToUrl.set(file.sourceId, existing.url);

            if (stats.updated % 10 === 0) {
              logger.info(
                `Updated ${stats.updated}/${filesToProcess.length} files`
              );
            }
          } else {
            stats.failed++;
            stats.errors.push(
              `Update ${file.filename}: ${updateResult.error.message}`
            );
          }
        } else {
          // No changes needed - skip
          stats.skipped++;
          // Build index with existing file
          fileIndex.urlToGid.set(file.url, existing.id);
          fileIndex.gidToGid.set(file.sourceId, existing.id);
          fileIndex.gidToUrl.set(file.sourceId, existing.url);
        }
      } else {
        // File doesn't exist - create it
        let result: Result<UploadedFile, ShopifyApiError>;

        if (file.url.includes("cdn.shopify.com")) {
          result = await createFileFromUrl(client, file);
        } else {
          result = await stagedUpload(client, file);
        }

        if (result.ok) {
          stats.uploaded++;
          // Build index for relinking
          fileIndex.urlToGid.set(file.url, result.data.destinationId);
          fileIndex.gidToGid.set(file.sourceId, result.data.destinationId);
          if (result.data.destinationUrl) {
            fileIndex.gidToUrl.set(file.sourceId, result.data.destinationUrl);
          }

          if (stats.uploaded % 10 === 0) {
            logger.info(
              `Uploaded ${stats.uploaded}/${filesToProcess.length} files`
            );
          }
        } else {
          stats.failed++;
          stats.errors.push(`Upload ${file.filename}: ${result.error.message}`);
        }
      }
    } catch (error) {
      stats.failed++;
      stats.errors.push(`Exception ${file.filename}: ${String(error)}`);
    }
  }

  logger.info(
    `✓ Files: ${stats.uploaded} uploaded, ${stats.updated} updated, ${stats.skipped} skipped, ${stats.failed} failed`
  );
  logger.info(
    `Built file index: ${fileIndex.urlToGid.size} URL mappings, ${fileIndex.gidToGid.size} GID mappings`
  );

  if (stats.errors.length > 0 && stats.errors.length <= 10) {
    stats.errors.forEach((err) => logger.warn(err));
  }

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
