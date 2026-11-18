"use strict";
/* 시작 화면 v3 — /api/intro 로 숫자·유튜버·예시 식당을 받아 세 칸(영상 · 댓글 · 지도)을 그립니다.
 *
 * 숫자는 전부 API 에서 옵니다. 고른 유튜버는 지도와 같은 localStorage 키
 * (lesulin.fav, 유튜버 id 의 JSON 배열)에 저장해서 지도가 그대로 읽습니다.
 * 3번 칸 카카오맵은 window.LesulinIntroMap(아래) 이 맡습니다. */
(function () {
  const FAV_KEY = "lesulin.fav";
  const MAX = 3;
  const $ = id => document.getElementById(id);

  /* 시크릿 창 등에서는 localStorage 접근 자체가 예외를 던집니다 */
  function safeGet() {
    try { const v = JSON.parse(localStorage.getItem(FAV_KEY) || "null"); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }
  function safeSet(ids) {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(ids)); } catch { /* 저장 못 해도 이동은 합니다 */ }
  }

  const nf = n => Number(n).toLocaleString("ko-KR");
  /* 지도(app.js)와 같은 조회수 표기 */
  const views = n => n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "만회"
                   : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "천회" : n + "회";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const YT = id => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const MAP = id => `/map.html?store=${encodeURIComponent(id)}`;
  const LVL = { 1: "들러볼 곳", 2: "우회해도 갈 곳", 3: "이곳을 위해" };   // 지도(app.js)와 같은 이름
  const cut = t => (t.length > 95 ? t.slice(0, 94).trimEnd() + "…" : t);

  let D = null;             // /api/intro 응답
  let picked = [];          // 고른 순서대로
  let sel = null;           // 카드·핀으로 고른 식당 하나
  let loaded = false;       // 칩을 실제로 보여 준 뒤에만 선택을 저장합니다

  /* 고른 유튜버가 없으면 성시경(사람이 확인한 복춘식당) + 식당 많은 앞 2명 */
  const shownCreators = () => picked.length ? picked
    : ["c1", ...D.creators.map(c => c.id).filter(id => id !== "c1").slice(0, 2)];
  /* 같은 식당이 두 유튜버에 걸려 있으면 한 번만 */
  function shownPlaces() {
    const ids = shownCreators(), seen = new Set(), out = [];
    for (const p of D.places) if (ids.includes(p.creatorId) && !seen.has(p.id)) { seen.add(p.id); out.push(p); }
    return out;
  }
  const creatorName = id => (D.creators.find(c => c.id === id) || {}).name || "";

  /* ── 1·2번 칸: 4건 이상이면 저절로 흐르게 카드를 한 번 더 붙입니다(복사본은 .dup, 보조기기에서 숨김) ── */
  function fill(port, items, render) {
    const still = !!sel || items.length < 4;
    port.classList.toggle("static", still);
    if (!items.length) { port.innerHTML = '<div class="empty">표시할 식당이 없습니다</div>'; return; }
    const html = items.map(x => render(x, false)).join("");
    const dup = still ? "" : items.map(x => render(x, true)).join("");
    port.innerHTML = `<div class="track" style="--dur:${Math.max(30, items.length * 9)}s">${html}${dup}</div>`;
  }

  const videoCard = (p, dup) => `
    <div class="vcard${dup ? " dup" : ""}" data-store="${esc(p.id)}" role="button" tabindex="${dup ? -1 : 0}"
         aria-pressed="${sel === p.id}"${dup ? ' aria-hidden="true" inert' : ""}>
      <a class="thumb vlink" href="${YT(p.video.id)}" target="_blank" rel="noreferrer" aria-label="${esc(p.video.title)} 유튜브에서 보기">
        <img src="img/vid/${encodeURIComponent(p.video.id)}.jpg" alt="" loading="lazy"
             onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${encodeURIComponent(p.video.id)}/hqdefault.jpg'">
        ${p.lvl ? `<span class="bd">${LVL[p.lvl] || ""}</span>` : ""}
        <span class="who"><img class="av" src="img/ch/${encodeURIComponent(p.creatorId)}.jpg" alt="">${esc(creatorName(p.creatorId))}</span>
        ${p.video.dur ? `<span class="du">${esc(p.video.dur)}</span>` : ""}
      </a>
      <span class="vt"><a class="slink" href="${MAP(p.id)}">${esc(p.name)}</a></span>
      <span class="vm">${[esc(p.region), esc(p.category), `조회 ${views(p.video.views)}`,
          `반응 <b class="p">${nf(p.used)}</b>`, p.neg ? `쓴소리 <b class="n">${nf(p.neg)}</b>` : ""]
          .filter(Boolean).map(x => `<span>${x}</span>`).join("<i>·</i>")}</span>
    </div>`;

  const reviewCard = ([p, kind], dup) => {
    const q = p[kind];
    return `
    <div class="rcard${dup ? " dup" : ""}" data-store="${esc(p.id)}" data-kind="${kind}" role="button" tabindex="${dup ? -1 : 0}"
         aria-pressed="${sel === p.id}"${dup ? ' aria-hidden="true" inert' : ""}>
      <span class="tag ${kind === "good" ? "p" : "n"}">${kind === "good" ? "좋았다는 이야기" : "아쉬웠다는 이야기"}</span>
      <q>"${esc(cut(q.text))}"</q>
      <small>${esc(p.name)} · 유튜브 댓글${q.likes ? ` · 좋아요 ${nf(q.likes)}` : ""}${q.wait ? " · 웨이팅 언급" : ""}
        · <a class="olink" href="${YT(q.vid)}" target="_blank" rel="noreferrer">원문 ↗</a></small>
    </div>`;
  };

  function render() {
    const places = shownPlaces();
    const focus = sel ? places.filter(p => p.id === sel) : places;
    const reviews = [];
    for (const p of focus) { if (p.good) reviews.push([p, "good"]); if (p.bad) reviews.push([p, "bad"]); }

    fill($("listVideos"), places, videoCard);
    fill($("listReviews"), reviews, reviewCard);
    $("cntVideos").textContent = `${places.length}편`;
    $("cntReviews").innerHTML = (sel ? '<button class="reset" id="rs">전체 보기</button>' : "") + `<span>${reviews.length}건</span>`;
    $("cntPlaces").textContent = `${places.length}곳`;
    $("bigNum").textContent = nf(places.reduce((n, p) => n + p.used, 0));
    $("bigWrap").hidden = false;
    if (window.LesulinIntroMap) window.LesulinIntroMap.show(places, sel);
  }

  function syncChips() {
    $("pickCnt").textContent = `즐겨찾기 ${picked.length} / ${MAX}`;
    for (const b of document.querySelectorAll("#chips [data-id]")) {
      b.setAttribute("aria-pressed", picked.includes(b.dataset.id) ? "true" : "false");
    }
  }

  function renderChips() {
    const box = $("chips");
    box.textContent = "";
    for (const c of D.creators) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.dataset.id = c.id; b.setAttribute("aria-pressed", "false");
      const img = document.createElement("img");
      img.src = `img/ch/${encodeURIComponent(c.id)}.jpg`; img.alt = ""; img.loading = "lazy";
      const name = document.createElement("span"); name.textContent = c.name;
      const n = document.createElement("small"); n.textContent = nf(c.stores);
      b.append(img, name, n);
      b.addEventListener("click", () => {
        const i = picked.indexOf(c.id);
        if (i >= 0) picked.splice(i, 1);                 // 다시 누르면 해제
        else {
          if (picked.length >= MAX) picked.shift();      // 4번째를 고르면 가장 먼저 고른 사람이 빠집니다
          picked.push(c.id);
        }
        sel = null;
        syncChips(); render();
      });
      box.append(b);
    }
  }

  /* 카드를 누르면 그 식당 하나만(링크를 누른 건 그대로 이동). 같은 걸 다시 누르면 풀립니다. */
  function choose(id) { sel = sel === id ? null : id; render(); }
  window.LesulinIntroChoose = choose;          // 지도 핀도 같은 동작
  document.addEventListener("click", e => {
    if (e.target.closest("#rs")) { sel = null; render(); return; }
    const card = e.target.closest(".vcard,.rcard");
    if (!card || e.target.closest("a")) return;
    choose(card.dataset.store);
  });
  document.addEventListener("keydown", e => {
    const card = e.target.closest && e.target.closest(".vcard,.rcard");
    if (card && (e.key === "Enter" || e.key === " ") && !e.target.closest("a")) { e.preventDefault(); choose(card.dataset.store); }
  });

  /* 데이터가 오기 전이나 불러오기에 실패했을 때 저장하면 전에 골라 둔 유튜버가 [] 로 지워집니다 */
  const savePicks = () => { if (loaded) safeSet(picked); };
  window.LesulinIntroSave = savePicks;
  $("go").addEventListener("click", () => { savePicks(); location.href = "/map.html"; });
  /* 링크로 나가도(상단 "맛집 지도 보러가기", 식당 이름, 지도 핀) 방금 고른 것을 남깁니다 */
  document.addEventListener("click", e => {
    const a = e.target.closest('a[href^="/map.html"]');
    if (a) savePicks();
  }, true);

  /* 방문 기록 — 지도(app.js)와 같은 키·형식으로 /api/track 에 보냅니다 */
  function newId() {
    return (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now())
      .replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  }
  function keepId(key, fallback) {
    try { let v = localStorage.getItem(key); if (!v) { v = newId(); localStorage.setItem(key, v); } return v; }
    catch { return fallback; }
  }
  const sid = keepId("lesulin.sid", "anon" + String(Date.now()).slice(-10));
  const vid = keepId("lesulin.vid", sid);
  try {
    fetch("/api/track", {
      method: "POST", headers: { "content-type": "application/json" }, keepalive: true,
      body: JSON.stringify({ hits: [{ event: "view", path: "/", session: sid, visitor: vid }] }),
    }).catch(() => {});
  } catch { /* 기록 실패는 화면에 영향을 주지 않습니다 */ }

  (async function boot() {
    try {
      const r = await fetch("/api/intro");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      D = await r.json();
      if (!D || !Array.isArray(D.creators) || !Array.isArray(D.places)) throw new Error("응답 형식");

      $("statStores").textContent = nf(D.meta.stores);
      $("statVideos").textContent = nf(D.meta.videos);
      $("statComments").textContent = nf(D.meta.comments);
      $("stats").hidden = false;

      const known = new Set(D.creators.map(c => c.id));
      /* 전에 고른 유튜버를 미리 선택 — 지금 있는 id 만, 최대 3명 */
      picked = safeGet().filter(id => known.has(id)).slice(0, MAX);
      renderChips(); syncChips();
      loaded = true;
      render();
    } catch {
      /* 예시를 못 불러와도 지도로는 갈 수 있어야 합니다 */
      $("stage").hidden = true;
    } finally {
      document.body.dataset.ready = "1";
    }
  })();
})();
