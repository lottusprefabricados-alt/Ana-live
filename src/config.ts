import path from "node:path";

export const MODEL = "claude-opus-5-5";
export const PORT = Number(process.env.PORT ?? 3000);
export const PSICOLOGO_RESPONSAVEL = process.env.PSICOLOGO_RESPONSAVEL ?? "";
export const VERSAO_TERMO = "2026-11-v1";
// A cada quantas trocas (usuário + Ana) o perfil é recalculado.
export const ATUALIZAR_PERFIL_A_CADA = 3;
// Pasta dos dados. Em hospedagem, aponte para um disco persistente (ex.: /var/data).
export const DATA_ROOT = path.resolve(process.env.DATA_DIR ?? "data");
// Limite de mensagens por IP, para evitar abuso e gasto excessivo com a API.
export const LIMITE_MENSAGENS = Number(process.env.LIMITE_MENSAGENS ?? 40);
export const JANELA_LIMITE_MS = 10 * 60 * 1000;
