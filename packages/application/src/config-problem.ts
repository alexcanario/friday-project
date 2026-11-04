export type ConfigProblemCode =
  | "missing_file"
  | "yaml_invalid"
  | "unknown_key"
  | "required_key"
  | "invalid_value"
  | "unknown_tool"
  | "secret_value"
  | "role_mismatch"
  | "prompt_file_invalid"
  | "agent_without_state"
  | "state_without_agent"
  | "specialist_without_agent";

export interface ConfigProblem {
  file: string;
  line: number;
  code: ConfigProblemCode;
  message: string;
}

const MESSAGES: Record<ConfigProblemCode, (subject: string) => string> = {
  missing_file: () => "Arquivo ausente.",
  yaml_invalid: () => "YAML inválido.",
  unknown_key: (s) => `Chave não prevista em ${s}.`,
  required_key: (s) => `Chave obrigatória ausente: ${s}.`,
  invalid_value: (s) => `Valor inválido em ${s}.`,
  unknown_tool: (s) => `Ferramenta desconhecida em ${s}.`,
  secret_value: () => "Valor secreto no arquivo: use só o nome da variável.",
  role_mismatch: () => "role deve ser igual ao nome do arquivo.",
  prompt_file_invalid: () => "prompt_file inválido.",
  agent_without_state: () => "Agente sem estado (states).",
  state_without_agent: (s) => `Estado sem agente: ${s}.`,
  specialist_without_agent: (s) => `Especialista sem ficha em InProgress: ${s}.`,
};

export function configProblem(
  code: ConfigProblemCode,
  file: string,
  line: number,
  subject = "",
): ConfigProblem {
  return { file, line, code, message: MESSAGES[code](subject) };
}
