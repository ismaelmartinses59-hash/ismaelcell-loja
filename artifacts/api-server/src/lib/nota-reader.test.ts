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

  it("usa o modelo como descrição original e preserva qualidade personalizada antiga", () => {
    const [item] = normalizarItensNota({
      itens: [{ modelo: "BATERIA A02", qualidade: "Foxcomm" }],
    });

    equal(item?.modeloOriginal, "BATERIA A02");
    equal(item?.qualidade, "Foxcomm");
  });

  it("canonicaliza variações conhecidas e preserva qualidades do fornecedor", () => {
    const itens = normalizarItensNota({
      itens: [
        { modelo: "TELA REDMI", custo: "65,00", qualidade: "DIAMONDS S/A" },
        { modelo: "TELA SAMSUNG", custo: "42,00", qualidade: "ORI S/A" },
        { modelo: "BATERIA SAMSUNG", custo: "50,00", qualidade: "SKAIKY" },
        { modelo: "TELA REALME", custo: "63,00", qualidade: "TITAN S/A" },
      ],
    });

    deepEqual(itens.map((item) => item.qualidade), ["Diamond", "ORI S/A", "Skaiky", "TITAN S/A"]);
    deepEqual(itens.map((item) => item.custo), ["65.00", "42.00", "50.00", "63.00"]);
  });

  it("move S/A sozinho para o modelo e deixa a qualidade vazia", () => {
    const [item] = normalizarItensNota({
      itens: [{
        modeloOriginal: "TELA G04/G04S/G24 F",
        modelo: "TELA G04/G04S/G24 F",
        qualidade: "S/A",
      }],
    });

    equal(item?.modelo, "TELA G04/G04S/G24 F S/A");
    equal(item?.modeloOriginal, "TELA G04/G04S/G24 F S/A");
    equal(item?.qualidade, "");
  });

  it("mantém uma qualidade explícita quando o modelo também contém S/A", () => {
    const [item] = normalizarItensNota({
      itens: [{ modelo: "TELA G04/G04S/G24 F S/A", qualidade: "ZL" }],
    });

    equal(item?.modelo, "TELA G04/G04S/G24 F S/A");
    equal(item?.qualidade, "ZL");
  });

  it("falha claramente se a resposta não tiver uma lista de itens", () => {
    throws(() => normalizarItensNota({}), NotaReaderError);
  });
});
