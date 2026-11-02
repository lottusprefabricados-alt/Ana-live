// Avatar em vídeo realista.
//
// Provedor padrão ("VideoLoopAvatar"): usa dois vídeos de uma pessoa real gravada
// (parada.mp4 = escutando, piscando, respirando; falando.mp4 = falando em loop) e
// alterna entre eles enquanto a voz sintetizada do navegador fala o texto.
//
// Para usar um serviço de avatar em tempo real com sincronia labial (HeyGen,
// D-ID, Synthesia etc.), crie outro objeto com a mesma interface
// { iniciar(), falar(texto) -> Promise, parar(), get falando } e atribua a
// window.AnaAvatar antes de app.js ser carregado.
(function () {
  const el = document.getElementById("avatar");
  const vParada = document.getElementById("video-parada");
  const vFalando = document.getElementById("video-falando");

  let temVideo = false;
  vParada.addEventListener("loadeddata", () => {
    temVideo = true;
    el.classList.add("com-video");
  });
  vParada.addEventListener("error", () => el.classList.remove("com-video"));

  function escolherVoz() {
    const vozes = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("pt"));
    // Prefere vozes femininas/naturais em pt-BR quando disponíveis.
    const preferidas = ["Francisca", "Luciana", "Maria", "Google português do Brasil", "Natural"];
    for (const nome of preferidas) {
      const v = vozes.find((voz) => voz.name.includes(nome) && voz.lang.toLowerCase() === "pt-br");
      if (v) return v;
    }
    return vozes.find((v) => v.lang.toLowerCase() === "pt-br") || vozes[0] || null;
  }
  let voz = null;
  if ("speechSynthesis" in window) {
    voz = escolherVoz();
    speechSynthesis.onvoiceschanged = () => (voz = escolherVoz());
  }

  let falas = 0;
  function setEstado(falando) {
    el.dataset.estado = falando ? "falando" : "parada";
    if (!temVideo) return;
    if (falando) {
      vFalando.play().catch(() => {});
    } else {
      vFalando.pause();
    }
  }

  window.AnaAvatar = window.AnaAvatar || {
    vozAtiva: true,
    get falando() {
      return falas > 0;
    },
    iniciar() {
      // Precisa ser chamado após um clique (política de autoplay dos navegadores).
      vParada.play().catch(() => {});
      vFalando.play().then(() => vFalando.pause()).catch(() => {});
    },
    falar(texto) {
      return new Promise((resolve) => {
        if (!this.vozAtiva || !("speechSynthesis" in window) || !texto.trim()) {
          resolve();
          return;
        }
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = "pt-BR";
        if (voz) u.voice = voz;
        u.rate = 0.98;
        u.pitch = 1.0;
        u.onstart = () => {
          falas++;
          setEstado(true);
        };
        const fim = () => {
          falas = Math.max(0, falas - 1);
          if (falas === 0 && !speechSynthesis.speaking) setEstado(false);
          resolve();
        };
        u.onend = fim;
        u.onerror = fim;
        speechSynthesis.speak(u);
      });
    },
    parar() {
      if ("speechSynthesis" in window) speechSynthesis.cancel();
      falas = 0;
      setEstado(false);
    },
  };
})();
