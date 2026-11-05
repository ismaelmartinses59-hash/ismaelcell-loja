import type { Request, Response, NextFunction } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;
const MAX_CLIENTS = 10_000;
const clients = new Map<string, { start: number; count: number }>();

export function limitPublicStatus(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  let entry = clients.get(ip);
  if (!entry || now - entry.start >= WINDOW_MS) {
    if (clients.size >= MAX_CLIENTS) {
      for (const [key, value] of clients) {
        if (now - value.start >= WINDOW_MS) clients.delete(key);
      }
      if (clients.size >= MAX_CLIENTS) clients.delete(clients.keys().next().value!);
    }
    entry = { start: now, count: 0 };
    clients.set(ip, entry);
  }
  entry.count++;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  if (entry.count > MAX_REQUESTS) {
    res.setHeader("Retry-After", String(Math.ceil((entry.start + WINDOW_MS - now) / 1000)));
    res.status(429).json({ error: "Muitas consultas. Tente novamente em instantes." });
    return;
  }
  next();
}