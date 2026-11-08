# Spike #276: documentação atual das bibliotecas para o `implementer` por MCP

Data: 2026-11-08. Sessão diurna local, com o agente `claude-code-guide` (documentação oficial) e um agente de pesquisa na web.

Cada afirmação leva uma marca:
- **(testado):** chamada real feita neste spike (API de rotinas, API pública do Context7, `tools/list` de servidores remotos, registro do npm, arquivos instalados).
- **(só lido):** lido na documentação ou nos tipos, sem execução.

Nenhuma chave, conta ou conteúdo do repositório foi enviado a terceiros. As consultas de teste ao Context7 levaram só o nome da biblioteca e um tema genérico.

## Versões fixadas

| Pacote | Versão fixada | Onde | `latest` no npm em 2026-11-08 |
|---|---|---|---|
| Zod | zod 4.6.7 | `packages/contracts`, `packages/infrastructure`, `apps/api` | 4.6.7 |
| Fastify | fastify 5.12.8 | `apps/api` | 5.12.8 |
| Drizzle ORM | drizzle-orm 0.45.4 | `packages/infrastructure` | 0.45.4 |
| Drizzle Kit | drizzle-kit 0.31.11 | `packages/infrastructure` (dev) | 0.31.11 |
| Agent SDK | @anthropic-ai/claude-agent-sdk 0.3.318 | `packages/infrastructure` | 0.3.319 |

(testado) `latest` lido em `https://registry.npmjs.org/<pacote>/latest`. Só o SDK já tem uma versão nova, um patch à frente: é a biblioteca que mais muda.

## Pergunta 1

**As tarefas agendadas do Claude Code na nuvem carregam servidores MCP? Quais e como se configuram?**

Status: testado

Resposta curta: sim, por três caminhos. Hoje nenhuma das 3 noites tem MCP.

