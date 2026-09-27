import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

const COOKIE = "finance_session";
const secret = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD;
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (!["http:", "https:"].includes(parsed.protocol) ||
        parsed.host !== req.headers.host ||
        (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
        res.status(403).json({ error: "Origem não permitida." }); return;
      }
    } catch {
      res.status(403).json({ error: "Origem não permitida." }); return;
    }
  }
  next();
}
function issueFinanceSession(res: Response, email: string) {
  const key = secret();
  if (!key) return;
  const body = Buffer.from(JSON.stringify({ email, exp: Date.now() + 8 * 3600000 })).toString("base64url");
  const signature = createHmac("sha256", key).update(body).digest("base64url");
  res.cookie(COOKIE, [body, signature].join("."), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: "/api", maxAge: 8 * 3600000,
  });
}
export function requireFinanceSession(req: Request, res: Response, next: NextFunction): void {
  const key = secret();
  const cookie = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  const [body, signature] = cookie?.split(".") ?? [];
  if (!key || !body || !signature) {
    res.status(401).json({ error: "Entre novamente para acessar os dados financeiros." }); return;
  }
  try {
    const expected = createHmac("sha256", key).update(body).digest("base64url");
    const a = Buffer.from(signature); const b = Buffer.from(expected);
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (a.length !== b.length || !timingSafeEqual(a, b) ||
      typeof value.email !== "string" || typeof value.exp !== "number" || value.exp <= Date.now())
      throw new Error("invalid session");
    requireSameOrigin(req, res, next);
  } catch { res.status(401).json({ error: "Sua sessão financeira expirou. Entre novamente." }); }
}
router.post("/auth/logout", requireSameOrigin, (_req, res) => {
  res.clearCookie(COOKIE, { path: "/api" });
  res.json({ success: true });
});

router.get("/auth/session", requireFinanceSession, (_req, res) => {
  res.json({ authenticated: true });
});

router.post("/auth/login", requireSameOrigin, async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email e senha são obrigatórios" });
    return;
  }

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    res.status(500).json({ error: "Credenciais do sistema não configuradas" });
    return;
  }

  const emailNorm = email.trim().toLowerCase();
  const passwordNorm = password.trim();
  const adminEmailNorm = adminEmail.trim().toLowerCase();
  const adminPasswordNorm = adminPassword.trim();

  if (emailNorm === adminEmailNorm && passwordNorm === adminPasswordNorm) {
    issueFinanceSession(res, emailNorm);
    res.json({ success: true, email: emailNorm });
    return;
  }

  res.status(401).json({ error: "E-mail ou senha incorretos" });
});

export default router;
