import { forwardRef } from "react";
import { Smartphone, Sun, Camera } from "lucide-react";
import { Order } from "@workspace/api-client-react";

interface ShareCardProps {
  order: Order;
}

export const ShareCard = forwardRef<HTMLDivElement, ShareCardProps>(
  ({ order }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          width: "420px",
          background: "#f0f2f5",
          borderRadius: "24px",
          overflow: "hidden",
          fontFamily: "'Inter', 'Segoe UI', sans-serif",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: "linear-gradient(135deg, #1a2236 0%, #0f1724 100%)",
            padding: "28px 32px",
            display: "flex",
            alignItems: "center",
            gap: "20px",
            borderBottom: "3px solid",
            borderImage: "linear-gradient(90deg, #6366f1, #a78bfa) 1",
          }}
        >
          <div
            style={{
              width: "72px",
              height: "72px",
              background: "rgba(255,255,255,0.08)",
              borderRadius: "18px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="5" y="2" width="14" height="20" rx="2" />
              <line x1="9" y1="7" x2="15" y2="7" />
              <line x1="12" y1="17" x2="12" y2="17" strokeWidth="2" />
            </svg>
          </div>
          <div>
            <div
              style={{
                color: "#ffffff",
                fontSize: "28px",
                fontWeight: "800",
                letterSpacing: "2px",
                lineHeight: 1.1,
              }}
            >
              ISMAEL CELL
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.5)",
                fontSize: "11px",
                fontWeight: "600",
                letterSpacing: "3px",
                marginTop: "4px",
              }}
            >
              SISTEMA DE SERVIÇOS
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ background: "#f0f2f5", padding: "20px 20px" }}>
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              overflow: "hidden",
            }}
          >
            {/* Row: Modelo */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                padding: "22px 24px",
                borderBottom: "1px solid #f0f2f5",
              }}
            >
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "#dbeafe",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="5" y="2" width="14" height="20" rx="2" />
                  <line x1="12" y1="17" x2="12" y2="17" strokeWidth="2" />
                </svg>
              </div>
              <div>
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: "11px",
                    fontWeight: "700",
                    letterSpacing: "2px",
                    marginBottom: "6px",
                  }}
                >
                  MODELO
                </div>
                <div
                  style={{
                    color: "#0f172a",
                    fontSize: "20px",
                    fontWeight: "800",
                    letterSpacing: "0.5px",
                  }}
                >
                  {order.modelo.toUpperCase()}
                </div>
              </div>
            </div>

            {/* Row: Serviço */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                padding: "22px 24px",
                borderBottom: "1px solid #f0f2f5",
              }}
            >
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "#ede9fe",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#7c3aed"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="4" />
                  <line x1="12" y1="2" x2="12" y2="4" />
                  <line x1="12" y1="20" x2="12" y2="22" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="2" y1="12" x2="4" y2="12" />
                  <line x1="20" y1="12" x2="22" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              </div>
              <div>
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: "11px",
                    fontWeight: "700",
                    letterSpacing: "2px",
                    marginBottom: "6px",
                  }}
                >
                  SERVIÇO
                </div>
                <div
                  style={{
                    color: "#0f172a",
                    fontSize: "20px",
                    fontWeight: "800",
                    letterSpacing: "0.5px",
                  }}
                >
                  {order.servico.toUpperCase()}
                </div>
              </div>
            </div>

            {/* Row: Valor */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                padding: "22px 24px",
              }}
            >
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  borderRadius: "50%",
                  background: "#d1fae5",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg
                  width="26"
                  height="26"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#059669"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <div>
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: "11px",
                    fontWeight: "700",
                    letterSpacing: "2px",
                    marginBottom: "6px",
                  }}
                >
                  VALOR
                </div>
                <div
                  style={{
                    color: "#059669",
                    fontSize: "22px",
                    fontWeight: "800",
                    letterSpacing: "0.5px",
                  }}
                >
                  R$ {order.valor}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
);

ShareCard.displayName = "ShareCard";
