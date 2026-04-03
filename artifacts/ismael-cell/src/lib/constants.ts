import { OrderLinha } from "@workspace/api-client-react";

export const SERVICES_BY_LINE: Record<OrderLinha, string[]> = {
  [OrderLinha.xiaomi]: ["CONTA GOOGLE", "CONTA MI", "PAYJOY", "SOFTWARE", "HARD RESET"],
  [OrderLinha.samsung]: ["CONTA GOOGLE", "SAMSUNG CLOUD", "PAYJOY", "SOFTWARE", "HARD RESET"],
  [OrderLinha.motorola]: ["CONTA GOOGLE", "MDM", "SOFTWARE", "HARD RESET"],
  [OrderLinha.ios]: ["SOFTWARE", "PASSCODE", "BYPASS"],
};

export const ESTIMATED_TIMES: Record<string, string> = {
  "CONTA GOOGLE": "5 a 60 min",
  "CONTA MI": "5 a 60 min",
  "HARD RESET": "10 a 60 min",
  "SOFTWARE": "30 min a 2h",
  "PAYJOY": "5 a 60 min",
  "SAMSUNG CLOUD": "5 a 60 min",
  "MDM": "30 min a 2h",
  "PASSCODE": "10 a 60 min",
  "BYPASS": "1 a 48h",
};
