/* ————————————————————————————————————————————————————————————
   Service worker: deixa o app abrir sem rede e, no Android com o
   app instalado, confere a previsão quando o sistema o acorda
   (Periodic Background Sync).
   ———————————————————————————————————————————————————————————— */
'use strict';

importScripts('previsao.js');

const VERSAO = '1.4.0';   // precisa casar com a VERSAO do app.js
const CACHE_APP = 'alerta-chuva-app-' + VERSAO;

const ARQUIVOS = [
  '.',
  'index.html',
  'app.css',
  'app.js',
  'previsao.js',
  'nuvens.js',
  'ceu.js',
  'onibus.js',
  'vendor/satellite.min.js',
  'manifest.webmanifest',
  'icones/icone-180.png',
  'icones/icone-192.png',
  'icones/icone-512.png',
  'icones/icone-maskable-512.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    // cache: 'reload' pula o cache HTTP do navegador: sem isso a versão nova
    // podia guardar arquivos da anterior (o GitHub Pages manda guardar por 10 min).
    caches.open(CACHE_APP)
      .then(c => c.addAll(ARQUIVOS.map(a => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(nomes => Promise.all(
        nomes.filter(n => n.startsWith('alerta-chuva-app-') && n !== CACHE_APP)
             .map(n => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // previsão e busca sempre na rede

  // Arquivos do app: rede primeiro (versão nova na hora), cache só sem internet.
  ev.respondWith(
    fetch(req, { cache: 'no-cache' }).then(resp => {
      if (resp && resp.ok) {
        const copia = resp.clone();
        caches.open(CACHE_APP).then(c => c.put(req, copia));
      }
      return resp;
    }).catch(() => caches.match(req, { ignoreSearch: true }))
  );
});

self.addEventListener('periodicsync', ev => {
  if (ev.tag === 'chuva') ev.waitUntil(conferirEmSegundoPlano());
});

async function conferirEmSegundoPlano() {
  // Com o app aberto na tela, quem avisa é a página.
  const janelas = await self.clients.matchAll({ type: 'window' });
  if (janelas.some(j => j.visibilityState === 'visible')) return;

  const estado = await Previsao.lerEstado();
  if (!estado.vigiando || !estado.local) return;

  const dados = await Previsao.buscar(estado.local.lat, estado.local.lon);
  const r = Previsao.avaliar(dados, { janela: estado.janela || 2, chance: estado.chance || 60 });
  if (!r.alerta) {
    if (estado.avisado) await Previsao.gravarEstado({ avisado: false });
    return;
  }
  if (estado.avisado) return;
  await Previsao.gravarEstado({ avisado: true });
  await self.registration.showNotification('Vai chover!', {
    body: Previsao.frase(r) + ' em ' + estado.local.nome + '.' +
      (r.granizo === 'alto' ? ' Risco de granizo!' : ''),
    icon: 'icones/icone-192.png',
    tag: 'alerta-chuva',
    renotify: true,
    vibrate: [400, 200, 400, 200, 800]
  });
}

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  ev.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const cliente of lista) {
        if ('focus' in cliente) return cliente.focus();
      }
      return self.clients.openWindow('.');
    })
  );
});
