import { forwardRef } from "react";
import { Order } from "@workspace/api-client-react";

interface ShareCardClienteProps {
  order: Order;
}

export const ShareCardCliente = forwardRef<HTMLDivElement, ShareCardClienteProps>(
  ({ order }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          width: "420px",
          position: "relative",
          display: "inline-block",
          lineHeight: 0,
        }}
      >
        {/* Background image */}
        <img
          src="/share-bg-cliente.png"
          alt="IsmaelCell"
          crossOrigin="anonymous"
          style={{
            width: "100%",
            display: "block",
            borderRadius: "16px",
          }}
        />

        {/* Overlay: Box 1 — Modelo */}
        <div
          style={{
            position: "absolute",
            top: "29.5%",
            left: "2.5%",
            width: "44%",
            height: "11.5%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: "10px", fontWeight: 700, letterSpacing: "2px", fontFamily: "Inter, Segoe UI, sans-serif", lineHeight: 1 }}>
            MODELO
          </span>
          <span style={{ color: "#0f172a", fontSize: "18px", fontWeight: 800, letterSpacing: "0.5px", fontFamily: "Inter, Segoe UI, sans-serif", lineHeight: 1, textAlign: "center" }}>
            {order.modelo.toUpperCase()}
          </span>
        </div>

        {/* Overlay: Box 2 — Serviço */}
        <div
          style={{
            position: "absolute",
            top: "43%",
            left: "2.5%",
            width: "44%",
            height: "11.5%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: "10px", fontWeight: 700, letterSpacing: "2px", fontFamily: "Inter, Segoe UI, sans-serif", lineHeight: 1 }}>
            SERVIÇO
          </span>
          <span style={{ color: "#0f172a", fontSize: "15px", fontWeight: 800, letterSpacing: "0.5px", fontFamily: "Inter, Segoe UI, sans-serif", lineHeight: 1.1, textAlign: "center" }}>
            {order.servico.toUpperCase()}
          </span>
        </div>

        {/* Overlay: Box 3 — Valor */}
        <div
          style={{
            position: "absolute",
            top: "56.5%",
            left: "2.5%",
            width: "44%",
            height: "11.5%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "2px",
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: "10px", fontWeight: 700, letterSpacing: "2px", fontFamily: "Inter, Segoe UI, sans-serif", lineHeight: 1 }}>
            VALOR
          </span>
          <span style={{ color: "#1d4ed8", fontSize: "20px", fontWeight: 900, fontFamily: "Inter, Segoe UI, sans-serif", lineHeight: 1, textAlign: "center" }}>
            R$ {order.valor}
          </span>
        </div>
      </div>
    );
  }
);

ShareCardCliente.displayName = "ShareCardCliente";
