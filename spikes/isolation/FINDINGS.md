# Spike: isolar o agente em contêiner sem acesso ao host

Spike da issue #11 (`docs/planning/13-second-opinion.md` §1 R3 e §7). Prova, sem chave de API, que um processo num contêiner `node:26-slim` não lê segredos do host e que a saída de rede só passa por um proxy com allowlist. A pasta `spikes/isolation/` fica fora do workspace pnpm da raiz.

## Comandos de teste

```bash
pnpm --dir spikes/isolation --ignore-workspace install --frozen-lockfile
pnpm --dir spikes/isolation test
```

Os testes de Docker chamam `docker run` com os argumentos de `buildDockerArgs` (usuário `1000:1000`, `--read-only`, `--cap-drop=ALL`, `no-new-privileges`, só a worktree montada em `/work`, ambiente explícito sem `*_TOKEN` nem chave). Sem Docker e fora do CI eles são ignorados; com `CI=true` e sem Docker o teste `fails when docker is missing in CI` reprova.

## Resultados

Os testes C1 a C4 e C9 a C12 são unitários e rodam em qualquer máquina. Os de Docker rodam de verdade no job `check` do CI, sem nenhum ignorado.

- C5 (contêiner não lê segredos do host nem outros projetos): passou.
- C6 (controle negativo: o probe detecta um vazamento proposital): passou.
- C7 (proxy encaminha o host da allowlist e bloqueia os demais): passou.
- C8 (contêiner não tem saída direta): passou.

## O que exige o dono

Cabe a uma issue `owner-action`:

- Rodar o agente real (`query()` com chave de API) dentro do contêiner e confirmar que a mesma fronteira vale.
- Repetir a prova no WSL2 da máquina do dono, onde o Docker e o sistema de arquivos montado do Windows se comportam diferente.

Fora do escopo: escolher entre `spawnClaudeCodeProcess` e `sandbox` do SDK, o contêiner por run em produção (FHP-034), `hooks.PreToolUse` de Bash e `permissionMode` (#16 e #17).

## Siglas

- API: interface de programação de aplicações.
- CI: integração contínua.
- DNS: sistema de nomes de domínio.
- SDK: kit de desenvolvimento de software.
- WSL2: subsistema Windows para Linux, versão 2.
