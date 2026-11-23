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
  const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  function fill(port, items, render, empty = "표시할 식당이 없습니다") {
    const still = !!sel || items.length < 4 || reduceMotion();     // 동작 줄이기 설정이면 복사본을 붙이지 않습니다
    port.classList.toggle("static", still);
    if (!items.length) { port.innerHTML = `<div class="empty">${empty}</div>`; return; }
    const html = items.map(x => render(x, false)).join("");
    const dup = still ? "" : items.map(x => render(x, true)).join("");
    port.innerHTML = `<div class="track" style="--dur:${Math.max(30, items.length * 9)}s">${html}${dup}</div>`;
  }

  const videoCard = (p, dup) => `
    <div class="vcard${dup ? " dup" : ""}" data-store="${esc(p.id)}" role="button" tabindex="${dup ? -1 : 0}"
         aria-pressed="${sel === p.id}"${dup ? ' aria-hidden="true"' : ""}>
      <a class="thumb vlink"${dup ? ' tabindex="-1"' : ""} href="${YT(p.video.id)}" target="_blank" rel="noreferrer" aria-label="${esc(p.video.title)} 유튜브에서 보기">
        <img src="img/vid/${encodeURIComponent(p.video.id)}.jpg" alt="" loading="lazy"
             onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${encodeURIComponent(p.video.id)}/hqdefault.jpg'">
        ${p.lvl ? `<span class="bd"><img src="/img/brand/badge-${p.lvl}.png" alt="">${LVL[p.lvl] || ""}</span>` : ""}
        <span class="who"><img class="av" src="img/ch/${encodeURIComponent(p.creatorId)}.jpg" alt="">${esc(creatorName(p.creatorId))}</span>
        ${p.video.dur ? `<span class="du">${esc(p.video.dur)}</span>` : ""}
      </a>
      <span class="vt"><a class="slink"${dup ? ' tabindex="-1"' : ""} href="${MAP(p.id)}">${esc(p.name)}</a></span>
      <span class="vm">${[esc(p.region), esc(p.category), `조회 ${views(p.video.views)}`,
          `반응 <b class="p">${nf(p.used)}</b>`, p.neg ? `쓴소리 <b class="n">${nf(p.neg)}</b>` : ""]
          .filter(Boolean).map(x => `<span>${x}</span>`).join("<i>·</i>")}</span>
    </div>`;

  const reviewCard = ([p, kind], dup) => {
    const q = p[kind];
    return `
    <div class="rcard${dup ? " dup" : ""}" data-store="${esc(p.id)}" data-kind="${kind}" role="button" tabindex="${dup ? -1 : 0}"
         aria-pressed="${sel === p.id}"${dup ? ' aria-hidden="true"' : ""}>
      <span class="tag ${kind === "good" ? "p" : "n"}">${kind === "good" ? "좋았다는 이야기" : "아쉬웠다는 이야기"}</span>
      <q>"${esc(cut(q.text))}"</q>
      <small>${esc(p.name)} · 유튜브 댓글${q.likes ? ` · 좋아요 ${nf(q.likes)}` : ""}${q.wait ? " · 웨이팅 언급" : ""}
        · <a class="olink"${dup ? ' tabindex="-1"' : ""} href="${YT(q.vid)}" target="_blank" rel="noreferrer">원문 ↗</a></small>
    </div>`;
  };

  function render() {
    const places = shownPlaces();
    const focus = sel ? places.filter(p => p.id === sel) : places;
    const reviews = [];
    for (const p of focus) { if (p.good) reviews.push([p, "good"]); if (p.bad) reviews.push([p, "bad"]); }

    fill($("listVideos"), places, videoCard);
    /* 또간집·히밥처럼 자기 영상에서 고른 댓글이 없는 유튜버만 고르면 — 식당은 있는데 댓글이 없는 것 */
    fill($("listReviews"), reviews, reviewCard,
         places.length ? "이 유튜버 영상에서 고른 방문 후기가 아직 없습니다" : "표시할 식당이 없습니다");
    $("selbar").hidden = !sel;
    $("bigNum").textContent = nf(places.reduce((n, p) => n + p.used, 0));
    $("bigWrap").hidden = false;
    if (window.LesulinIntroMap) window.LesulinIntroMap.show(places, sel);
    /* 지도에서 고른 식당이 1번 칸 아래쪽에 있으면 그 카드가 보이게 옮깁니다(칸 안에서만 스크롤) */
    if (sel) {
      const port = $("listVideos"), card = port.querySelector(`.vcard[data-store="${CSS.escape(sel)}"]:not(.dup)`);
      if (card) port.scrollTop = Math.max(0, card.offsetTop - 12);
    }
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

  /* ── 3번 칸 카카오맵 ──
     키는 지도 화면과 같은 /api/mapkey 에서 받습니다(도메인 등록됨). 못 불러오면 식당 이름 목록만 둡니다.
     칸이 바뀔 때마다 핀을 전부 지우고 다시 그려서 지난 선택의 핀이 남지 않게 합니다. */
  const KAKAO_TO = p => `https://map.kakao.com/link/to/${encodeURIComponent(p.name)},${p.lat},${p.lng}`;
  window.LesulinIntroMap = (() => {
    let map = null, pins = [], last = null, failed = false;

    function list(places) {
      $("introMapList").innerHTML = places.length
        ? places.map(p => `<a href="${MAP(p.id)}">${esc(p.name)}<small>${esc(p.region)}</small></a>`).join("")
        : '<div class="empty">표시할 식당이 없습니다</div>';
    }
    function popup(places, selId) {
      const p = selId && places.find(x => x.id === selId);
      const box = $("place");
      if (!p) { box.hidden = true; box.innerHTML = ""; return; }
      box.innerHTML = `<button class="x" id="px" aria-label="닫기">×</button><h3>${esc(p.name)}</h3>
        <p>${esc(p.region)} · ${esc(p.category)} · 반응 ${nf(p.used)}</p>
        <div class="row"><a class="btn pri" href="${MAP(p.id)}">지도에서 보기</a>
          <a class="btn route" href="${KAKAO_TO(p)}" target="_blank" rel="noreferrer">길찾기</a>
          <a class="btn" href="${YT(p.video.id)}" target="_blank" rel="noreferrer">영상</a></div>`;
      box.hidden = false;
      $("px").addEventListener("click", () => choose(p.id));      // 같은 식당을 다시 고르면 풀립니다
    }
    /* 화면에서 44px 안에 겹치는 핀은 묶음 하나로(지도 화면의 묶음과 같은 방식).
       지도가 움직이거나 확대될 때마다(idle) 다시 묶습니다. */
    function regroup() {
      if (!map || !last) return;
      pins.forEach(o => o.setMap(null)); pins = [];
      const proj = map.getProjection(), groups = [];
      for (const p of last.places) {
        const ll = new kakao.maps.LatLng(p.lat, p.lng), pt = proj.containerPointFromCoords(ll);
        const g = groups.find(g => Math.hypot(g.x - pt.x, g.y - pt.y) < 44);
        if (g) g.items.push(p); else groups.push({ x: pt.x, y: pt.y, items: [p] });
      }
      for (const g of groups) {
        const el = document.createElement("button");
        el.type = "button";
        let pos;
        if (g.items.length === 1) {
          const p = g.items[0];
          pos = new kakao.maps.LatLng(p.lat, p.lng);
          el.className = "ipin" + (p.id === last.selId ? " sel" : "");
          el.dataset.store = p.id; el.setAttribute("aria-label", p.name);
          el.innerHTML = `<img src="img/ch/${encodeURIComponent(p.creatorId)}.jpg" alt="">`;
          el.addEventListener("click", e => { e.stopPropagation(); choose(p.id); });
        } else {
          const lat = g.items.reduce((n, p) => n + p.lat, 0) / g.items.length;
          const lng = g.items.reduce((n, p) => n + p.lng, 0) / g.items.length;
          pos = new kakao.maps.LatLng(lat, lng);
          el.className = "icluster" + (g.items.some(p => p.id === last.selId) ? " sel" : "");
          el.dataset.stores = g.items.map(p => p.id).join(",");
          el.textContent = String(g.items.length);
          el.setAttribute("aria-label", `${g.items.length}곳 묶음, 확대`);
          el.addEventListener("click", e => {
            e.stopPropagation();
            const b = new kakao.maps.LatLngBounds();
            g.items.forEach(p => b.extend(new kakao.maps.LatLng(p.lat, p.lng)));
            const lv = map.getLevel();
            map.setBounds(b, 60, 60, 60, 60);
            if (map.getLevel() >= lv) map.setLevel(Math.max(1, lv - 2), { anchor: pos });   // 한 점에 몰려 있어도 확대
          });
        }
        const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, clickable: true, zIndex: el.classList.contains("sel") ? 5 : 2 });
        ov.setMap(map); pins.push(ov);
      }
    }
    function draw(places, selId) {
      if (!places.length) { pins.forEach(o => o.setMap(null)); pins = []; return; }
      const p = selId && places.find(x => x.id === selId);
      if (p) { map.setLevel(Math.min(map.getLevel(), 5)); map.panTo(new kakao.maps.LatLng(p.lat, p.lng)); }
      else if (places.length === 1) { map.setLevel(6); map.setCenter(new kakao.maps.LatLng(places[0].lat, places[0].lng)); }
      else {
        const bounds = new kakao.maps.LatLngBounds();
        places.forEach(x => bounds.extend(new kakao.maps.LatLng(x.lat, x.lng)));
        map.setBounds(bounds, 50, 50, 50, 50);
      }
      regroup();
    }
    function show(places, selId) {
      last = { places, selId };
      popup(places, selId);
      if (failed) list(places);
      else if (map) draw(places, selId);
    }
    function fail() {
      failed = true;
      $("zoom").hidden = true; $("introMapList").hidden = false;
      if (last) list(last.places);
    }
    (async function init() {
      try {
        const { key } = await (await fetch("/api/mapkey")).json();
        if (!key) throw new Error("지도 키 없음");
        await new Promise((ok, no) => {
          const sc = document.createElement("script");
          sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
          sc.onload = ok; sc.onerror = no;
          document.head.append(sc);
          setTimeout(() => no(new Error("지도 시간 초과")), 10000);
        });
        await new Promise(ok => kakao.maps.load(ok));
        map = new kakao.maps.Map($("introMap"), { center: new kakao.maps.LatLng(36.4, 127.9), level: 13 });
        $("iZin").onclick = () => map.setLevel(map.getLevel() - 1);
        $("iZout").onclick = () => map.setLevel(map.getLevel() + 1);
        $("zoom").hidden = false;
        new ResizeObserver(() => map.relayout()).observe($("introMap"));
        kakao.maps.event.addListener(map, "idle", regroup);
        /* 만들자마자 setBounds 로 옮기면 처음 타일 로딩이 끊겨, 칸 오른쪽에 낮은 배율 타일이
           흐릿하게 남았습니다. 첫 타일이 다 깔린 뒤에 식당 위치로 옮깁니다. */
        await new Promise(ok => {
          const done = () => { kakao.maps.event.removeListener(map, "tilesloaded", done); ok(); };
          kakao.maps.event.addListener(map, "tilesloaded", done);
          setTimeout(ok, 3000);
        });
        if (last) draw(last.places, last.selId);
      } catch { fail(); }
    })();
    return { show };
  })();

  /* 데이터가 오기 전이나 불러오기에 실패했을 때 저장하면 전에 골라 둔 유튜버가 [] 로 지워집니다 */
  const savePicks = () => { if (loaded) safeSet(picked); };
  window.LesulinIntroSave = savePicks;
  /* 지도로 나가는 링크(상단 "맛집 지도 보러가기", 식당 이름, 지도 카드)를 누르면 방금 고른 것을 남깁니다 */
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
      document.querySelector(".picker .hd").hidden = true;    // 칩 없이 "즐겨찾기 0 / 3"만 남지 않게
      $("chips").hidden = true;
    } finally {
      document.body.dataset.ready = "1";
    }
  })();
})();
