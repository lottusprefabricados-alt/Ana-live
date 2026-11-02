// Detecção rápida de sinais de risco na fala do usuário, antes mesmo da resposta do modelo.
// Não substitui a avaliação do modelo nem a supervisão humana; serve para exibir
// imediatamente os contatos de emergência na tela e gerar alerta.

const PADROES_RISCO: RegExp[] = [
  /suic[ií]d/i,
  /\bme\s+matar\b/i,
  /\btirar\s+(a\s+)?minha\s+(pr[oó]pria\s+)?vida\b/i,
  /\bacabar\s+com\s+(tudo|a\s+minha\s+vida)\b/i,
  /\bn[aã]o\s+(quero|aguento)\s+mais\s+viver\b/i,
  /\bquero\s+morrer\b/i,
  /\bmelhor\s+(se\s+eu\s+)?(estar|estivesse)\s+mort[oa]\b/i,
  /\bsumir\s+(do\s+mundo|pra\s+sempre)\b/i,
  /\bme\s+(cortar|cortei|machucar|machuquei|ferir|feri)\b/i,
  /\bautoles[aã]o\b/i,
  /\bautomutila/i,
  /\boverdose\b/i,
];

export function detectarRisco(texto: string): boolean {
  return PADROES_RISCO.some((re) => re.test(texto));
}

export const CONTATOS_EMERGENCIA = [
  { nome: "CVV – Centro de Valorização da Vida", contato: "188", detalhe: "24h, ligação gratuita · chat em cvv.org.br" },
  { nome: "SAMU", contato: "192", detalhe: "emergência médica" },
  { nome: "Polícia", contato: "190", detalhe: "perigo imediato" },
];
