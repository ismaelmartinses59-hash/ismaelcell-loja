import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import authRouter, { requireFinanceSession } from "./auth";

const previous = {
  email: process.env.ADMIN_EMAIL,
  password: process.env.ADMIN_PASSWORD,
  secret: process.env.SESSION_SECRET,
};
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let base: string;

before(async () => {
  process.env.ADMIN_EMAIL = "owner@example.test";
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.SESSION_SECRET = "test-session-signing-key";
  const app = express();
  app.use(express.json());
  app.use("/api", authRouter);
  app.use("/api", requireFinanceSession, (req, res) => {
    res.json({ path: req.path, method: req.method });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  for (const [key, value] of Object.entries({
    ADMIN_EMAIL: previous.email,
    ADMIN_PASSWORD: previous.password,
    SESSION_SECRET: previous.secret,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("financial reads and writes are refused without a valid session", async () => {
  for (const [path, method] of [
    ["/api/caixa", "GET"], ["/api/financeiro/config", "PUT"],
    ["/api/pecas", "GET"], ["/api/pecas/1/vender", "POST"],
    ["/api/caixa-sessoes/historico", "GET"], ["/api/auth/session", "GET"],
  ]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("a login issues a reusable cookie and logout invalidates it", async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ email: "owner@example.test", password: "test-password" }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.match(cookie ?? "", /^finance_session=/);

  for (const [path, method] of [
    ["/api/caixa", "GET"], ["/api/financeiro/config", "PUT"],
    ["/api/pecas", "GET"], ["/api/pecas/1/vender", "POST"],
  ]) {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie! } });
    assert.equal(response.status, 200, `${method} ${path}`);
  }
  const session = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie! } });
  assert.deepEqual(await session.json(), { authenticated: true });

  const foreign = await fetch(`${base}/api/caixa`, {
    headers: { Cookie: cookie!, Origin: "https://attacker.example" },
  });
  assert.equal(foreign.status, 403);
  const foreignPost = await fetch(`${base}/api/pecas/1/vender`, {
    method: "POST", headers: { Cookie: cookie!, Origin: "https://attacker.example" },
  });
  assert.equal(foreignPost.status, 403);
  const foreignLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
    body: JSON.stringify({ email: "owner@example.test", password: "test-password" }),
  });
  assert.equal(foreignLogin.status, 403);
  const foreignLogout = await fetch(`${base}/api/auth/logout`, {
    method: "POST", headers: { Cookie: cookie!, Origin: "https://attacker.example" },
  });
  assert.equal(foreignLogout.status, 403);

  const logout = await fetch(`${base}/api/auth/logout`, {
    method: "POST", headers: { Cookie: cookie!, Origin: base },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0|Expires=/i);
});

test("invalid, expired, and forged cookies are refused", async () => {
  const bad = await fetch(`${base}/api/caixa`, { headers: { Cookie: "finance_session=fake.signature" } });
  assert.equal(bad.status, 401);
  const missingCredentials = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.test", password: "test-password" }),
  });
  assert.equal(login.status, 500);
  process.env.ADMIN_PASSWORD = missingCredentials;
});