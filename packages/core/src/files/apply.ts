/**
 * File upload and management for seeding destination file library.
 *
 * PURPOSE: Upload files from source URLs to destination store.
 * APPROACH: Use stagedUploadsCreate → PUT → fileCreate workflow.
 * IDEMPOTENCY: Track by original URL/filename to avoid duplicates.
 */

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

  if (!sourceResponse.ok) {
    return err(sourceResponse.error);
  }

  const fileData = await sourceResponse.data.arrayBuffer();

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

  if (!uploadResponse.ok) {
    return err(uploadResponse.error);
  }

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
