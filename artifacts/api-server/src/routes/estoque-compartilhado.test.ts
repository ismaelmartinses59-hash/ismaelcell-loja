import test from "node:test";
import assert from "node:assert/strict";
import { chaveEstoqueCompartilhado, mesmaPecaCompartilhada } from "./estoque-compartilhado.js";

test("compartilha estoque quando modelo igual só muda caixa, acento ou pontuação", () => {
  assert.equal(
    mesmaPecaCompartilhada(
      { modelo: "Tela A10s", qualidade: "Diamond" },
      { modelo: " TÉLA-A10S ", qualidade: "diamond" },
    ),
    true,
  );
});

test("mantém modelos distintos quando uma palavra de identidade muda", () => {
  assert.notEqual(
    chaveEstoqueCompartilhado("TELA A10s", "Diamond"),
    chaveEstoqueCompartilhado("TELA DO A10s", "Diamond"),
  );
  assert.notEqual(
    chaveEstoqueCompartilhado("TELA A10s", "Diamond"),
    chaveEstoqueCompartilhado("BATERIA A10s", "Diamond"),
  );
});

test("preserva a ordem das palavras ao identificar o mesmo estoque", () => {
  assert.equal(
    mesmaPecaCompartilhada(
      { modelo: "TELA A10s", qualidade: "Diamond" },
      { modelo: "A10s TELA", qualidade: "Diamond" },
    ),
    false,
  );
});
