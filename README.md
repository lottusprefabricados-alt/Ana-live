# Ana · avatar humanizado de acolhimento psicológico

A Ana é uma assistente de **acolhimento e apoio emocional**. Ela aparece como um avatar em vídeo e conversa por **voz e texto**. As respostas vêm do Claude (Anthropic). A cada conversa, a Ana atualiza um **perfil de atendimento** com os padrões de comportamento e as preferências da pessoa. Esse perfil serve para personalizar os próximos atendimentos e **nunca contém diagnóstico**.

> ⚠️ A Ana é uma IA e **não substitui psicoterapia**. Antes de usá-la com pessoas reais, leia a seção [Responsabilidade clínica e legal](#responsabilidade-clínica-e-legal).

## Como funciona

```
Navegador (public/)                         Servidor (src/)
┌──────────────────────────┐   SSE    ┌──────────────────────────────────────────┐
│ Avatar em vídeo           │◀────────│ POST /api/clientes/:id/mensagens          │
│ Voz (fala da Ana)         │         │  1. detectarRisco() → alerta imediato     │
│ Microfone (reconhecimento)│────────▶│  2. Claude + prompt da Ana + PERFIL       │
│ Chat + alerta de crise    │         │  3. salva a conversa da sessão            │
└──────────────────────────┘         │  4. a cada 3 trocas → atualiza o perfil   │
                                      └──────────────────────────────────────────┘
```

| Arquivo | Função |
|---|---|
| `src/prompts.ts` | Personalidade e limites da Ana (sem diagnóstico, protocolo de crise, estilo falado). |
| `src/profile.ts` | Esquema do perfil (estilo de comunicação, temas, gatilhos, o que ajudou, nível de risco…) e extração com saída estruturada. |
| `src/safety.ts` | Detecção de frases de risco, que mostra na hora os contatos CVV 188, SAMU 192 e 190. |
| `src/store.ts` | Armazenamento em JSON por cliente e registro de alertas em `data/alertas.log`. |
| `src/server.ts` | API HTTP: consentimento, conversa em streaming, sessões, acesso e exclusão de dados (LGPD). |
| `public/avatar.js` | Avatar em vídeo e voz sintetizada. |
| `public/app.js` | Interface: consentimento, chat, microfone, "Meus dados", "Apagar meus dados". |

### Personalização (memória entre sessões)
- **Durante a sessão**, a conversa inteira é enviada ao modelo.
- **A cada 3 trocas, e ao encerrar a sessão**, outro modelo lê a conversa e atualiza o perfil. O perfil inclui estilo de comunicação, ritmo preferido (mais escuta ou mais prático), temas recorrentes, emoções frequentes, padrões de comportamento, gatilhos, forças e rede de apoio, o que ajudou, o que evitar, pontos para retomar e nível de risco.
- **Na sessão seguinte**, a Ana não recebe o histórico antigo, só o perfil. Com ele, ajusta o tom e o ritmo, retoma assuntos e evita o que não funcionou.

## Rodando

Requer Node.js 20 ou superior.

```bash
npm install
cp .env.example .env      # preencha ANTHROPIC_API_KEY e PSICOLOGO_RESPONSAVEL
npm run dev               # http://localhost:3000
```

Use **Chrome ou Edge** para conversar por voz. Esses navegadores têm reconhecimento de fala em pt-BR. Em outros navegadores, a conversa funciona por texto.

Em produção: `npm run build && npm start`, atrás de HTTPS (o microfone só funciona em HTTPS ou em localhost).

## Avatar em vídeo realista

### Opção 1: vídeos gravados (incluída, sem custo)
Grave uma pessoa real (atriz ou ator com **autorização de uso de imagem**) e coloque dois vídeos em `public/avatar/`:

| Arquivo | Conteúdo |
|---|---|
| `parada.mp4` | 10 a 20 s escutando: olhar para a câmera, piscar, leve aceno de cabeça. Em loop. |
| `falando.mp4` | 10 a 20 s falando de forma natural (pode ser "blá-blá" sem som). Em loop. |

Dicas: mesmo enquadramento e mesma iluminação nos dois vídeos, fundo neutro, formato vertical 3:4, sem áudio, H.264, cerca de 2 MB cada. O avatar alterna entre os dois enquanto a voz fala. Sem os arquivos, aparece um avatar provisório.

### Opção 2: avatar com sincronia labial em tempo real (serviço pago)
Para lábios sincronizados de verdade, use um serviço de avatar em streaming (HeyGen / LiveAvatar, D-ID, Synthesia, Tavus etc.). O `public/avatar.js` define uma interface simples:

```js
window.AnaAvatar = {
  iniciar() {},              // abre a sessão de vídeo do provedor
  falar(texto) { return Promise },  // manda o texto para o avatar falar
  parar() {},                // interrompe a fala
  get falando() {},
  vozAtiva: true,
};
```

Crie um arquivo que implemente essa interface com o SDK do provedor escolhido e carregue-o **antes** de `avatar.js` no `index.html`. A chave do provedor deve ficar no servidor: crie uma rota que gera o token de sessão. O restante do app não muda.

## Responsabilidade clínica e legal

Antes de colocar em uso com o público:

1. **Psicólogo(a) responsável.** Defina um(a) profissional com CRP ativo que supervisione o serviço e revise `data/alertas.log` todos os dias. Consulte as resoluções do Conselho Federal de Psicologia (CFP) sobre serviços psicológicos mediados por tecnologia. A Ana deve ser apresentada como acolhimento e apoio, nunca como psicoterapia ou avaliação.
2. **LGPD.** Dados de saúde mental são **dados pessoais sensíveis** (art. 11). O app já pede consentimento explícito, mostra os dados guardados ("Meus dados") e permite apagá-los. Em produção, ainda falta:
   - banco de dados com criptografia, em vez de arquivos JSON;
   - login real, em vez do ID salvo no navegador;
   - política de privacidade, encarregado(a) de dados (DPO) e prazo de retenção;
   - acordo de tratamento de dados com os fornecedores (Anthropic e o provedor de avatar).
3. **Crise.** O app detecta frases de risco e mostra CVV, SAMU e 190. A Ana foi instruída a seguir um protocolo de crise. **Mesmo assim, nenhum sistema automático é infalível.** Defina como a equipe humana age diante de um alerta.
4. **Transparência.** A Ana sempre se apresenta como IA, e o rodapé lembra que ela não substitui atendimento profissional.
