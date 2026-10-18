/* ————————————————————————————————————————————————————————————
   Quadro de nuvens: imagem do satélite GOES-16 (GOES-East) em volta
   do local, pelo serviço WMS do NASA GIBS — gratuito, sem chave,
   imagem nova a cada 10 minutos para todo o Brasil.

   Infravermelho: nuvem de topo frio (alta e grossa, a que dá chuva
   forte) aparece colorida; funciona de dia e de noite.
   Visível: a foto "de verdade" das nuvens, só com sol.

   A imagem do satélite tem 1 a 2 km por ponto, então numa área de
   20 km ela fica granulada — por isso o quadro marca o círculo de
   20 km e deixa abrir a vista para ver a formação chegando.
   ———————————————————————————————————————————————————————————— */
'use strict';

const Nuvens = (() => {
  const WMS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
  const CAMADAS = {
    infra: 'GOES-East_ABI_Band13_Clean_Infrared',
    visivel: 'GOES-East_ABI_Band2_Red_Visible_1km'
  };
  const REFERENCIA = 'Reference_Features_15m';   // estradas e divisas, numa imagem por cima
  const PASSO = 10 * 60 * 1000;                  // o satélite manda uma imagem a cada 10 min
  const ATRASO = 20 * 60 * 1000;                 // folga mínima até a imagem chegar ao GIBS
  // Quanto recuar (em passos de 10 min) procurando uma imagem que já tenha chegado:
  // de 20 min até 3 h atrás, mais denso no começo.
  const RECUOS = [0, 1, 2, 3, 4, 5, 7, 9, 12, 16];
  const QUADROS = 6;                             // animação: a última hora
  const LADO = 512;

  const $ = id => document.getElementById(id);
  let el = null;
  let local = null;
  let largura = 60;           // km de lado da imagem
  let camada = 'infra';
  let quadros = [];           // [{ t, img }]
  let atual = 0;
  let animacao = null;
  let geracao = 0;            // descarta imagens de um pedido antigo

  function iniciar() {
    el = {
      caixa: $('nuvens'),
      imagem: $('nuvens-img'),
      referencia: $('nuvens-ref'),
      circulo: $('nuvens-circulo'),
      hora: $('nuvens-hora'),
      aviso: $('nuvens-aviso'),
      tocar: $('nuvens-tocar'),
      larguras: document.querySelectorAll('[data-nuvens-largura]'),
      camadas: document.querySelectorAll('[data-nuvens-camada]')
    };
    for (const b of el.larguras) {
      b.addEventListener('click', () => { largura = Number(b.dataset.nuvensLargura); carregar(); });
    }
    for (const b of el.camadas) {
      b.addEventListener('click', () => { camada = b.dataset.nuvensCamada; carregar(); });
    }
    el.tocar.addEventListener('click', () => animacao ? parar() : tocar());
  }

  /** Caixa em graus em volta do ponto, com `km` de lado. */
  function caixa(lat, lon, km) {
    const dLat = km / 2 / 111.32;
    const dLon = dLat / Math.max(0.1, Math.cos(lat * Math.PI / 180));
    return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];   // ordem do WMS 1.3.0 em EPSG:4326
  }

  /**
   * Endereço WMS. Com TRANSPARENT o GIBS devolve "sem dados" como pixel
   * transparente — é assim que dá para perceber uma imagem que ainda não chegou
   * (ele não responde erro: manda a imagem vazia).
   */
  function endereco(camadaWms, t) {
    const p = new URLSearchParams({
      SERVICE: 'WMS',
      REQUEST: 'GetMap',
      VERSION: '1.3.0',
      LAYERS: camadaWms,
      CRS: 'EPSG:4326',
      BBOX: caixa(local.lat, local.lon, largura).map(v => v.toFixed(4)).join(','),
      WIDTH: String(LADO),
      HEIGHT: String(LADO),
      FORMAT: 'image/png',
      TRANSPARENT: 'TRUE'
    });
    if (t) p.set('TIME', new Date(t).toISOString().slice(0, 19) + 'Z');
    return WMS + '?' + p;
  }

  function carregarImagem(url) {
    return new Promise((ok, falha) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';   // o GIBS libera CORS; sem isso não dá para olhar os pixels
      img.decoding = 'async';
      img.onload = () => ok(img);
      img.onerror = falha;
      img.src = url;
    });
  }

  /** Vazia = quase tudo transparente ou preto (sem dados naquele horário). */
  function vazia(img) {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 48;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0, 48, 48);
      const px = g.getImageData(0, 0, 48, 48).data;
      let cheios = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] > 20 && px[i] + px[i + 1] + px[i + 2] > 24) cheios++;
      }
      return cheios < (48 * 48) * 0.05;
    } catch (e) {
      return false;   // não deu para olhar: confia na imagem
    }
  }

  async function imagemCom(t) {
    const img = await carregarImagem(endereco(CAMADAS[camada], t));
    if (vazia(img)) throw new Error('vazia');
    return img;
  }

  /** Acha a imagem mais nova que já chegou, recuando até 3 h. */
  async function maisRecente(gen) {
    const base = Math.floor((Date.now() - ATRASO) / PASSO) * PASSO;
    for (const r of RECUOS) {
      if (gen !== geracao) return null;
      const t = base - r * PASSO;
      try {
        const img = await imagemCom(t);
        return gen === geracao ? { t, img } : null;
      } catch (e) { /* ainda não chegou ou veio vazia: tenta mais cedo */ }
    }
    throw new Error('sem imagem');
  }

  async function carregar() {
    if (!local || !el) return;
    const gen = ++geracao;
    parar();
    marcarBotoes();
    desenharCirculo();
    el.caixa.dataset.estado = 'carregando';
    el.aviso.textContent = 'Buscando a imagem do satélite…';
    el.referencia.src = endereco(REFERENCIA);   // estradas e divisas não mudam com a hora
    try {
      const ultimo = await maisRecente(gen);
      if (!ultimo) return;
      quadros = [ultimo];
      atual = 0;
      mostrar();
      el.caixa.dataset.estado = 'pronto';
      el.aviso.textContent = camada === 'visivel' && escuroNoLocal(ultimo.t)
        ? 'É noite no local: a imagem visível fica preta. Use Infravermelho.'
        : '';
      // A hora anterior, para a animação, vem por trás.
      for (let i = 1; i < QUADROS; i++) {
        const t = ultimo.t - i * PASSO;
        imagemCom(t).then(img => {
          if (gen !== geracao) return;
          quadros.push({ t, img });
          quadros.sort((a, b) => a.t - b.t);
          if (!animacao) { atual = quadros.length - 1; mostrar(); }
          el.tocar.disabled = quadros.length < 2;
        }).catch(() => {});
      }
    } catch (e) {
      if (gen !== geracao) return;
      el.caixa.dataset.estado = 'erro';
      el.aviso.textContent = navigator.onLine === false
        ? 'Sem internet: a imagem do satélite precisa de rede.'
        : camada === 'visivel' && escuroNoLocal(Date.now())
          ? 'É noite no local: a imagem visível não existe agora. Use Infravermelho.'
          : 'O satélite não mandou imagem desta área nas últimas 3 horas. Tente de novo mais tarde.';
    }
  }

  /** Noite aproximada pela posição do sol (bom o bastante para avisar). */
  function escuroNoLocal(t) {
    const d = new Date(t);
    const horaSolar = (d.getUTCHours() + d.getUTCMinutes() / 60 + local.lon / 15 + 24) % 24;
    return horaSolar < 6.3 || horaSolar > 17.7;
  }

  function mostrar() {
    const q = quadros[atual];
    if (!q) return;
    // Troca o nó pela imagem já baixada, em vez de copiar o src (que baixaria de novo).
    if (el.imagem !== q.img) {
      q.img.id = 'nuvens-img';
      q.img.alt = el.imagem.alt;
      el.imagem.replaceWith(q.img);
      el.imagem = q.img;
    }
    const min = Math.round((Date.now() - q.t) / 60000);
    el.hora.textContent = new Date(q.t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) +
      ` · há ${min} min`;
  }

  function tocar() {
    if (quadros.length < 2) return;
    el.tocar.textContent = '❚❚ Parar';
    atual = 0;
    mostrar();
    animacao = setInterval(() => {
      atual = (atual + 1) % quadros.length;
      mostrar();
    }, 700);
  }

  function parar() {
    clearInterval(animacao);
    animacao = null;
    if (el) {
      el.tocar.textContent = '▶ Última hora';
      atual = quadros.length - 1;
      mostrar();
    }
  }

  /** O círculo marca 20 km de diâmetro, em qualquer abertura da vista. */
  function desenharCirculo() {
    const fracao = Math.min(1, 20 / largura);
    el.circulo.style.width = el.circulo.style.height = (fracao * 100) + '%';
    el.circulo.hidden = fracao >= 1;
  }

  function marcarBotoes() {
    for (const b of el.larguras) b.setAttribute('aria-pressed', String(Number(b.dataset.nuvensLargura) === largura));
    for (const b of el.camadas) b.setAttribute('aria-pressed', String(b.dataset.nuvensCamada === camada));
  }

  function definirLocal(novo) {
    local = novo;
    quadros = [];
    el.tocar.disabled = true;
    if (local) carregar();
  }

  return { iniciar, definirLocal, carregar };
})();
