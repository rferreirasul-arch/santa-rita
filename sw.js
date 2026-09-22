// Service worker: guarda o app no aparelho para abrir sem internet.
// Com sinal, o app sempre pega a versão mais nova do GitHub. Aumente a VERSAO
// só se adicionar ou remover arquivos da lista abaixo.
const VERSAO = "fsr-v2";
const ARQUIVOS = [
  "./", "index.html", "styles.css", "app.js", "config.js", "manifest.webmanifest",
  "img/logo.svg", "img/logo-branco.svg", "img/fundo-1.jpg", "img/fundo-4.jpg",
  "img/icon-180.png", "img/icon-192.png", "img/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO && k !== "fsr-fontes").map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;

  // Fontes do Google: guarda a primeira cópia e reaproveita offline
  if (url.host.includes("fonts.googleapis.com") || url.host.includes("fonts.gstatic.com")) {
    e.respondWith(
      caches.open("fsr-fontes").then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin !== location.origin) return; // login Google e API passam direto

  // Arquivos do app: com sinal, busca a versão mais nova (até 4 s);
  // sem sinal ou com sinal fraco, usa a cópia guardada no aparelho
  e.respondWith(
    caches.open(VERSAO).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      const rede = fetch(e.request, { cache: "no-cache" })
        .then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; });
      if (!hit) return rede;
      const limite = new Promise((ok) => setTimeout(() => ok(hit), 4000));
      return Promise.race([rede.catch(() => hit), limite]);
    })
  );
});
