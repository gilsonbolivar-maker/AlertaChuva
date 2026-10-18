/* ————————————————————————————————————————————————————————————
   Alerta de Chuva — escolhe o local, consulta a previsão de tempos
   em tempos e avisa (som, vibração, notificação) quando a chuva vem.
   ———————————————————————————————————————————————————————————— */
'use strict';

const VERSAO = '1.4.0';   // precisa casar com a VERSAO do sw.js

// Versão sempre à vista: cada [data-versao] da página mostra a deste app.
for (const lugar of document.querySelectorAll('[data-versao]')) lugar.textContent = 'v' + VERSAO;

// Tema Escuro / Claro: o <head> já aplicou o salvo; aqui fica a troca pelos Ajustes.
(() => {
  const CHAVE_TEMA = 'alerta-chuva:tema';
  const COR_BARRA = { escuro: '#0b1220', claro: '#f3f5f9' };
  const botoes = document.querySelectorAll('[data-tema-opcao]');

  function aplicarTema(tema) {
    if (tema !== 'claro') tema = 'escuro';
    document.documentElement.dataset.tema = tema;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COR_BARRA[tema]);
    for (const b of botoes) b.setAttribute('aria-pressed', String(b.dataset.temaOpcao === tema));
  }

  aplicarTema(document.documentElement.dataset.tema);
  for (const b of botoes) {
    b.addEventListener('click', () => {
      aplicarTema(b.dataset.temaOpcao);
      try { localStorage.setItem(CHAVE_TEMA, b.dataset.temaOpcao); } catch (e) { /* modo privado */ }
    });
  }
})();

