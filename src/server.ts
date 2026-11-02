import express, { type Request, type Response } from "express";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { ANA_SYSTEM_PROMPT, formatProfileForPrompt } from "./prompts.js";
import { atualizarPerfil, perfilComoTexto } from "./profile.js";
import { CONTATOS_EMERGENCIA, detectarRisco } from "./safety.js";
import {
  carregarCliente,
  comCliente,
  criarCliente,
  excluirCliente,
  registrarAlerta,
  salvarCliente,
  type Cliente,
} from "./store.js";
import {
  ATUALIZAR_PERFIL_A_CADA,
  JANELA_LIMITE_MS,
  LIMITE_MENSAGENS,
  MODEL,
  PORT,
  PSICOLOGO_RESPONSAVEL,
  VERSAO_TERMO,
} from "./config.js";

const anthropic = new Anthropic();
const app = express();
app.set("trust proxy", 1); // atrás do proxy da hospedagem, para obter o IP real
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.resolve("public")));

const MSG_INICIO = "[A pessoa acabou de entrar no atendimento. Cumprimente-a pelo nome, se souber.]";
const MSG_RECUSA =
  "Desculpe, não consegui responder a isso agora. Se você estiver passando por um momento difícil, o CVV atende 24 horas pelo 188. Quer me contar de outro jeito o que está acontecendo?";

async function getCliente(req: Request, res: Response): Promise<Cliente | null> {
  const cliente = await carregarCliente(String(req.params.id)).catch(() => null);
  if (!cliente) res.status(404).json({ erro: "Cliente não encontrado." });
  return cliente;
}

// Recalcula o perfil de atendimento a partir da sessão atual. Roda em segundo plano.
function agendarAtualizacaoPerfil(id: string): void {
  comCliente(id, async () => {
    const cliente = await carregarCliente(id);
    if (!cliente || cliente.sessaoAtual.length === 0) return;
    const perfil = await atualizarPerfil(anthropic, cliente.perfil, cliente.sessaoAtual);
    if (!perfil) return;
    cliente.perfil = perfil;
    cliente.trocasDesdeUltimoPerfil = 0;
    await salvarCliente(cliente);
    if (perfil.nivel_risco === "alto") await registrarAlerta(id, "perfil: nível de risco alto");
  }).catch((err) => console.error("Falha ao atualizar perfil:", err));
}

app.get("/api/config", (_req, res) => {
  res.json({ psicologo: PSICOLOGO_RESPONSAVEL, contatos: CONTATOS_EMERGENCIA, versaoTermo: VERSAO_TERMO });
});

// Cadastro com consentimento explícito (LGPD, art. 11: dados sensíveis de saúde).
app.post("/api/clientes", async (req, res) => {
  const { nome, consentimento } = req.body ?? {};
  if (consentimento !== true) {
    res.status(400).json({ erro: "É necessário aceitar o termo de consentimento." });
    return;
  }
  const nomeLimpo = typeof nome === "string" && nome.trim() ? nome.trim().slice(0, 60) : null;
  const cliente = await criarCliente(nomeLimpo, VERSAO_TERMO);
  res.status(201).json({ id: cliente.id, nome: cliente.nome });
});

app.get("/api/clientes/:id", async (req, res) => {
  const cliente = await getCliente(req, res);
  if (!cliente) return;
  res.json({ id: cliente.id, nome: cliente.nome, sessoesConcluidas: cliente.sessoesConcluidas });
});

// Direito de acesso (LGPD, art. 18): a pessoa pode ver o que foi registrado sobre ela.
app.get("/api/clientes/:id/dados", async (req, res) => {
  const cliente = await getCliente(req, res);
  if (!cliente) return;
  res.json({
    nome: cliente.nome,
    consentimento: cliente.consentimento,
    criadoEm: cliente.criadoEm,
    sessoesConcluidas: cliente.sessoesConcluidas,
    perfil: cliente.perfil,
  });
});

// Direito de eliminação (LGPD, art. 18).
app.delete("/api/clientes/:id", async (req, res) => {
  await comCliente(String(req.params.id), () => excluirCliente(String(req.params.id))).catch(() => undefined);
  res.status(204).end();
});

