"use strict";
/* 르슐랭 가이드 — 카카오맵 위에 올린 버전.
   아티팩트(claude.ai)에서는 CSP가 dapi.kakao.com 스크립트와 daumcdn 타일을 막아
   이 화면이 뜨지 않습니다. 로컬(또는 도메인 등록한 호스트)에서만 동작합니다. */

const $ = id => document.getElementById(id);
let SEED, stores, creators, CRE, META;
let q = "", picked = new Set(), region = null, cat = null, selected = null;
let onlyRated = false, onlyWait = false, minViews = 0, minEv = 0, sort = "score";   // 기본: 점수 높은 순(별 3개 → 2개 → 1개)
let fav = new Set();            // 내가 고른 유튜버(최대 10명) — 숨기지 않고 위로 올립니다
let kmap = null, lastPinch = 0;
/* 핀·묶음 오버레이를 키로 보관해 다시 씁니다 (키: 묶인 식당 id 들) */
const pinPool = new Map();

const esc = t => String(t).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
const nfm = n => n.toLocaleString("ko-KR");
const views = n => n >= 10000 ? (n/10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/,"") + "만회"
                 : n >= 1000 ? (n/1000).toFixed(1).replace(/\.0$/,"") + "천회" : n + "회";
const dateK = d => d.replace(/-/g, ".");
const chImg = id => `img/ch/${id}.jpg`;
const vdImg = id => `img/vid/${id}.jpg`;
const YT = id => "https://www.youtube.com/watch?v=" + id;
const topVid = s => s.vids[0];
const rated = s => s.status === "RATED";
const sido = r => r.split(" ")[0];          // "부산광역시 해운대구" → "부산광역시"
const stem = s => s.replace(/(특별자치도|특별자치시|특별시|광역시|도)$/, "");
const shortRegion = r => {
  const [a, ...b] = r.split(" ");
  const h = stem(a).replace(/^(전라|경상|충청)(남|북)?$/, (m,p,d) => p[0] + (d||""));
  return b.length ? h + " " + b.join(" ") : h;
};
const LVL = { 1:"들러볼 곳", 2:"우회해도 갈 곳", 3:"이곳을 위해" };
const ASPECT_LABEL = { "대기":"대기 없음" };
/* 조회수 슬라이더: 1천~1000만을 로그로 펼칩니다 */
const subsK = n => n >= 10000 ? "구독 " + (n/10000).toFixed(n >= 1000000 ? 0 : 0).replace(/\.0$/,"") + "만"
                : "구독 " + nfm(n);
const sliderToViews = v => v <= 0 ? 0 : Math.round(1000 * Math.pow(10, (v/100) * 4));

/* ══ 필터 ══ */
/* 지도를 움직일 때마다 drawPins가 filtered()를 다시 부릅니다.
   필터가 그대로면 같은 결과라 1,512곳을 다시 걸러 정렬할 이유가 없습니다. */
let fCache = null, fKey = "";
function filtered() {
  const k = [q.trim(), [...picked].sort().join(), region, cat, onlyRated, onlyWait,
             minViews, minEv, sort, [...fav].sort().join()].join("|");
  if (k === fKey && fCache) return fCache;
  fKey = k; fCache = filteredRaw();
  return fCache;
}
function filteredRaw() {
  const t = q.trim().toLowerCase();
  const out = stores.filter(s => {
    if (onlyRated && !rated(s)) return false;
    if (onlyWait && !(s.waitN >= 3)) return false;
    if (picked.size && !s.cs.some(c => picked.has(c))) return false;
    /* region 은 시군구("부산광역시 해운대구") 또는 시·도("부산광역시") */
    if (region && s.r !== region && sido(s.r) !== region) return false;
    if (cat && catGroup(s) !== cat) return false;
    if (minEv && (s.cUsed || 0) < minEv) return false;
    if (minViews && Math.max(0, ...s.vids.map(v => v.vw || 0)) < minViews) return false;
    if (t) {
      const hay = (s.n + " " + s.addr + " " + s.r + " " + shortRegion(s.r) + " " + s.cat + " " + (catGroup(s) || "") + " "
        + s.cs.map(i => CRE.get(i).n).join(" ") + " " + s.vids.map(v => v.t).join(" ")).toLowerCase();
      /* 띄어 쓴 낱말은 순서와 상관없이 모두 들어 있으면 됩니다 ("해운대 국밥") */
      if (!t.split(/\s+/).every(w => hay.includes(w))) return false;
    }
    return true;
  });
  const by = {
    ev:     (a,b) => b.cUsed - a.cUsed || b.cVisit - a.cVisit,
    score:  (a,b) => (b.sc ?? -1) - (a.sc ?? -1) || b.cUsed - a.cUsed,
    neg:    (a,b) => (b.negN ?? -1) - (a.negN ?? -1) || b.cUsed - a.cUsed,
    wait:   (a,b) => (b.waitN ?? -1) - (a.waitN ?? -1) || b.cUsed - a.cUsed,
    views:  (a,b) => (topVid(b)?.vw||0) - (topVid(a)?.vw||0),
    recent: (a,b) => (topVid(b)?.at||"").localeCompare(topVid(a)?.at||""),
    name:   (a,b) => a.n.localeCompare(b.n, "ko"),
  }[sort];
  /* 고른 유튜버(내 유튜버) 식당은 거르지도, 위로 올리지도 않습니다(11/23 결정).
     정렬은 고른 기준 그대로(기본: 점수 높은 순)라 별 3개 식당이 늘 맨 위에 보이고,
     내 유튜버 식당은 카드의 "내 유튜버" 표시와 지도 핀의 주황 테두리로만 구분합니다. */
  return out.sort(by);
}

/* ══ 카카오맵 ══ */
function initMap() {
  kmap = new kakao.maps.Map($("kmap"), {
    center: new kakao.maps.LatLng(36.5, 127.8), level: 13,
  });
  /* 카카오 클러스터러 대신 직접 묶습니다. 기본 마커를 숨기고 프로필 핀만 남기려면
     그 편이 깔끔하고, 화면 거리 기준이라 줌에 따라 자연스럽게 풀립니다. */
  kakao.maps.event.addListener(kmap, "idle", () => drawPins());

  /* 맥 트랙패드 핀치는 ctrlKey 가 붙은 wheel 로 들어옵니다.
     카카오 지도는 이걸 안 받아서, 막지 않으면 브라우저가 페이지 전체를 확대·축소합니다.
     커서 위치를 기준점으로 삼아 지도 줌으로 돌려 줍니다. */
  $("kmap").addEventListener("wheel", e => {
    if (!e.ctrlKey) return;                  // 일반 휠은 카카오가 알아서 처리
    e.preventDefault();
    const now = Date.now();
    if (now - lastPinch < 90) return;        // 핀치는 이벤트가 촘촘해 그대로 쓰면 너무 빨리 튑니다
    lastPinch = now;
    const r = $("kmap").getBoundingClientRect();
    const anchor = kmap.getProjection().coordsFromContainerPoint(
      new kakao.maps.Point(e.clientX - r.left, e.clientY - r.top));
    const next = Math.min(14, Math.max(1, kmap.getLevel() + (e.deltaY > 0 ? 1 : -1)));
    kmap.setLevel(next, { anchor, animate: false });
  }, { passive: false });

  drawPins(true);
}

const CLUSTER_PX = 44;

/* 핀에 어느 얼굴을 올릴지.
   한 식당을 여러 유튜버가 소개했으면, 내가 고른 사람을 먼저 보여 줍니다.
   전에는 늘 cs[0] 이라서 유튜버를 바꿔도 지도가 그대로였습니다. */
const faceOf = s => s.cs.find(c => fav.has(c)) || s.cs[0];
const isMine = s => fav.size > 0 && s.cs.some(c => fav.has(c));

