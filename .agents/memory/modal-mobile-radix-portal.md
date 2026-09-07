---
name: Modais móveis sobre Radix
description: Regra para overlays e telas cheias abertas de dentro de um DialogContent.
---

Overlays `position: fixed` abertos dentro de um `DialogContent` do Radix devem ser renderizados em um portal ligado ao `document.body`, não como descendentes diretos do diálogo.

**Why:** o `transform` usado para posicionar o diálogo cria um novo bloco de contenção. No iPhone, o overlay supostamente fixo passa a ocupar apenas os limites do diálogo pai, causando cortes, espaços vazios e rolagem iniciada no meio.

**How to apply:** sempre que uma tela cheia ou modal secundário nascer dentro de um diálogo Radix, use portal ou outro diálogo com portal próprio; ajustes de `100vh`, `100dvh` e `scrollTop` não resolvem a contenção transformada.