---
name: Contagem física no fechamento do caixa
description: Mantém a conferência da gaveta independente do valor calculado pelo sistema.
---

# Contagem física no fechamento

O campo de valor contado no fechamento deve sempre começar vazio. O valor esperado
pelo sistema aparece separadamente, e a interface mostra a sobra ou falta depois
que a pessoa digita quanto encontrou fisicamente.

**Why:** preencher a contagem com o valor esperado transforma a conferência em uma
confirmação automática e esconde dinheiro físico sem lançamento ou faltas reais.

**How to apply:** qualquer mudança no fechamento deve preservar três valores
distintos: esperado pelos lançamentos, contado fisicamente e diferença entre eles.
Durante a conferência, deve haver uma lista mista de todas as entradas e saídas do
dia, atualizada no momento do toque, para confirmar item por item se tudo foi
lançado antes de fechar. A última hora deve ser apenas um filtro opcional dessa
mesma lista.