function drawPins(fit) {
  if (!kmap) return;
  const list = filtered();

  if (fit && list.length) {
    const b = new kakao.maps.LatLngBounds();
    for (const s of list) b.extend(new kakao.maps.LatLng(s.lat, s.lng));
    kmap.setBounds(b, 60, 60, 60, 60);
  }

  /* 화면 밖은 아예 계산하지 않습니다.
     식당이 1,512곳이 되고부터 이게 체감 차이를 만듭니다 —
     전에는 전부 카카오 투영 API(containerPointFromCoords)로 돌려서
     지도를 움직일 때마다 1,512번 호출됐습니다. */
  const bb = kmap.getBounds(), sw = bb.getSouthWest(), ne = bb.getNorthEast();
  const la0 = sw.getLat(), la1 = ne.getLat(), ln0 = sw.getLng(), ln1 = ne.getLng();
  const W = $("kmap").clientWidth, H = $("kmap").clientHeight;
  const dla = la1 - la0, dln = ln1 - ln0;
  if (!(dla > 0 && dln > 0)) return;
  const mLa = dla * (90 / H), mLn = dln * (90 / W);        // 화면 밖 90px까지는 남겨 둡니다
  /* 픽셀 좌표는 경계로 직접 환산합니다. 한 화면 안에서 메르카토르 왜곡은
     묶을지 말지 가리는 데 영향을 줄 정도가 아닙니다. 표시 위치는 아래에서
     실제 위·경도를 그대로 쓰므로 핀이 어긋나지 않습니다. */
  const px = s => ({ x: (s.lng - ln0) / dln * W, y: (1 - (s.lat - la0) / dla) * H });

  const near = [];
  for (const s of list) {
    if (s.lat < la0 - mLa || s.lat > la1 + mLa || s.lng < ln0 - mLn || s.lng > ln1 + mLn) {
      if (s.id !== selected) continue;
    }
    near.push(s);
  }

  /* 묶는 거리를 화면 안 식당 수에 맞춰 늘립니다.
     서울을 확대하면 화면에 900곳이 들어와 핀이 100개를 넘고, 그러면
     지도를 움직일 때마다 그만큼의 DOM 이 따라다녀 체감이 떨어집니다.
     많을 때는 넓게 묶어 핀을 80개 안쪽으로 유지합니다. */
  const cpx = near.length > 600 ? CLUSTER_PX * 1.7
            : near.length > 300 ? CLUSTER_PX * 1.35
            : CLUSTER_PX;

  /* 격자에 담아 묶습니다. 전에는 후보 묶음을 전부 훑어서 n×묶음 수만큼 비교했습니다. */
  const cell = new Map(), groups = [];
  const key = (x, y) => ((x / cpx) | 0) + "," + ((y / cpx) | 0);
  for (const s of near) {
    const p = px(s);
    if (s.id === selected) { groups.push({ items: [s], lat: s.lat, lng: s.lng, fixed: true }); continue; }
    const gx = (p.x / cpx) | 0, gy = (p.y / cpx) | 0;
    let hit = null;
    for (let dx = -1; dx <= 1 && !hit; dx++)
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const g = cell.get((gx + dx) + "," + (gy + dy));
        if (g && Math.hypot(g.p.x - p.x, g.p.y - p.y) < cpx) hit = g;
      }
    if (hit) {
      const n = hit.items.push(s);
      hit.p = { x: (hit.p.x * (n - 1) + p.x) / n, y: (hit.p.y * (n - 1) + p.y) / n };
      hit.lat = (hit.lat * (n - 1) + s.lat) / n;
      hit.lng = (hit.lng * (n - 1) + s.lng) / n;
    } else {
      const g = { items: [s], p, lat: s.lat, lng: s.lng };
      groups.push(g); cell.set(key(p.x, p.y), g);
    }
  }

  /* 오버레이를 버리지 않고 재사용합니다.
     전에는 지도를 멈출 때마다 핀 100여 개를 전부 지우고 새로 만들었습니다.
     그때마다 img 100여 개가 다시 붙어서 드래그를 멈춘 순간 걸렸습니다. */
  const want = new Set();
  for (const g of groups) {
    const pos = new kakao.maps.LatLng(g.lat, g.lng);      // 실제 좌표 — 역변환하지 않습니다
    g.key = g.items.length > 1
      ? "c:" + g.items.length + ":" + g.items.map(s => s.id).sort().join(",")
      : "p:" + g.items[0].id + (g.items[0].id === selected ? ":sel" : "");
    want.add(g.key);
    const hit = pinPool.get(g.key);
    if (hit) { hit.ov.setPosition(pos); continue; }        // 이미 있으면 위치만 옮깁니다

    const box = document.createElement("div");
    if (g.items.length > 1) {
      const r = 16 + Math.min(g.items.length, 10);
      // 그 묶음에서 가장 많은 채널의 얼굴을 얹습니다
      const tally = {};
      for (const s of g.items) for (const c of s.cs) tally[c] = (tally[c] || 0) + 1;
      // 내가 고른 유튜버가 묶음 안에 있으면 그 사람을 얹습니다
      const picks = Object.keys(tally).filter(c => fav.has(c));
      const pool = picks.length ? picks : Object.keys(tally);
      const top = pool.sort((a, b) => tally[b] - tally[a])[0];
      const mineN = g.items.filter(isMine).length;
      box.className = "kcluster" + (mineN ? " mine" : "");
      box.style.cssText = `width:${r * 2}px;height:${r * 2}px`;
      box.innerHTML = `<img src="${chImg(top)}" alt="">
        <span class="n" style="font-size:${Math.max(10, r * .6).toFixed(1)}px">${g.items.length}</span>`;
      box.onclick = () => {
        const b = new kakao.maps.LatLngBounds();
        for (const s of g.items) b.extend(new kakao.maps.LatLng(s.lat, s.lng));
        kmap.setBounds(b, 80, 80, 80, 80);
      };
      const ov = new kakao.maps.CustomOverlay({ position: pos, content: box, clickable: true, zIndex: 2 });
      ov.setMap(kmap); pinPool.set(g.key, { ov });
    } else {
      const s = g.items[0], on = s.id === selected, cr = CRE.get(faceOf(s));
      box.className = "pinbox" + (on ? " sel" : "") + (isMine(s) ? " mine" : "");
      box.innerHTML = `<img src="${chImg(cr.id)}" alt="${esc(cr.n)}">
        ${s.lvl ? `<img class="lv" src="/img/brand/badge-${s.lvl}.png" alt="${LVL[s.lvl]}">` : ""}
        <span class="tail"></span>
        ${on ? `<span class="nm">${esc(s.n)}</span>` : ""}`;
      box.onclick = e => { e.stopPropagation(); select(s.id); };
      const ov = new kakao.maps.CustomOverlay({ position: pos, content: box, yAnchor: 1,
                                                clickable: true, zIndex: on ? 10 : 3 });
      ov.setMap(kmap); pinPool.set(g.key, { ov });
    }
  }
  /* 화면에서 사라진 것만 떼어 냅니다. 풀이 너무 커지면 비웁니다 —
     계속 모으면 메모리가 늘어납니다. */
  for (const [k, v] of pinPool) {
    if (!want.has(k)) { v.ov.setMap(null); pinPool.delete(k); }
  }
}

/* ══ 우측 ══ */
/* 결과 카드를 한 번에 514개 그리면 DOM이 1만 개가 되어 지도까지 버벅입니다.
   보이는 만큼만 그리고, 아래로 내려가면 이어 붙입니다. */
const PAGE = 24;
let listCache = [], listShown = 0;

/* 업종 원문이 "육류,고기요리"처럼 쉼표 뒤가 붙어 있어 띄워서 보여줍니다 */
const catText = c => String(c).replace(/\s*,\s*/g, ", ");

function cardHTML(s, i) {
  const v = topVid(s);
  /* 둘 이상이 간 집은 56곳이고 전부 2명이라 "외 1" 대신 그냥 나열합니다 */
  const crs = s.cs.map(id => CRE.get(id)).filter(Boolean)
    .sort((a, b) => (fav.has(b.id) ? 1 : 0) - (fav.has(a.id) ? 1 : 0));
  return `<button class="rcard" onclick="window.__sel('${s.id}')">
    <span class="img">
      ${v ? `<img src="${vdImg(v.id)}" alt="" loading="lazy" decoding="async" width="240" height="135">` : ""}
      ${s.lvl ? `<span class="lvchip"><img class="lvb" src="/img/brand/badge-${s.lvl}.png" alt="">${LVL[s.lvl]}</span>` : `<span class="rk">${i + 1}</span>`}
      <span class="ytstack">
        <span class="faces">${crs.map(c =>
          `<img src="${chImg(c.id)}" alt="${esc(c.n)}" width="18" height="18">`).join("")}</span>
        <span class="who">${crs.map(c => esc(c.h)).join(" · ")}</span></span>
      ${v && v.dur ? `<span class="durchip">${v.dur}</span>` : ""}
      ${fav.size && s.cs.some(c => fav.has(c)) ? `<span class="favchip">내 유튜버</span>` : ""}
    </span>
    <span class="rmeta"><span class="rtitle"><h5 class="t1">${esc(s.n)}</h5>${s.sc != null ? `<b class="rsc">${s.sc}점</b>` : ""}</span>
      <span class="rsub"><span>${esc(shortRegion(s.r))}</span>
      ${s.cat ? `<i class="dot"></i><span>${esc(catText(s.cat))}</span>` : ""}
      ${v ? `<i class="dot"></i><span>${views(v.vw)}</span>` : ""}</span>
      <span class="rsub">${rated(s) ? `<span class="ev">반응 ${s.cUsed}</span>${s.negN ? `<i class="dot"></i><span class="ng">쓴소리 ${s.negN}</span>` : ""}${s.waitN >= 3 ? `<i class="dot"></i><span class="wt">줄 ${s.waitN}</span>` : ""}`
                 : `<span>방문댓글 ${s.cVisit}</span>`}</span>
    </span></button>`;
}

function appendCards() {
  const box = $("results"); if (!box) return;
  const next = listCache.slice(listShown, listShown + PAGE);
  if (!next.length) return;
  box.insertAdjacentHTML("beforeend", next.map((s, k) => cardHTML(s, listShown + k)).join(""));
  listShown += next.length;
}

function renderResults() {
  listCache = filtered(); listShown = 0;
  $("panel").innerHTML = `
    <div class="panel-h"><b>${nfm(listCache.length)}<i>곳</i></b>
      <select id="sort">
        <option value="score">점수 높은 순</option>
        <option value="ev">방문 반응 많은 순</option>
        <option value="neg">쓴소리 많은 순</option>
        <option value="wait">줄 서는 집 순</option>
        <option value="views">조회수 많은 순</option>
        <option value="recent">최근 영상 순</option>
        <option value="name">이름순</option>
      </select></div>
    <div class="results" id="results">${listCache.length ? "" :
      `<p class="empty">조건에 맞는 식당이 없습니다.<br>필터를 풀어 보세요.</p>`}</div>`;
  $("sort").value = sort;
  $("sort").onchange = e => { sort = e.target.value; renderResults(); };
  const box = $("results");
  box.onscroll = () => {
    if (box.scrollTop + box.clientHeight > box.scrollHeight - 400) appendCards();
  };
  appendCards();
}

