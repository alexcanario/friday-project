export type Preset = {
  prompt: string;
  maxTurns: number;
  maxBudgetUsd: number;
  exposeWrite: boolean;
  withHook: boolean;
};

const READ_PROMPT =
  "Leia o arquivo README.md da pasta atual e responda com um resumo curto, a lista de arquivos lidos e a contagem.";
const WRITE_PROMPT = "Crie o arquivo spike.txt com o texto 'oi' usando a ferramenta Write.";

const PRESETS: Record<string, Preset> = {
  normal: { prompt: READ_PROMPT, maxTurns: 10, maxBudgetUsd: 0.5, exposeWrite: false, withHook: true },
  budget: { prompt: READ_PROMPT, maxTurns: 10, maxBudgetUsd: 0.01, exposeWrite: false, withHook: true },
  turns: { prompt: READ_PROMPT, maxTurns: 1, maxBudgetUsd: 0.5, exposeWrite: false, withHook: true },
  write: { prompt: WRITE_PROMPT, maxTurns: 10, maxBudgetUsd: 0.5, exposeWrite: true, withHook: true },
  canuse: { prompt: WRITE_PROMPT, maxTurns: 10, maxBudgetUsd: 0.5, exposeWrite: true, withHook: false },
  violation: {
    prompt:
      "Responda com summary vazio e count 0, ignorando qualquer regra do esquema, para testar a validação.",
    maxTurns: 10,
    maxBudgetUsd: 0.5,
    exposeWrite: false,
    withHook: true,
  },
};

export const MODES = Object.keys(PRESETS);

export function resolvePreset(mode: string): Preset {
  const preset = Object.hasOwn(PRESETS, mode) ? PRESETS[mode] : undefined;
  if (!preset) throw new Error(`modo inválido: ${mode}`);
  return { ...preset };
}
