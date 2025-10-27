/**
 * Chunking utilities for batching operations.
 * Used to split large arrays into smaller chunks for batch processing.
 */

/**
 * Split an array into chunks of a specified size.
 *
 * @example
 * const items = [1, 2, 3, 4, 5];
 * const chunks = chunkArray(items, 2);
 * // [[1, 2], [3, 4], [5]]
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    throw new Error("Chunk size must be greater than 0");
  }

  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Process an array in chunks with a given async function.
 * Useful for batch operations with rate limiting.
 *
 * @example
 * await processInChunks(items, 50, async (chunk) => {
 *   await batchMutation(chunk);
 * });
 */
export async function processInChunks<T, R>(
  array: T[],
  chunkSize: number,
  processFn: (chunk: T[], chunkIndex: number) => Promise<R>
): Promise<R[]> {
  const chunks = chunkArray(array, chunkSize);
  const results: R[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const result = await processFn(chunks[i], i);
    results.push(result);
  }

  return results;
}

/**
 * Process items in chunks with concurrency control.
 *
 * @example
 * await processInChunksConcurrent(items, 50, 3, async (chunk) => {
 *   return await processBatch(chunk);
 * });
 */
export async function processInChunksConcurrent<T, R>(
  array: T[],
  chunkSize: number,
  concurrency: number,
  processFn: (chunk: T[], chunkIndex: number) => Promise<R>
): Promise<R[]> {
  const chunks = chunkArray(array, chunkSize);
  const results: R[] = new Array(chunks.length);
  let index = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (index < chunks.length) {
      const currentIndex = index++;
      results[currentIndex] = await processFn(
        chunks[currentIndex],
        currentIndex
      );
    }
  });

  await Promise.all(workers);
  return results;
}
