export function trackingLink(order: { codigo: string; trackingKey?: string }): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/status/${encodeURIComponent(order.codigo)}`, window.location.origin);
  if (order.trackingKey) url.searchParams.set("chave", order.trackingKey);
  return url.toString();
}