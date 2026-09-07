---
name: Modais móveis sobre Radix
description: Regra para overlays e telas cheias abertas de dentro de um DialogContent.
---

Overlays `position: fixed` abertos dentro de um `DialogContent` do Radix devem usar outro `Dialog` Radix, com seu próprio `DialogContent` e portal, não um descendente direto nem um `createPortal` manual.

**Why:** o `transform` usado para posicionar o diálogo cria um novo bloco de contenção. No iPhone, um descendente `fixed` fica preso aos limites do pai. Um portal manual corrige a geometria, mas o Radix torna seus irmãos externos inertes enquanto o diálogo modal está aberto, deixando o formulário visível porém sem aceitar toques.

**How to apply:** sempre que uma tela cheia ou modal secundário nascer dentro de um diálogo Radix, abra um segundo `Dialog` Radix. Ajustes de `100vh`, `100dvh`, `scrollTop` ou um portal manual não resolvem geometria e interação ao mesmo tempo.