function renderDetail(s) {
  if (s.quotes === undefined) loadQuotes(s);       // 없으면 받아 옵니다
  const hero = topVid(s);
  const vids = s.vids.map(v => {
    const c = CRE.get(v.c);
    return `<a class="vid" href="${YT(v.id)}" target="_blank" rel="noreferrer">
      <span class="vthumb"><img src="${vdImg(v.id)}" alt="" loading="lazy"><span class="play">▶</span>
        ${v.dur ? `<span class="dur">${v.dur}</span>` : ""}</span>
      <span class="vinfo"><span class="vt t2">${esc(v.t)}</span>
        <span class="vc"><img src="${chImg(c.id)}" alt="">${esc(c.n)}</span>
        <span class="vm">${views(v.vw)} · ${dateK(v.at)}</span></span></a>`;
  }).join("");
  const body = rated(s) ? `
    <div class="blk"><p class="blk-t">방문자 반응 · 댓글 ${nfm(s.cUsed)}건 집계</p>
      <div class="aspects">${s.aspects.map(a => `<div class="asp">
        <span class="an">${ASPECT_LABEL[a.a] || a.a}</span>
        <span class="bar"><i class="p" style="width:${a.p}%"></i><i class="n" style="width:${100-a.p}%"></i></span>
        <span class="av">${a.p}% · ${a.n}건</span></div>`).join("")}</div>
      <p class="caveat">유튜브 댓글은 칭찬에 쏠려 있습니다 — 맛 항목 전체 96.2% 긍정.
        <b>반응의 양과 쓴소리</b>를 보세요.${s.waitN ? ` “대기 없음”이 낮을수록 줄을 섰다는 뜻입니다 — 이 집은 ${s.waitN}명이 기다렸다고 적었습니다.` : ""}</p>
      ${["pos","neg"].map(k => (s.quotes || {})[k] ? `<div class="quote">${esc(s.quotes[k].x)}
        <span class="qm"><span>유튜브 댓글</span><span>${dateK(s.quotes[k].at)}</span>${s.quotes[k].like ? `<span>좋아요 ${nfm(s.quotes[k].like)}</span>` : ""}</span></div>` : "").join("")}
    </div>`
    : `<div class="blk"><p class="blk-t">방문자 반응</p>
       <p class="note">아직 점수를 내지 않았습니다. 댓글 ${nfm(s.cTotal)}개 중 방문 경험을 밝힌 것이 ${s.cVisit}개라
       ${s.cVisit >= 5 ? "항목이 잡히지 않았습니다" : "최소 근거(5개)에 못 미칩니다"}. 근거가 모자라면 비워 둡니다.</p></div>`;

  /* 근거 요약 — 혼합 판정(규칙 + LLM)을 적용한 식당만. 줄을 누르면 근거 댓글 원문이 펼쳐집니다. */
  const ai = s.ai, sm = ai && ai.summary;
  const KIND = { good: "좋았다는 점", bad: "아쉬웠다는 점", tip: "가기 전에" };
  const aiBlk = !ai ? "" : `
    <div class="blk aisum"><p class="blk-t">방문 후기 요약 <span class="aitag">AI</span></p>
      ${sm && sm.status === "ok" ? sm.lines.map((l, i) => `<details class="ail ${l.kind}">
          <summary><span class="k">${KIND[l.kind] || ""}</span>${esc(l.text)}<span class="n">근거 ${l.commentIds.length}</span></summary>
          ${l.commentIds.map(id => ai.evidence[id] ? `<div class="quote">${esc(ai.evidence[id].x)}
            <span class="qm"><span>유튜브 댓글</span><span>${dateK(ai.evidence[id].at)}</span>${ai.evidence[id].like ? `<span>좋아요 ${nfm(ai.evidence[id].like)}</span>` : ""}</span></div>` : "").join("")}
        </details>`).join("")
        : `<p class="note">분석할 방문 언급 댓글이 부족함</p>`}
      <p class="aimeta">댓글 ${nfm(ai.visit.n)}개 판정 · 방문 언급 ${nfm(ai.visit.final_visit)}개 (규칙 ${nfm(ai.visit.rule_visit)} → 규칙+LLM 확인) · LLM 확인 ${nfm(ai.visit.routed)}개${sm && sm.model ? ` · ${esc(sm.model)}` : ""}</p>
    </div>`;
  const kakaoTo = `https://map.kakao.com/link/to/${encodeURIComponent(s.n)},${s.lat},${s.lng}`;
  $("panel").innerHTML = `
    <div class="det">
      <div class="det-hero">
        ${hero ? `<a class="det-open" href="${YT(hero.id)}" target="_blank" rel="noreferrer"
             aria-label="${esc(hero.t)} 유튜브에서 보기">
            <img src="${vdImg(hero.id)}" alt="">
            <span class="det-play">▶</span>
            ${hero.dur ? `<span class="det-dur">${hero.dur}</span>` : ""}
          </a>` : ""}
        <button class="det-back" onclick="window.__close()">&larr;</button></div>
      <div class="det-b">
        <div class="det-title">
          <div class="badges">
            ${s.sc != null ? `<span class="bdg s">${s.sc}점</span>` : ""}
            ${s.lvl ? `<span class="bdg c"><img class="lvb" src="/img/brand/badge-${s.lvl}.png" alt="">${LVL[s.lvl]}</span>` : ""}
            ${rated(s) ? `<span class="bdg t">방문 반응 ${s.cUsed}</span>` : `<span class="bdg n">근거 부족</span>`}
            ${s.waitN >= 3 ? `<span class="bdg w">줄 서는 집</span>` : ""}
            ${s.cat ? `<span class="bdg n">${esc(catText(s.cat))}</span>` : ""}
          </div>
          <h3>${esc(s.n)}</h3><p class="addr">${esc(s.addr || shortRegion(s.r))}</p>
        </div>
        ${aiBlk}
        <div class="blk"><p class="blk-t">소개한 영상 ${s.vids.length}편</p>${vids}</div>
        <div class="blk"><p class="blk-t">수집된 댓글</p>
          <dl class="kv">
            <div><dt>전체</dt><dd>${nfm(s.cTotal)}</dd></div>
            <div><dt>방문 명시</dt><dd>${nfm(s.cVisit)}</dd></div>
            <div><dt>집계됨</dt><dd>${nfm(s.cUsed)}</dd></div>
          </dl></div>
        ${body}
      </div>
      <div class="acts">
        <a class="pri" href="${kakaoTo}" target="_blank" rel="noreferrer">카카오맵 길찾기</a>
        <button class="sec" onclick="window.__askStore('${s.id}')">이 가게 물어보기</button>
      </div></div>`;
}

/* 대표 인용문은 /api/seed 에 담지 않습니다 — 전체의 33%(355KB)인데
   식당 하나를 열 때만 필요합니다. 그래서 열 때 받아 와서 채웁니다.
   받아오기 전에도 화면은 그대로 뜨고, 도착하면 인용문만 덧붙습니다. */
const quoteWait = new Set();
async function loadQuotes(s) {
  if (s.quotes !== undefined || quoteWait.has(s.id)) return;
  quoteWait.add(s.id);
  try {
    const r = await fetch(`/api/store/${encodeURIComponent(s.id)}`);
    if (!r.ok) { s.quotes = null; return; }
    const d = await r.json();
    s.quotes = d.quotes ?? null;
    s.ai = d.ai ?? null;               // AI 적용 식당만 값이 있음
    if (selected === s.id) renderDetail(s);        // 열려 있으면 다시 그립니다
  } catch { s.quotes = null; }
  finally { quoteWait.delete(s.id); }
}

function select(id) {
  const s = stores.find(v => v.id === id); if (!s) return;
  selected = id; renderDetail(s);
  if (kmap) { kmap.setLevel(4); kmap.panTo(new kakao.maps.LatLng(s.lat, s.lng)); drawPins(); }
}
window.__sel = select;
window.__close = () => { selected = null; renderResults(); drawPins(); };

/* ══ 좌측 ══ */
/* 지역은 검색으로만 고릅니다(왼쪽 위 지역 메뉴는 없앴습니다). 고른 지역은 검색창 안에 표시하고, 누르면 풉니다. */
function renderChips() {
  const c = $("rchip"); if (!c) return;
  c.hidden = !region;
  c.textContent = region ? shortRegion(region) : "";
}
/* ══ 선호 유튜버 고르기 ══ */
const FAV_KEY = "lesulin.fav";
const FAV_MAX = 10;

function loadFav() {
  try {
    const v = JSON.parse(localStorage.getItem(FAV_KEY) || "null");
    if (Array.isArray(v)) fav = new Set(v.filter(id => CRE.has(id)).slice(0, FAV_MAX));
    return v !== null;                       // 한 번이라도 고른(또는 건너뛴) 적이 있는가
  } catch { return false; }                  // 시크릿 창 등 저장소를 못 쓰는 경우
}
function saveFav() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...fav])); } catch {}
}
function renderFavGrid() {
  $("favGrid").innerHTML = creators.map(c => {
    const n = stores.filter(s => s.cs.includes(c.id)).length, on = fav.has(c.id);
    return `<button class="favcard${on?" on":""}"
        onclick="window.__fav('${c.id}')" aria-pressed="${on}">
      <img src="${chImg(c.id)}" alt="">
      <span><b>${esc(c.n)}</b><s>${c.subs ? subsK(c.subs) + " · " : ""}식당 ${n}곳</s></span></button>`;
  }).join("");
  $("favCnt").textContent = `${fav.size} / ${FAV_MAX}`;
  if ($("favReset")) $("favReset").hidden = !fav.size;
  /* 이미 고른 사람이 있으면 "그냥 둘러보기"가 무슨 뜻인지 헷갈립니다 */
  if ($("favSkip")) $("favSkip").textContent = fav.size ? "안 쓰고 닫기" : "그냥 둘러보기";
}
window.__fav = id => {
  if (fav.has(id)) fav.delete(id);                          // 다시 누르면 해제
  else {
    /* 4번째를 고르면 가장 먼저 고른 사람이 빠집니다 (Set 은 넣은 순서를 지킵니다) */
    if (fav.size >= FAV_MAX) fav.delete(fav.values().next().value);
    fav.add(id);
  }
  renderFavGrid();
};
function openFav() {
  if (!$("favWrap")) return;
  renderFavGrid(); $("favWrap").hidden = false;
}
/* record=true 일 때만 "물어봤다"고 기록합니다.
   바깥을 클릭하거나 Esc 로 닫은 것은 고른 게 아니므로 다음에 다시 묻습니다.
   전에는 어느 쪽이든 기록해서, 실수로 바깥을 한 번 누르면
   그 뒤로 영원히 안 뜨었습니다. */
function closeFav(record) {
  if ($("favWrap")) $("favWrap").hidden = true;
  if (record) { saveFav(); dropYtParam(); }
  favChanged();
}
function syncFavBtn() {
  if ($("favEdit")) $("favEdit").textContent =
    fav.size ? `내 유튜버 ${fav.size}명 바꾸기` : "내 유튜버 고르기";
  if ($("favClear")) $("favClear").hidden = !fav.size;
}
function clearFav() {                         // 고른 유튜버를 모두 풉니다
  fav.clear(); saveFav(); dropYtParam(); favChanged();
}
/* 내 유튜버가 바뀌면 핀을 새로 그립니다.
   핀은 식당 번호로 재사용하므로(drawPins), 그대로 두면 이미 그려진 핀이
   주황 테두리(mine)와 예전 얼굴을 계속 달고 있습니다. */
