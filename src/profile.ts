// Construção do perfil de atendimento: padrões de comportamento e preferências
// extraídos das conversas, usados para personalizar os próximos atendimentos.
// Nunca contém diagnóstico.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { PROFILE_SYSTEM_PROMPT } from "./prompts.js";
import { MODEL } from "./config.js";

export const PerfilSchema = z.object({
  estilo_comunicacao: z
    .string()
    .describe("Como a pessoa se expressa e como prefere ser abordada (ex.: objetiva, reflexiva, precisa de espaço para desabafar)."),
  ritmo_preferido: z.enum(["mais_escuta", "equilibrado", "mais_pratico"]),
  temas_recorrentes: z.array(z.string()),
  emocoes_frequentes: z.array(z.string()),
  padroes_comportamentais: z.array(z.string()).describe("Padrões observáveis, em linguagem descritiva, sem rótulos clínicos."),
  situacoes_gatilho: z.array(z.string()),
  recursos_e_forcas: z.array(z.string()).describe("Pontos fortes, rede de apoio, estratégias que a pessoa já usa."),
  intervencoes_que_ajudaram: z.array(z.string()),
  intervencoes_a_evitar: z.array(z.string()),
  pontos_para_retomar: z.array(z.string()).describe("Assuntos em aberto para retomar no próximo atendimento."),
  nivel_risco: z.enum(["nenhum", "baixo", "moderado", "alto"]),
  sugerir_encaminhamento: z.boolean(),
  resumo: z.string().describe("Resumo de 2 a 3 frases da trajetória da pessoa até aqui."),
});

export type PerfilAtendimento = z.infer<typeof PerfilSchema> & { atualizadoEm: string };

export function perfilComoTexto(p: PerfilAtendimento): string {
  const lista = (titulo: string, itens: string[]) =>
    itens.length ? `${titulo}:\n${itens.map((i) => `- ${i}`).join("\n")}` : "";
  return [
    `Resumo: ${p.resumo}`,
    `Estilo de comunicação: ${p.estilo_comunicacao}`,
    `Ritmo preferido: ${p.ritmo_preferido.replace("_", " ")}`,
    lista("Temas recorrentes", p.temas_recorrentes),
    lista("Emoções frequentes", p.emocoes_frequentes),
    lista("Padrões de comportamento", p.padroes_comportamentais),
    lista("Situações-gatilho", p.situacoes_gatilho),
    lista("Recursos e forças", p.recursos_e_forcas),
    lista("O que ajudou", p.intervencoes_que_ajudaram),
    lista("O que evitar", p.intervencoes_a_evitar),
    lista("Para retomar", p.pontos_para_retomar),
    `Nível de risco observado: ${p.nivel_risco}`,
    p.sugerir_encaminhamento ? "Atenção: incentivar com cuidado o contato com psicólogo(a) humano(a)." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function transcricao(mensagens: Anthropic.Beta.BetaMessageParam[]): string {
  return mensagens
    .map((m) => {
      let texto = "";
      if (typeof m.content === "string") {
        texto = m.content;
      } else {
        for (const b of m.content ?? []) {
          if (b.type === "text") texto += `${b.text} `;
        }
      }
      if (!texto.trim()) return null;
      return `${m.role === "user" ? "Pessoa" : "Ana"}: ${texto}`;
    })
    .filter(Boolean)
    .join("\n");
}

export async function atualizarPerfil(
  client: Anthropic,
  perfilAnterior: PerfilAtendimento | null,
  mensagensRecentes: Anthropic.Beta.BetaMessageParam[],
): Promise<PerfilAtendimento | null> {
  const anterior = perfilAnterior ? JSON.stringify(perfilAnterior, null, 2) : "(nenhum — primeiro atendimento)";
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "low", format: zodOutputFormat(PerfilSchema) },
    system: PROFILE_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `<perfil_anterior>\n${anterior}\n</perfil_anterior>\n\n<conversa_recente>\n${transcricao(mensagensRecentes)}\n</conversa_recente>`,
      },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return null;
  return { ...response.parsed_output, atualizadoEm: new Date().toISOString() };
}