// Inicia uma nova sessão. A sessão anterior é resumida no perfil antes de ser arquivada.
app.post("/api/clientes/:id/sessao", async (req, res) => {
  const id = String(req.params.id);
  const cliente = await getCliente(req, res);
  if (!cliente) return;
  await comCliente(id, async () => {
    const atual = await carregarCliente(id);
    if (!atual || atual.sessaoAtual.length === 0) return;
    if (atual.trocasDesdeUltimoPerfil > 0) {
      const perfil = await atualizarPerfil(anthropic, atual.perfil, atual.sessaoAtual).catch(() => null);
      if (perfil) atual.perfil = perfil;
    }
    atual.sessaoAtual = [];
    atual.trocasDesdeUltimoPerfil = 0;
    atual.sessoesConcluidas += 1;
    await salvarCliente(atual);
  });
  res.json({ ok: true });
});

// Limite simples, em memória, de mensagens por IP.
const usoPorIp = new Map<string, number[]>();
function excedeuLimite(ip: string): boolean {
  const agora = Date.now();
  const recentes = (usoPorIp.get(ip) ?? []).filter((t) => agora - t < JANELA_LIMITE_MS);
  if (recentes.length >= LIMITE_MENSAGENS) {
    usoPorIp.set(ip, recentes);
    return true;
  }
  recentes.push(agora);
  usoPorIp.set(ip, recentes);
  return false;
}
setInterval(() => {
  const agora = Date.now();
  for (const [ip, ts] of usoPorIp) if (ts.every((t) => agora - t >= JANELA_LIMITE_MS)) usoPorIp.delete(ip);
}, JANELA_LIMITE_MS).unref();

// Envia uma fala e recebe a resposta da Ana em streaming (Server-Sent Events).
app.post("/api/clientes/:id/mensagens", async (req, res) => {
  const id = String(req.params.id);
  const inicio = req.body?.inicio === true;
  const texto = typeof req.body?.texto === "string" ? req.body.texto.trim().slice(0, 4000) : "";
  if (!inicio && !texto) {
    res.status(400).json({ erro: "Mensagem vazia." });
    return;
  }
  if (excedeuLimite(req.ip ?? "desconhecido")) {
    res.status(429).json({ erro: "Muitas mensagens em pouco tempo. Respire um pouco e tente de novo em alguns minutos." });
    return;
  }
  if (!(await getCliente(req, res))) return;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const enviar = (evento: object) => res.write(`data: ${JSON.stringify(evento)}\n\n`);
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  if (texto && detectarRisco(texto)) {
    enviar({ tipo: "risco", contatos: CONTATOS_EMERGENCIA });
    registrarAlerta(id, "fala com sinal de risco").catch(() => undefined);
  }

  let precisaPerfil = false;
  try {
    await comCliente(id, async () => {
      const cliente = await carregarCliente(id);
      if (!cliente) throw new Error("cliente removido");

      const mensagens: Anthropic.Beta.BetaMessageParam[] = [
        ...cliente.sessaoAtual,
        { role: "user", content: inicio ? MSG_INICIO : texto },
      ];
      const perfilTexto = cliente.perfil ? perfilComoTexto(cliente.perfil) : null;

      const stream = anthropic.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system: [
            // Parte fixa primeiro, com cache; o perfil (que muda) vem depois.
            { type: "text", text: ANA_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
            { type: "text", text: formatProfileForPrompt(perfilTexto, cliente.nome) },
          ],
          messages: mensagens,
        },
        { signal: abort.signal },
      );

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          enviar({ tipo: "texto", texto: event.delta.text });
        }
      }
      const final = await stream.finalMessage();

      if (final.stop_reason === "refusal") {
        // Não grava a troca recusada no histórico; responde com uma mensagem segura.
        enviar({ tipo: "texto", texto: MSG_RECUSA });
        return;
      }

      // Guarda o conteúdo completo (inclusive blocos de pensamento) para o próximo turno.
      cliente.sessaoAtual = [...mensagens, { role: "assistant", content: final.content }];
      cliente.trocasDesdeUltimoPerfil += 1;
      precisaPerfil = cliente.trocasDesdeUltimoPerfil >= ATUALIZAR_PERFIL_A_CADA;
      await salvarCliente(cliente);
    });
    enviar({ tipo: "fim" });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error("Erro no atendimento:", err);
      const msg =
        err instanceof Anthropic.RateLimitError
          ? "Muitas conversas ao mesmo tempo. Tente de novo em alguns segundos."
          : "Tive um problema técnico para responder. Pode repetir?";
      enviar({ tipo: "erro", mensagem: msg });
    }
  } finally {
    res.end();
  }
  if (precisaPerfil) agendarAtualizacaoPerfil(id);
});

app.listen(PORT, () => {
  console.log(`Ana está no ar em http://localhost:${PORT}`);
});
