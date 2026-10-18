# Alerta de Chuva

PWA que avisa quando a previsão mostra chuva chegando no local escolhido —
som, vibração, tela azul e notificação.

Página estática em HTML, CSS e JavaScript puros — sem build, sem dependências,
sem servidor, sem chave de API. A previsão vem do [Open-Meteo](https://open-meteo.com/).

## Como usar

1. Toque em **Minha localização** (GPS) ou em **Buscar cidade**.
2. Em **Ajustes**, escolha o prazo (1 a 6 h) e a chance mínima (20 a 90%).
3. Toque em **Ligar alerta** e deixe o app aberto.

## Como decide

| Trecho | Fonte | Conta como chuva |
|---|---|---|
| Agora | `current.precipitation` | qualquer valor acima de 0 |
| Próximas 2 h | `minutely_15.precipitation` | ≥ 0,2 mm em 15 min |
| Resto do prazo | `hourly.precipitation_probability` | chance ≥ limite **e** mm > 0 |

Com risco alto de **granizo** no prazo, o alerta acrescenta "Risco de granizo!".

## Tempo agora

| Cartão | O que mostra | Fonte |
|---|---|---|
| Temperatura | atual, sensação, mín. e máx. do dia | `current`, `daily` |
| Umidade do ar | % e se o ar está seco | `relative_humidity_2m` |
| Índice UV | agora e máximo do dia, na escala da OMS | `uv_index`, `uv_index_max` |
| Vento | velocidade, de onde vem e rajadas | `wind_*_10m` |
| Nascer do sol | nascer e pôr, no fuso do local | `sunrise`, `sunset` |
| Lua | fase e % iluminada | **calculada no aparelho**, sem rede |
| Granizo | baixo / possível / alto | código 95/96/99 + CAPE |

## Nuvens agora (satélite)

Imagem do satélite **GOES-16** pelo WMS do [NASA GIBS](https://earthdata.nasa.gov/gibs)
(gratuito, sem chave, imagem nova a cada 10 min), centrada no local.

| Botão | O que faz |
|---|---|
| Infravermelho | topo de nuvem frio = colorido (chuva forte); dia e noite |
| Visível | foto das nuvens; só com sol |
| ▶ Última hora | anima as 6 últimas imagens, para ver a formação se mexendo |
| Vista 20 / 60 / 150 / 400 km | largura da imagem; o círculo tracejado marca sempre 20 km |

O satélite tem 1 a 2 km por ponto: na vista de 20 km a imagem fica granulada.
A imagem chega ao GIBS com uns 20–40 min de atraso; o app procura a mais nova que já existe.

## Céu agora

| Aba | O que mostra | Fonte |
|---|---|---|
| ✈️ Aviões | radar visto de cima (50 / 150 / 300 km), voo, tipo, altitude, velocidade e direção; a cada 15 s | ADS‑B comunitário: [adsb.lol](https://adsb.lol), reserva airplanes.live e OpenSky |
| 🛰 Satélites | cúpula do céu (centro = zênite) com os satélites acima do horizonte e o rastro dos próximos 5 min; ISS, Tiangong e Hubble em vermelho | órbitas da [CelesTrak](https://celestrak.org) (grupos `stations` e `visual`), posição calculada no aparelho com [satellite.js](https://github.com/shashwatak/satellite-js) (MIT, em `vendor/`) |

As órbitas ficam guardadas no aparelho por 6 h (a CelesTrak pede que não se baixe
mais vezes que a atualização deles). Os aviões só são consultados com a seção na
tela e o app aberto. Onde não há receptor ADS‑B de voluntário por perto, o avião
não aparece.

## Ônibus

Não há fonte aberta de partidas e chegadas das rodoviárias brasileiras. A seção
mostra atalhos com a cidade escolhida: busca de horários, ClickBus e Quero Passagem
(busca do Google restrita ao site, que leva à página da cidade) e a rodoviária no
Google Maps. Com local de GPS, a cidade vem do [Nominatim](https://nominatim.org/)
(OpenStreetMap), uma consulta por local.

Granizo não vem pronto na previsão: **alto** = código 96/99 (só marcado em parte
do mundo) ou trovoada com CAPE ≥ 2500; **possível** = trovoada ou CAPE ≥ 1500.
É um indício, não certeza.

Consulta a cada 10 minutos e ao voltar para o app. Avisa **uma vez por chuva**:
só toca de novo depois que a previsão ficar seca.

## Limites

- **Deixe o app aberto.** Um site não roda em segundo plano. No Android, com o app
  instalado pelo Chrome, o service worker usa *Periodic Background Sync* para
  conferir de vez em quando (no mínimo a cada 30 min, quando o sistema quiser) e
  mostra só a notificação.
- **iPhone/iPad:** notificação só com o app adicionado à Tela de Início; sem
  vibração. O som toca por `<audio>`, então sai mesmo no modo silencioso, mas o
  volume de mídia precisa estar alto.
- Previsão é previsão: pancada isolada de verão às vezes escapa.

## Endereço

<https://gilsonbolivar-maker.github.io/AlertaChuva/>

Todo push na `main` publica no GitHub Pages pelo workflow em
`.github/workflows/pages.yml` (a primeira execução liga o Pages sozinha).

## Versão

A versão mora em `const VERSAO` no `app.js` **e** no `sw.js`, com o mesmo valor, e
aparece ao lado do título. Toda mudança sobe a versão no mesmo commit: correção →
último número, recurso novo → do meio, mudança grande → primeiro.

## Estrutura

```
index.html            tela única: local, previsão, tempo agora, barras por hora, ajustes e alerta
app.css               estilos (tema escuro e claro)
app.js                local, ajustes, consultas, disparo e som
nuvens.js             quadro do satélite (NASA GIBS, GOES-16)
ceu.js                aviões (ADS-B) e satélites (CelesTrak + satellite.js)
vendor/               satellite.js 5.0.0 (MIT)
onibus.js             atalhos de ônibus da cidade (Nominatim para GPS)
previsao.js           Open-Meteo, regra de decisão, granizo, lua e estado compartilhado com o SW
sw.js                 app offline e conferência em segundo plano (Android)
manifest.webmanifest  dados de instalação do PWA
icones/               ícones 180, 192, 512 e maskable
```

## Créditos

Dados de tempo e busca de cidades por [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
