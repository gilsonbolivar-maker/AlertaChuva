/* ————————————————————————————————————————————————————————————
   Busca a previsão no Open-Meteo e decide se vai chover. Usado pela
   página e pelo service worker (importScripts), para os dois darem
   sempre a mesma resposta.

   Também guarda o "estado compartilhado" (local, ajustes e se já
   avisou desta chuva) no Cache Storage: é o único armazenamento que
   a página e o service worker enxergam igual, sem IndexedDB.
   ———————————————————————————————————————————————————————————— */
'use strict';

const Previsao = (() => {
  const API = 'https://api.open-meteo.com/v1/forecast';
  const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
  const CACHE_ESTADO = 'alerta-chuva-estado';
  const URL_ESTADO = 'estado.json';
  const MM_15 = 0.2;        // mm em 15 min a partir do qual conta como chuva
  const CHANCE_TALVEZ = 30; // abaixo do limiar, mas vale mostrar "pode chover"

  async function buscar(lat, lon) {
    const p = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      current: 'precipitation,weather_code,temperature_2m,apparent_temperature,relative_humidity_2m,' +
               'wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day',
      minutely_15: 'precipitation',
      hourly: 'precipitation_probability,precipitation,weather_code,cape',
      daily: 'sunrise,sunset,temperature_2m_max,temperature_2m_min,uv_index_max',
      forecast_minutely_15: '8',   // 2 horas
      forecast_hours: '13',
      forecast_days: '2',
      wind_speed_unit: 'kmh',
      timeformat: 'unixtime',
      timezone: 'auto'
    });
    const resp = await fetch(API + '?' + p, { cache: 'no-store' });
    if (!resp.ok) throw new Error('Open-Meteo respondeu ' + resp.status);
    return resp.json();
  }

  async function procurarCidade(nome) {
    const p = new URLSearchParams({ name: nome, count: '6', language: 'pt', format: 'json' });
    const resp = await fetch(GEO + '?' + p);
    if (!resp.ok) throw new Error('busca respondeu ' + resp.status);
    const dados = await resp.json();
    return (dados.results || []).map(r => ({
      nome: r.name,
      detalhe: [r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude
    }));
  }

  /**
   * Lê a resposta do Open-Meteo e devolve:
   *   alerta    — true quando bate com os ajustes (vai chover)
   *   nivel     — 'chuva' | 'talvez' | 'seco'
   *   quando    — instante (s) em que a chuva começa, ou null
   *   chanceMax — maior chance (%) dentro da janela
   *   horas     — [{ t, chance, mm }] das próximas 12 horas
   */
  function avaliar(dados, { janela, chance }, agora = Date.now() / 1000) {
    const fim = agora + janela * 3600;
    let quando = null;

    const atual = dados.current || {};
    if (atual.precipitation > 0) quando = agora;

    // Primeiras 2 horas, de 15 em 15 minutos: diz quando começa.
    const m = dados.minutely_15 || {};
    if (quando === null && m.time) {
      for (let i = 0; i < m.time.length; i++) {
        const t = m.time[i];
        if (t + 900 <= agora || t >= fim) continue;
        if ((m.precipitation[i] || 0) >= MM_15) { quando = Math.max(t, agora); break; }
      }
    }

    // Resto da janela, hora a hora, pela chance.
    const h = dados.hourly || {};
    const horas = [];
    let chanceMax = 0;
    for (let i = 0; i < (h.time || []).length; i++) {
      const t = h.time[i];
      if (t + 3600 <= agora) continue;
      const c = h.precipitation_probability ? (h.precipitation_probability[i] || 0) : 0;
      const mm = h.precipitation ? (h.precipitation[i] || 0) : 0;
      if (horas.length < 12) horas.push({ t, chance: c, mm });
      if (t >= fim) continue;
      chanceMax = Math.max(chanceMax, c);
      if (quando === null && c >= chance && mm > 0) quando = Math.max(t, agora);
    }

    const alerta = quando !== null;
    return {
      alerta,
      granizo: riscoDeGranizo(h, agora, fim),
      nivel: alerta ? 'chuva' : chanceMax >= CHANCE_TALVEZ ? 'talvez' : 'seco',
      quando,
      chanceMax,
      chovendo: atual.precipitation > 0,
      mmAgora: atual.precipitation || 0,
      codigo: atual.weather_code,
      fuso: dados.utc_offset_seconds || 0,
      horas
    };
  }

  /**
   * Granizo não vem pronto na previsão. Juntamos dois sinais dentro do prazo:
   *   código 96/99 (trovoada com granizo — o modelo só marca isso em parte do mundo)
   *   ou trovoada (95) com muita energia no ar (CAPE alto), que é o que forma pedra.
   * Devolve 'alto' | 'possivel' | 'baixo'.
   */
  function riscoDeGranizo(h, agora, fim) {
    let risco = 'baixo';
    for (let i = 0; i < (h.time || []).length; i++) {
      const t = h.time[i];
      if (t + 3600 <= agora || t >= fim) continue;
      const cod = h.weather_code ? h.weather_code[i] : 0;
      const cape = h.cape ? (h.cape[i] || 0) : 0;
      if (cod === 96 || cod === 99 || (cod === 95 && cape >= 2500)) return 'alto';
      if (cod === 95 || cape >= 1500) risco = 'possivel';
    }
    return risco;
  }

  /** Temperatura, umidade, UV, vento e sol, no formato que a tela usa. */
  function resumirTempo(dados) {
    const c = dados.current || {};
    const d = dados.daily || {};
    return {
      temp: c.temperature_2m,
      sensacao: c.apparent_temperature,
      min: d.temperature_2m_min ? d.temperature_2m_min[0] : null,
      max: d.temperature_2m_max ? d.temperature_2m_max[0] : null,
      umidade: c.relative_humidity_2m,
      uv: c.uv_index,
      uvMax: d.uv_index_max ? d.uv_index_max[0] : null,
      vento: c.wind_speed_10m,
      rajada: c.wind_gusts_10m,
      direcao: c.wind_direction_10m,
      nascer: d.sunrise ? d.sunrise[0] : null,
      por: d.sunset ? d.sunset[0] : null
    };
  }

  /** Nível do UV pela escala da OMS. */
  function nivelUv(uv) {
    if (uv == null) return '';
    if (uv < 3) return 'baixo';
    if (uv < 6) return 'moderado';
    if (uv < 8) return 'alto';
    if (uv < 11) return 'muito alto';
    return 'extremo';
  }

  /** De onde o vento vem, em 8 pontos: 0° = vem do norte. */
  function direcaoVento(graus) {
    if (graus == null) return '';
    return ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(graus / 45) % 8];
  }

  /**
   * Fase da lua calculada no aparelho, sem rede: idade desde uma lua nova
   * conhecida (6/jan/2000 18:14 UTC), dividida pelo mês sinódico.
   */
  function faseDaLua(data = new Date()) {
    const SINODICO = 29.530588853;
    const dias = (data.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 86400000;
    const idade = ((dias % SINODICO) + SINODICO) % SINODICO;
    const fracao = idade / SINODICO;
    const luz = Math.round((1 - Math.cos(2 * Math.PI * fracao)) / 2 * 100);
    const FASES = [
      ['Lua nova', '🌑'], ['Crescente', '🌒'], ['Quarto crescente', '🌓'], ['Crescente gibosa', '🌔'],
      ['Lua cheia', '🌕'], ['Minguante gibosa', '🌖'], ['Quarto minguante', '🌗'], ['Minguante', '🌘']
    ];
    const [nome, icone] = FASES[Math.round(fracao * 8) % 8];
    return { nome, icone, luz, idade };
  }

  /** Hora do local consultado (que pode ter outro fuso que o aparelho). */
  function horaLocal(t, fuso) {
    const d = new Date((t + fuso) * 1000);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  }

  /** Frase curta: "Chovendo agora", "Chuva em ~40 min", "Chuva por volta das 16:00". */
  function frase(r, agora = Date.now() / 1000) {
    if (!r.alerta) return '';
    if (r.chovendo) return 'Chovendo agora';
    const min = Math.round((r.quando - agora) / 60);
    if (min <= 5) return 'Chuva começando';
    if (min < 90) return `Chuva em ~${Math.round(min / 5) * 5} min`;
    return 'Chuva por volta das ' + horaLocal(r.quando, r.fuso);
  }

  async function lerEstado() {
    try {
      const c = await caches.open(CACHE_ESTADO);
      const r = await c.match(URL_ESTADO);
      return r ? await r.json() : {};
    } catch (e) {
      return {};
    }
  }

  async function gravarEstado(mudancas) {
    try {
      const atual = await lerEstado();
      const novo = Object.assign(atual, mudancas);
      const c = await caches.open(CACHE_ESTADO);
      await c.put(URL_ESTADO, new Response(JSON.stringify(novo), {
        headers: { 'Content-Type': 'application/json' }
      }));
      return novo;
    } catch (e) {
      return mudancas;
    }
  }

  return {
    buscar, procurarCidade, avaliar, horaLocal, frase, lerEstado, gravarEstado,
    resumirTempo, nivelUv, direcaoVento, faseDaLua
  };
})();
