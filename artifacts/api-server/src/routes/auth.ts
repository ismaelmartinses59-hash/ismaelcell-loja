import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
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

  if (email === adminEmail && password === adminPassword) {
    res.json({ success: true, email });
    return;
  }

  res.status(401).json({ error: "E-mail ou senha incorretos" });
});

export default router;
