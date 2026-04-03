import { Router, type IRouter } from "express";

const router: IRouter = Router();

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@ismaelcell.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "ismael123";

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: "Email e senha são obrigatórios" });
    return;
  }

  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    res.json({ success: true, email });
    return;
  }

  res.status(401).json({ error: "Credenciais inválidas" });
});

export default router;
