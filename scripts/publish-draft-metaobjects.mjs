import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = new Set(argv.slice(2));
  return {
    dryRun: args.has("--dry-run"),
    verbose: args.has("--verbose") || args.has("-v"),
    help: args.has("--help") || args.has("-h"),
  };
}

function loadDotEnv() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function usage() {
  console.log(`\nPublish all DRAFT metaobjects to ACTIVE in destination store.\n
Usage:
	node scripts/publish-draft-metaobjects.mjs [--dry-run] [--verbose]

Required environment variables:
	DST_SHOP_DOMAIN
	DST_ADMIN_TOKEN

Optional environment variables:
	SHOPIFY_API_VERSION   (default: 2025-10)
`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { dryRun, verbose, help } = parseArgs(process.argv);
  if (help) {
    usage();
    process.exit(0);
  }

  loadDotEnv();

  const shop = process.env.DST_SHOP_DOMAIN;
  const token = process.env.DST_ADMIN_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2025-10";

  if (!(shop && token)) {
    console.error(
      "Missing required env vars: DST_SHOP_DOMAIN, DST_ADMIN_TOKEN",
    );
    process.exit(1);
  }

  const endpoint = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  async function gql(query, variables = {}, attempt = 0) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      if (attempt < 6) {
        await sleep(500 * 2 ** attempt);
        return gql(query, variables, attempt + 1);
      }
      throw new Error(
        `Non-JSON response (${response.status}): ${text.slice(0, 300)}`,
      );
    }

    const errors = payload.errors || [];
    const throttled =
      response.status === 429 ||
      errors.some((err) =>
        String(err.message || "")
          .toLowerCase()
          .includes("thrott"),
      ) ||
      errors.some((err) => err.extensions?.code === "THROTTLED");

    if (throttled && attempt < 8) {
      const backoff =
        Math.min(10_000, 350 * 2 ** attempt) + Math.floor(Math.random() * 250);
      if (verbose) {
        console.log(
          `Throttle detected, backing off ${backoff}ms (attempt ${attempt + 1})`,
        );
      }
      await sleep(backoff);
      return gql(query, variables, attempt + 1);
    }

    if (errors.length > 0) {
      throw new Error(JSON.stringify(errors));
    }

    return payload.data;
  }

  async function* metaobjectTypes() {
    let after = null;
    do {
      const data = await gql(
        `query($first:Int!,$after:String){
					metaobjectDefinitions(first:$first, after:$after){
						edges{ node{ type } }
						pageInfo{ hasNextPage endCursor }
					}
				}`,
        { first: 250, after },
      );

      for (const edge of data.metaobjectDefinitions.edges) {
        yield edge.node.type;
      }

      after = data.metaobjectDefinitions.pageInfo.hasNextPage
        ? data.metaobjectDefinitions.pageInfo.endCursor
        : null;
    } while (after);
  }

  async function* draftMetaobjectsByType(type) {
    let after = null;
    do {
      const data = await gql(
        `query($type:String!,$first:Int!,$after:String){
					metaobjects(type:$type, first:$first, after:$after){
						edges{
							node{
								id
								type
								handle
								capabilities {
									publishable {
										status
									}
								}
							}
						}
						pageInfo{ hasNextPage endCursor }
					}
				}`,
        { type, first: 250, after },
      );

      for (const edge of data.metaobjects.edges) {
        if (edge.node.capabilities?.publishable?.status === "DRAFT") {
          yield edge.node;
        }
      }

      after = data.metaobjects.pageInfo.hasNextPage
        ? data.metaobjects.pageInfo.endCursor
        : null;
    } while (after);
  }

  console.log(`Target: ${shop} | API: ${apiVersion}`);
  console.log("Scanning for draft metaobjects...");

  const drafts = [];
  let typeCount = 0;

  for await (const type of metaobjectTypes()) {
    typeCount += 1;
    for await (const item of draftMetaobjectsByType(type)) {
      drafts.push(item);
    }
  }

  console.log(`Found ${typeCount} metaobject types.`);
  console.log(`Found ${drafts.length} draft entries.`);

  if (drafts.length === 0) {
    console.log("No updates needed.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("Dry run only. No updates were made.");
    process.exit(0);
  }

  const mutation = `mutation($id:ID!){
		metaobjectUpdate(id:$id, metaobject:{capabilities:{publishable:{status:ACTIVE}}}){
			metaobject{
				id
				capabilities {
					publishable {
						status
					}
				}
			}
			userErrors{ field message code }
		}
	}`;

  let updated = 0;
  let failed = 0;
  const failures = [];

  for (let index = 0; index < drafts.length; index += 1) {
    const item = drafts[index];
    try {
      const data = await gql(mutation, { id: item.id });
      const userErrors = data.metaobjectUpdate?.userErrors || [];
      if (userErrors.length > 0) {
        failed += 1;
        failures.push({
          type: item.type,
          handle: item.handle,
          error: userErrors.map((err) => err.message).join("; "),
        });
      } else {
        updated += 1;
      }
    } catch (error) {
      failed += 1;
      failures.push({
        type: item.type,
        handle: item.handle,
        error: String(error),
      });
    }

    if ((index + 1) % 25 === 0 || index + 1 === drafts.length) {
      console.log(
        `Progress ${index + 1}/${drafts.length} | updated=${updated} failed=${failed}`,
      );
    }

    await sleep(140);
  }

  console.log("\nDone.");
  console.log(`Updated: ${updated}`);
  console.log(`Failed: ${failed}`);

  if (failures.length > 0) {
    console.log("\nFirst failures:");
    for (const failure of failures.slice(0, 20)) {
      console.log(
        `- ${failure.type}:${failure.handle} -> ${String(failure.error).slice(0, 240)}`,
      );
    }
    process.exit(2);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