function favChanged() {
  for (const v of pinPool.values()) v.ov.setMap(null);
  pinPool.clear();
  syncFavBtn(); renderCres(); refresh(false);
}
/* 시작 화면에서 넘어온 ?yt= 는 첫 화면에만 씁니다. 지도에서 직접 바꾼 뒤에도 주소에 남으면
   새로고침할 때 해제한 유튜버가 다시 살아납니다. 이후로는 브라우저 저장값이 기준입니다. */
function dropYtParam() {
  const u = new URL(location.href);
  if (!u.searchParams.has("yt")) return;
  u.searchParams.delete("yt");
  history.replaceState(history.state, "", u.pathname + u.search + u.hash);
}

const CRE_SHOWN = 5;             // 10명을 다 펼치면 왼쪽 칸이 너무 길어집니다
let creOpen = false;
window.__creMore = () => { creOpen = !creOpen; renderCres(); };

function renderCres() {
  /* 내가 고른 사람과 지금 켜 둔 사람을 위로 올립니다 —
     접힌 상태에서 켜 둔 채널이 안 보이면 왜 걸러졌는지 알 수 없습니다. */
  const rank = c => (fav.has(c.id) ? 0 : 2) - (picked.has(c.id) ? 1 : 0);
  const ord = [...creators].sort((a, b) => rank(a) - rank(b));
  const shown = creOpen ? ord : ord.slice(0, CRE_SHOWN);
  const rest = ord.slice(shown.length);

  const row = c => {
    const on = picked.has(c.id);
    return `<button class="ytrow${on?" on":""}" onclick="window.__cre('${c.id}')" aria-pressed="${on}">
      <img src="${chImg(c.id)}" alt="">
      <span class="nm"><b class="t1">${esc(c.n)}</b><span class="t1">${esc(c.handle||"")}</span></span>
      </button>`;
  };
  $("cres").innerHTML = shown.map(row).join("")
    + (rest.length
        ? `<button class="ytmore" onclick="window.__creMore()" aria-expanded="false">
             <span class="faces">${rest.slice(0, 4).map(c =>
               `<img src="${chImg(c.id)}" alt="">`).join("")}</span>
             ${rest.length}명 더보기</button>`
        : (creOpen && creators.length > CRE_SHOWN
            ? `<button class="ytmore" onclick="window.__creMore()" aria-expanded="true">접기</button>`
            : ""));
  $("creHint").textContent = picked.size ? `${picked.size}개 선택` : "";
}
function renderFeed() {
  const vs = [];
  for (const s of filtered()) for (const v of s.vids) vs.push({ ...v, s });
  vs.sort((a,b) => b.at.localeCompare(a.at));
  const seen = new Set(), top = [];
  for (const v of vs) { if (seen.has(v.id)) continue; seen.add(v.id); top.push(v); if (top.length >= 30) break; }
  $("feedCnt").textContent = `${nfm(seen.size)}편`;
  $("feed").innerHTML = top.map(v => `<button class="fitem" onclick="window.__sel('${v.s.id}')">
    <img src="${vdImg(v.id)}" alt="" loading="lazy">
    <span class="ft"><b class="t2">${esc(v.t)}</b><span>${views(v.vw)} · ${dateK(v.at)}</span></span></button>`).join("")
    || `<p class="empty" style="padding:18px 0">표시할 영상이 없습니다</p>`;
}
/* 업종 — 카카오 분류(164종, 가게 이름이 섞인 것도 있음)를 13가지로 묶습니다.
   위에서부터 먼저 맞는 것 하나. 술집·카페·마트처럼 맞는 게 없으면 업종을 고르지 않았을 때만 보입니다. */
const CAT_GROUPS = [
  ["패스트푸드", /햄버거|버거|패스트푸드|핫도그|토스트|샌드위치|도시락|와플|도넛/],
  ["찜·탕", /찜|탕|국밥|해장국|곰탕|설렁탕|찌개|전골|샤브|추어|순댓국|아구/],
  ["치킨", /치킨|닭강정|통닭/],
  ["중식", /중국|중식|반점|양꼬치|마라/],
  ["일식", /일식|일본|초밥|스시|이자카야|우동|라멘|쿠우쿠우|꼬치/],
  ["한식", /한식|국수|칼국수|냉면|비빔밥|쌈밥|한정식|기사식당|닭요리|백반|만두|낙지|주꾸미|오징어/],
  ["분식", /분식|떡볶이|순대|김밥|간식/],
  ["돈까스·회", /돈까스|돈가스|^회$|생선회|참치회|횟집|사조회|복어|수산|굴,전복|조개|해물,생선|게,대게|장어|해산물/],
  ["피자", /피자/],
  ["고기", /고기|육류|구이|갈비|삼겹|정육|곱창|막창|오리|불고기|두루치기|돼지|닭갈비/],
  ["양식", /양식|이탈리안|스테이크|프랑스|스페인|멕시칸|파스타|브라질|샐러드/],
  ["아시안", /태국|베트남|인도음식|아시아|동남아|쌀국수/],
  ["족발·보쌈", /족발|보쌈/],
];
/* 판정 순서 — 화면 순서와 다릅니다. "족발,보쌈"이 다른 묶음에 먼저 걸리지 않게, 겹치는 말이 있는 것부터 봅니다 */
const CAT_ORDER = ["족발·보쌈", "피자", "치킨", "패스트푸드", "돈까스·회", "찜·탕", "중식", "일식", "아시안", "양식", "고기", "분식", "한식"];
const CAT_RE = new Map(CAT_GROUPS);
function catGroup(s) {
  if (s._grp !== undefined) return s._grp;
  const c = s.cat || "";
  return (s._grp = (c && CAT_ORDER.find(g => CAT_RE.get(g).test(c))) || null);
}
function renderCats() {
  const m = new Map();
  for (const s of stores) { const g = catGroup(s); if (g) m.set(g, (m.get(g) || 0) + 1); }
  $("cats").innerHTML = CAT_GROUPS.filter(([g]) => m.get(g)).map(([g]) => `<button class="chip${cat===g?" on":""}"
    onclick="window.__cat('${g}')">${esc(g)}</button>`).join("");
}
function renderHist() {
  const buckets = new Array(22).fill(0);
  for (const s of stores) {
    const v = Math.max(0, ...s.vids.map(x => x.vw || 0));
    if (v < 1000) continue;
    const i = Math.min(21, Math.floor((Math.log10(v/1000)/4) * 22));
    buckets[i]++;
  }
  const mx = Math.max(...buckets, 1), onFrom = Math.floor((minViews > 0 ? (Math.log10(minViews/1000)/4) : 0) * 22);
  $("vwHist").innerHTML = buckets.map((b,i) =>
    `<i class="${i >= onFrom ? "on" : ""}" style="height:${Math.max(2, Math.round(b/mx*22))}px"></i>`).join("");
}
/* 왼쪽 유튜버 목록은 최대 10명까지 — 11번째를 누르면 가장 먼저 고른 사람이 빠집니다 */
const PICK_MAX = 10;
window.__cre = id => {
  if (picked.has(id)) picked.delete(id);
  else { if (picked.size >= PICK_MAX) picked.delete(picked.values().next().value); picked.add(id); }
  selected = null; refresh(true);
};
window.__reg = r => { region = r; selected = null; refresh(true); };   // 아래 기록 배선이 감쌉니다
window.__cat = c => { cat = cat === c ? null : c; selected = null; refresh(true); };
/* 업종 줄 — 스크롤 막대 없이 마우스 휠이나 끌어서 옆으로 넘깁니다. 끌다가 손을 뗀 건 누른 걸로 치지 않습니다 */
(function catScroll() {
  const el = document.getElementById("cats"); if (!el) return;
  el.addEventListener("wheel", e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += e.deltaY; e.preventDefault();
  }, { passive: false });
  let x0 = 0, left0 = 0, down = false, moved = false;
  el.addEventListener("pointerdown", e => { if (e.pointerType !== "mouse") return; down = true; moved = false; x0 = e.clientX; left0 = el.scrollLeft; });
  window.addEventListener("pointermove", e => {
    if (!down) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) > 4) { moved = true; el.classList.add("dragging"); }
    if (moved) el.scrollLeft = left0 - dx;
  });
  window.addEventListener("pointerup", () => { down = false; el.classList.remove("dragging"); });
  el.addEventListener("click", e => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
})();

function refresh(fit) {
  renderChips(); renderCres(); renderFeed(); renderCats(); renderHist();
  const list = filtered();
  /* 상단 숫자 칸은 없앴습니다 — 칸이 다시 생기면 그대로 채웁니다 */
  if ($("tbStores")) $("tbStores").textContent = nfm(list.length);
  if ($("tbVids")) $("tbVids").textContent = nfm(new Set(list.flatMap(s => s.vids.map(v => v.id))).size);
  if ($("tbCmt")) $("tbCmt").textContent = nfm(list.reduce((a,s) => a + s.cTotal, 0));
  $("vwLab").textContent = minViews ? views(minViews) + " 이상" : "전체";
  $("evLab").textContent = minEv ? minEv + "건 이상" : "전체";
  if (selected && list.some(s => s.id === selected)) renderDetail(stores.find(s => s.id === selected));
  else { selected = null; renderResults(); }
  if (kmap) drawPins(fit);
  const t = $("toast");
  if (!list.length) { t.hidden = false; t.textContent = "조건에 맞는 식당이 없습니다"; } else t.hidden = true;
}

