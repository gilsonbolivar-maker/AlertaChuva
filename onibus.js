/* ————————————————————————————————————————————————————————————
   Ônibus: atalhos para ver os horários de ônibus saindo da cidade
   escolhida. Não existe fonte aberta com partidas e chegadas das
   rodoviárias no Brasil, então o app abre quem tem: os sites de
   passagens (pela busca do Google restrita ao site, que leva à página
   da cidade mesmo se o site mudar de endereço) e o mapa da rodoviária.

   Com o local vindo do GPS, o nome da cidade sai do Nominatim
   (OpenStreetMap), uma consulta por local escolhido.
   ———————————————————————————————————————————————————————————— */
'use strict';

const Onibus = (() => {
  const UF = {
    'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM', 'Bahia': 'BA', 'Ceará': 'CE',
    'Distrito Federal': 'DF', 'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA',
    'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', 'Pará': 'PA',
    'Paraíba': 'PB', 'Paraná': 'PR', 'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ',
    'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR',
    'Santa Catarina': 'SC', 'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO'
  };
  const NOMINATIM = 'https://nominatim.openstreetmap.org/reverse';

  const $ = id => document.getElementById(id);
  let el = null;
  let geracao = 0;
  const lembrado = new Map();   // "lat,lon" → { cidade, estado }, para não repetir a consulta

  function iniciar() {
    el = {
      titulo: $('onibus-titulo'),
      aviso: $('onibus-aviso'),
      links: document.querySelectorAll('[data-onibus]')
    };
    mostrar(null);
  }

  const sigla = estado => UF[estado] || estado || '';

  /** Cidade e estado do local: do próprio local, do nome "Cidade — Estado, País" ou do Nominatim. */
  async function descobrirCidade(local) {
    if (local.cidade) return { cidade: local.cidade, estado: local.estado || '' };
    const partes = local.nome.split(' — ');
    if (partes.length > 1) return { cidade: partes[0], estado: partes[1].split(',')[0].trim() };

    const chave = local.lat.toFixed(3) + ',' + local.lon.toFixed(3);
    if (lembrado.has(chave)) return lembrado.get(chave);
    const p = new URLSearchParams({
      lat: local.lat.toFixed(5), lon: local.lon.toFixed(5),
      format: 'jsonv2', zoom: '10', 'accept-language': 'pt-BR'
    });
    const resp = await fetch(NOMINATIM + '?' + p);
    if (!resp.ok) throw new Error(resp.status);
    const a = (await resp.json()).address || {};
    const achado = {
      cidade: a.city || a.town || a.municipality || a.village || a.county || '',
      estado: a.state || ''
    };
    if (!achado.cidade) throw new Error('sem cidade');
    lembrado.set(chave, achado);
    return achado;
  }

  function enderecos(cidade, uf) {
    const lugar = `${cidade} ${uf}`.trim();
    const google = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
    return {
      horarios: google(`horários de ônibus saindo de ${lugar} rodoviária`),
      clickbus: google(`site:clickbus.com.br ônibus saindo de ${lugar}`),
      queropassagem: google(`site:queropassagem.com.br ônibus saindo de ${lugar}`),
      mapa: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`rodoviária ${lugar}`)
    };
  }

  function mostrar(achado) {
    if (!el) return;
    for (const a of el.links) {
      a.toggleAttribute('aria-disabled', !achado);
      a.tabIndex = achado ? 0 : -1;
    }
    if (!achado) {
      el.titulo.textContent = 'Ônibus saindo da cidade';
      return;
    }
    const uf = sigla(achado.estado);
    el.titulo.textContent = `Ônibus saindo de ${achado.cidade}${uf ? ' (' + uf + ')' : ''}`;
    const urls = enderecos(achado.cidade, uf);
    for (const a of el.links) a.href = urls[a.dataset.onibus];
  }

  async function definirLocal(local) {
    if (!el) return;
    const gen = ++geracao;
    mostrar(null);
    if (!local) {
      el.aviso.textContent = 'Escolha um local para ver os ônibus.';
      return;
    }
    el.aviso.textContent = 'Descobrindo a cidade…';
    try {
      const achado = await descobrirCidade(local);
      if (gen !== geracao) return;
      mostrar(achado);
      el.aviso.textContent = '';
    } catch (e) {
      if (gen !== geracao) return;
      el.aviso.textContent = 'Não deu para descobrir a cidade deste ponto. Use “Buscar cidade” lá em cima.';
    }
  }

  return { iniciar, definirLocal };
})();
