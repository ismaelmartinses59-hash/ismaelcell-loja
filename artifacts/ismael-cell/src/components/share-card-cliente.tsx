import { forwardRef } from "react";
import { Order } from "@workspace/api-client-react";

interface ShareCardClienteProps {
  order: Order;
}

const FONT = "Inter, Segoe UI, Arial, sans-serif";

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
          style={{ width: "100%", display: "block", borderRadius: "16px" }}
        />

        {/* Box 1 — Modelo */}
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
            gap: "3px",
          }}
        >
          <span style={{
            color: "#7dd3fc",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "2.5px",
            fontFamily: FONT,
            lineHeight: 1,
          }}>
            MODELO
          </span>
          <span style={{
            color: "#ffffff",
            fontSize: "22px",
            fontWeight: 900,
            letterSpacing: "1px",
            fontFamily: FONT,
            lineHeight: 1,
            textAlign: "center",
            textShadow: "0 0 8px rgba(96,165,250,0.6)",
          }}>
            {order.modelo.toUpperCase()}
          </span>
        </div>

        {/* Box 2 — Serviço */}
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
            gap: "3px",
          }}
        >
          <span style={{
            color: "#7dd3fc",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "2.5px",
            fontFamily: FONT,
            lineHeight: 1,
          }}>
            SERVIÇO
          </span>
          <span style={{
            color: "#ffffff",
            fontSize: "17px",
            fontWeight: 900,
            letterSpacing: "0.5px",
            fontFamily: FONT,
            lineHeight: 1.1,
            textAlign: "center",
            textShadow: "0 0 8px rgba(96,165,250,0.6)",
          }}>
            {order.servico.toUpperCase()}
          </span>
        </div>

        {/* Box 3 — Valor */}
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
            gap: "3px",
          }}
        >
          <span style={{
            color: "#7dd3fc",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "2.5px",
            fontFamily: FONT,
            lineHeight: 1,
          }}>
            VALOR
          </span>
          <span style={{
            color: "#60a5fa",
            fontSize: "26px",
            fontWeight: 900,
            fontFamily: FONT,
            lineHeight: 1,
            textAlign: "center",
            textShadow: "0 0 12px rgba(96,165,250,0.8)",
          }}>
            R$ {order.valor}
          </span>
        </div>
      </div>
    );
  }
);

ShareCardCliente.displayName = "ShareCardCliente";