/* ══ 검색 ══ */
let acTimer;
function suggest() {
  const t = q.trim().toLowerCase();
  if (!t) { $("ac").hidden = true; return; }
  const cs = creators.filter(c => (c.n + c.h).toLowerCase().includes(t)).slice(0, 4);
  /* 시·도 이름만 쳐도("부산") 그 지역 전체로 갈 수 있게 시·도를 시군구보다 먼저 보여 줍니다 */
  const rm = new Map(), dm = new Map();
  for (const s of stores) { rm.set(s.r, (rm.get(s.r)||0) + 1); dm.set(sido(s.r), (dm.get(sido(s.r))||0) + 1); }
  const hit = r => (r + " " + shortRegion(r)).toLowerCase().includes(t);
  const ds = [...dm].filter(([d]) => hit(d)).sort((a,b) => b[1]-a[1]).slice(0, 2)
    .map(([d,n]) => [d, n, shortRegion(d) + " 전체"]);
  const rs = [...ds, ...[...rm].filter(([r]) => r.includes(" ") && hit(r)).sort((a,b) => b[1]-a[1])
    .slice(0, 5 - ds.length).map(([r,n]) => [r, n, shortRegion(r)])];
  const ss = filtered().slice(0, 6);
  if (!cs.length && !rs.length && !ss.length) {
    $("ac").innerHTML = `<p class="empty">검색 결과가 없습니다</p>`; $("ac").hidden = false; return;
  }
  const grp = (l, items) => items.length ? `<div class="g"><p class="gl">${l}</p>${items.join("")}</div>` : "";
  $("ac").innerHTML =
    grp("유튜버", cs.map(c => `<button onclick="window.__pick('c','${c.id}')">
      <img src="${chImg(c.id)}" style="width:20px;height:20px;border-radius:50%"><span class="m">${esc(c.n)}</span>
      <span class="s">${stores.filter(s => s.cs.includes(c.id)).length}곳</span></button>`)) +
    grp("지역", rs.map(([r,n,label]) => `<button onclick="window.__pick('r','${r}')">
      <span class="m">${esc(label)}</span><span class="s">${n}곳</span></button>`)) +
    grp("식당", ss.map(s => `<button onclick="window.__pick('s','${s.id}')">
      <span class="m t1">${esc(s.n)}</span><span class="s">${esc(shortRegion(s.r))}</span></button>`));
  $("ac").hidden = false;
}
window.__pick = (k, v) => {
  q = ""; $("q").value = ""; $("clr").hidden = true; $("ac").hidden = true;
  if (k === "c") { picked = new Set([v]); selected = null; refresh(true); }
  else if (k === "r") window.__reg(v);
  else { refresh(false); select(v); }
};

/* ══ 시작 ══ */
function wire() {
  $("q").addEventListener("input", e => {
    q = e.target.value; $("clr").hidden = !q;
    clearTimeout(acTimer); acTimer = setTimeout(() => { suggest(); refresh(false); }, 150);
  });
  /* Enter: 자동완성 첫 항목을 고릅니다. 항목이 없으면 지금 걸러진 식당으로 지도를 맞춥니다.
     한글 입력 중 Enter(조합 확정)는 한 번 더 들어오므로 그건 건너뜁니다. */
  $("q").addEventListener("keydown", e => {
    /* 빈 검색창에서 지우기를 누르면 고른 지역을 풉니다 */
    if (e.key === "Backspace" && !$("q").value && region) { region = null; selected = null; refresh(true); return; }
    if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    clearTimeout(acTimer);
    q = $("q").value;
    if (!q.trim()) return;
    suggest();
    const first = $("ac").querySelector("button");
    if (first) first.click();
    else { $("ac").hidden = true; selected = null; refresh(true); }
  });
  $("clr").onclick = () => { q = ""; $("q").value = ""; $("clr").hidden = true; $("ac").hidden = true; refresh(true); };
  document.addEventListener("pointerdown", e => { if (!e.target.closest(".srch")) $("ac").hidden = true; });
  $("rchip").onclick = () => { region = null; selected = null; refresh(true); $("q").focus(); };
  $("onlyRated").onclick = () => { onlyRated = !onlyRated; $("onlyRated").setAttribute("aria-pressed", onlyRated); selected = null; refresh(true); };
  $("onlyWait").onclick = () => { onlyWait = !onlyWait; $("onlyWait").setAttribute("aria-pressed", onlyWait); selected = null; refresh(true); };
  $("vwMin").oninput = e => { minViews = sliderToViews(+e.target.value); refresh(false); };
  $("evMin").oninput = e => { minEv = +e.target.value; refresh(false); };
  $("resetF").onclick = () => {
    picked.clear(); region = null; cat = null; onlyRated = onlyWait = false; minViews = minEv = 0;
    $("vwMin").value = 0; $("evMin").value = 0;
    $("onlyRated").setAttribute("aria-pressed", "false"); $("onlyWait").setAttribute("aria-pressed", "false");
    selected = null; refresh(true);
  };
  $("zIn").onclick = () => kmap && kmap.setLevel(kmap.getLevel() - 1);
  $("zOut").onclick = () => kmap && kmap.setLevel(kmap.getLevel() + 1);
  $("zFit").onclick = () => drawPins(true);
  /* 요소 하나가 없어도 나머지 배선이 멈추지 않게 둡니다 */
  if ($("favEdit")) $("favEdit").onclick = openFav;
  if ($("favGo"))   $("favGo").onclick   = () => closeFav(true);
  if ($("favSkip")) $("favSkip").onclick = () => { fav.clear(); closeFav(true); };
  if ($("favReset")) $("favReset").onclick = () => { fav.clear(); renderFavGrid(); };
  if ($("favClear")) $("favClear").onclick = clearFav;
  // 바깥 클릭은 기록하지 않습니다 — 다음에 다시 묻습니다
  if ($("favWrap")) $("favWrap").onclick = e => { if (e.target.id === "favWrap") closeFav(false); };
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("favWrap").hidden) closeFav(false);
  });
}

/* 카카오 JS 키 — 서버 환경변수에서 받아옵니다. 소스에 박지 않습니다. */
async function mapKey() {
  try {
    const r = await fetch("/api/mapkey");
    if (!r.ok) return "";
    return (await r.json()).key || "";
  } catch { return ""; }
}

/* 리퍼러 우회는 없앴습니다.
   도메인 등록을 "앱 설정 → 앱 키 → JavaScript 키 → JavaScript SDK 도메인"에
   하면 localhost 도 정상 등록됩니다. 전에 8가지 변형이 다 401 이었던 것은
   등록 위치가 틀렸기 때문이었습니다("플랫폼" 페이지가 아닙니다).
   그래서 로컬·배포 모두 카카오의 도메인 검사를 그대로 받습니다. */

function mapFailed(msg) {
  $("mapmsg").hidden = false;
  $("mapmsgBody").innerHTML = msg;
}

async function loadSeed() {
  try {
    const r = await fetch("/api/seed");
    if (r.ok) {
      const d = await r.json();
      if (d.stores && d.stores.length) { srcLabel("DB"); return d; }
    }
  } catch { /* API가 없는 환경 — 아래에서 파일을 읽습니다 */ }
  srcLabel("파일");
  return (await fetch("data/seed.json")).json();
}
function srcLabel(kind) {
  const el = $("srcTag");
  if (el) { el.textContent = kind; el.dataset.kind = kind; }
}

(async function boot() {
  /* DB(/api/seed)를 먼저 보고, 없으면 파일로 돌아갑니다.
     python3 -m http.server 로 띄우면 API가 없으니 파일이 쓰이고,
     npm run dev 로 띄우면 Postgres에서 옵니다. */
  SEED = await loadSeed();
  stores = SEED.stores; creators = SEED.creators; META = SEED.meta;
  CRE = new Map(creators.map(c => [c.id, c]));
  loadFav();
  /* 시작 화면에서 고른 유튜버(?yt=c1,c2)는 거르지 않고 "내 유튜버"로 — 모든 식당을 보여 주되 그 유튜버 식당을 위로 올립니다 */
  const ytParam = (new URLSearchParams(location.search).get("yt") || "").split(",").filter(id => CRE.has(id)).slice(0, FAV_MAX);
  if (ytParam.length) fav = new Set(ytParam);
  wire(); syncFavBtn(); refresh(false);
  /* 유튜버 고르기는 이제 시작 화면(/)이 맡습니다. 지도에서는 자동으로 띄우지 않고,
     ?pick=1 을 붙였을 때와 왼쪽 "내 유튜버 고르기" 버튼으로만 엽니다. */
  const params = new URLSearchParams(location.search);
  if (params.has("pick")) openFav();
  /* 시작 화면의 "지도에서 보기"(?store=<id>)는 그 식당 상세를 바로 엽니다.
     없는 id 면 조용히 무시합니다. 지도가 아직 없으면 지도가 준비된 뒤 한 번 더 옮깁니다. */
  const startStore = stores.some(s => s.id === params.get("store")) ? params.get("store") : null;
  if (startStore) select(startStore);
  instrument();                              // 사용 기록을 켭니다 (아래 정의)

  const key = window.__MAPKEY__ || await mapKey();
  if (!key) return mapFailed(
    "지도 JS 키가 없습니다. 주소 뒤에 <code>?key=발급받은_JavaScript_키</code>를 붙여 다시 여세요.");
  const sc = document.createElement("script");
  sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
  sc.onerror = () => mapFailed(
    "카카오 지도 SDK를 불러오지 못했습니다.<br>" +
    "카카오 개발자 콘솔 → 앱 설정 → 플랫폼 → Web 에 <code>" + location.origin + "</code> 을 등록했는지 확인하세요.");
  sc.onload = () => kakao.maps.load(() => {
    try { initMap(); if (startStore) select(startStore); } catch (e) { mapFailed(String(e)); }
  });
  document.head.appendChild(sc);
})();

/* ══════════════════════════════════════════════════════════════════
   실시간 투표 — 8초마다 확인하고, 새 글이 오면 오른쪽 위에 알립니다.

   글은 지우기 전까지 남습니다(11/24 에 밤 12시 초기화를 없앰).
   최신순은 전체, 인기순과 왼쪽 "실시간 인기글"은 최근 7일 글만 봅니다.
   지난 토론은 DB에 남아서 Admin에서 볼 수 있습니다.
   ══════════════════════════════════════════════════════════════════ */
const POLL_MS = 8000;
const SEEN_KEY = "lesulin.pollSeen";
let polls = [], preps = new Map(), pollSort = "hot";
let myLoc = null, seen = { poll: 0, reply: 0 }, pollTimer = null, pollOn = false;
let pollTarget = null;                       // 가게를 지정해 올릴 때의 식당

/* 익명이라 브라우저마다 고유값을 하나 둡니다. 중복 투표를 막는 데에만 씁니다. */
const sid = (() => {
  try {
    let v = localStorage.getItem("lesulin.sid");
    if (!v) {
      v = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now())
            .replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
      localStorage.setItem("lesulin.sid", v);
    }
    return v;
  } catch { return "anon" + String(Date.now()).slice(-10); }
})();