(() => {

const CHAVE_LOCAL = 'alerta-chuva:local';
const CHAVE_CONFIG = 'alerta-chuva:config';
const INTERVALO = 10 * 60 * 1000;   // entre consultas, com o app aberto
const ETIQUETA_SYNC = 'chuva';

const $ = id => document.getElementById(id);

const el = {
  estado: $('estado'),
  localNome: $('local-nome'),
  gps: $('btn-gps'),
  mostrarBusca: $('btn-mostrar-busca'),
  buscaCaixa: $('busca-caixa'),
  busca: $('busca'),
  buscar: $('btn-buscar'),
  resultados: $('resultados'),
  painel: $('painel'),
  pIcone: $('painel-icone'),
  pTitulo: $('painel-titulo'),
  pTexto: $('painel-texto'),
  dAgora: $('d-agora'),
  dChance: $('d-chance'),
  dIdade: $('d-idade'),
  horas: $('horas'),
  tTemp: $('t-temp'), tTempNota: $('t-temp-nota'),
  tUmidade: $('t-umidade'), tUmidadeNota: $('t-umidade-nota'),
  tUv: $('t-uv'), tUvNota: $('t-uv-nota'),
  tVento: $('t-vento'), tVentoNota: $('t-vento-nota'),
  tSol: $('t-sol'), tSolNota: $('t-sol-nota'),
  tLua: $('t-lua'), tLuaNota: $('t-lua-nota'),
  cGranizo: $('c-granizo'), tGranizo: $('t-granizo'), tGranizoNota: $('t-granizo-nota'),
  vigiar: $('btn-vigiar'),
  atualizar: $('btn-atualizar'),
  janela: $('janela'),
  janelaValor: $('janela-valor'),
  chance: $('chance'),
  chanceValor: $('chance-valor'),
  optSom: $('opt-som'),
  optVibrar: $('opt-vibrar'),
  optTela: $('opt-tela'),
  testar: $('btn-testar'),
  instalar: $('btn-instalar'),
  alerta: $('alerta'),
  aTexto: $('alerta-texto'),
  ok: $('btn-ok'),
  toast: $('toast')
};

/* ————————————————— armazenamento ————————————————— */

function ler(chave, padrao) {
  try {
    const bruto = localStorage.getItem(chave);
    return bruto ? JSON.parse(bruto) : padrao;
  } catch (e) {
    return padrao;
  }
}

function gravar(chave, valor) {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
}

let local = ler(CHAVE_LOCAL, null);   // { nome, lat, lon }
let config = Object.assign(
  { janela: 2, chance: 60, som: true, vibrar: true, tela: false, vigiando: false },
  ler(CHAVE_CONFIG, {})
);

/** Grava no aparelho e repassa ao service worker o que ele precisa. */
function salvar() {
  gravar(CHAVE_LOCAL, local);
  gravar(CHAVE_CONFIG, config);
  Previsao.gravarEstado({ local, janela: config.janela, chance: config.chance, vigiando: config.vigiando });
}

/* ————————————————— estado da tela ————————————————— */

let ultima = null;           // { r: avaliação, tempo: resumo, em: Date.now() }
let relogio = null;
let consulta = null;
let travaTela = null;
let promessaInstalar = null;

let toastTimer = null;
function avisar(texto, ms = 3200) {
  el.toast.textContent = texto;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

function definirEstado(texto, classe = '') {
  el.estado.textContent = texto;
  el.estado.className = 'estado ' + classe;
}

function mostrarEstado() {
  if (!config.vigiando) definirEstado('Desligado');
  else if (!local) definirEstado('Sem local', 'erro');
  else definirEstado('Vigiando a cada 10 min', 'ativo');
  el.vigiar.textContent = config.vigiando ? 'Desligar alerta' : 'Ligar alerta';
  el.vigiar.className = 'botao largo ' + (config.vigiando ? 'perigo' : 'principal');
}

function mostrarAjustes() {
  el.janela.value = config.janela;
  el.janelaValor.textContent = config.janela + ' h';
  el.chance.value = config.chance;
  el.chanceValor.textContent = config.chance + '%';
  el.optSom.checked = config.som;
  el.optVibrar.checked = config.vibrar;
  el.optTela.checked = config.tela;
  if (!navigator.vibrate) el.optVibrar.closest('.opcao').hidden = true;
  if (!('wakeLock' in navigator)) el.optTela.closest('.opcao').hidden = true;
}

function mostrarLocal() {
  el.localNome.textContent = local ? local.nome : 'Nenhum local escolhido';
}

/* ————————————————— previsão ————————————————— */

const ICONE = { chuva: '☔', talvez: '🌦', seco: '⛅' };

function iconeDoTempo(r) {
  if (r.nivel !== 'seco') return ICONE[r.nivel];
  return r.codigo === 0 || r.codigo === 1 ? '☀' : r.codigo === 45 || r.codigo === 48 ? '🌫' : ICONE.seco;
}

function desenhar() {
  if (!ultima) return;
  const { r } = ultima;
  el.painel.dataset.nivel = r.nivel;
  el.pIcone.textContent = iconeDoTempo(r);

  if (r.alerta) {
    el.pTitulo.textContent = Previsao.frase(r);
    el.pTexto.textContent = `Chance de até ${r.chanceMax}% nas próximas ${config.janela} h.`;
  } else if (r.nivel === 'talvez') {
    el.pTitulo.textContent = 'Pode chover';
    el.pTexto.textContent = `Até ${r.chanceMax}% de chance nas próximas ${config.janela} h — abaixo do seu limite de ${config.chance}%.`;
  } else {
    el.pTitulo.textContent = 'Sem chuva à vista';
    el.pTexto.textContent = `Nada previsto nas próximas ${config.janela} h.`;
  }

  el.dAgora.textContent = r.chovendo ? r.mmAgora.toFixed(1).replace('.', ',') + ' mm' : 'seco';
  el.dChance.textContent = r.chanceMax + '%';
  atualizarIdade();
  desenharTempo(ultima.tempo, r);

  el.horas.textContent = '';
  const fim = Date.now() / 1000 + config.janela * 3600;
  for (const h of r.horas) {
    const li = document.createElement('li');
    if (h.t < fim) li.classList.add('janela');
    if (h.chance >= config.chance && h.mm > 0) li.classList.add('molha');
    li.title = `${Previsao.horaLocal(h.t, r.fuso)} · ${h.chance}% · ${h.mm.toFixed(1)} mm`;

    const pct = document.createElement('span');
    pct.className = 'pct';
    pct.textContent = h.chance + '%';
    const coluna = document.createElement('span');
    coluna.className = 'coluna';
    const barra = document.createElement('i');
    barra.style.height = Math.max(2, h.chance) + '%';
    coluna.appendChild(barra);
    const hora = document.createElement('span');
    hora.className = 'hora';
    hora.textContent = Previsao.horaLocal(h.t, r.fuso).slice(0, 2) + 'h';

    li.append(pct, coluna, hora);
    el.horas.appendChild(li);
  }
}

const graus = v => v == null ? '—' : Math.round(v) + '°';
const numero = (v, sufixo) => v == null ? '—' : Math.round(v) + sufixo;

function desenharTempo(t, r) {
  el.tTemp.textContent = graus(t.temp);
  el.tTempNota.textContent = `sensação ${graus(t.sensacao)} · mín ${graus(t.min)} máx ${graus(t.max)}`;

  el.tUmidade.textContent = numero(t.umidade, '%');
  el.tUmidadeNota.textContent = t.umidade == null ? '—'
    : t.umidade < 30 ? 'ar muito seco — beba água'
    : t.umidade < 50 ? 'ar seco'
    : t.umidade <= 80 ? 'confortável' : 'ar muito úmido';

  el.tUv.textContent = t.uv == null ? '—' : String(Math.round(t.uv));
  el.tUvNota.textContent = t.uv == null ? '—'
    : `${Previsao.nivelUv(t.uv)} · máx. hoje ${t.uvMax == null ? '—' : Math.round(t.uvMax)} (${Previsao.nivelUv(t.uvMax)})`;

  el.tVento.textContent = numero(t.vento, ' km/h');
  el.tVentoNota.textContent = `do ${Previsao.direcaoVento(t.direcao) || '—'} · rajadas ${numero(t.rajada, ' km/h')}`;

  el.tSol.textContent = t.nascer == null ? '—' : Previsao.horaLocal(t.nascer, r.fuso);
  el.tSolNota.textContent = t.por == null ? '—' : `pôr do sol às ${Previsao.horaLocal(t.por, r.fuso)}`;

  const lua = Previsao.faseDaLua();
  el.tLua.textContent = lua.icone + ' ' + lua.luz + '%';
  el.tLuaNota.textContent = lua.nome + ' · iluminada';

  const GRANIZO = {
    alto: ['Risco alto', 'trovoada com granizo prevista no prazo'],
    possivel: ['Possível', 'trovoada ou ar muito instável no prazo'],
    baixo: ['Baixo', `nada indica granizo nas próximas ${config.janela} h`]
  };
  el.cGranizo.dataset.risco = r.granizo;
  [el.tGranizo.textContent, el.tGranizoNota.textContent] = GRANIZO[r.granizo];
}

function atualizarIdade() {
  if (!ultima) { el.dIdade.textContent = '—'; return; }
  const s = Math.round((Date.now() - ultima.em) / 1000);
  el.dIdade.textContent = s < 60 ? 'agora' : `há ${Math.round(s / 60)} min`;
}

let consultando = false;
async function verificar({ silencioso = false } = {}) {
  if (!local || consultando) return;
  consultando = true;
  if (!silencioso) definirEstado('Consultando…');
  try {
    const dados = await Previsao.buscar(local.lat, local.lon);
    const r = Previsao.avaliar(dados, config);
    ultima = { r, tempo: Previsao.resumirTempo(dados), em: Date.now() };
    desenhar();
    mostrarEstado();
    if (silencioso) Nuvens.carregar();   // a cada 10 min, junto com a previsão
    await decidirAlerta(r);
  } catch (e) {
    definirEstado(navigator.onLine === false ? 'Sem internet' : 'Previsão indisponível', 'erro');
  } finally {
    consultando = false;
  }
}

/** Uma vez por chuva: toca e só volta a tocar depois que a previsão secar. */
async function decidirAlerta(r) {
  const estado = await Previsao.lerEstado();
  if (!r.alerta) {
    if (estado.avisado) Previsao.gravarEstado({ avisado: false });
    return;
  }
  if (!config.vigiando || estado.avisado) return;
  Previsao.gravarEstado({ avisado: true });
  disparar(Previsao.frase(r) + (local ? ' em ' + local.nome : '') + '.' +
    (r.granizo === 'alto' ? ' Risco de granizo!' : ''));
}

/* ————————————————— disparo ————————————————— */

function disparar(texto) {
  el.aTexto.textContent = texto;
  el.alerta.hidden = false;
  if (config.som) Som.tocar();
  if (config.vibrar && navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 800]);
  notificar(texto);
}

async function notificar(texto) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.ready;
    const opcoes = { body: texto, icon: 'icones/icone-192.png', tag: 'alerta-chuva', renotify: true };
    if (reg) reg.showNotification('Vai chover!', opcoes);
    else new Notification('Vai chover!', opcoes);
  } catch (e) { /* sem notificação, o aviso na tela basta */ }
}

