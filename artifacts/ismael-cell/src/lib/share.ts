import html2canvas from "html2canvas";
import { Order } from "@workspace/api-client-react";

export async function shareOrderAsImage(order: Order, containerEl: HTMLElement): Promise<void> {
  const canvas = await html2canvas(containerEl, {
    backgroundColor: "#f0f2f5",
    scale: 2,
    useCORS: true,
    logging: false,
  });

  const imgDataUrl = canvas.toDataURL("image/png");

  // Build the correct public status URL
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const statusUrl = `${window.location.origin}${base}/status/${order.codigo}`;

  // Download the image first
  const link = document.createElement("a");
  link.href = imgDataUrl;
  link.download = `ismael-cell-${order.codigo}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Then open WhatsApp with the status link and order info
  const text =
    `📱 *ISMAEL CELL*\n` +
    `Ordem de Serviço\n\n` +
    `Aparelho: ${order.modelo}\n` +
    `Serviço: ${order.servico}\n` +
    `Valor: R$ ${order.valor}\n\n` +
    `🔗 Acompanhe sua ordem:\n${statusUrl}`;

  const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;

  setTimeout(() => {
    window.open(waUrl, "_blank");
  }, 500);
}
