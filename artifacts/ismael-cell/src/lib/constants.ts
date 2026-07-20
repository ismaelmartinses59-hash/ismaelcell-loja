import { OrderLinha } from "@workspace/api-client-react";

// ─── Serviços — Lojista (software/desbloqueio) ───────────────────────────────
export const SERVICES_BY_LINE: Record<OrderLinha, string[]> = {
  [OrderLinha.xiaomi]:   ["CONTA GOOGLE", "CONTA MI", "PAYJOY", "SOFTWARE", "HARD RESET"],
  [OrderLinha.samsung]:  ["CONTA GOOGLE", "SAMSUNG CLOUD", "PAYJOY", "SOFTWARE", "HARD RESET"],
  [OrderLinha.motorola]: ["CONTA GOOGLE", "MDM", "SOFTWARE", "HARD RESET"],
  [OrderLinha.ios]:      ["SOFTWARE", "PASSCODE", "BYPASS"],
  [OrderLinha.realme]:   ["CONTA GOOGLE", "SOFTWARE", "HARD RESET"],
};

// ─── Serviços — Cliente (reparos físicos + desbloqueio) ──────────────────────
const CLIENTE_SERVICES = [
  "TROCA DE TELA",
  "TROCA DE BATERIA",
  "TROCA DE CONECTOR",
  "TROCA TAMPA TRASEIRA",
  "REPARO EM PLACA",
  "DESBLOQUEIO",
  "SOFTWARE",
];

export const SERVICES_BY_LINE_CLIENTE: Record<OrderLinha, string[]> = {
  [OrderLinha.xiaomi]:   CLIENTE_SERVICES,
  [OrderLinha.samsung]:  CLIENTE_SERVICES,
  [OrderLinha.motorola]: CLIENTE_SERVICES,
  [OrderLinha.ios]:      CLIENTE_SERVICES,
  [OrderLinha.realme]:   CLIENTE_SERVICES,
};

// ─── Tempo estimado ───────────────────────────────────────────────────────────
export const ESTIMATED_TIMES: Record<string, string> = {
  // Lojista
  "CONTA GOOGLE":    "5 a 60 min",
  "CONTA MI":        "5 a 60 min",
  "HARD RESET":      "10 a 60 min",
  "SOFTWARE":        "30 min a 2h",
  "PAYJOY":          "5 a 60 min",
  "SAMSUNG CLOUD":   "5 a 60 min",
  "MDM":             "30 min a 2h",
  "PASSCODE":        "10 a 60 min",
  "BYPASS":          "1 a 48h",
  // Cliente
  "TROCA DE TELA":       "30 min a 1h",
  "TROCA DE BATERIA":    "30 a 60 min",
  "TROCA DE CONECTOR":   "30 a 60 min",
  "TROCA TAMPA TRASEIRA": "20 a 40 min",
  "REPARO EM PLACA":     "1 a 5 dias",
  "DESBLOQUEIO":         "5 a 60 min",
};