function pedirNotificacao() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

/* ————————————————— som ————————————————— */

/**
 * "Plim-plom" montado como WAV e tocado por <audio>: no iPhone o modo
 * silencioso cala a Web Audio, mas não a reprodução de mídia.
 */
const Som = (() => {
  const TAXA = 22050;
  let elemento = null;

  function montarWav() {
    const notas = [[880, .22], [660, .32], [0, .25], [880, .22], [660, .32], [0, .25], [880, .22], [660, .5]];
    const total = Math.round(TAXA * notas.reduce((s, n) => s + n[1], 0));
    const buffer = new ArrayBuffer(44 + total * 2);
    const dv = new DataView(buffer);
    const texto = (pos, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(pos + i, s.charCodeAt(i)); };
    texto(0, 'RIFF'); dv.setUint32(4, 36 + total * 2, true); texto(8, 'WAVE');
    texto(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, TAXA, true); dv.setUint32(28, TAXA * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    texto(36, 'data'); dv.setUint32(40, total * 2, true);

    let i = 0;
    for (const [freq, dur] of notas) {
      const n = Math.round(TAXA * dur);
      for (let k = 0; k < n && i < total; k++, i++) {
        const t = k / TAXA;
        const env = freq ? Math.min(1, t * 80) * Math.exp(-t * 6) : 0;   // ataque curto, decai como sino
        const v = env * (Math.sin(2 * Math.PI * freq * t) + 0.3 * Math.sin(4 * Math.PI * freq * t));
        dv.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, v * 0.75)) * 32000), true);
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  /** Precisa partir de um toque: depois disso o iOS deixa tocar sozinho. */
  function liberar() {
    if (elemento) return;
    elemento = new Audio(URL.createObjectURL(montarWav()));
    elemento.preload = 'auto';
    elemento.setAttribute('playsinline', '');
    elemento.hidden = true;
    document.body.appendChild(elemento);
    elemento.muted = true;
    const p = elemento.play();
    if (p && p.then) p.then(() => { elemento.pause(); elemento.muted = false; elemento.currentTime = 0; })
      .catch(() => { elemento.muted = false; });
  }

  function tocar() {
    if (!elemento) liberar();
    elemento.muted = false;
    elemento.currentTime = 0;
    const p = elemento.play();
    if (p && p.catch) p.catch(() => {});
  }

  function parar() {
    if (elemento) { elemento.pause(); elemento.currentTime = 0; }
  }

  return { liberar, tocar, parar };
})();

