(function () {
  const $ = (id) => document.getElementById(id);
  const avatar = window.AnaAvatar;
  const CHAVE = "ana:clienteId";

  let clienteId = lerId();
  let ocupado = false; // aguardando resposta da Ana
  let filaFala = Promise.resolve();

  function lerId() {
    try {
      return localStorage.getItem(CHAVE);
    } catch {
      return null;
    }
  }
  function gravarId(id) {
    try {
      id ? localStorage.setItem(CHAVE, id) : localStorage.removeItem(CHAVE);
    } catch {}
  }

  // ---------- Inicialização ----------
  async function iniciar() {
    const cfg = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
    if (cfg.psicologo) {
      $("aviso-psicologo").hidden = false;
      $("aviso-psicologo").textContent = `Os atendimentos são supervisionados por ${cfg.psicologo}.`;
    }
    if (clienteId) {
      const r = await fetch(`/api/clientes/${clienteId}`);
      if (r.ok) {
        mostrarAtendimento(true);
        return;
      }
      gravarId(null);
      clienteId = null;
    }
    $("tela-consentimento").hidden = false;
  }

  $("form-consentimento").addEventListener("submit", async (e) => {
    e.preventDefault();
    const r = await fetch("/api/clientes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: $("campo-nome").value, consentimento: $("campo-aceite").checked }),
    });
    if (!r.ok) return alert("Não foi possível iniciar. Tente novamente.");
    const { id } = await r.json();
    clienteId = id;
    gravarId(id);
    mostrarAtendimento(false);
  });

  function mostrarAtendimento(retorno) {
    $("tela-consentimento").hidden = true;
    $("tela-atendimento").hidden = false;
    if (retorno) {
      // Navegadores só tocam áudio/vídeo após um gesto do usuário.
      const b = document.createElement("button");
      b.className = "primario botao-entrar";
      b.textContent = "Entrar no atendimento";
      $("historico").append(b);
      b.onclick = async () => {
        b.remove();
        avatar.iniciar();
        await fetch(`/api/clientes/${clienteId}/sessao`, { method: "POST" });
        enviar({ inicio: true });
      };
    } else {
      avatar.iniciar();
      enviar({ inicio: true });
    }
  }

  // ---------- Conversa ----------
  function adicionarBalao(quem, texto = "") {
    const li = document.createElement("li");
    li.className = `balao ${quem}`;
    li.textContent = texto;
    $("historico").append(li);
    li.scrollIntoView({ block: "end", behavior: "smooth" });
    return li;
  }

  function falar(trecho) {
    filaFala = filaFala.then(() => {
      $("legenda").textContent = trecho;
      return avatar.falar(trecho);
    });
    return filaFala;
  }

  async function enviar({ texto = "", inicio = false }) {
    if (ocupado || !clienteId) return;
    ocupado = true;
    pararEscuta();
    avatar.parar();
    filaFala = Promise.resolve();
    if (texto) adicionarBalao("pessoa", texto);
    const balao = adicionarBalao("ana");
    balao.classList.add("digitando");

    let completo = "";
    let pendente = "";
    try {
      const r = await fetch(`/api/clientes/${clienteId}/mensagens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto, inicio }),
      });
      if (!r.ok || !r.body) throw new Error("falha");
      const leitor = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buffer += value;
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const linha = buffer.slice(0, idx).replace(/^data: /, "");
          buffer = buffer.slice(idx + 2);
          if (!linha) continue;
          const ev = JSON.parse(linha);
          if (ev.tipo === "texto") {
            balao.classList.remove("digitando");
            completo += ev.texto;
            pendente += ev.texto;
            balao.textContent = completo;
            balao.scrollIntoView({ block: "end" });
            // Fala frase a frase, sem esperar a resposta inteira.
            let m;
            while ((m = pendente.match(/^([\s\S]*?[.!?…])(\s+)/))) {
              falar(m[1].trim());
              pendente = pendente.slice(m[0].length);
            }
          } else if (ev.tipo === "risco") {
            mostrarAlertaRisco(ev.contatos);
          } else if (ev.tipo === "erro") {
            balao.classList.remove("digitando");
            balao.textContent = ev.mensagem;
            balao.classList.add("erro");
          }
        }
      }
      if (pendente.trim()) falar(pendente.trim());
    } catch {
      balao.classList.remove("digitando");
      balao.classList.add("erro");
      balao.textContent = "Perdi a conexão por um instante. Pode tentar de novo?";
    } finally {
      ocupado = false;
    }
    await filaFala;
    $("legenda").textContent = "";
    if (micAtivo) iniciarEscuta();
  }

  $("form-mensagem").addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = $("campo-mensagem").value.trim();
    if (!texto) return;
    $("campo-mensagem").value = "";
    enviar({ texto });
  });

  $("opcao-voz").addEventListener("change", (e) => {
    avatar.vozAtiva = e.target.checked;
    if (!e.target.checked) avatar.parar();
  });

  function mostrarAlertaRisco(contatos) {
    $("contatos-risco").innerHTML = contatos
      .map((c) => `<a href="tel:${c.contato}">${c.nome} ${c.contato}</a> <small>(${c.detalhe})</small>`)
      .join(" · ");
    $("alerta-risco").hidden = false;
  }

  // ---------- Microfone (reconhecimento de voz do navegador) ----------
  const Reconhecimento = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let micAtivo = false;
  let escutando = false;

  if (!Reconhecimento) {
    $("botao-mic").disabled = true;
    $("botao-mic").title = "Seu navegador não suporta reconhecimento de voz (use Chrome ou Edge).";
  } else {
    rec = new Reconhecimento();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (e) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          $("campo-mensagem").value = "";
          enviar({ texto: r[0].transcript.trim() });
          return;
        }
        parcial += r[0].transcript;
      }
      $("campo-mensagem").value = parcial;
    };
    rec.onend = () => {
      escutando = false;
      $("botao-mic").classList.remove("ouvindo");
      // Continua ouvindo enquanto o modo de voz estiver ligado e a Ana estiver em silêncio.
      if (micAtivo && !ocupado && !avatar.falando) setTimeout(iniciarEscuta, 250);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        micAtivo = false;
        $("botao-mic").setAttribute("aria-pressed", "false");
        alert("Permita o uso do microfone para conversar por voz.");
      }
    };
  }

  function iniciarEscuta() {
    if (!rec || escutando || ocupado) return;
    try {
      rec.start();
      escutando = true;
      $("botao-mic").classList.add("ouvindo");
    } catch {}
  }
  function pararEscuta() {
    if (rec && escutando) rec.abort();
  }

  $("botao-mic").addEventListener("click", () => {
    micAtivo = !micAtivo;
    $("botao-mic").setAttribute("aria-pressed", String(micAtivo));
    if (micAtivo) {
      avatar.parar(); // permite interromper a Ana para falar
      iniciarEscuta();
    } else {
      pararEscuta();
    }
  });

  // ---------- Sessão e dados (LGPD) ----------
  $("botao-nova-sessao").addEventListener("click", async () => {
    avatar.parar();
    pararEscuta();
    await fetch(`/api/clientes/${clienteId}/sessao`, { method: "POST" });
    $("historico").innerHTML = "";
    $("alerta-risco").hidden = true;
    adicionarBalao("sistema", "Sessão encerrada. Obrigada por conversar comigo. Quando quiser, é só voltar.");
    mostrarAtendimento(true);
  });

  $("botao-meus-dados").addEventListener("click", async () => {
    const dados = await fetch(`/api/clientes/${clienteId}/dados`).then((r) => r.json());
    $("conteudo-dados").textContent = JSON.stringify(dados, null, 2);
    $("dialogo-dados").showModal();
  });

  $("botao-excluir").addEventListener("click", async () => {
    if (!confirm("Apagar definitivamente todos os seus dados e o histórico com a Ana?")) return;
    avatar.parar();
    pararEscuta();
    await fetch(`/api/clientes/${clienteId}`, { method: "DELETE" });
    gravarId(null);
    location.reload();
  });

  iniciar();
})();
