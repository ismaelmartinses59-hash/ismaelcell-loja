---
name: GitHub pelo painel Git
description: Particularidade da autenticação GitHub no painel Git do Replit versus o terminal
---

O painel Git do Replit pode autenticar e sincronizar o repositório mesmo quando o remote HTTPS usado pelo terminal rejeita a credencial.

**Why:** A conexão GitHub gerenciada e a credencial usada pelo comando `git push` não são necessariamente a mesma sessão de autenticação.

**How to apply:** Para sincronizar uma branch, usar o painel Git após conferir a branch e resolver divergências de histórico; não presumir que uma falha de `git push` no terminal significa que a conexão GitHub do painel está inativa.