/* ————————————————— vigilância ————————————————— */

function ligar() {
  if (!local) { avisar('Escolha um local primeiro.'); return; }
  Som.liberar();
  pedirNotificacao();
  config.vigiando = true;
  salvar();
  iniciarRelogio();
  registrarSyncPeriodico(true);
  segurarTela();
  mostrarEstado();
  Previsao.gravarEstado({ avisado: false }).then(() => verificar());
  avisar('Alerta ligado. Deixe o app aberto.');
}

function desligar() {
  config.vigiando = false;
  salvar();
  clearInterval(consulta);
  consulta = null;
  registrarSyncPeriodico(false);
  soltarTela();
  mostrarEstado();
}

function iniciarRelogio() {
  clearInterval(consulta);
  consulta = setInterval(() => verificar({ silencioso: true }), INTERVALO);
}

/** Android, app instalado: o sistema acorda o service worker de vez em quando. */
async function registrarSyncPeriodico(ligado) {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !('periodicSync' in reg)) return;
    if (!ligado) { await reg.periodicSync.unregister(ETIQUETA_SYNC); return; }
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (perm.state === 'granted') {
      await reg.periodicSync.register(ETIQUETA_SYNC, { minInterval: 30 * 60 * 1000 });
    }
  } catch (e) { /* não suportado: fica só com o app aberto */ }
}

async function segurarTela() {
  if (!config.vigiando || !config.tela || !('wakeLock' in navigator) || travaTela) return;
  try {
    travaTela = await navigator.wakeLock.request('screen');
    travaTela.addEventListener('release', () => { travaTela = null; });
  } catch (e) { travaTela = null; }
}

function soltarTela() {
  if (travaTela) { travaTela.release().catch(() => {}); travaTela = null; }
}

/* ————————————————— local ————————————————— */

function escolherLocal(novo) {
  local = novo;
  ultima = null;
  salvar();
  mostrarLocal();
  mostrarEstado();
  Nuvens.definirLocal(local);
  Ceu.definirLocal(local);
  Onibus.definirLocal(local);
  el.buscaCaixa.hidden = true;
  el.resultados.hidden = true;
  Previsao.gravarEstado({ avisado: false }).then(() => verificar());
}

function usarGps() {
  if (!navigator.geolocation) { avisar('Este navegador não dá a localização.'); return; }
  definirEstado('Localizando…');
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lon } = pos.coords;
    escolherLocal({ nome: `Minha localização (${lat.toFixed(3)}, ${lon.toFixed(3)})`, lat, lon });
  }, erro => {
    mostrarEstado();
    avisar(erro.code === erro.PERMISSION_DENIED
      ? 'Localização negada. Libere nas permissões ou busque a cidade.'
      : 'Não deu para achar a posição. Tente buscar a cidade.', 5000);
  }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 10 * 60 * 1000 });
}

