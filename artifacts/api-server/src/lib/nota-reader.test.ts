import { deepEqual, equal, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import { NotaReaderError, normalizarItensNota } from "./nota-reader.js";

describe("normalizarItensNota", () => {
  it("mantém a descrição original e a qualidade reconhecida ao receber o modelo limpo", () => {
    const [item] = normalizarItensNota({
      itens: [{
        modeloOriginal: "TELA DIAMOND SAMSUNG A02/A12/A13 5G PRETO S/A",
        modelo: "TELA A02/A12/A13 5G",
        quantidade: "3",
        custo: "50,00",
        qualidade: "diamond",
      }],
    });

    deepEqual(item, {
      modeloOriginal: "TELA DIAMOND SAMSUNG A02/A12/A13 5G PRETO S/A",
      modelo: "TELA A02/A12/A13 5G",
      quantidade: 3,
      custo: "50.00",
      qualidade: "Diamond",
    });
  });

  it("usa o modelo como descrição original para respostas antigas", () => {
    const [item] = normalizarItensNota({
      itens: [{ modelo: "BATERIA A02", qualidade: "Foxcomm" }],
    });

    equal(item?.modeloOriginal, "BATERIA A02");
    equal(item?.qualidade, "");
  });

  it("falha claramente se a resposta não tiver uma lista de itens", () => {
    throws(() => normalizarItensNota({}), NotaReaderError);
  });
});
