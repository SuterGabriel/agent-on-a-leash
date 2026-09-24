// Per-run memory. Only APPROVED purchases count as spend.
// A step_up is "pending" until the customer answers.
import type { Decision } from "../../shared/src/types";

export type FinalStatus = "approved" | "declined" | "pending" | "expired";

export interface LedgerEntry {
  authorization_id: string; // live ID
  decision: Decision;
  final_status: FinalStatus;
  amount_chf: number;
  merchant_id: string;
  item_signature: string;
  device_id: string | null;
  country: string;
  sim_time: number;
  stored_result: unknown; // the exact answer we sent, replayed on retry
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class Ledger {
  private entries = new Map<string, LedgerEntry>();

  get(id: string): LedgerEntry | undefined {
    return this.entries.get(id);
  }

  record(e: LedgerEntry): void {
    if (this.entries.has(e.authorization_id)) return; // never count twice
    this.entries.set(e.authorization_id, e);
  }

  /** The customer answered a step_up. */
  resolve(id: string, answer: "approve" | "decline"): void {
    const e = this.entries.get(id);
    if (!e || e.final_status !== "pending") return;
    e.final_status = answer === "approve" ? "approved" : "declined";
  }

  expire(id: string): void {
    const e = this.entries.get(id);
    if (e && e.final_status === "pending") e.final_status = "expired";
  }

  /** Approved purchases in the rolling window (t - days, t]. */
  approvedInWindow(simTime: number, days: number): LedgerEntry[] {
    const from = simTime - days * DAY_MS;
    return [...this.entries.values()].filter(
      (e) => e.final_status === "approved" && e.sim_time > from && e.sim_time <= simTime,
    );
  }

  approvedAtMerchantSince(merchantId: string, since: number, until: number): LedgerEntry[] {
    return [...this.entries.values()].filter(
      (e) => e.final_status === "approved" && e.merchant_id === merchantId && e.sim_time >= since && e.sim_time <= until,
    );
  }

  /** Approved purchases at this shop in this run, whatever the time: the customer said yes here, so the shop is known. */
  /** Approved purchases in this run from this device: the customer said yes once, so the device is theirs for the run. */
  approvedOnDevice(deviceId: string | null): number {
    if (!deviceId) return 0;
    let n = 0;
    for (const e of this.entries.values()) if (e.final_status === "approved" && e.device_id === deviceId) n++;
    return n;
  }

  /** Approved purchases in this run at shops in this country. */
  approvedInCountry(country: string): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.final_status === "approved" && e.country === country) n++;
    return n;
  }

  approvedAtMerchant(merchantId: string): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.final_status === "approved" && e.merchant_id === merchantId) n++;
    return n;
  }

  all(): LedgerEntry[] {
    return [...this.entries.values()];
  }
}

export { DAY_MS };
