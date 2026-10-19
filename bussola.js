/* ————————————————————————————————————————————————————————————
   Bússola de verdade nos quadros de nuvens, aviões e satélites.

   O sensor do celular dá o rumo em relação ao NORTE MAGNÉTICO. O mapa
   usa o NORTE VERDADEIRO. No Brasil os dois diferem uns 20° (‑23° na
   Bahia), então o rumo é corrigido pela declinação do local, calculada
   no aparelho com o modelo magnético mundial WMM2025 (vendor/geomag).

   Cada quadro marcado com [data-bussola-quadro] ganha uma rosa no canto
   com a agulha vermelha no norte verdadeiro. Com "Girar com o celular",
   o conteúdo do quadro ([data-bussola-giro]) gira junto, alinhando o
   mapa com o mundo à sua frente.
   ———————————————————————————————————————————————————————————— */
'use strict';

const Bussola = (() => {
  const CHAVE = 'alerta-chuva:bussola';
  const SUAVE = 0.25;                  // filtro: 0 = parado, 1 = sem filtro

  let ligada = false;
  let girar = false;
  let declinacao = 0;
  let rumo = null;                     // graus do norte verdadeiro para o topo do celular
  let vetor = null;                    // [cos, sin] filtrado (média de ângulos sem pulo em 0/360)
  let quadro = null;                   // pedido de desenho pendente
  let semSinal = null;
  let evento = null;

  const $$ = s => document.querySelectorAll(s);

  function iniciar() {
    let salvo = {};
    try { salvo = JSON.parse(localStorage.getItem(CHAVE) || '{}'); } catch (e) { /* modo privado */ }
    girar = !!salvo.girar;

    for (const q of $$('[data-bussola-quadro]')) q.append(rosa());
    for (const b of $$('[data-bussola="ligar"]')) b.addEventListener('click', () => ligada ? desligar() : ligar());
    for (const b of $$('[data-bussola="girar"]')) b.addEventListener('click', () => {
      girar = !girar;
      gravar();
      marcar();
      desenhar();
    });
    marcar();
    // Android liga sem pedir; o iOS exige um toque — lá fica para o botão.
    if (salvo.ligada && typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission !== 'function') ligar();
  }

  function gravar() {
    try { localStorage.setItem(CHAVE, JSON.stringify({ ligada, girar })); } catch (e) { /* modo privado */ }
  }

  function definirLocal(local) {
    declinacao = 0;
    if (local && window.Geomag) {
      try { declinacao = Geomag.declinacao(local.lat, local.lon, new Date()); } catch (e) { declinacao = 0; }
    }
    desenhar();
  }

  /** A rosa do canto: não gira; só a agulha gira. */
  function rosa() {
    const div = document.createElement('div');
    div.className = 'bussola';
    div.hidden = true;
    div.innerHTML =
      '<svg viewBox="-24 -24 48 48" aria-hidden="true">' +
        '<circle r="22" class="bussola-aro"/>' +
        '<g class="bussola-agulha">' +
          '<path d="M0 -18 L5 0 L-5 0 Z" class="bussola-norte"/>' +
          '<path d="M0 18 L5 0 L-5 0 Z" class="bussola-sul"/>' +
          '<text y="-9" text-anchor="middle" class="bussola-n">N</text>' +
        '</g>' +
        '<circle r="2" class="bussola-eixo"/>' +
      '</svg>' +
      '<span class="bussola-graus"></span>';
    return div;
  }

  async function ligar() {
    if (typeof DeviceOrientationEvent === 'undefined') { avisar('Este aparelho não tem bússola.'); return; }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        if (await DeviceOrientationEvent.requestPermission() !== 'granted') {
          avisar('Sem permissão para a bússola. Libere “Movimento e orientação” nos ajustes do Safari.');
          return;
        }
      } catch (e) {
        avisar('Não deu para pedir a permissão da bússola.');
        return;
      }
    }
    evento = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(evento, aoGirar);
    ligada = true;
    rumo = vetor = null;
    gravar();
    marcar();
    clearTimeout(semSinal);
    semSinal = setTimeout(() => {
      if (rumo === null) avisar('O sensor de bússola não respondeu. Em computador ou tablet sem bússola ela não funciona.');
    }, 3000);
  }

  function desligar() {
    if (evento) window.removeEventListener(evento, aoGirar);
    ligada = false;
    rumo = vetor = null;
    clearTimeout(semSinal);
    gravar();
    marcar();
    desenhar();
  }

  function anguloTela() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    return typeof window.orientation === 'number' ? window.orientation : 0;
  }

  function aoGirar(e) {
    let magnetico = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      magnetico = e.webkitCompassHeading;                  // iOS: já em graus a partir do norte, sentido horário
    } else if ((e.absolute || evento === 'deviceorientationabsolute') && typeof e.alpha === 'number') {
      magnetico = 360 - e.alpha;                           // Android: alpha cresce no sentido anti-horário
    }
    if (magnetico === null) return;
    const verdadeiro = (magnetico + anguloTela() + declinacao + 720) % 360;

    const r = verdadeiro * Math.PI / 180;
    const novo = [Math.cos(r), Math.sin(r)];
    vetor = vetor
      ? [vetor[0] + (novo[0] - vetor[0]) * SUAVE, vetor[1] + (novo[1] - vetor[1]) * SUAVE]
      : novo;
    rumo = (Math.atan2(vetor[1], vetor[0]) * 180 / Math.PI + 360) % 360;
    if (!quadro) quadro = requestAnimationFrame(desenhar);
  }

  const PONTOS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];

  function desenhar() {
    quadro = null;
    const ativo = ligada && rumo !== null;
    for (const r of $$('.bussola')) {
      r.hidden = !ativo;
      if (!ativo) continue;
      r.querySelector('.bussola-agulha').setAttribute('transform', `rotate(${(-rumo).toFixed(1)})`);
      r.querySelector('.bussola-graus').textContent = `${Math.round(rumo)}° ${PONTOS[Math.round(rumo / 45) % 8]}`;
    }
    const giro = ativo && girar ? `rotate(${(-rumo).toFixed(1)}deg)` : '';
    for (const g of $$('[data-bussola-giro]')) g.style.transform = giro;
  }

  function marcar() {
    for (const b of $$('[data-bussola="ligar"]')) {
      b.setAttribute('aria-pressed', String(ligada));
      b.textContent = ligada ? '🧭 Bússola ligada' : '🧭 Ligar bússola';
    }
    for (const b of $$('[data-bussola="girar"]')) {
      b.setAttribute('aria-pressed', String(girar));
      b.hidden = !ligada;
    }
  }

  function avisar(texto) {
    for (const p of $$('[data-bussola-aviso]')) p.textContent = texto;
    setTimeout(() => { for (const p of $$('[data-bussola-aviso]')) if (p.textContent === texto) p.textContent = ''; }, 6000);
  }

  return { iniciar, definirLocal };
})();
