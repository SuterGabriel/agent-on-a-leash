// Prints every live scenario: the instruction and what compilePolicy() reads from it.
//   npm run inspect-live
// Downloads bootstrap, reference data and card history (cached in data/live/). Starts no run.
import { resolve } from "node:path";
import { loadConfig } from "../config.js";
import { HttpVisecaClient } from "../viseca/client.js";
import { loadLiveReference } from "../live/referenceData.js";
import { compilePolicy, WEEKDAYS } from "../../../shared/src/compiler.js";

const cfg = loadConfig({ mode: "live" });
const client = new HttpVisecaClient(cfg.baseUrl, cfg.teamApiKey);
const ref = await loadLiveReference(client, resolve(cfg.dataDir, "live"), (l) => console.log(l));

const pack = (ref.bootstrap as { pack_version?: string } | null)?.pack_version ?? "unknown";
const cards = new Set(ref.history.map((r) => r.card_id)).size;
console.log(`live pack ${pack} · reference data ${ref.source} · ${ref.history.length} history rows, ${cards} cards, ${ref.merchants.size} merchants`);
console.log(`cached in ${resolve(cfg.dataDir, "live")}\n`);

const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "string" ? v : JSON.stringify(v));

for (const s of ref.scenarios) {
  const p = compilePolicy(s.cardholder_instruction);
  console.log(`=== ${s.scenario_id} · ${s.scenario_name} · ${s.event_count} purchases`);
  console.log(`instruction: ${s.cardholder_instruction}`);
  console.log(`  per-order limit     ${p.perOrderLimitChf === null ? "—" : `CHF ${p.perOrderLimitChf}`}`);
  console.log(`  period limit        ${p.periodLimit ? `CHF ${p.periodLimit.amountChf} per ${p.periodLimit.days} days` : "—"}`);
  console.log(`  categories          ${show(p.allowedCategories)}`);
  console.log(`  requested item      ${show(p.requestedItem?.phrase)}`);
  console.log(`  size                ${show(p.size)}`);
  console.log(`  min. return days    ${show(p.minReturnDays)}`);
  console.log(`  shop type           ${show(p.requiredMerchantCategories)}`);
  console.log(`  known shops only    ${p.familiarShopsOnly ? "yes" : "no"}`);
  console.log(`  no extras           ${p.noExtras ? "yes" : "no"}`);
  console.log(`  session check       ${p.sessionIntegrity ? "yes" : "no"}`);
  console.log(`  per-unit limit      ${p.perUnitLimit ? `CHF ${p.perUnitLimit.amountChf} per ${p.perUnitLimit.unit}` : "—"}`);
  console.log(`  max orders          ${p.maxOrdersPerPeriod ? `${p.maxOrdersPerPeriod.count} per ${p.maxOrdersPerPeriod.days} day(s)` : "—"}`);
  console.log(`  allowed weekdays    ${p.allowedWeekdays ? p.allowedWeekdays.map((d) => WEEKDAYS[d]).join(",") : "—"}`);
  console.log(`  blocked categories  ${show(p.blockedCategories)}`);
  console.log(`  blocked keywords    ${show(p.blockedKeywords)}`);
  console.log(`  refundable only     ${p.refundableRequired ? "yes" : "no"}`);
  console.log(`  destination         ${show(p.destinationCity)}`);
  console.log(`  nights / dates      ${p.stayNights ?? "—"}${p.stayDates ? ` (${p.stayDates.from} → ${p.stayDates.to})` : ""}`);
  console.log(`  when uncertain      ${p.uncertainty}`);
  for (const a of p.assumptions) console.log(`  assumption: ${a}`);
  for (const q of p.openQuestions) console.log(`  open question: ${q}`);
  console.log();
}
