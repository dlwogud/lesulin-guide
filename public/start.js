"use strict";
/* 시작 화면 — /api/showcase 로 예시 식당과 유튜버 목록을 채웁니다.
 *
 * 숫자는 전부 API 에서 옵니다. 고른 유튜버는 지도와 같은 localStorage 키
 * (lesulin.fav, 유튜버 id 의 JSON 배열)에 저장해서 지도가 그대로 읽습니다. */
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
  const views = n => n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "만"
                   : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "천" : String(n);
  const dateK = d => String(d).replace(/-/g, ".");
  const YT = id => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;

  let picked = [];          // 고른 순서대로
  let known = new Set();    // 지금 있는 유튜버 id

  function syncCount(warn) {
    const el = $("pickCnt");
    el.textContent = `${picked.length} / ${MAX}`;
    el.classList.toggle("warn", !!warn);
    if (warn) setTimeout(() => el.classList.remove("warn"), 900);
    for (const b of document.querySelectorAll("#chips [data-id]")) {
      b.setAttribute("aria-pressed", picked.includes(b.dataset.id) ? "true" : "false");
    }
  }

  function renderChips(creators) {
    const box = $("chips");
    box.textContent = "";
    for (const c of creators) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.id = c.id;
      b.setAttribute("aria-pressed", "false");
      const img = document.createElement("img");
      img.src = `img/ch/${encodeURIComponent(c.id)}.jpg`; img.alt = ""; img.loading = "lazy";
      const name = document.createElement("span"); name.textContent = c.name;
      const n = document.createElement("s"); n.textContent = `${nf(c.stores)}곳`;
      b.append(img, name, n);
      b.addEventListener("click", () => {
        const i = picked.indexOf(c.id);
        if (i >= 0) picked.splice(i, 1);
        else if (picked.length >= MAX) return syncCount(true);   // 4번째는 받지 않습니다
        else picked.push(c.id);
        syncCount(false);
      });
      box.append(b);
    }
  }

  function fillExample(d) {
    const { store, video, good, bad } = d;
    if (!store) { $("ex").hidden = true; return; }

    if (video) {
      $("exThumb").href = YT(video.id);
      $("exThumbImg").src = `img/vid/${encodeURIComponent(video.id)}.jpg`;
      $("exTitle").href = YT(video.id);
      $("exTitle").textContent = video.title;
      $("exChImg").src = `img/ch/${encodeURIComponent(video.creatorId)}.jpg`;
      $("exVideoMeta").textContent = `${video.creatorName} · 조회 ${views(video.views)} · ${dateK(video.at).slice(0, 7)}`;
    } else {
      $("exVideo").hidden = true;
    }

    $("exVisits").textContent = `${nf(store.visits)}건`;
    $("exCountNote").textContent = `수집한 댓글 ${nf(store.commentsAll)}건 중, 다녀온 경험을 적은 댓글`;

    const quote = (box, textEl, metaEl, q, extra) => {
      if (!q) { $(box).hidden = true; return; }
      $(textEl).textContent = `"${q.text.length > 95 ? q.text.slice(0, 94).trimEnd() + "…" : q.text}"`;
      const meta = $(metaEl);
      meta.textContent = `유튜브 댓글 · ${dateK(q.at)} · 좋아요 ${nf(q.likes)}${extra ? " · " + extra : ""} · `;
      if (video) {
        const a = document.createElement("a");
        a.href = YT(video.id); a.target = "_blank"; a.rel = "noreferrer";
        a.textContent = "영상에서 원문 보기 ↗";
        meta.append(a);
      }
    };
    quote("exGood", "exGoodText", "exGoodMeta", good, "");
    quote("exBad", "exBadText", "exBadMeta", bad, store.waits > 0 ? `웨이팅을 언급한 댓글 ${nf(store.waits)}건` : "");

    $("exName").textContent = store.name;
    $("exWhere").textContent = ` ${store.region} · ${store.category}`;
    $("exMap").href = `/map.html?store=${encodeURIComponent(store.id)}`;
    /* 지도 상세(app.js)의 카카오맵 길찾기와 같은 형식 */
    $("exRoute").href = `https://map.kakao.com/link/to/${encodeURIComponent(store.name)},${store.lat},${store.lng}`;
  }

  function go(ids) {
    safeSet(ids);
    location.href = "/map.html";
  }

  $("go").addEventListener("click", () => go(picked));
  $("skip").addEventListener("click", () => go([]));

  (async function boot() {
    try {
      const r = await fetch("/api/showcase");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (!d || !Array.isArray(d.creators)) throw new Error("응답 형식");

      known = new Set(d.creators.map(c => c.id));
      /* 전에 고른 유튜버를 미리 선택 — 지금 있는 id 만, 최대 3명 */
      picked = safeGet().filter(id => known.has(id)).slice(0, MAX);
      renderChips(d.creators);
      syncCount(false);

      if (d.meta) {
        $("lead").textContent =
          `유튜버 ${nf(d.meta.creators)}명의 영상 ${nf(d.meta.videos)}편과, 그 영상에 "다녀왔다"고 적은 댓글을 함께 봅니다.`;
      }
      fillExample(d);
    } catch {
      /* 예시를 못 불러와도 지도로는 갈 수 있어야 합니다 */
      $("ex").hidden = true;
    } finally {
      document.body.dataset.ready = "1";
    }
  })();
})();
