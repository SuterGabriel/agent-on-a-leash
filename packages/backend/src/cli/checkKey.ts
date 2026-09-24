// Step 0: prove the team key works. Prints health, bootstrap timeouts and the reference-data size.
import { loadConfig } from "../config.js";
import { HttpVisecaClient } from "../viseca/client.js";
import { VisecaError } from "../viseca/api.js";

/** Collects every numeric setting whose name mentions a deadline, timeout, window or wait. */
function findTimeouts(value: unknown, path = "", out: string[] = []): string[] {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) findTimeouts(v, path ? `${path}.${k}` : k, out);
  } else if (typeof value === "number" && /deadline|timeout|window|wait|human/i.test(path)) {
    out.push(`  ${path} = ${value}`);
  }
  return out;
}

const cfg = loadConfig({ mode: "live" });
const api = new HttpVisecaClient(cfg.baseUrl, cfg.teamApiKey);

try {
  console.log("healthz:", JSON.stringify(await api.healthz()));
  if (!cfg.teamApiKey) {
    console.error("\nTEAM_API_KEY is empty. Copy .env.example to .env and paste the key from Slack.");
    process.exit(1);
  }
  const bootstrap = await api.bootstrap();
  console.log("\nbootstrap: OK");
  const timeouts = findTimeouts(bootstrap);
  console.log(timeouts.length ? `timeouts found:\n${timeouts.join("\n")}` : "no timeout fields recognised, full response below");
  console.log(JSON.stringify(bootstrap, null, 2));
} catch (err) {
  if (err instanceof VisecaError && err.status === 401) {
    console.error("\n401 Unauthorized. Try the key without the 'team3:' prefix and post the working format in Slack.");
  } else {
    console.error("\nfailed:", (err as Error).message);
  }
  process.exit(1);
}
