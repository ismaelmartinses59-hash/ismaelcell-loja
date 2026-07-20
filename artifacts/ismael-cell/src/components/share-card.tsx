import { forwardRef } from "react";
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
              ORDEM DE SERVIÇO
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ background: "#f0f2f5", padding: "20px" }}>
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
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
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
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
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