async function buscarCidade() {
  const termo = el.busca.value.trim();
  if (termo.length < 2) return;
  el.resultados.hidden = false;
  el.resultados.textContent = '';
  const carregando = document.createElement('li');
  carregando.textContent = 'Buscando…';
  el.resultados.appendChild(carregando);
  try {
    const lista = await Previsao.procurarCidade(termo);
    el.resultados.textContent = '';
    if (!lista.length) {
      const li = document.createElement('li');
      li.textContent = 'Nenhuma cidade com esse nome.';
      el.resultados.appendChild(li);
      return;
    }
    for (const c of lista) {
      const li = document.createElement('li');
      li.textContent = c.nome + ' ';
      const small = document.createElement('small');
      small.textContent = c.detalhe;
      li.appendChild(small);
      li.addEventListener('click', () => escolherLocal({
        nome: c.nome + (c.detalhe ? ' — ' + c.detalhe : ''), lat: c.lat, lon: c.lon,
        cidade: c.nome, estado: c.estado
      }));
      el.resultados.appendChild(li);
    }
  } catch (e) {
    el.resultados.textContent = '';
    const li = document.createElement('li');
    li.textContent = 'Busca indisponível. Confira a internet.';
    el.resultados.appendChild(li);
  }
}

/* ————————————————— eventos ————————————————— */

el.gps.addEventListener('click', usarGps);
el.mostrarBusca.addEventListener('click', () => {
  el.buscaCaixa.hidden = !el.buscaCaixa.hidden;
  if (!el.buscaCaixa.hidden) el.busca.focus();
});
el.buscar.addEventListener('click', buscarCidade);
el.busca.addEventListener('keydown', ev => { if (ev.key === 'Enter') buscarCidade(); });

el.vigiar.addEventListener('click', () => config.vigiando ? desligar() : ligar());
el.atualizar.addEventListener('click', () => {
  if (!local) { avisar('Escolha um local primeiro.'); return; }
  Som.liberar();
  verificar();
});

el.janela.addEventListener('input', () => {
  config.janela = Number(el.janela.value);
  el.janelaValor.textContent = config.janela + ' h';
});
el.chance.addEventListener('input', () => {
  config.chance = Number(el.chance.value);
  el.chanceValor.textContent = config.chance + '%';
});
for (const campo of [el.janela, el.chance]) {
  campo.addEventListener('change', () => { salvar(); verificar({ silencioso: true }); });
}
el.optSom.addEventListener('change', () => { config.som = el.optSom.checked; salvar(); });
el.optVibrar.addEventListener('change', () => { config.vibrar = el.optVibrar.checked; salvar(); });
el.optTela.addEventListener('change', () => {
  config.tela = el.optTela.checked;
  salvar();
  config.tela ? segurarTela() : soltarTela();
});

el.testar.addEventListener('click', () => {
  Som.liberar();
  pedirNotificacao();
  disparar('Teste: assim o alerta aparece quando a chuva vem.');
});

el.ok.addEventListener('click', () => {
  el.alerta.hidden = true;
  Som.parar();
  if (navigator.vibrate) navigator.vibrate(0);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  segurarTela();   // a trava cai quando a página some
  if (config.vigiando && (!ultima || Date.now() - ultima.em > INTERVALO)) verificar({ silencioso: true });
});

window.addEventListener('beforeinstallprompt', ev => {
  ev.preventDefault();
  promessaInstalar = ev;
  el.instalar.hidden = false;
});
el.instalar.addEventListener('click', async () => {
  if (!promessaInstalar) return;
  promessaInstalar.prompt();
  await promessaInstalar.userChoice.catch(() => {});
  promessaInstalar = null;
  el.instalar.hidden = true;
});

/* ————————————————— início ————————————————— */

mostrarAjustes();
Nuvens.iniciar();
Nuvens.definirLocal(local);
Ceu.iniciar();
Ceu.definirLocal(local);
Onibus.iniciar();
Onibus.definirLocal(local);
mostrarLocal();
mostrarEstado();
salvar();
relogio = setInterval(atualizarIdade, 15000);
if (config.vigiando) { iniciarRelogio(); segurarTela(); }
if (local) verificar();

if ('serviceWorker' in navigator) {
  // updateViaCache 'none': procura sw.js novo sem passar pelo cache do navegador.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
  // Quando a versão nova assume, recarrega uma vez para já mostrá-la.
  const tinhaControle = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaControle || recarregou) return;
    recarregou = true;
    location.reload();
  });
}

})();
