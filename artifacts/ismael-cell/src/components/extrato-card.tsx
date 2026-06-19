import { forwardRef } from "react";

export interface ExtratoItem {
  id: string | number;
  modelo: string;
  qualidade?: string | null;
  valor: string;
  createdAt: string;
}

export interface ExtratoCardProps {
  nome: string;
  saldo: number;
  itens: ExtratoItem[];
}

function formatMoney(val: string) {
  const n = parseFloat(val.replace(",", "."));
  if (isNaN(n)) return val;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export const ExtratoCard = forwardRef<HTMLDivElement, ExtratoCardProps>(function ExtratoCard(
  { nome, saldo, itens },
  ref,
) {
  return (
    <div
      ref={ref}
      style={{ width: 640, fontFamily: "Arial, Helvetica, sans-serif", background: "#0c2256", padding: 26, boxSizing: "border-box" }}
    >
      {/* Cabeçalho / logo */}
      <div style={{ textAlign: "center", paddingBottom: 22 }}>
        <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 1, lineHeight: "44px", whiteSpace: "nowrap" }}>
          <span style={{ color: "#ffffff" }}>ISMAEL </span>
          <span style={{ color: "#2f86ff" }}>CELL</span>
        </div>
        <div style={{ color: "#9db8e6", fontSize: 12, fontWeight: 700, letterSpacing: 2, lineHeight: "20px", whiteSpace: "nowrap" }}>ASSISTÊNCIA TÉCNICA ESPECIALIZADA</div>
      </div>

      {/* Painel branco */}
      <div style={{ background: "#ffffff", borderRadius: 18, padding: 24, boxSizing: "border-box" }}>
        <div style={{ textAlign: "center", fontSize: 28, fontWeight: 800, color: "#0c2256", letterSpacing: 0.5, lineHeight: "34px", paddingBottom: 20 }}>EXTRATO DE DÉBITO</div>

        {/* Cliente + Data de emissão (posição absoluta p/ html2canvas) */}
        <div style={{ position: "relative", height: 64, marginBottom: 20 }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: 263, height: 64, border: "1px solid #e2e8f0", borderRadius: 10, boxSizing: "border-box" }}>
            <div style={{ position: "absolute", left: 12, top: 14, width: 36, height: 36, borderRadius: "50%", background: "#0c2256" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ position: "absolute", left: 9, top: 9 }}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>
            </div>
            <div style={{ position: "absolute", left: 58, top: 13, width: 191 }}>
              <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 0.5, lineHeight: "16px" }}>CLIENTE</div>
              <div style={{ fontSize: 16, color: "#0c2256", fontWeight: 800, lineHeight: "22px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nome}</div>
            </div>
          </div>
          <div style={{ position: "absolute", left: 277, top: 0, width: 263, height: 64, border: "1px solid #e2e8f0", borderRadius: 10, boxSizing: "border-box" }}>
            <div style={{ position: "absolute", left: 12, top: 14, width: 36, height: 36, borderRadius: "50%", background: "#0c2256" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ position: "absolute", left: 9, top: 9 }}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
            </div>
            <div style={{ position: "absolute", left: 58, top: 13, width: 191 }}>
              <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 0.5, lineHeight: "16px" }}>DATA DE EMISSÃO</div>
              <div style={{ fontSize: 16, color: "#0c2256", fontWeight: 800, lineHeight: "22px" }}>{new Date().toLocaleDateString("pt-BR")}</div>
            </div>
          </div>
        </div>

        {/* Cabeçalho da seção */}
        <div style={{ position: "relative", height: 42, background: "#0c2256", borderRadius: 8, marginBottom: 12 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ position: "absolute", left: 14, top: 12 }}><rect x="6" y="3" width="12" height="4" rx="1" /><path d="M6 5H4v16h16V5h-2" /></svg>
          <div style={{ position: "absolute", left: 42, top: 0, height: 42, lineHeight: "42px", color: "#fff", fontWeight: 700, fontSize: 16, letterSpacing: 0.5 }}>PRODUTOS E SERVIÇOS</div>
        </div>

        {/* Itens dinâmicos */}
        <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden" }}>
          {[...itens]
            .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map((item, idx, arr) => (
              <div key={item.id} style={{ position: "relative", minHeight: 66, boxSizing: "border-box", borderBottom: idx < arr.length - 1 ? "1px dashed #e2e8f0" : "none" }}>
                <div style={{ position: "absolute", left: 14, top: 13, width: 40, height: 40, borderRadius: "50%", background: "#0c2256" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ position: "absolute", left: 10, top: 10 }}><rect x="6" y="3" width="12" height="4" rx="1" /><path d="M6 5H4v16h16V5h-2" /></svg>
                </div>
                <div style={{ marginLeft: 66, marginRight: 118, paddingTop: 13, paddingBottom: 13 }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: "#0c2256", lineHeight: "20px" }}>
                    {item.modelo}{item.qualidade && item.qualidade !== "Serviço" ? ` (${item.qualidade})` : ""}
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", lineHeight: "16px", marginTop: 3 }}>
                    {new Date(item.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                <div style={{ position: "absolute", left: 424, top: 15, width: 100, textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, lineHeight: "14px" }}>Valor</div>
                  <div style={{ fontSize: 18, color: "#16a34a", fontWeight: 800, lineHeight: "22px" }}>{formatMoney(item.valor)}</div>
                </div>
              </div>
            ))}
        </div>

        {/* Divisor $ */}
        <div style={{ textAlign: "center", height: 32, lineHeight: "32px", margin: "16px 0" }}>
          <span style={{ display: "inline-block", width: 32, height: 32, borderRadius: "50%", background: "#2f86ff", color: "#fff", textAlign: "center", lineHeight: "32px", fontWeight: 800, fontSize: 16, verticalAlign: "top" }}>$</span>
        </div>

        {/* Total */}
        <div style={{ position: "relative", minHeight: 78, background: "#eafaf1", border: "1px solid #bbf7d0", borderRadius: 12, boxSizing: "border-box" }}>
          <div style={{ position: "absolute", left: 18, top: 16, width: 46, height: 46, borderRadius: "50%", background: "#16a34a" }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" style={{ position: "absolute", left: 12, top: 12 }}><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M16 12h.01M2 10h20" /></svg>
          </div>
          <div style={{ marginLeft: 78, paddingTop: 15, paddingRight: 16, paddingBottom: 15 }}>
            <div style={{ fontSize: 13, color: "#166534", fontWeight: 700, letterSpacing: 0.5, lineHeight: "18px" }}>VALOR TOTAL DO DÉBITO</div>
            <div style={{ fontSize: 30, color: "#16a34a", fontWeight: 800, lineHeight: "36px" }}>{fmtBRL(saldo)}</div>
          </div>
        </div>
      </div>

      {/* Rodapé */}
      <div style={{ position: "relative", height: 34, marginTop: 18, marginBottom: 4 }}>
        <div style={{ position: "absolute", left: 4, top: 0, height: 34, lineHeight: "34px", fontSize: 18, fontWeight: 800, whiteSpace: "nowrap" }}>
          <span style={{ color: "#fff" }}>ISMAEL </span>
          <span style={{ color: "#2f86ff" }}>CELL</span>
        </div>
        <div style={{ position: "absolute", right: 4, top: 0, height: 34, lineHeight: "34px", fontSize: 18, fontWeight: 800, color: "#fff", whiteSpace: "nowrap" }}>89 98144-8787</div>
        <div style={{ position: "absolute", right: 152, top: 2, width: 30, height: 30, borderRadius: "50%", background: "#25d366" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#fff" style={{ position: "absolute", left: 6, top: 6 }}><path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2zm0 2a8 8 0 0 1 0 16 8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 0 1 12 4zm4.5 9.8c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1l-.7.9c-.1.1-.2.2-.4.1a6.5 6.5 0 0 1-3.2-2.8c-.1-.2 0-.3.1-.4l.3-.4c.1-.1.1-.2.2-.4s0-.3 0-.4l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5c-.2 0-.4.1-.6.3a2.7 2.7 0 0 0-.8 2 4.7 4.7 0 0 0 1 2.5 10.7 10.7 0 0 0 4.1 3.6c1.5.6 2 .6 2.7.5.4 0 1.4-.6 1.6-1.1s.2-1 .1-1.1l-.4-.3z" /></svg>
        </div>
      </div>
      <div style={{ textAlign: "center", color: "#9db8e6", fontSize: 11, lineHeight: "16px", paddingTop: 6 }}>Documento gerado automaticamente pelo sistema de gestão da ISMAEL CELL.</div>
      <div style={{ textAlign: "center", color: "#2f86ff", fontSize: 11, fontWeight: 700, lineHeight: "16px", paddingTop: 2 }}>ISMAEL CELL – CONFIANÇA QUE CONECTA!</div>
    </div>
  );
});
