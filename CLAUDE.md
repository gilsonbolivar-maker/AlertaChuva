# Alerta de Chuva — regras do repositório

- A versão mora em `const VERSAO = 'x.y.z'` no `app.js` **e** no `sw.js`, com o
  mesmo valor (o cache do service worker leva o número no nome).
- **Toda mudança sobe a versão**, no mesmo commit: correção → último número;
  recurso novo → do meio; mudança grande → primeiro.
- A versão aparece ao lado do título, em todo elemento com `data-versao`.
