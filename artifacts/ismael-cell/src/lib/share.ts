import html2canvas from "html2canvas";
import { Order } from "@workspace/api-client-react";

export async function shareOrderAsImage(order: Order, containerEl: HTMLElement): Promise<void> {
  const canvas = await html2canvas(containerEl, {
    backgroundColor: null,
    scale: 2,
    useCORS: true,
    logging: false,
  });

  const imgDataUrl = canvas.toDataURL("image/png");

  const statusUrl = `https://${window.location.host}/status/${order.codigo}`;
  const whatsappText = encodeURIComponent(`Serviço Ismael Cell\n${statusUrl}`);
  const waUrl = `https://wa.me/?text=${whatsappText}`;

  window.open(waUrl, "_blank");

  const link = document.createElement("a");
  link.href = imgDataUrl;
  link.download = `ismael-cell-${order.codigo}.png`;
  link.click();
}