const ago = iso => {
  const m = Math.floor((Date.now() - new Date(iso)) / 60000);
  return m < 1 ? "방금" : m < 60 ? m + "분 전" : m < 1440 ? Math.floor(m / 60) + "시간 전" : Math.floor(m / 1440) + "일 전";
};

/* ── 알림 ───────────────────────────────────────────────── */
function toast(p) {
  const box = $("ntfs");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "ntf";
  const where = p.store_name ? `📍 ${esc(p.store_name)}`
              : p.place ? `📍 ${esc(shortRegion(p.place))}` : "르슐랭 가이드";
  el.innerHTML = `<div class="th"><b>새 글</b><span>·</span><span>${where}</span></div>
                  <div class="tb">${esc(p.body)}</div>`;
  el.onclick = () => { openPolls(); kill(); };
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  const kill = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 220);
  };
  setTimeout(kill, 4500);
}

function markSeen() {
  seen = { poll: head.poll, reply: head.reply };
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch {}
  paintBell();
}
let head = { poll: 0, reply: 0 };
function paintBell() {
  const unseen = polls.filter(p => +p.id > seen.poll && !p.mine).length;
  /* 숫자는 두지 않습니다 — 빨간 점만으로 "새 게 있다"가 전해집니다.
     */
  const dot = $("bellDot"), b = $("bell");
  if (dot) dot.hidden = unseen === 0;
  if (b) b.classList.toggle("live", unseen > 0);
}

/* ── 가져오기 ───────────────────────────────────────────── */
async function pullPolls(notify) {
  try {
    const r = await fetch(`/api/polls?sort=${pollSort}&session=${sid}`);
    if (!r.ok) return false;
    const d = await r.json();
    const fresh = d.polls.filter(p => +p.id > head.poll && !p.mine);
    polls = d.polls;
    head = d.head;
    preps = new Map();
    for (const x of d.replies) {
      const k = +x.poll_id;              // DB 가 bigint 를 문자열로 줍니다 — 숫자로 맞춰야 아래에서 찾습니다
      if (!preps.has(k)) preps.set(k, []);
      preps.get(k).push(x);
    }
    if (notify) for (const p of fresh.slice(0, 2)) toast(p);
    paintBell(); renderHot();
    if (pollOn && !pedit && !pdel) renderPolls();   // 고치거나 지우는 중이면 그 칸을 덮어쓰지 않습니다
    return true;
  } catch { return false; }
}

/* ── 좌측 실시간 인기 ───────────────────────────────────── */
function renderHot() {
  const el = $("hotList"); if (!el) return;
  /* 인기글은 최근 7일 글에서만 — 최신순 탭에서 받은 목록에는 더 오래된 글도 섞여 있습니다 */
  const since = Date.now() - 7 * 864e5;
  const top = polls.filter(p => new Date(p.created_at) > since)
    .sort((a, b) => b.heat - a.heat || +b.id - +a.id).slice(0, 5);
  if (!top.length) {
    el.innerHTML = `<p class="hotempty">최근 7일 동안 올라온 글이 없습니다.</p>`;
    return;
  }
  el.innerHTML = top.map((p, i) => `<button class="hotrow" onclick="window.__hot(${p.id})">
    <span class="n">${i + 1}</span>
    <span class="tx">${esc(p.body)}</span>
    <span class="hm">${p.replies ? "답" + p.replies : ""}${p.ups ? " ♥" + p.ups : ""}</span>
  </button>`).join("");
}
window.__hot = id => { openPolls(); setTimeout(() => {
  const el = document.getElementById("p" + id);
  if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("hot"); }
}, 60); };

/* ── 패널 ───────────────────────────────────────────────── */
function renderPolls() {
  const el = $("pollBody"); if (!el) return;
  if (!polls.length) {
    el.innerHTML = `<p class="hotempty">${pollSort === "hot" ? "최근 7일 동안 올라온 글이 없습니다." : "아직 올라온 글이 없습니다."}</p>`;
    return;
  }
  el.innerHTML = polls.map((p, i) => {
    const rs = preps.get(+p.id) || [];
    const isNew = +p.id > seen.poll && !p.mine;
    return `<article class="pitem${isNew ? " hot" : ""}${+p.id === threadId ? " sel" : ""}" id="p${p.id}" data-id="${p.id}" tabindex="0">
      <div class="ph">
        <span class="au">${p.mine ? "내 글" : esc(p.nickname || "익명")}</span><span>·</span><span>${ago(p.created_at)}${p.edited_at ? " · 수정됨" : ""}</span>
        ${p.store_name ? `<span class="st">📍 ${esc(p.store_name)}</span>`
          : p.place ? `<span>· ${esc(shortRegion(p.place))}</span>` : ""}
        ${p.mine ? ownBtns("poll", p.id) : ""}
      </div>
      ${isEdit("poll", p.id) ? editBox() : `<p class="pt">${esc(p.body)}</p>`}
      ${isDel("poll", p.id) ? delBar("글과 답글이 모두 지워집니다.") : ""}
      <div class="pf">
        <button class="vbtn${p.my_vote === 1 ? " on" : ""}"
          onclick="window.__vote(${p.id},1,'poll')">👍 ${p.ups}</button>
        <button class="vbtn dn${p.my_vote === -1 ? " on" : ""}"
          onclick="window.__vote(${p.id},-1,'poll')">👎 ${p.downs}</button>
        <button class="rbtn" onclick="window.__thread(${p.id})">답글 ${rs.length || ""}</button>
      </div>
    </article>`;
  }).join("");
  renderThread();
}

/* ── 답글 채팅 — 글을 누르면 아래에서 올라옵니다 ───────────── */
let threadId = null;
function renderThread() {
  const box = $("pThread"); if (!box) return;
  const p = threadId != null && polls.find(x => +x.id === threadId);
  if (!p) { box.hidden = true; threadId = null; return; }
  if (box.hidden) {                                  // 열릴 때 저장해 둔 높이로 (창 크기가 바뀌었으면 상한에 맞춤)
    box.hidden = false;
    let v = NaN; try { v = Number(localStorage.getItem(PTH_KEY)); } catch {}
    if (v > 0) setPthH(v, false);
  }
  $("pThTitle").textContent = p.body;
  const rs = preps.get(+p.id) || [];
  const list = $("pThList"), atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
  list.innerHTML = rs.length ? rs.map(r => `<div class="bub${r.mine ? " me" : ""}">
      <span class="nm">${r.mine ? "나" : esc(r.nickname || "익명")}</span>
      ${isEdit("reply", r.id) ? editBox() : `<span class="tx">${esc(r.body)}${r.store_name ? ` <b>📍${esc(r.store_name)}</b>` : ""}</span>`}
      <span class="mt">${r.created_at ? ago(r.created_at) : ""}${r.edited_at ? " · 수정됨" : ""}
        <button class="vbtn rv${r.my_vote === 1 ? " on" : ""}" onclick="window.__vote(${r.id},1,'reply')">♥ ${r.ups}</button>
        ${r.mine ? ownBtns("reply", r.id) : ""}</span>
      ${isDel("reply", r.id) ? delBar("답글을 지웁니다.") : ""}
    </div>`).join("") : `<p class="none">아직 답글이 없습니다. 첫 답글을 달아 보세요.</p>`;
  if (atBottom || list.dataset.for !== String(p.id)) list.scrollTop = list.scrollHeight;
  list.dataset.for = String(p.id);
}
/* 답글 창 높이 — 위 손잡이를 끌어 정하고, 다음에 열 때도 그 높이로 엽니다.
   투표창 머리(제목·탭)는 가리지 않게 상한을 둡니다. 더블클릭하면 원래대로. */
const PTH_KEY = "lesulin.pthH", PTH_MIN = 150;
function pthMax() {
  const w = $("pollWrap"), hd = w && w.querySelector("header");
  return w ? w.clientHeight - (hd ? hd.offsetHeight : 0) - 60 : 600;
}
function setPthH(px, save = true) {
  const box = $("pThread"); if (!box) return;
  if (px == null) { box.style.height = ""; box.style.maxHeight = ""; try { localStorage.removeItem(PTH_KEY); } catch {} return; }
  const h = Math.round(Math.max(PTH_MIN, Math.min(pthMax(), px)));
  box.style.height = h + "px"; box.style.maxHeight = "none";
  if (save) try { localStorage.setItem(PTH_KEY, String(h)); } catch {}
}
function wirePthGrip() {
  const el = $("pThGrip"); if (!el) return;
  el.addEventListener("pointerdown", e => {
    e.preventDefault();
    const start = e.clientY, base = $("pThread").offsetHeight;
    el.classList.add("on"); document.body.classList.add("resizing-y");
    el.setPointerCapture(e.pointerId);
    const move = ev => setPthH(base - (ev.clientY - start));
    const up = () => {
      el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up);
      el.classList.remove("on"); document.body.classList.remove("resizing-y");
    };
    el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  });
  el.addEventListener("dblclick", () => setPthH(null));
  el.addEventListener("keydown", e => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    setPthH($("pThread").offsetHeight + (e.key === "ArrowUp" ? 30 : -30));
  });
}
function openThread(id) {
  threadId = threadId === id ? null : id;           // 같은 글을 다시 누르면 닫힙니다
  $("pThErr").hidden = true;
  renderPolls();
  if (threadId != null) $("pThText").focus();
}
window.__thread = openThread;

window.__vote = async (id, v, target) => {
  const cur = target === "poll"
    ? polls.find(p => +p.id === id)?.my_vote
    : [...preps.values()].flat().find(r => +r.id === id)?.my_vote;
  const value = cur === v ? 0 : v;              // 같은 걸 다시 누르면 취소
  try {
    const r = await fetch(`/api/polls/${id}/vote`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sid, value, target }),
    });
    if (r.ok) await pullPolls(false);
  } catch {}
};

/* ── 내 글·답글 고치기·지우기 ─────────────────────────────
   서버가 글을 쓴 브라우저의 세션과 같은지 확인합니다. 화면은 mine 인 것에만 버튼을 둡니다.
   pedit/pdel 이 있는 동안은 8초 새로고침이 목록을 다시 그리지 않습니다(쓰던 내용이 날아가지 않게). */
