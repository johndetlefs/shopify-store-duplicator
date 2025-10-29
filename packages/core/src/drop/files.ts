/**
 * Delete files from destination store.
 *
 * PURPOSE: Clean up files before re-applying.
 * APPROACH: Query all files, then delete them in batches.
 */

import { logger } from "../utils/logger.js";
import { type GraphQLClient } from "../graphql/client.js";
import { type Result, ok, err } from "../utils/types.js";

const FILES_QUERY = `
  query files($first: Int!, $after: String) {
    files(first: $first, after: $after) {
      edges {
        node {
          id
          ... on MediaImage {
            id
          }
          ... on GenericFile {
            id
          }
          ... on Video {
            id
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const FILE_DELETE = `
  mutation fileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors {
        field
        message
      }
    }
  }
`;

export interface DropStats {
  total: number;
  deleted: number;
  failed: number;
  errors: string[];
}

/**
 * Drop (delete) all files from the destination store.
 */
export async function dropFiles(
  client: GraphQLClient
): Promise<Result<DropStats, Error>> {
  logger.info("Dropping all files...");

  const stats: DropStats = {
    total: 0,
    deleted: 0,
    failed: 0,
    errors: [],
  };

  // Step 1: Collect all file IDs
  const fileIds: string[] = [];
  let hasNextPage = true;
  let cursor: string | undefined;

  logger.info("Fetching file list...");

  while (hasNextPage) {
    const result = await client.request({
      query: FILES_QUERY,
      variables: { first: 250, after: cursor },
    });

    if (!result.ok) {
      return err(new Error(`Failed to fetch files: ${result.error.message}`));
    }

    const files = result.data.data?.files;
    if (!files) {
      return err(new Error("No files in response"));
    }

    for (const edge of files.edges) {
      if (edge.node?.id) {
        fileIds.push(edge.node.id);
      }
    }

    hasNextPage = files.pageInfo.hasNextPage;
    cursor = files.pageInfo.endCursor;

    if (fileIds.length % 250 === 0 && fileIds.length > 0) {
      logger.info(`Found ${fileIds.length} files so far...`);
    }
  }

  stats.total = fileIds.length;
  logger.info(`Found ${stats.total} total files`);

  if (stats.total === 0) {
    logger.info("No files to delete");
    return ok(stats);
  }

  // Step 2: Delete files in batches of 50 (Shopify limit)
  const BATCH_SIZE = 50;

  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE);

    const result = await client.request({
      query: FILE_DELETE,
      variables: { fileIds: batch },
    });

    if (!result.ok) {
      stats.failed += batch.length;
      stats.errors.push(`Batch ${i / BATCH_SIZE + 1}: ${result.error.message}`);
      logger.warn(`Failed to delete batch ${i / BATCH_SIZE + 1}`, {
        error: result.error.message,
      });
      continue;
    }

    const response = result.data.data?.fileDelete;
    if (response?.userErrors && response.userErrors.length > 0) {
      const errorCount = response.userErrors.length;
      stats.failed += errorCount;
      stats.deleted += batch.length - errorCount;

      for (const error of response.userErrors) {
        stats.errors.push(`${error.field?.join(".")}: ${error.message}`);
      }

      logger.warn(`Batch ${i / BATCH_SIZE + 1} had errors`, {
        errors: response.userErrors,
      });
    } else {
      const deletedCount = response?.deletedFileIds?.length || batch.length;
      stats.deleted += deletedCount;
      logger.debug(
        `Deleted batch ${i / BATCH_SIZE + 1} (${deletedCount} files)`
      );
    }

    if ((i + BATCH_SIZE) % 250 === 0 || i + BATCH_SIZE >= fileIds.length) {
      logger.info(
        `Progress: ${Math.min(i + BATCH_SIZE, fileIds.length)}/${
          fileIds.length
        } files deleted`
      );
    }
  }

  logger.info(`✓ Deleted ${stats.deleted} files (${stats.failed} failed)`);

  if (stats.errors.length > 0 && stats.errors.length <= 10) {
    logger.warn(`Errors:`, stats.errors);
  } else if (stats.errors.length > 10) {
    logger.warn(`First 10 errors:`, stats.errors.slice(0, 10));
  }

  return ok(stats);
}
