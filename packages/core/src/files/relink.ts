/**
 * File reference relinking: update file references in metaobjects/metafields.
 *
 * Purpose:
 * - Scan dumped metaobjects/metafields for file references
 * - Replace source file URLs/GIDs with destination GIDs
 * - Ensure all file references point to newly uploaded files
 *
 * Approach:
 * - Parse metafield values that contain file references
 * - Use file index (source → destination mapping) to relink
 * - Handle both single references and list references
 */

import { logger } from "../utils/logger.js";
import type { FileIndex } from "./apply.js";

// ============================================================================
// Types (from migration/dump.ts)
// ============================================================================

interface DumpedField {
  key: string;
  type: string;
  value: string | null;
  refMetaobject?: { type: string; handle: string };
  refProduct?: { handle: string };
  refVariant?: { productHandle: string; sku?: string; position?: number };
  refCollection?: { handle: string };
  refPage?: { handle: string };
  refFile?: { url: string };
  refList?: Array<{
    type: string;
    metaobjectHandle?: string;
    metaobjectType?: string;
    productHandle?: string;
    variantSku?: string;
    variantProductHandle?: string;
    collectionHandle?: string;
    pageHandle?: string;
    fileUrl?: string;
  }>;
}

interface DumpedMetafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
  refMetaobject?: { type: string; handle: string };
  refProduct?: { handle: string };
  refCollection?: { handle: string };
  refFile?: { url: string };
  refList?: Array<{
    type: string;
    metaobjectHandle?: string;
    metaobjectType?: string;
    productHandle?: string;
    fileUrl?: string;
  }>;
}

// ============================================================================
// Relinking Functions
// ============================================================================

/**
 * Relink file references in a metaobject field.
 * Updates refFile to point to destination GID if available.
 */
export function relinkMetaobjectField(
  field: DumpedField,
  fileIndex: FileIndex
): DumpedField {
  const relinked = { ...field };

  // Single file reference
  if (relinked.refFile?.url) {
    const destGid = fileIndex.urlToGid.get(relinked.refFile.url);
    if (destGid) {
      // Store destination GID in the value field for apply to use
      relinked.value = destGid;
      logger.debug(
        `Relinked file reference: ${relinked.refFile.url} → ${destGid}`
      );
    } else {
      logger.warn(`File not found in index: ${relinked.refFile.url}`);
    }
  }

  // List of file references
  if (relinked.refList) {
    relinked.refList = relinked.refList.map((item) => {
      if (item.fileUrl) {
        const destGid = fileIndex.urlToGid.get(item.fileUrl);
        if (destGid) {
          logger.debug(`Relinked file in list: ${item.fileUrl} → ${destGid}`);
          return { ...item, fileGid: destGid };
        } else {
          logger.warn(`File not found in index: ${item.fileUrl}`);
        }
      }
      return item;
    });
  }

  return relinked;
}

/**
 * Relink file references in a metafield.
 */
export function relinkMetafield(
  metafield: DumpedMetafield,
  fileIndex: FileIndex
): DumpedMetafield {
  const relinked = { ...metafield };

  // Single file reference
  if (relinked.refFile?.url) {
    const destGid = fileIndex.urlToGid.get(relinked.refFile.url);
    if (destGid) {
      relinked.value = destGid;
      logger.debug(
        `Relinked metafield file: ${relinked.refFile.url} → ${destGid}`
      );
    } else {
      logger.warn(
        `File not found in index for metafield: ${relinked.refFile.url}`
      );
    }
  }

  // List of file references
  if (relinked.refList) {
    relinked.refList = relinked.refList.map((item) => {
      if (item.fileUrl) {
        const destGid = fileIndex.urlToGid.get(item.fileUrl);
        if (destGid) {
          logger.debug(
            `Relinked file in metafield list: ${item.fileUrl} → ${destGid}`
          );
          return { ...item, fileGid: destGid };
        } else {
          logger.warn(`File not found in index: ${item.fileUrl}`);
        }
      }
      return item;
    });
  }

  return relinked;
}

/**
 * Relink all file references in an array of metaobjects.
 */
export function relinkMetaobjects<T extends { fields: DumpedField[] }>(
  metaobjects: T[],
  fileIndex: FileIndex
): T[] {
  let relinkedCount = 0;

  const relinked = metaobjects.map((metaobject) => ({
    ...metaobject,
    fields: metaobject.fields.map((field) => {
      const relinkedField = relinkMetaobjectField(field, fileIndex);
      if (relinkedField.value !== field.value) {
        relinkedCount++;
      }
      return relinkedField;
    }),
  }));

  if (relinkedCount > 0) {
    logger.info(`Relinked ${relinkedCount} file references in metaobjects`);
  }

  return relinked;
}

/**
 * Relink all file references in an array of metafields.
 */
export function relinkMetafields(
  metafields: DumpedMetafield[],
  fileIndex: FileIndex
): DumpedMetafield[] {
  let relinkedCount = 0;

  const relinked = metafields.map((metafield) => {
    const relinkedMetafield = relinkMetafield(metafield, fileIndex);
    if (relinkedMetafield.value !== metafield.value) {
      relinkedCount++;
    }
    return relinkedMetafield;
  });

  if (relinkedCount > 0) {
    logger.info(`Relinked ${relinkedCount} file references in metafields`);
  }

  return relinked;
}