let pedit = null, pdel = null;          // {t:"poll"|"reply", id, text?, err?}
const isEdit = (t, id) => pedit && pedit.t === t && pedit.id === +id;
const isDel = (t, id) => pdel && pdel.t === t && pdel.id === +id;
const ownBtns = (t, id) => `<span class="own"><button class="ownb" onclick="window.__pedit('${t}',${id})">수정</button><button class="ownb" onclick="window.__pdel('${t}',${id})">삭제</button></span>`;
const editBox = () => `<div class="pedit"><textarea class="pedt" maxlength="300" rows="2">${esc(pedit.text)}</textarea>
  ${pedit.err ? `<p class="perr">${esc(pedit.err)}</p>` : ""}
  <div class="pea"><button class="ownb" onclick="window.__pcancel()">취소</button><button class="pesave" onclick="window.__psave()">저장</button></div></div>`;
const delBar = msg => `<div class="pdel"><span>${msg}</span><button class="ownb" onclick="window.__pcancel()">취소</button><button class="pdelgo" onclick="window.__pdelgo()">삭제</button></div>`;
const ownItem = (t, id) => t === "poll" ? polls.find(p => +p.id === id) : [...preps.values()].flat().find(r => +r.id === id);
const ownUrl = (t, id) => t === "poll" ? `/api/polls/${id}` : `/api/polls/${+ownItem(t, id).poll_id}/reply/${id}`;

function focusEdit() {
  const ta = document.querySelector("textarea.pedt"); if (!ta) return;
  ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
  ta.oninput = () => { if (pedit) pedit.text = ta.value; };
  ta.onkeydown = e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); window.__psave(); } };
}
window.__pedit = (t, id) => {
  const it = ownItem(t, id); if (!it) return;
  pedit = { t, id, text: it.body }; pdel = null;
  renderPolls(); focusEdit();
};
window.__pdel = (t, id) => { pdel = { t, id }; pedit = null; renderPolls(); };
window.__pcancel = () => { pedit = pdel = null; renderPolls(); };
window.__psave = async () => {
  if (!pedit) return;
  const { t, id } = pedit, body = pedit.text.trim();
  if (!body) return;
  try {
    const r = await fetch(ownUrl(t, id), { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sid, body }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { pedit.err = d.error || "고치지 못했습니다. 잠시 뒤 다시 해 주세요."; renderPolls(); focusEdit(); return; }
  } catch { pedit.err = "고치지 못했습니다. 인터넷 연결을 확인해 주세요."; renderPolls(); focusEdit(); return; }
  pedit = null; await pullPolls(false); renderPolls();
};
window.__pdelgo = async () => {
  if (!pdel) return;
  const { t, id } = pdel, url = ownUrl(t, id);
  pdel = null;
  try { await fetch(url, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ session: sid }) }); } catch {}
  if (t === "poll" && threadId === id) threadId = null;
  await pullPolls(false); renderPolls();
};

