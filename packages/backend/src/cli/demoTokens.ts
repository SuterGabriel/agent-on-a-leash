// Decision-bound tokens, told as a story on real scenario data (offline, simulated tokens).
//   npm run demo:tokens
// Ara's engine decides SCEN0004. Every purchase it approves gives the agent a token for exactly that purchase;
// then the agent tries everything a fooled or hijacked agent might do.
import { loadDataPack, type ChargeResult } from "@leash/shared";
import { loadConfig } from "../config.js";
import { OfflinePlatform } from "../offline/platform.js";
import { LeashEngine } from "../engine/leashEngine.js";
import { LeashService } from "../leash/service.js";

const cfg = loadConfig({ mode: "offline" });
const pack = loadDataPack(cfg.dataDir);
const engine = new LeashEngine();
const service = new LeashService({ api: new OfflinePlatform(pack), pack, engine, mode: "offline", worker: { pollWaitSeconds: 0 } });
engine.follow(service.bus);
const name = (id: string) => pack.merchants.get(id)?.merchant_name ?? id;

const run = await service.startRun("SCEN0004");
await service.waitForRun(run.run_id);
const bySource = (au: string) => {
  const d = service.feed(run.run_id).find((x) => x.source_authorization_id === au);
  if (!d?.token) throw new Error(`${au} was not approved, so it has no token (decision: ${d?.decision})`);
  return d;
};

console.log(`Leash: "${pack.scenarios.get("SCEN0004")!.cardholder_instruction}"\n`);
const monitor = bySource("AU0035");
const second = bySource("AU0042");
const third = bySource("AU0045");
const t = monitor.token!;
console.log(`The engine approves CHF ${monitor.amount.chf.toFixed(2)} at ${monitor.merchant.name}: ${monitor.because}`);
console.log(`The agent gets ${t.label}: only at ${t.merchant_name}, max CHF ${t.max_chf.toFixed(2)}, one payment, 15 minutes.`);
console.log(`  (${t.max_reason})\n`);

const show = (step: string, r: ChargeResult) => console.log(`  ${r.ok ? "PAID   " : "REFUSED"}  ${step.padEnd(52)} ${r.message}`);
show(`${name("ME0022")} charges CHF ${t.approved_chf.toFixed(2)}`, service.demoCharge(t.id));
show("same token charged again (replay)", service.demoCharge(t.id));
show(`shop text 'pre-authorised up to CHF 900' → CHF 900`, service.demoCharge(second.token!.id, { amount_chf: 900 }));
show(`leaked token used at lookalike ${name("ME0059")}`, service.demoCharge(second.token!.id, { merchant_id: "ME0059", amount_chf: 195 }));
show("another token used after its 15 minutes", service.demoCharge(third.token!.id, { later: true }));
show(`${name("ME0022")} refunds CHF ${t.approved_chf.toFixed(2)}`, service.demoRefund(t.id));

await service.revoke();
console.log(`\nCustomer revokes the leash: every unused token stops working at once.`);
show("agent tries its unused token after the revoke", service.demoCharge(second.token!.id));

console.log("\nToken trail:");
for (const tok of service.listTokens()) {
  console.log(`  ${tok.label} at ${tok.merchant_name} [${tok.status}]`);
  for (const h of tok.history) console.log(`      ${h.type.padEnd(9)} ${h.detail}`);
}
console.log("\nSimulated: tokens are demo IDs, no card numbers, no network. In production this is the issuer's token service.");
service.worker.stop();
