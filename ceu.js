/* ————————————————————————————————————————————————————————————
   Céu agora: aviões em volta do local e satélites acima do horizonte.

   Aviões — posição ADS-B que o próprio avião transmite, recebida por
   voluntários e publicada de graça (adsb.lol; se falhar, airplanes.live
   e OpenSky). Onde ninguém tem antena por perto, o avião não aparece.

   Satélites — as órbitas (TLE) vêm da CelesTrak e a posição é calculada
   no aparelho com a satellite.js (vendor/), sem rede a cada segundo.
   Mostra as estações espaciais e os ~150 satélites mais brilhantes.
   ———————————————————————————————————————————————————————————— */
'use strict';

const Ceu = (() => {
  const NM = 1.852;                         // km por milha náutica
  const PES = 0.3048;                       // m por pé
  const INTERVALO_AVIOES = 15000;
  const INTERVALO_SATELITES = 5000;
  const CHAVE_TLE = 'alerta-chuva:tle';
  const VALIDADE_TLE = 6 * 3600 * 1000;     // a CelesTrak atualiza a cada ~2 h; pedimos bem menos
  const GRUPOS_TLE = ['stations', 'visual'];
  // Lixo espacial: os detritos dos grandes eventos que a CelesTrak acompanha em separado.
  const CHAVE_LIXO = 'alerta-chuva:tle-lixo';
  const CHAVE_LIXO_LIGADO = 'alerta-chuva:lixo-ligado';
  const ORIGEM_LIXO = {
    'fengyun-1c-debris': 'Fengyun‑1C · teste antissatélite chinês, 2007',
    'cosmos-2251-debris': 'Cosmos 2251 · colisão com o Iridium 33, 2009',
    'iridium-33-debris': 'Iridium 33 · colisão com o Cosmos 2251, 2009',
    'cosmos-1408-debris': 'Cosmos 1408 · teste antissatélite russo, 2021'
  };
  const DESTAQUE = /ISS \(ZARYA\)|CSS \(TIANHE\)|HST/;   // ISS, Tiangong, Hubble

  const SVG = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);

  let el = null;
  let local = null;
  let aba = 'avioes';
  let raio = 150;                           // km do radar de aviões
  let visivel = false;                      // a seção está na tela
  let relogioAvioes = null;
  let relogioSatelites = null;
  let satelites = null;                     // [{ nome, satrec }]
  let lixo = null;                          // [{ nome, satrec, origem }]
  let lixoLigado = false;
  let geracao = 0;

  function iniciar() {
    el = {
      secao: $('ceu'),
      abas: document.querySelectorAll('[data-ceu-aba]'),
      raios: document.querySelectorAll('[data-ceu-raio]'),
      painelAvioes: $('ceu-avioes'),
      painelSatelites: $('ceu-satelites'),
      radar: $('radar'),
      listaAvioes: $('lista-avioes'),
      estadoAvioes: $('estado-avioes'),
      cupula: $('cupula'),
      listaSatelites: $('lista-satelites'),
      estadoSatelites: $('estado-satelites'),
      botaoLixo: $('ceu-lixo'),
      listaLixo: $('lista-lixo'),
      estadoLixo: $('estado-lixo')
    };
    try { lixoLigado = localStorage.getItem(CHAVE_LIXO_LIGADO) === '1'; } catch (e) { /* modo privado */ }
    el.botaoLixo.addEventListener('click', () => {
      lixoLigado = !lixoLigado;
      try { localStorage.setItem(CHAVE_LIXO_LIGADO, lixoLigado ? '1' : '0'); } catch (e) { /* modo privado */ }
      marcarLixo();
      mostrarSatelites();
    });
    marcarLixo();
    for (const b of el.abas) b.addEventListener('click', () => { aba = b.dataset.ceuAba; atualizarTela(); });
    for (const b of el.raios) b.addEventListener('click', () => { raio = Number(b.dataset.ceuRaio); atualizarTela(true); });

    // Só consulta enquanto a seção está na tela e o app aberto: poupa bateria e as APIs gratuitas.
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entradas => {
        visivel = entradas.some(e => e.isIntersecting);
        ligarRelogios();
      }).observe(el.secao);
    } else {
      visivel = true;
    }
    document.addEventListener('visibilitychange', ligarRelogios);
    atualizarTela();
  }

  function definirLocal(novo) {
    local = novo;
    atualizarTela(true);
  }

  function atualizarTela(recarregar = false) {
    if (!el) return;
    for (const b of el.abas) b.setAttribute('aria-pressed', String(b.dataset.ceuAba === aba));
    for (const b of el.raios) b.setAttribute('aria-pressed', String(Number(b.dataset.ceuRaio) === raio));
    el.painelAvioes.hidden = aba !== 'avioes';
    el.painelSatelites.hidden = aba !== 'satelites';
    if (recarregar) geracao++;
    ligarRelogios();
  }

  function ligarRelogios() {
    clearInterval(relogioAvioes);
    clearInterval(relogioSatelites);
    relogioAvioes = relogioSatelites = null;
    const ativo = visivel && document.visibilityState === 'visible' && local;
    if (!ativo) return;
    if (aba === 'avioes') {
      buscarAvioes();
      relogioAvioes = setInterval(buscarAvioes, INTERVALO_AVIOES);
    } else {
      mostrarSatelites();
      relogioSatelites = setInterval(mostrarSatelites, INTERVALO_SATELITES);
    }
  }

  /* ————————————————— geometria ————————————————— */

  const rad = g => g * Math.PI / 180;

  /** Distância (km) e rumo (graus, 0 = norte) do local até o ponto. */
  function distanciaRumo(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    const d = 2 * R * Math.asin(Math.sqrt(a));
    const y = Math.sin(dLon) * Math.cos(rad(lat2));
    const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) - Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLon);
    return { d, rumo: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360 };
  }

  const PONTOS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
  const pontoCardeal = g => PONTOS[Math.round(g / 45) % 8];

  function no(tag, attrs = {}, texto) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (texto != null) n.textContent = texto;
    return n;
  }

  /** Fundo comum: anéis, cruz e pontos cardeais. `rotulos` = texto de cada anel. */
  function fundo(svg, rotulos) {
    svg.textContent = '';
    svg.setAttribute('viewBox', '-110 -110 220 220');
    const g = no('g', { class: 'ceu-fundo' });
    rotulos.forEach((r, i) => {
      const raioAnel = 100 * (i + 1) / rotulos.length;
      g.append(no('circle', { r: raioAnel }));
      if (r) g.append(no('text', { x: 2, y: -raioAnel + 8, class: 'ceu-anel' }, r));
    });
    g.append(no('line', { x1: -100, y1: 0, x2: 100, y2: 0 }), no('line', { x1: 0, y1: -100, x2: 0, y2: 100 }));
    [['N', 0, -103], ['L', 104, 3], ['S', 0, 109], ['O', -104, 3]].forEach(([t, x, y]) =>
      g.append(no('text', { x, y, class: 'ceu-cardeal', 'text-anchor': 'middle' }, t)));
    svg.append(g);
  }

  /* ————————————————— aviões ————————————————— */

  /** Cada fonte devolve no mesmo formato: { id, voo, lat, lon, altM, kmh, rumo, tipo, chao }. */
  const FONTES = [
    {
      nome: 'adsb.lol',
      url: (lat, lon, nm) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${nm}`,
      ler: d => (d.ac || []).map(lerAdsbx)
    },
    {
      nome: 'airplanes.live',
      url: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`,
      ler: d => (d.ac || []).map(lerAdsbx)
    },
    {
      nome: 'OpenSky',
      url: (lat, lon, nm) => {
        const dLat = nm * NM / 111.32;
        const dLon = dLat / Math.max(0.1, Math.cos(rad(lat)));
        return `https://opensky-network.org/api/states/all?lamin=${(lat - dLat).toFixed(3)}&lomin=${(lon - dLon).toFixed(3)}` +
               `&lamax=${(lat + dLat).toFixed(3)}&lomax=${(lon + dLon).toFixed(3)}`;
      },
      ler: d => (d.states || []).map(s => ({
        id: s[0], voo: (s[1] || '').trim(), lat: s[6], lon: s[5],
        altM: s[7], kmh: s[9] != null ? s[9] * 3.6 : null, rumo: s[10], tipo: '', chao: s[8]
      }))
    }
  ];

  function lerAdsbx(a) {
    const chao = a.alt_baro === 'ground';
    return {
      id: a.hex, voo: (a.flight || a.r || '').trim(), lat: a.lat, lon: a.lon,
      altM: chao ? 0 : typeof a.alt_baro === 'number' ? a.alt_baro * PES : (a.alt_geom != null ? a.alt_geom * PES : null),
      kmh: a.gs != null ? a.gs * NM : null, rumo: a.track ?? a.true_heading ?? null, tipo: a.t || '', chao
    };
  }

  async function buscarAvioes() {
    if (!local) return;
    const gen = geracao;
    const nm = Math.ceil(raio / NM);
    for (const f of FONTES) {
      try {
        const ctrl = new AbortController();
        const prazo = setTimeout(() => ctrl.abort(), 8000);
        const resp = await fetch(f.url(local.lat.toFixed(4), local.lon.toFixed(4), nm), { signal: ctrl.signal });
        clearTimeout(prazo);
        if (!resp.ok) throw new Error(resp.status);
        const lista = f.ler(await resp.json()).filter(a => a.lat != null && a.lon != null);
        if (gen !== geracao) return;
        desenharAvioes(lista, f.nome);
        return;
      } catch (e) { /* tenta a próxima fonte */ }
    }
    if (gen !== geracao) return;
    el.estadoAvioes.textContent = navigator.onLine === false
      ? 'Sem internet.'
      : 'Os serviços de rastreio de aviões não responderam. Tentando de novo em 15 s.';
  }

  function desenharAvioes(lista, fonte) {
    const avioes = lista
      .map(a => Object.assign(a, distanciaRumo(local.lat, local.lon, a.lat, a.lon)))
      .filter(a => a.d <= raio)
      .sort((a, b) => a.d - b.d);

    fundo(el.radar, [`${Math.round(raio / 3)} km`, `${Math.round(raio * 2 / 3)} km`, `${raio} km`]);
    el.radar.append(no('circle', { r: 2.5, class: 'ceu-eu' }));

    for (const a of avioes) {
      const r = 100 * a.d / raio;
      const x = r * Math.sin(rad(a.rumo));
      const y = -r * Math.cos(rad(a.rumo));
      const g = no('g', { class: 'aviao' + (a.chao ? ' no-chao' : ''), transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})` });
      g.append(no('path', { d: 'M0 -6 L4 5 L0 2.5 L-4 5 Z', transform: `rotate(${Math.round(a.rumo ?? 0)})` }));
      if (a.voo) g.append(no('text', { x: 6, y: -4, class: 'ceu-rotulo' }, a.voo));
      el.radar.append(g);
    }

    el.listaAvioes.textContent = '';
    for (const a of avioes.slice(0, 15)) {
      const li = document.createElement('li');
      const nome = document.createElement('b');
      nome.textContent = a.voo || a.id.toUpperCase();
      const info = document.createElement('span');
      info.textContent = [
        a.tipo,
        a.chao ? 'no chão' : a.altM != null ? `${Math.round(a.altM / 100) * 100} m` : '',
        a.kmh != null ? `${Math.round(a.kmh)} km/h` : '',
        `${Math.round(a.d)} km ao ${pontoCardeal(a.rumo)}`
      ].filter(Boolean).join(' · ');
      li.append(nome, info);
      el.listaAvioes.append(li);
    }

    const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    el.estadoAvioes.textContent = avioes.length
      ? `${avioes.length} avião(ões) a até ${raio} km · ${hora} · ${fonte}`
      : `Nenhum avião captado a até ${raio} km agora (${hora}). Onde não há antena de voluntário por perto, o avião não aparece.`;
  }

  /* ————————————————— satélites ————————————————— */

  function lerTle(texto) {
    const linhas = texto.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
    const lista = [];
    for (let i = 0; i + 2 < linhas.length; i += 3) {
      const [nome, l1, l2] = linhas.slice(i, i + 3);
      if (!l1 || !l2 || l1[0] !== '1' || l2[0] !== '2') continue;
      lista.push({ nome: nome.trim(), l1, l2 });
    }
    return lista;
  }

  /**
   * Baixa os grupos da CelesTrak (guardados por 6 h em `chave`). Cada item leva
   * o grupo de onde veio. Com `parcial`, um grupo que falhe não derruba os outros.
   */
  async function carregarTle(chave = CHAVE_TLE, grupos = GRUPOS_TLE, parcial = false) {
    let guardado = null;
    try { guardado = JSON.parse(localStorage.getItem(chave) || 'null'); } catch (e) { /* modo privado */ }
    if (guardado && Date.now() - guardado.em < VALIDADE_TLE) return guardado.lista;

    try {
      const baixar = g => fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`).then(r => {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      }).then(texto => lerTle(texto).map(s => Object.assign(s, { grupo: g })));
      const partes = parcial
        ? (await Promise.allSettled(grupos.map(baixar))).filter(r => r.status === 'fulfilled').map(r => r.value)
        : await Promise.all(grupos.map(baixar));
      const vistos = new Set();
      const lista = partes.flat().filter(s => {
        const id = s.l1.slice(2, 7);
        if (vistos.has(id)) return false;
        vistos.add(id);
        return true;
      });
      if (!lista.length) throw new Error('vazio');
      try { localStorage.setItem(chave, JSON.stringify({ em: Date.now(), lista })); } catch (e) { /* cheio */ }
      return lista;
    } catch (e) {
      if (guardado) return guardado.lista;   // velho, mas serve por alguns dias
      throw e;
    }
  }

  async function prepararSatelites() {
    if (satelites) return satelites;
    if (!window.satellite) throw new Error('satellite.js ausente');
    const lista = await carregarTle();
    satelites = lista.map(s => {
      try { return { nome: s.nome, satrec: satellite.twoline2satrec(s.l1, s.l2) }; } catch (e) { return null; }
    }).filter(Boolean);
    return satelites;
  }

  async function prepararLixo() {
    if (lixo) return lixo;
    const lista = await carregarTle(CHAVE_LIXO, Object.keys(ORIGEM_LIXO), true);
    lixo = lista.map(s => {
      try { return { nome: s.nome, origem: ORIGEM_LIXO[s.grupo] || '', satrec: satellite.twoline2satrec(s.l1, s.l2) }; }
      catch (e) { return null; }
    }).filter(Boolean);
    return lixo;
  }

  function marcarLixo() {
    el.botaoLixo.setAttribute('aria-pressed', String(lixoLigado));
    el.listaLixo.hidden = el.estadoLixo.hidden = !lixoLigado;
  }

  /** Azimute e elevação (graus) e altitude (km) de um satélite visto do local. */
  function olhar(sat, data, observador, gmst) {
    const pv = satellite.propagate(sat.satrec, data);
    if (!pv || !pv.position) return null;
    const ecf = satellite.eciToEcf(pv.position, gmst);
    const ang = satellite.ecfToLookAngles(observador, ecf);
    const geo = satellite.eciToGeodetic(pv.position, gmst);
    return { az: ang.azimuth * 180 / Math.PI, el: ang.elevation * 180 / Math.PI, altKm: geo.height };
  }

  /** Céu como cúpula: centro = bem em cima (zênite), borda = horizonte. */
  function posicaoCupula(az, elev) {
    const r = 100 * (90 - elev) / 90;
    return [r * Math.sin(rad(az)), -r * Math.cos(rad(az))];
  }

  async function mostrarSatelites() {
    if (!local) return;
    try {
      el.estadoSatelites.textContent = satelites ? el.estadoSatelites.textContent : 'Carregando as órbitas…';
      await prepararSatelites();
    } catch (e) {
      el.estadoSatelites.textContent = 'Não deu para baixar as órbitas dos satélites (CelesTrak). Confira a internet.';
      return;
    }

    const agora = new Date();
    const gmst = satellite.gstime(agora);
    const observador = { latitude: rad(local.lat), longitude: rad(local.lon), height: 0.5 };
    const acima = [];
    for (const s of satelites) {
      const p = olhar(s, agora, observador, gmst);
      if (p && p.el > 0) acima.push(Object.assign({ sat: s, nome: s.nome }, p));
    }
    acima.sort((a, b) => b.el - a.el);

    fundo(el.cupula, ['60°', '30°', 'horizonte']);
    if (lixoLigado) await desenharLixo(agora, observador, gmst);   // por baixo dos satélites
    for (const p of acima) {
      const destaque = DESTAQUE.test(p.nome);
      // Rastro dos próximos 5 minutos, para ver para onde vai.
      const pontos = [];
      for (let m = 0; m <= 5; m++) {
        const t = new Date(agora.getTime() + m * 60000);
        const q = olhar(p.sat, t, observador, satellite.gstime(t));
        if (q && q.el > -2) pontos.push(posicaoCupula(q.az, Math.max(0, q.el)).map(v => v.toFixed(1)).join(','));
      }
      if (pontos.length > 1) el.cupula.append(no('polyline', { points: pontos.join(' '), class: 'sat-rastro' + (destaque ? ' destaque' : '') }));
      const [x, y] = posicaoCupula(p.az, p.el);
      el.cupula.append(no('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: destaque ? 3.4 : 1.8, class: 'sat' + (destaque ? ' destaque' : '') }));
      if (destaque || p.el > 45) {
        el.cupula.append(no('text', { x: (x + 4).toFixed(1), y: (y - 3).toFixed(1), class: 'ceu-rotulo' + (destaque ? ' destaque' : '') }, nomeCurto(p.nome)));
      }
    }

    el.listaSatelites.textContent = '';
    for (const p of acima.slice(0, 15)) {
      const li = document.createElement('li');
      if (DESTAQUE.test(p.nome)) li.className = 'destaque';
      const nome = document.createElement('b');
      nome.textContent = nomeCurto(p.nome);
      const info = document.createElement('span');
      info.textContent = `${Math.round(p.el)}° de altura ao ${pontoCardeal(p.az)} · ${Math.round(p.altKm)} km do chão`;
      li.append(nome, info);
      el.listaSatelites.append(li);
    }
    el.estadoSatelites.textContent = `${acima.length} satélite(s) acima do horizonte agora, de ${satelites.length} acompanhados.`;
  }

  /** Lixo espacial: pontos cinza, sem rastro (são milhares), e a lista dos mais altos. */
  async function desenharLixo(agora, observador, gmst) {
    try {
      el.estadoLixo.textContent = lixo ? el.estadoLixo.textContent : 'Carregando o lixo espacial…';
      await prepararLixo();
    } catch (e) {
      el.estadoLixo.textContent = 'Não deu para baixar a lista de lixo espacial (CelesTrak).';
      el.listaLixo.textContent = '';
      return;
    }
    const acima = [];
    for (const s of lixo) {
      const p = olhar(s, agora, observador, gmst);
      if (p && p.el > 0) acima.push(Object.assign({ nome: s.nome, origem: s.origem }, p));
    }
    acima.sort((a, b) => b.el - a.el);
    for (const p of acima) {
      const [x, y] = posicaoCupula(p.az, p.el);
      el.cupula.append(no('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 1.1, class: 'lixo' }));
    }
    el.listaLixo.textContent = '';
    for (const p of acima.slice(0, 8)) {
      const li = document.createElement('li');
      li.className = 'lixo';
      const nome = document.createElement('b');
      nome.textContent = p.nome.replace(/\s+DEB$/, '') + ' — detrito';
      const info = document.createElement('span');
      info.textContent = `${p.origem} · ${Math.round(p.el)}° de altura ao ${pontoCardeal(p.az)} · ${Math.round(p.altKm)} km`;
      li.append(nome, info);
      el.listaLixo.append(li);
    }
    el.estadoLixo.textContent = `🗑 ${acima.length} pedaço(s) de lixo espacial acima do horizonte agora, de ${lixo.length} acompanhados (pontos cinza).`;
  }

  function nomeCurto(n) {
    if (/ISS \(ZARYA\)/.test(n)) return 'ISS (Estação Espacial)';
    if (/CSS \(TIANHE\)/.test(n)) return 'Tiangong (estação chinesa)';
    if (/^HST$/.test(n)) return 'Hubble';
    return n.replace(/\s+DEB$/, ' (detrito)');
  }

  return { iniciar, definirLocal };
})();