async function sendReply() {
  const t = $("pThText"), body = t.value.trim(), id = threadId;
  if (id == null || !body) return;
  $("pThSend").disabled = true; $("pThErr").hidden = true;
  try {
    const r = await fetch(`/api/polls/${id}/reply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sid, body }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { $("pThErr").textContent = d.error || "답글을 달지 못했습니다. 잠시 뒤 다시 보내 주세요."; $("pThErr").hidden = false; }
    else { t.value = ""; await pullPolls(false); $("pThList").scrollTop = $("pThList").scrollHeight; }
  } catch { $("pThErr").textContent = "답글을 달지 못했습니다. 인터넷 연결을 확인해 주세요."; $("pThErr").hidden = false; }
  $("pThSend").disabled = !$("pThText").value.trim();
}

/* ── 올리기 ─────────────────────────────────────────────── */
function pollTagHTML() {
  if (pollTarget) return `📍 <b>${esc(pollTarget.n)}</b> 에 대해 — 좋아요·싫어요가 달립니다`;
  if (gpsState === "asking") return "📍 현재 위치를 확인하는 중…";
  const sw = `<button class="locsw" onclick="window.__loctoggle()">`;
  if (myLoc && myLoc.src === "gps")
    return `📍 <b>${esc(myLoc.label)}</b> (현재 위치) ${sw}지도 중심으로</button>`;
  const why = gpsState === "denied" ? "위치 권한이 거부돼 " : gpsState === "unavailable" ? "위치를 못 받아 " : "";
  if (myLoc)
    return `📍 ${why}<b>${esc(myLoc.label)}</b> (지도 중심) ${sw}현재 위치 쓰기</button>`;
  return `위치 없이 올라갑니다 ${sw}현재 위치 쓰기</button>`;
}
function syncForm() {
  const t = $("pollText"); if (!t) return;
  $("pollTag").innerHTML = pollTagHTML();
  $("pollSend").disabled = t.value.trim().length < 2;
}

async function sendPoll() {
  const t = $("pollText"), body = t.value.trim();
  if (body.length < 2) return;
  $("pollSend").disabled = true;
  try {
    const r = await fetch("/api/polls", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session: sid, body,
        storeId: pollTarget?.id || null,
        lat: pollTarget ? null : myLoc?.lat ?? null,
        lng: pollTarget ? null : myLoc?.lng ?? null,
      }),
    });
    const d = await r.json();
    if (!r.ok) { alert(d.error || "올리지 못했습니다."); syncForm(); return; }
    t.value = ""; pollTarget = null; showForm(false);
    await pullPolls(false);
    markSeen();
  } catch { alert("올리지 못했습니다."); }
  syncForm();
}

/* ── 글을 올릴 위치 ────────────────────────────────────────
   "주변 맛집 아시는 분" 같은 질문은 **글쓴 사람이 서 있는 자리**가 기준이어야
   합니다. 서울에 있으면서 부산 지도를 보고 있으면 지도 중심은 틀린 답입니다.
   그래서 현재 위치를 먼저 쓰고, 권한을 안 주거나 실패하면 지도 중심으로 돌아갑니다.
   정확한 좌표는 보내지 않습니다 — 서버가 가장 가까운 식당의 시군구만 저장합니다. */
let locMode = "gps";             // gps | map
let gpsState = "idle";           // idle | asking | ok | denied | unavailable

function nearestRegion(lat, lng) {
  const near = stores.reduce((b, s) => {
    const d = (s.lat - lat) ** 2 + (s.lng - lng) ** 2;
    return !b || d < b.d ? { d, s } : b;
  }, null);
  return near ? shortRegion(near.s.r) : null;
}

function locFromMap() {
  if (!kmap) return;
  const c = kmap.getCenter();
  myLoc = { lat: c.getLat(), lng: c.getLng(),
            label: nearestRegion(c.getLat(), c.getLng()) || "지도 중심", src: "map" };
  syncForm();
}

function locFromGPS() {
  if (!navigator.geolocation) { gpsState = "unavailable"; locMode = "map"; locFromMap(); return; }
  gpsState = "asking"; syncForm();
  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      /* 국내 범위를 벗어나면 쓰지 않습니다 — VPN·오차로 엉뚱한 좌표가 올 수 있습니다 */
      if (!(lat > 33 && lat < 39 && lng > 124 && lng < 132)) {
        gpsState = "unavailable"; locMode = "map"; locFromMap(); return;
      }
      gpsState = "ok"; locMode = "gps";
      myLoc = { lat, lng, label: nearestRegion(lat, lng) || "현재 위치", src: "gps" };
      syncForm();
    },
    err => {
      gpsState = err.code === err.PERMISSION_DENIED ? "denied" : "unavailable";
      locMode = "map"; locFromMap();
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
  );
}

window.__loctoggle = () => {
  if (locMode === "gps") { locMode = "map"; locFromMap(); }
  else if (gpsState === "ok") { locMode = "gps"; syncForm(); locFromGPS(); }
  else locFromGPS();
};

function openPolls() {
  if (!$("pollWrap")) return;
  pollOn = true; $("pollWrap").hidden = false;
  document.body.classList.add("pollopen");
  $("bell")?.classList.add("open");
  locFromMap();                              // 먼저 지도 중심으로 채워 두고
  if (locMode === "gps" && gpsState === "idle") locFromGPS();   // 현재 위치를 물어봅니다
  renderPolls(); markSeen();
}
function showForm(on) {
  $("pollForm").hidden = !on;
  $("pollAdd").setAttribute("aria-expanded", String(on));
  $("pollAdd").setAttribute("aria-label", on ? "글쓰기 닫기" : "글 올리기");
  if (on) { syncForm(); $("pollText").focus(); }
}
function closePolls() {
  pollOn = false;
  if ($("pollWrap")) $("pollWrap").hidden = true;
  document.body.classList.remove("pollopen");
  $("bell")?.classList.remove("open");
}

function wirePolls() {
  if (!$("bell")) return;
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "null");
    if (v && typeof v.poll === "number") seen = v;
  } catch {}
  $("bell").onclick = () => (pollOn ? closePolls() : openPolls());
  $("pollX").onclick = closePolls;
  $("tabHot").onclick = () => setSort("hot");
  $("tabNew").onclick = () => setSort("new");
  $("pollText").oninput = syncForm;
  $("pollText").onkeydown = e => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") sendPoll();
  };
  $("pollSend").onclick = sendPoll;
  $("pollAdd").onclick = () => showForm($("pollForm").hidden);
  /* 글(카드)을 누르면 답글 채팅 — 투표·답글 버튼을 누른 건 그대로 */
  $("pollBody").addEventListener("click", e => {
    if (e.target.closest("button, .pedit, .pdel")) return;
    const a = e.target.closest(".pitem"); if (a) openThread(+a.dataset.id);
  });
  $("pollBody").addEventListener("keydown", e => {
    const a = e.target.closest(".pitem");
    if (a && e.target === a && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openThread(+a.dataset.id); }
  });
  $("pThX").onclick = () => openThread(threadId);
  $("pThText").oninput = () => { $("pThSend").disabled = !$("pThText").value.trim(); };
  $("pThText").onkeydown = e => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendReply(); } };
  $("pThSend").onclick = sendReply;
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape" || !pollOn) return;
    if (pedit || pdel) window.__pcancel();
    else if (threadId != null) openThread(threadId);        // 채팅 먼저 닫고
    else if (!$("pollForm").hidden) showForm(false);   // 글쓰기 칸, 그다음 창
    else closePolls();
  });
  pullPolls(false);
  pollTimer = setInterval(() => {
    if (document.hidden) return;              // 탭이 안 보이면 묻지 않습니다
    pullPolls(true);
  }, POLL_MS);
}
function setSort(s) {
  pollSort = s;
  $("tabHot").classList.toggle("on", s === "hot");
  $("tabNew").classList.toggle("on", s === "new");
  pullPolls(false);
}

/** 상세 패널에서 "이 가게로 물어보기" 를 눌렀을 때 */
window.__askStore = id => {
  const s = stores.find(x => x.id === id);
  if (!s) return;
  pollTarget = s;
  openPolls();
  $("pollText").placeholder = `예) ${s.n} 웨이팅 얼마나 되나요?`;
  showForm(true);
};

wirePolls();

/* ══════════════════════════════════════════════════════════════════
   사용 기록 — 방문자·검색어·클릭·재방문

   클릭마다 요청을 보내지 않습니다. 모아서 5초마다, 그리고 탭을 떠날 때
   한 번에 보냅니다(sendBeacon). 화면이 느려지지 않아야 기록을 켤 수 있습니다.

   남기는 것   브라우저가 만든 난수 id, 무슨 화면·무엇을 눌렀나, 검색어
   안 남기는 것 IP·브라우저 정보·이메일 — 개인을 지목할 수 있는 건 보내지 않습니다
   ══════════════════════════════════════════════════════════════════ */
const vid = (() => {
  try {
    let v = localStorage.getItem("lesulin.vid");
    if (!v) {
      v = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now())
            .replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
      localStorage.setItem("lesulin.vid", v);        // 재방문 판별에만 씁니다
    }
    return v;
  } catch { return sid; }                            // 저장소를 못 쓰면 세션과 같게
})();

let hits = [], hitTimer = null;

function track(event, extra = {}) {
  hits.push({ event, path: location.pathname, session: sid, visitor: vid, ...extra });
  if (hits.length >= 20) return flushHits();
  if (!hitTimer) hitTimer = setTimeout(flushHits, 5000);
}

function flushHits(beacon) {
  if (hitTimer) { clearTimeout(hitTimer); hitTimer = null; }
  if (!hits.length) return;
  const payload = JSON.stringify({ hits });
  hits = [];
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/track", {
        method: "POST", headers: { "content-type": "application/json" },
        body: payload, keepalive: true,
      }).catch(() => {});
    }
  } catch {}
}

/* 탭을 닫거나 숨길 때 남은 것을 보냅니다. beforeunload 는 모바일에서
   자주 안 불려서 visibilitychange 를 같이 씁니다. */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) flushHits(true);
});
window.addEventListener("pagehide", () => flushHits(true));

/* ── 어디서 기록을 거나 ─────────────────────────────────────
   원래 함수를 고치지 않고 감싸서 붙입니다. 기록이 실패해도
   화면 동작은 그대로 돌아야 합니다. */
function instrument() {
  track("view");

  const _select = select;
  select = function (id) {                    // 식당을 열었을 때
    const s = stores.find(x => x.id === id);
    track("store_open", { storeId: id, creatorId: s?.cs?.[0] });
    return _select.apply(this, arguments);
  };
  window.__sel = id => select(id);

  const _cre = window.__cre;
  window.__cre = id => { track("creator_pick", { creatorId: id }); return _cre(id); };

  const _closeFav = closeFav;
  closeFav = function (record) {
    if (record && fav.size) track("fav_set", { q: [...fav].join(",") });
    return _closeFav.apply(this, arguments);
  };

  const _openPolls = openPolls;
  openPolls = function () { track("poll_open"); return _openPolls.apply(this, arguments); };

  /* 검색어는 타이핑 중간을 다 남기면 쓰레기가 됩니다.
     1.2초 쉬었고 두 글자 이상일 때만 한 번 남깁니다. */
  let qTimer, lastQ = "";
  const box = $("q");
  if (box) box.addEventListener("input", () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      const t = box.value.trim();
      if (t.length >= 2 && t !== lastQ) { lastQ = t; track("search", { q: t }); }
    }, 1200);
  });

  const _reg = window.__reg;
  if (_reg) window.__reg = r => { track("region_pick", { q: r }); return _reg(r); };
}

/* ══════════════════════════════════════════════════════════════════
   오류 신고 — 사용자가 틀린 정보를 알려주는 길.

   로그인을 요구하지 않습니다. 틀린 걸 알려주려고 계정을 만들라고 하면
   아무도 알려주지 않습니다. 대신 한 사람이 10분에 5건으로 막아 뒀습니다.
   ══════════════════════════════════════════════════════════════════ */
const FB_KINDS = [
  ["wrong_place", "위치가 틀려요", "지도에 찍힌 자리가 실제 가게와 다릅니다"],
  ["closed", "문을 닫았어요", "폐업·휴업·이전했습니다"],
  ["wrong_video", "영상이 이 가게가 아니에요", "다른 가게 영상이 붙어 있습니다"],
  ["wrong_score", "반응 수나 배지가 이상해요", "숫자나 배지가 안 맞습니다"],
  ["other", "그 밖에", "직접 적겠습니다"],
];
let fbStore = null, fbKind = null;

function renderFbKinds() {
  $("fbKinds").innerHTML = FB_KINDS.map(([k, label, hint]) =>
    `<button class="fbkind${fbKind === k ? " on" : ""}" onclick="window.__fbk('${k}')">
       <span><b style="font-weight:inherit">${label}</b>
       <span style="display:block;font-size:10.5px;color:var(--muted);font-weight:400">${hint}</span></span>
     </button>`).join("");
  $("fbSend").disabled = !fbKind;
}
window.__fbk = k => { fbKind = (fbKind === k ? null : k); renderFbKinds(); };

window.__report = id => {
  fbStore = stores.find(s => s.id === id) || null;
  fbKind = null;
  $("fbBody").value = "";
  $("fbStore").textContent = fbStore
    ? `${fbStore.n} — 알려주시면 운영자가 확인하고 고칩니다.`
    : "알려주시면 운영자가 확인하고 고칩니다.";
  renderFbKinds();
  $("fbWrap").hidden = false;
};

function closeFb() { $("fbWrap").hidden = true; }

async function sendFb() {
  if (!fbKind) return;
  $("fbSend").disabled = true;
  try {
    const r = await fetch("/api/feedback", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: fbKind, storeId: fbStore?.id ?? null,
        body: $("fbBody").value.trim() || null, session: sid, visitor: vid,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { alert(d.error || "보내지 못했습니다."); $("fbSend").disabled = false; return; }
    track("feedback", { storeId: fbStore?.id, q: fbKind });
    closeFb();
    alert("보냈습니다. 확인하고 고치겠습니다.");
  } catch {
    alert("보내지 못했습니다."); $("fbSend").disabled = false;
  }
}

if ($("fbWrap")) {
  $("fbCancel").onclick = closeFb;
  $("fbSend").onclick = sendFb;
  $("fbWrap").onclick = e => { if (e.target.id === "fbWrap") closeFb(); };
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !$("fbWrap").hidden) closeFb();
  });
}

/* ══════════════════════════════════════════════════════════════════
   바 폭 조절 — 가장자리를 끌어 왼쪽·오른쪽 바를 늘리고 줄입니다.

   폭은 CSS 변수 하나(--side-w / --panel-w)로 두고, 그 변수를 상단바·패널·
   투표창·알림 위치가 전부 따라 쓰게 해 두었습니다. 그래서 여기서는
   변수 값만 바꿉니다.

   지도 컨테이너 크기가 바뀌면 카카오에 알려 줘야 합니다(relayout).
   안 그러면 타일이 어긋나고 핀 위치가 틀어집니다.
   ══════════════════════════════════════════════════════════════════ */
const BAR = {
  side:  { v: "--side-w",  min: 220, max: 460, key: "lesulin.sideW" },
  panel: { v: "--panel-w", min: 260, max: 560, key: "lesulin.panelW" },
};

function setBar(which, px) {
  const b = BAR[which];
  const w = Math.round(Math.min(b.max, Math.max(b.min, px)));
  document.documentElement.style.setProperty(b.v, w + "px");
  try { localStorage.setItem(b.key, String(w)); } catch {}
  return w;
}

function loadBars() {
  for (const k of Object.keys(BAR)) {
    try {
      const v = Number(localStorage.getItem(BAR[k].key));
      if (Number.isFinite(v) && v > 0) setBar(k, v);
    } catch {}
  }
}

function wireGrips() {
  const jobs = [["gripL", "side", +1], ["gripR", "panel", -1]];
  for (const [id, which, dir] of jobs) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("pointerdown", e => {
      e.preventDefault();
      const start = e.clientX;
      const base = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue(BAR[which].v)) || 0;
      el.classList.add("on");
      document.body.classList.add("resizing");
      el.setPointerCapture(e.pointerId);

      let raf = 0, pending = base;
      const move = ev => {
        pending = base + (ev.clientX - start) * dir;
        if (raf) return;                     // 프레임당 한 번만 적용합니다
        raf = requestAnimationFrame(() => { raf = 0; setBar(which, pending); });
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        el.classList.remove("on");
        document.body.classList.remove("resizing");
        if (raf) cancelAnimationFrame(raf);
        setBar(which, pending);
        /* 지도 컨테이너가 넓어지거나 좁아졌으니 카카오에 알려 줍니다 */
        if (kmap) { kmap.relayout(); drawPins(); }
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });

    /* 더블클릭하면 기본값으로 돌아갑니다 */
    el.addEventListener("dblclick", () => {
      setBar(which, which === "side" ? 276 : 330);
      if (kmap) { kmap.relayout(); drawPins(); }
    });

    /* 키보드로도 조절됩니다 (←→, 10px) */
    el.tabIndex = 0;
    el.addEventListener("keydown", e => {
      const step = e.shiftKey ? 40 : 10;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const cur = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue(BAR[which].v)) || 0;
      setBar(which, cur + (e.key === "ArrowRight" ? step : -step) * dir);
      if (kmap) { kmap.relayout(); drawPins(); }
    });
  }
}

loadBars();
wireGrips();
wirePthGrip();
