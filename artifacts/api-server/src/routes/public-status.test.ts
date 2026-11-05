import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import publicStatusRouter from "./public-status";
import { createOrderCode, isRandomCode, legacyTrackingKey, validLegacyTrackingKey, withTrackingKey } from "../lib/order-tracking";

const previousSecret = process.env.SESSION_SECRET;
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let base: string;

before(async () => {
  process.env.SESSION_SECRET = "test-tracking-signing-secret";
  const app = express();
  app.use("/api", publicStatusRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (previousSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = previousSecret;
});

test("new order codes are unpredictable and distinct", () => {
  const codes = new Set(Array.from({ length: 100 }, createOrderCode));
  assert.equal(codes.size, 100);
  for (const code of codes) assert.ok(isRandomCode(code));
  assert.equal(isRandomCode("OS-1760000000000"), false);
});

test("legacy links need an authenticated staff-issued key", async () => {
  const code = "OS-1760000000000";
  const key = legacyTrackingKey(code);
  assert.deepEqual(withTrackingKey({ codigo: code }), { codigo: code, trackingKey: key });
  assert.deepEqual(withTrackingKey({ codigo: createOrderCode() }).trackingKey, undefined);
  assert.equal(validLegacyTrackingKey(code, key), true);
  assert.equal(validLegacyTrackingKey("OS-1760000000001", key), false);
  assert.equal(validLegacyTrackingKey(code, "0".repeat(64)), false);

  for (const suffix of ["", "?chave=" + "0".repeat(64)]) {
    const response = await fetch(`${base}/api/status/${code}${suffix}`);
    assert.equal(response.status, 403);
    assert.match((await response.json() as { error: string }).error, /novo link/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
  const bad = await fetch(`${base}/api/status/OS-123`);
  assert.equal(bad.status, 404);
});

test("repeated public lookups are limited even for invalid codes", async () => {
  let response: Response | undefined;
  for (let i = 0; i < 20; i++) {
    response = await fetch(`${base}/api/status/invalid-${i}`);
  }
  assert.equal(response?.status, 429);
  assert.ok(Number(response?.headers.get("retry-after")) > 0);
});