1. **Estado atual das noites (testado).** As rotinas `Friday · Noite A · Refinar`, `Friday · Noite B · Implementar` e `Friday · Noite C · Revisar, testar, merge e relatório`, lidas pela API de rotinas em 2026-11-08, têm `mcp_connections: []`, `mcp_servers: []` e `allowed_tools: ["Bash","Read","Write","Edit","Glob","Grep","Agent"]`, todas no mesmo ambiente de nuvem.
2. **`.mcp.json` do repositório (só lido).** Uma sessão na nuvem com um repositório carrega os servidores do `.mcp.json` versionado. Para uma rotina de um repositório, a documentação manda declarar o servidor num `.mcp.json` versionado. Fontes: https://code.claude.com/docs/en/cloud-environments.md ("What carries over") e https://code.claude.com/docs/en/routines.md ("Connectors").
3. **Sem pergunta de confiança (só lido).** Em execução sem tela (headless e nuvem), o Claude Code carrega os servidores de escopo de projeto sem perguntar (https://code.claude.com/docs/en/mcp.md, "Project scope"). Consequência: um servidor posto no `.mcp.json` chega a todas as sessões que abrem o repositório, nas três fases e nas sessões locais do dono, não só ao `implementer`.
4. **Conectores do claude.ai (só lido).** Uma rotina inclui por padrão todos os conectores ligados à conta, e cada um pode ser removido na aba "Connectors" da rotina. O tráfego desses conectores passa pelos servidores da Anthropic e não precisa de lista de domínios. Fontes: https://code.claude.com/docs/en/routines.md e https://code.claude.com/docs/en/cloud-environments.md ("Access levels"). Servidores de usuário (`~/.claude.json`) não vão para a nuvem.
5. **Rede (só lido).** O nível padrão do ambiente é `Trusted`; `registry.npmjs.org` está na lista padrão, então um servidor `npx` baixa. `context7.com` e `mcp.context7.com` não estão na lista: é preciso passar o ambiente a `Custom` e listar os domínios, um por ambiente (https://code.claude.com/docs/en/cloud-environments.md, "Allow specific domains").
6. **Segredos (só lido).** Variáveis de ambiente do ambiente de nuvem ficam visíveis a quem usa o ambiente; a documentação recomenda segredos de rede, que o proxy só anexa quando o host bate com o listado (https://code.claude.com/docs/en/cloud-environments.md, "Add network secrets"). Não está documentado se um servidor MCP recebe esse segredo nas próprias chamadas.
7. **Por agente (só lido).** O frontmatter de um subagente aceita `tools`, `disallowedTools` e `mcpServers` (referência ou servidor em linha `stdio`, `http`, `sse` ou `ws`). Sem `tools`, o subagente herda todas as ferramentas, MCP incluídas (https://code.claude.com/docs/en/sub-agents.md). Os tipos instalados do SDK 0.3.318 confirmam `AgentDefinition.mcpServers?: AgentMcpServerSpec[]` e `disallowedTools` com `mcp__server` (`sdk.d.ts`, linhas 36 a 59).
8. **O `implementer` herdaria tudo (testado).** `.claude/agents/implementer.md` não tem `tools` no frontmatter. Qualquer ferramenta MCP da sessão chegaria a ele e aos outros agentes sem `tools`.
9. **Permissão na noite (só lido).** A execução de uma rotina começa em modo automático (https://code.claude.com/docs/en/routines.md, "Permission prompts during a run"); as regras usam `mcp__<server>__*` (https://code.claude.com/docs/en/permissions.md). Não está documentado se o modo automático aprova uma ferramenta MCP que não está em `allowed_tools`.

Não verificado (exige uma rodada real na nuvem): se um servidor `stdio` lançado com `npx` sobe numa sessão de rotina e recebe as variáveis do ambiente.

Para a #275 (`mcp__friday__*` nas noites): vale o mesmo mecanismo. Um servidor no `.mcp.json` chega a todos os agentes sem `tools`; `mcpServers` no frontmatter do agente que precisa, ou `disallowedTools: mcp__*` nos outros, limita o alcance.

## Pergunta 2

**Qual servidor de documentação usar, com que custo e com que dados saindo do repositório?**

Status: testado

| Candidato | Transporte | Chave | Custo | Dados que saem | Versão | Marca |
|---|---|---|---|---|---|---|
| Context7 (Upstash) | HTTP remoto `https://mcp.context7.com/mcp` ou `npx @upstash/context7-mcp` (que chama a mesma API) | opcional | grátis: 1 000 chamadas por mês; Pro: US$ 10 por usuário por mês | nome da biblioteca, consulta em texto livre, cliente, IP | sim, `/org/projeto/versão` | testado |
| arabold/docs-mcp-server | `stdio` ou HTTP local, auto-hospedado | não | grátis | só o tráfego de raspagem dos sites; telemetria PostHog **ligada por padrão** | sim, um índice por versão | só lido |
| GitMCP | HTTP remoto | não | grátis | repositório e consulta | não: branch padrão | testado (`tools/list`) |
| DeepWiki (Cognition) | HTTP remoto | não | grátis | repositório e pergunta para um respondedor de IA | não | testado (`tools/list`) |
| Ref | HTTP remoto | sim | 200 créditos únicos; US$ 50 por mês | consulta e URL | não | só lido |
| Pacotes instalados (`node_modules`) | arquivos locais | não | grátis | nada | exata | testado |

Fontes: https://context7.com/plans, https://context7.com/docs/security/data-privacy, https://github.com/arabold/docs-mcp-server, https://github.com/idosal/git-mcp, https://cognition.com/privacy-policy, https://docs.ref.tools/usage/pricing, https://ref.tools/privacy.

**Context7 (testado).** As ferramentas MCP são `resolve-library-id` (`query`, `libraryName`) e `query-docs` (`libraryId`, `query`, `language`). Sem chave, os cabeçalhos da API mostraram `Ratelimit-Limit: 200`, contado por IP; numa nuvem com IP compartilhado, o limite pode acabar antes da noite. Uma chave ficaria no ambiente de nuvem.

**Dados que saem (só lido).** O Context7 guarda as consultas de forma anônima para avaliação, mantém os logs da API por 30 dias e reordena os resultados com um modelo de linguagem (https://context7.com/docs/security/data-privacy). A Cognition diz que conteúdo do usuário pode treinar modelos (https://cognition.com/privacy-policy). O risco principal é a consulta: quem a escreve é o agente, e ela pode levar trechos do repositório (nomes de tipos, código, mensagens de erro).

**Injeção de prompt (só lido).** A falha ContextCrush (CVE-2026-75130, CVSS 9.0) passava "Custom Rules" de bibliotecas do Context7 ao agente sem filtro; a demonstração fez um agente enviar o `.env` para fora e apagar arquivos. A Upstash diz que corrigiu no servidor em 2026-02-23 (https://context7.com/guides/contextcrush); o registro do CVE ainda não lista correção (https://app.opencve.io/cve/CVE-2026-75130). O mesmo risco vale para todo servidor que devolve conteúdo de terceiros.

**Alternativa sem MCP (testado).** Os pacotes instalados já trazem a documentação da versão exata:
- `zod@4.6.7`: `index.d.ts`, `src/` e `README.md`.
- `fastify@5.12.8`: `fastify.d.ts`, `types/` e `docs/Reference/` (21 arquivos Markdown).
- `drizzle-orm@0.45.4`: `.d.ts` por módulo, incluindo `better-sqlite3/`.
- `@anthropic-ai/claude-agent-sdk@0.3.318`: `sdk.d.ts` com 10 500 linhas e JSDoc em cada opção.

O `implementer` já tem `Read` e `Grep`: não sai nenhum dado, não há ferramenta nova nem `gate:security`. Para texto corrido do SDK, a página oficial https://code.claude.com/docs/en/agent-sdk/typescript.md marca cada opção com "Requires TypeScript Agent SDK vX" até a 0.3.318 (testado).

## Pergunta 3

**A documentação devolvida bate com as versões fixadas no `package.json`?**

Status: testado

Testado na API do Context7 em 2026-11-08, pedindo cada versão fixada:

| Biblioteca | Resultado | Detalhe |
|---|---|---|
| zod 4.6.7 | bate | `/colinhacks/zod/v4.6.7` devolve trechos de `blob/v4.6.7`. Armadilha: `/websites/zod_dev` está marcado como v3. |
| fastify 5.12.8 | não bate | o índice para em 5.12.7; pedir v5.12.8 devolve a documentação atual de `main`, com um aviso de versão. |
| drizzle-orm 0.45.4 | bate, mas pobre | `/drizzle-team/drizzle-orm` tem 0.45.4 com só 873 trechos; um fork (`/replit/drizzle-orm`) tem nota de confiança maior e pode ser escolhido por engano; o site de documentação não tem versão e já fala da v1.0 beta. |
| drizzle-kit 0.31.11 | não bate | só existe `drizzle-kit_0.31.5`. |
| @anthropic-ai/claude-agent-sdk 0.3.318 | não bate | não há índice do SDK TypeScript por versão; `/websites/code_claude_en_agent-sdk` (atualizado em 2026-10-28) tem notas só até a 0.3.282 e não traz opções da 0.3.314 em diante. |

GitMCP, DeepWiki e Ref não aceitam versão (testado no `tools/list` de GitMCP e DeepWiki; só lido no Ref: https://github.com/ref-tools/ref-tools-mcp). O arabold indexa por versão, mas exige hospedar e indexar antes (só lido: https://github.com/arabold/docs-mcp-server).

Resumo: no melhor servidor hospedado, 2 de 5 pacotes batem. O SDK, que muda toda semana e onde errar de memória é mais provável, é o que tem a pior cobertura. Os arquivos em `node_modules` batem nos 5 por construção: são a versão instalada pelo lockfile.

## Procedimento de medição

Vale para reabrir este spike (servidor MCP) ou para medir a alternativa local. Com a decisão abaixo, a issue `owner-action` de medição não foi criada.

1. **Issue de exemplo:** #43 (PR #110, "servidor MCP friday e portões do resultado de agente"), que criou `packages/infrastructure/src/friday-mcp-server.ts` com `createSdkMcpServer` e `tool` do SDK.
2. **Base:** uma branch descartável a partir do commit pai do merge do PR #110, com o corpo da #43 como estava.
3. **Duas rodadas do `implementer`**, mesmo modelo e mesmo teto (D44: 10 turnos, US$ 0,50 cada):
   - A: como hoje.
   - B: com a mudança medida, seja o passo de ler os tipos em `node_modules`, seja o servidor (Context7 em linha em `mcpServers` do agente, `mcp.context7.com` e `context7.com` na lista `Custom` do ambiente, chave como segredo de rede, `mcp__context7__*` em `allowed_tools`; tudo atrás de `gate:security`).
4. **O que comparar:** erros de typecheck na primeira execução (`TS2339`, `TS2353`, `TS2554`, que indicam API inventada), número de correções até o verde, turnos, `total_cost_usd`, e as consultas enviadas ao servidor (para ver se levaram código do repositório).
5. **Registro:** uma tabela A × B nesta seção, num PR novo.

## Recomendação

Decisão: não usar

Motivos:
1. Os pacotes instalados dão a documentação exata das 4 bibliotecas sem dado saindo e sem ferramenta nova.
2. O melhor servidor hospedado (Context7) erra a versão de fastify, drizzle-kit e do SDK TypeScript, justamente a biblioteca que mais muda.
3. A consulta sai do repositório escrita pelo agente, fica guardada pelo serviço, e a resposta é um canal de injeção de prompt já explorado (ContextCrush).
4. Adotar exigiria quatro mudanças de segurança ao mesmo tempo: servidor no agente ou no `.mcp.json`, `allowed_tools` das rotinas, lista de domínios do ambiente e uma chave no ambiente. Cada uma é `gate:security`.

Reabrir se: a medição acima mostrar que o `implementer` inventa API mesmo lendo os tipos locais; ou um servidor com versão exata rodar sem rede sobre o `node_modules`; ou o Context7 indexar o SDK TypeScript por versão.

Proposta de issue (não adota MCP e não dá ferramenta nova):
- Título: "`implementer` lê os tipos instalados antes de usar uma API de biblioteca".
- Resumo: acrescentar ao `implementer` um passo para, antes de usar Zod, Fastify, Drizzle ou o Agent SDK, ler o `.d.ts` e a documentação do pacote em `node_modules` do pacote que o importa (por exemplo `packages/infrastructure/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` e `apps/api/node_modules/fastify/docs/Reference/`). Mexe em `.claude/agents/implementer.md`, então depende das #273 e #274.

## Siglas

- **API:** Application Programming Interface (interface de programação de aplicações).
- **CI:** Continuous Integration (integração contínua).
- **CVE:** Common Vulnerabilities and Exposures (catálogo público de vulnerabilidades).
- **CVSS:** Common Vulnerability Scoring System (escala de gravidade de vulnerabilidades).
- **HTTP:** Hypertext Transfer Protocol.
- **IA:** inteligência artificial.
- **IP:** Internet Protocol (endereço de rede).
- **MCP:** Model Context Protocol.
- **PR:** Pull Request.
- **SDK:** Software Development Kit (kit de desenvolvimento de software).
- **URL:** Uniform Resource Locator.
- **D44:** decisão numerada em `docs/decisions.md`.
