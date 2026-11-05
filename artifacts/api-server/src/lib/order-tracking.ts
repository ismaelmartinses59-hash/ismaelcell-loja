import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const LEGACY_CODE = /^OS-\d{13}$/;
const RANDOM_CODE = /^OS-[a-f0-9]{32}$/;
const SIGNATURE = /^[a-f0-9]{64}$/;

export function createOrderCode(): string {
  return `OS-${randomBytes(16).toString("hex")}`;
}

export function isLegacyCode(code: string): boolean {
  return LEGACY_CODE.test(code);
}

export function isRandomCode(code: string): boolean {
  return RANDOM_CODE.test(code);
}

// Signed access for previously issued, predictable order numbers. Never expose
// this signature from a public endpoint; only authenticated staff may share it.
export function legacyTrackingKey(code: string): string {
  const secret = process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) throw new Error("Tracking signing secret is not configured");
  return createHmac("sha256", secret)
    .update(`ismael-cell:legacy-tracking:v1:${code}`)
    .digest("hex");
}

export function validLegacyTrackingKey(code: string, key: unknown): boolean {
  if (!isLegacyCode(code) || typeof key !== "string" || !SIGNATURE.test(key)) return false;
  return timingSafeEqual(Buffer.from(key, "hex"), Buffer.from(legacyTrackingKey(code), "hex"));
}

export function withTrackingKey<T extends { codigo: string }>(order: T): T & { trackingKey?: string } {
  return isLegacyCode(order.codigo)
    ? { ...order, trackingKey: legacyTrackingKey(order.codigo) }
    : order;
}