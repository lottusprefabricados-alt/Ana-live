// Armazenamento simples em arquivos JSON (um por cliente). Adequado para protótipo.
// Em produção: banco de dados com criptografia em repouso, controle de acesso e
// política de retenção, pois são dados pessoais sensíveis de saúde (LGPD, art. 11).
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { PerfilAtendimento } from "./profile.js";

import { DATA_ROOT } from "./config.js";

const DATA_DIR = path.join(DATA_ROOT, "clientes");
const ALERTS_FILE = path.join(DATA_ROOT, "alertas.log");

export interface Cliente {
  id: string;
  nome: string | null;
  consentimento: { aceitoEm: string; versao: string };
  criadoEm: string;
  perfil: PerfilAtendimento | null;
  sessoesConcluidas: number;
  // Conversa da sessão atual, enviada inteira à API a cada turno. Só cresce (append-only):
  // os blocos de pensamento devolvidos pelo modelo precisam voltar sem alterações.
  // A memória entre sessões fica no perfil, não no histórico.
  sessaoAtual: Anthropic.Beta.BetaMessageParam[];
  trocasDesdeUltimoPerfil: number;
}

const ID_RE = /^[0-9a-f-]{36}$/;

function fileFor(id: string): string {
  if (!ID_RE.test(id)) throw new Error("id inválido");
  return path.join(DATA_DIR, `${id}.json`);
}

export async function criarCliente(nome: string | null, versaoTermo: string): Promise<Cliente> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const agora = new Date().toISOString();
  const cliente: Cliente = {
    id: randomUUID(),
    nome,
    consentimento: { aceitoEm: agora, versao: versaoTermo },
    criadoEm: agora,
    perfil: null,
    sessoesConcluidas: 0,
    sessaoAtual: [],
    trocasDesdeUltimoPerfil: 0,
  };
  await salvarCliente(cliente);
  return cliente;
}

export async function carregarCliente(id: string): Promise<Cliente | null> {
  try {
    return JSON.parse(await fs.readFile(fileFor(id), "utf8")) as Cliente;
  } catch {
    return null;
  }
}

export async function salvarCliente(cliente: Cliente): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const destino = fileFor(cliente.id);
  const tmp = `${destino}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cliente, null, 2), "utf8");
  await fs.rename(tmp, destino);
}

export async function excluirCliente(id: string): Promise<void> {
  await fs.rm(fileFor(id), { force: true });
}

// Registro para o(a) psicólogo(a) responsável revisar casos de risco.
export async function registrarAlerta(clienteId: string, motivo: string): Promise<void> {
  await fs.mkdir(path.dirname(ALERTS_FILE), { recursive: true });
  await fs.appendFile(ALERTS_FILE, `${new Date().toISOString()}\t${clienteId}\t${motivo}\n`, "utf8");
}

// Serializa operações por cliente para evitar que gravações concorrentes se sobrescrevam.
const filas = new Map<string, Promise<unknown>>();
export function comCliente<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const anterior = filas.get(id) ?? Promise.resolve();
  const proxima = anterior.catch(() => undefined).then(fn);
  filas.set(id, proxima);
  proxima.finally(() => {
    if (filas.get(id) === proxima) filas.delete(id);
  }).catch(() => undefined);
  return proxima;
}
