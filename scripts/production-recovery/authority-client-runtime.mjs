import { canonicalJson } from "./canonical.mjs";
import { parseOperationArguments, sendProductionOperation } from "./host-operation-client.mjs";

/** Public non-privileged client bundle; the root service revalidates every request. */
export async function runProductionOperationClient(argv = process.argv.slice(2)) {
  const request = parseOperationArguments(argv);
  const response = await sendProductionOperation(request);
  process.stdout.write(canonicalJson(response) + "\n");
}
