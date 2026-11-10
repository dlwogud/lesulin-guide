"use strict";
/* 르슐랭 가이드 — 카카오맵 위에 올린 버전.
   아티팩트(claude.ai)에서는 CSP가 dapi.kakao.com 스크립트와 daumcdn 타일을 막아
   이 화면이 뜨지 않습니다. 로컬(또는 도메인 등록한 호스트)에서만 동작합니다. */

const $ = id => document.getElementById(id);
let SEED, stores, creators, CRE, META;
let q = "", picked = new Set(), region = null, cat = null, selected = null;
let onlyRated = false, onlyWait = false, minViews = 0, minEv = 0, sort = "ev";
let fav = new Set();            // 내가 고른 유튜버(최대 3명) — 숨기지 않고 위로 올립니다
let kmap = null, overlays = [], lastPinch = 0;

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
    if (region && s.r !== region) return false;
    if (cat && s.cat !== cat) return false;
    if (minEv && (s.cUsed || 0) < minEv) return false;
    if (minViews && Math.max(0, ...s.vids.map(v => v.vw || 0)) < minViews) return false;
    if (t) {
      const hay = s.n + " " + s.addr + " " + s.r + " " + s.cat + " "
        + s.cs.map(i => CRE.get(i).n).join(" ") + " " + s.vids.map(v => v.t).join(" ");
      if (!hay.toLowerCase().includes(t)) return false;
    }
    return true;
  });
  const by = {
    ev:     (a,b) => b.cUsed - a.cUsed || b.cVisit - a.cVisit,
    neg:    (a,b) => (b.negN ?? -1) - (a.negN ?? -1) || b.cUsed - a.cUsed,
    wait:   (a,b) => (b.waitN ?? -1) - (a.waitN ?? -1) || b.cUsed - a.cUsed,
    views:  (a,b) => (topVid(b)?.vw||0) - (topVid(a)?.vw||0),
    recent: (a,b) => (topVid(b)?.at||"").localeCompare(topVid(a)?.at||""),
    name:   (a,b) => a.n.localeCompare(b.n, "ko"),
  }[sort];
  /* 고른 유튜버가 간 곳을 위로 올립니다. 거르는 게 아니라 순서만 바꿉니다 —
     3명만 남기면 지도가 비어 버려서 "내가 좋아하는 유튜버는 어디 갔나"와
     "그 동네에 또 뭐가 있나"를 같이 볼 수 없습니다. */
  const mine = s => fav.size && s.cs.some(c => fav.has(c)) ? 0 : 1;
  return out.sort((a, b) => mine(a) - mine(b) || by(a, b));
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

  /* 격자에 담아 묶습니다. 전에는 후보 묶음을 전부 훑어서 n×묶음 수만큼 비교했습니다. */
  const cell = new Map(), groups = [];
  const key = (x, y) => ((x / CLUSTER_PX) | 0) + "," + ((y / CLUSTER_PX) | 0);
  for (const s of near) {
    const p = px(s);
    if (s.id === selected) { groups.push({ items: [s], lat: s.lat, lng: s.lng, fixed: true }); continue; }
    const gx = (p.x / CLUSTER_PX) | 0, gy = (p.y / CLUSTER_PX) | 0;
    let hit = null;
    for (let dx = -1; dx <= 1 && !hit; dx++)
      for (let dy = -1; dy <= 1 && !hit; dy++) {
        const g = cell.get((gx + dx) + "," + (gy + dy));
        if (g && Math.hypot(g.p.x - p.x, g.p.y - p.y) < CLUSTER_PX) hit = g;
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

  overlays.forEach(o => o.setMap(null));
  overlays = [];
  for (const g of groups) {
    const pos = new kakao.maps.LatLng(g.lat, g.lng);      // 실제 좌표 — 역변환하지 않습니다
    const box = document.createElement("div");
    if (g.items.length > 1) {
      const r = 16 + Math.min(g.items.length, 10);
      // 그 묶음에서 가장 많은 채널의 얼굴을 얹습니다
      const tally = {};
      for (const s of g.items) for (const c of s.cs) tally[c] = (tally[c] || 0) + 1;
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
      box.className = "kcluster";
      box.style.cssText = `width:${r * 2}px;height:${r * 2}px`;
      box.innerHTML = `<img src="${chImg(top)}" alt="">
        <span class="n" style="font-size:${Math.max(10, r * .6).toFixed(1)}px">${g.items.length}</span>`;
      box.onclick = () => {
        const b = new kakao.maps.LatLngBounds();
        for (const s of g.items) b.extend(new kakao.maps.LatLng(s.lat, s.lng));
        kmap.setBounds(b, 80, 80, 80, 80);
      };
      overlays.push(new kakao.maps.CustomOverlay({ position: pos, content: box, clickable: true, zIndex: 2 }));
    } else {
      const s = g.items[0], on = s.id === selected, cr = CRE.get(s.cs[0]);
      box.className = "pinbox" + (on ? " sel" : "");
      box.innerHTML = `<img src="${chImg(cr.id)}" alt="${esc(cr.n)}">
        ${s.lvl ? `<span class="lv">${"◆".repeat(s.lvl)}</span>` : ""}
        <span class="tail"></span>
        ${on ? `<span class="nm">${esc(s.n)}</span>` : ""}`;
      box.onclick = e => { e.stopPropagation(); select(s.id); };
      overlays.push(new kakao.maps.CustomOverlay({ position: pos, content: box, yAnchor: 1,
                                                   clickable: true, zIndex: on ? 10 : 3 }));
    }
  }
  overlays.forEach(o => o.setMap(kmap));
}

/* ══ 우측 ══ */
/* 결과 카드를 한 번에 514개 그리면 DOM이 1만 개가 되어 지도까지 버벅입니다.
   보이는 만큼만 그리고, 아래로 내려가면 이어 붙입니다. */
const PAGE = 24;
let listCache = [], listShown = 0;

function cardHTML(s, i) {
  const v = topVid(s);
  /* 둘 이상이 간 집은 56곳이고 전부 2명이라 "외 1" 대신 그냥 나열합니다 */
  const crs = s.cs.map(id => CRE.get(id)).filter(Boolean);
  return `<button class="rcard" onclick="window.__sel('${s.id}')">
    <span class="img">
      ${v ? `<img src="${vdImg(v.id)}" alt="" loading="lazy" decoding="async" width="240" height="135">` : ""}
      ${s.lvl ? `<span class="lvchip">${"◆".repeat(s.lvl)} ${LVL[s.lvl]}</span>` : `<span class="rk">${i + 1}</span>`}
      <span class="ytstack">
        <span class="faces">${crs.map(c =>
          `<img src="${chImg(c.id)}" alt="${esc(c.n)}" width="18" height="18">`).join("")}</span>
        <span class="who">${crs.map(c => esc(c.h)).join(" · ")}</span></span>
      ${v && v.dur ? `<span class="durchip">${v.dur}</span>` : ""}
      ${fav.size && s.cs.some(c => fav.has(c)) ? `<span class="favchip">내 유튜버</span>` : ""}
    </span>
    <span class="rmeta"><h5 class="t1">${esc(s.n)}</h5>
      <span class="rsub"><span>${esc(shortRegion(s.r))}</span>
      ${s.cat ? `<i class="dot"></i><span>${esc(s.cat)}</span>` : ""}
      ${v ? `<i class="dot"></i><span>${views(v.vw)}</span>` : ""}
      <i class="dot"></i>
      ${rated(s) ? `<span class="ev">반응 ${s.cUsed}</span>${s.negN ? `<i class="dot"></i><span class="ng">쓴소리 ${s.negN}</span>` : ""}${s.waitN >= 3 ? `<i class="dot"></i><span class="wt">줄 ${s.waitN}</span>` : ""}`
                 : `<span>방문댓글 ${s.cVisit}</span>`}
    </span></span></button>`;
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
      ${["pos","neg"].map(k => s.quotes[k] ? `<div class="quote">${esc(s.quotes[k].x)}
        <span class="qm"><span>유튜브 댓글</span><span>${dateK(s.quotes[k].at)}</span>${s.quotes[k].like ? `<span>좋아요 ${nfm(s.quotes[k].like)}</span>` : ""}</span></div>` : "").join("")}
    </div>`
    : `<div class="blk"><p class="blk-t">방문자 반응</p>
       <p class="note">아직 점수를 내지 않았습니다. 댓글 ${nfm(s.cTotal)}개 중 방문 경험을 밝힌 것이 ${s.cVisit}개라
       ${s.cVisit >= 5 ? "항목이 잡히지 않았습니다" : "최소 근거(5개)에 못 미칩니다"}. 근거가 모자라면 비워 둡니다.</p></div>`;

  const kakaoTo = `https://map.kakao.com/link/to/${encodeURIComponent(s.n)},${s.lat},${s.lng}`;
  $("panel").innerHTML = `
    <div class="det">
      <div class="det-hero">${hero ? `<img src="${vdImg(hero.id)}" alt="">` : ""}
        <button class="det-back" onclick="window.__close()">&larr;</button>
        ${hero ? `<a class="det-play" href="${YT(hero.id)}" target="_blank" rel="noreferrer">▶</a>
          ${hero.dur ? `<span class="det-dur">${hero.dur}</span>` : ""}` : ""}</div>
      <div class="det-b">
        <div class="det-title">
          <div class="badges">
            ${s.lvl ? `<span class="bdg c">${"◆".repeat(s.lvl)} ${LVL[s.lvl]}</span>` : ""}
            ${rated(s) ? `<span class="bdg t">방문 반응 ${s.cUsed}</span>` : `<span class="bdg n">근거 부족</span>`}
            ${s.waitN >= 3 ? `<span class="bdg w">줄 서는 집</span>` : ""}
            ${s.cat ? `<span class="bdg n">${esc(s.cat)}</span>` : ""}
          </div>
          <h3>${esc(s.n)}</h3><p class="addr">${esc(s.addr || shortRegion(s.r))}</p>
        </div>
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
      </div>
      <div class="acts" style="border-top:0;padding-top:0">
        <button class="sec" style="flex:none;padding:8px 12px;font-size:11.5px"
          onclick="window.__report('${s.id}')">정보가 틀렸어요</button>
      </div></div>`;
}

function select(id) {
  const s = stores.find(v => v.id === id); if (!s) return;
  selected = id; renderDetail(s);
  if (kmap) { kmap.setLevel(4); kmap.panTo(new kakao.maps.LatLng(s.lat, s.lng)); drawPins(); }
}
window.__sel = select;
window.__close = () => { selected = null; renderResults(); drawPins(); };

/* ══ 좌측 ══ */
function renderChips() {
  const m = new Map();
  for (const s of stores) m.set(s.r, (m.get(s.r)||0) + 1);
  const rs = [...m].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0],"ko"));
  $("regHint").textContent = `${m.size}개 시군구`;
  $("regList").innerHTML = rs.map(([r,n]) => `<button class="chip${region===r?" on":""}"
    onclick="window.__reg('${r}')">${esc(shortRegion(r))}<span class="c">${n}</span></button>`).join("");
  $("regLabel").textContent = region ? shortRegion(region) : "지역";
  $("regToggle").classList.toggle("on", !!region);
}
function regOpen(v) {
  $("regPop").hidden = !v;
  $("regToggle").setAttribute("aria-expanded", String(v));
  if (v) { const on = $("regList").querySelector(".chip.on"); if (on) on.scrollIntoView({ block:"nearest" }); }
}
/* ══ 선호 유튜버 고르기 ══ */
const FAV_KEY = "lesulin.fav";
const FAV_MAX = 3;

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
    const full = !on && fav.size >= FAV_MAX;
    return `<button class="favcard${on?" on":""}" ${full?"disabled":""}
        onclick="window.__fav('${c.id}')" aria-pressed="${on}">
      <img src="${chImg(c.id)}" alt="">
      <span><b>${esc(c.n)}</b><s>${c.subs ? subsK(c.subs) + " · " : ""}식당 ${n}곳</s></span></button>`;
  }).join("");
  $("favCnt").textContent = fav.size
    ? `${fav.size} / ${FAV_MAX} 선택 — 다시 누르면 해제됩니다`
    : `0 / ${FAV_MAX}`;
  if ($("favReset")) $("favReset").hidden = !fav.size;
  /* 이미 고른 사람이 있으면 "그냥 둘러보기"가 무슨 뜻인지 헷갈립니다 */
  if ($("favSkip")) $("favSkip").textContent = fav.size ? "안 쓰고 닫기" : "그냥 둘러보기";
}
window.__fav = id => {
  if (fav.has(id)) fav.delete(id);
  else if (fav.size < FAV_MAX) fav.add(id);
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
  if (record) saveFav();
  syncFavBtn(); renderCres(); refresh(false);
}
function syncFavBtn() {
  if ($("favEdit")) $("favEdit").textContent =
    fav.size ? `내 유튜버 ${fav.size}명 바꾸기` : "내 유튜버 고르기";
  if ($("favClear")) $("favClear").hidden = !fav.size;
}
function clearFav() {                         // 고른 3명을 되돌립니다
  fav.clear(); saveFav(); syncFavBtn(); renderCres(); refresh(false);
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
    const n = stores.filter(s => s.cs.includes(c.id)).length, on = picked.has(c.id);
    return `<button class="ytrow${on?" on":""}" onclick="window.__cre('${c.id}')" aria-pressed="${on}">
      <img src="${chImg(c.id)}" alt="">
      <span class="nm"><b class="t1">${esc(c.n)}${fav.has(c.id) ? " ★" : ""}</b><span class="t1">${esc(c.handle||"")}</span></span>
      <span class="cnt">${n}</span><span class="chk">✓</span></button>`;
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
  $("creHint").textContent = picked.size ? `${picked.size}개 선택` : `${creators.length}개 채널`;
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
function renderCats() {
  const m = new Map();
  for (const s of stores) if (s.cat) m.set(s.cat, (m.get(s.cat)||0) + 1);
  const cs = [...m].sort((a,b) => b[1]-a[1]).slice(0, 12);
  $("catHint").textContent = `${m.size}종`;
  $("cats").innerHTML = cs.map(([c,n]) => `<button class="chip${cat===c?" on":""}"
    onclick="window.__cat('${c}')">${esc(c)}<span class="c">${n}</span></button>`).join("");
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
window.__cre = id => { picked.has(id) ? picked.delete(id) : picked.add(id); selected = null; refresh(true); };
window.__reg = r => { region = region === r ? null : r; selected = null; regOpen(false); refresh(true); };
window.__cat = c => { cat = cat === c ? null : c; selected = null; refresh(true); };

function refresh(fit) {
  renderChips(); renderCres(); renderFeed(); renderCats(); renderHist();
  const list = filtered();
  $("tbStores").textContent = nfm(list.length);
  $("tbVids").textContent = nfm(new Set(list.flatMap(s => s.vids.map(v => v.id))).size);
  $("tbCmt").textContent = nfm(list.reduce((a,s) => a + s.cTotal, 0));
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
  const rm = new Map(); for (const s of stores) rm.set(s.r, (rm.get(s.r)||0) + 1);
  const rs = [...rm].filter(([r]) => (r + shortRegion(r)).toLowerCase().includes(t)).slice(0, 5);
  const ss = filtered().slice(0, 6);
  if (!cs.length && !rs.length && !ss.length) {
    $("ac").innerHTML = `<p class="empty">검색 결과가 없습니다</p>`; $("ac").hidden = false; return;
  }
  const grp = (l, items) => items.length ? `<div class="g"><p class="gl">${l}</p>${items.join("")}</div>` : "";
  $("ac").innerHTML =
    grp("유튜버", cs.map(c => `<button onclick="window.__pick('c','${c.id}')">
      <img src="${chImg(c.id)}" style="width:20px;height:20px;border-radius:50%"><span class="m">${esc(c.n)}</span>
      <span class="s">${stores.filter(s => s.cs.includes(c.id)).length}곳</span></button>`)) +
    grp("지역", rs.map(([r,n]) => `<button onclick="window.__pick('r','${r}')">
      <span class="m">${esc(shortRegion(r))}</span><span class="s">${n}곳</span></button>`)) +
    grp("식당", ss.map(s => `<button onclick="window.__pick('s','${s.id}')">
      <span class="m t1">${esc(s.n)}</span><span class="s">${esc(shortRegion(s.r))}</span></button>`));
  $("ac").hidden = false;
}
window.__pick = (k, v) => {
  q = ""; $("q").value = ""; $("clr").hidden = true; $("ac").hidden = true;
  if (k === "c") { picked = new Set([v]); selected = null; refresh(true); }
  else if (k === "r") { region = v; selected = null; refresh(true); }
  else { refresh(false); select(v); }
};

/* ══ 시작 ══ */
function wire() {
  $("q").addEventListener("input", e => {
    q = e.target.value; $("clr").hidden = !q;
    clearTimeout(acTimer); acTimer = setTimeout(() => { suggest(); refresh(false); }, 150);
  });
  $("clr").onclick = () => { q = ""; $("q").value = ""; $("clr").hidden = true; $("ac").hidden = true; refresh(true); };
  document.addEventListener("pointerdown", e => { if (!e.target.closest(".srch")) $("ac").hidden = true; });
  $("regToggle").onclick = () => regOpen($("regPop").hidden);
  $("regClear").onclick = () => { region = null; selected = null; regOpen(false); refresh(true); };
  document.addEventListener("pointerdown", e => { if (!e.target.closest(".regbtn")) regOpen(false); });
  addEventListener("keydown", e => { if (e.key === "Escape") regOpen(false); });
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
  const asked = loadFav();
  wire(); syncFavBtn(); refresh(false);
  if (!asked) openFav();                     // 첫 방문에만 묻습니다
  instrument();                              // 사용 기록을 켭니다 (아래 정의)

  const key = window.__MAPKEY__ || await mapKey();
  if (!key) return mapFailed(
    "지도 JS 키가 없습니다. 주소 뒤에 <code>?key=발급받은_JavaScript_키</code>를 붙여 다시 여세요.");
  const sc = document.createElement("script");
  sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&autoload=false`;
  sc.onerror = () => mapFailed(
    "카카오 지도 SDK를 불러오지 못했습니다.<br>" +
    "카카오 개발자 콘솔 → 앱 설정 → 플랫폼 → Web 에 <code>" + location.origin + "</code> 을 등록했는지 확인하세요.");
  sc.onload = () => kakao.maps.load(() => { try { initMap(); } catch (e) { mapFailed(String(e)); } });
  document.head.appendChild(sc);
})();

/* ══════════════════════════════════════════════════════════════════
   실시간 투표 — 8초마다 확인하고, 새 글이 오면 오른쪽 위에 알립니다.

   "밤 12시 초기화"는 크론으로 지우지 않습니다. 글에 한국 날짜를 박아 두고
   서버가 오늘 것만 돌려줍니다 — 0시가 지나면 저절로 새 판이 됩니다.
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
  return m < 1 ? "방금" : m < 60 ? m + "분 전" : Math.floor(m / 60) + "시간 전";
};

/* ── 알림 ───────────────────────────────────────────────── */
function toast(p) {
  const box = $("ntfs");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "ntf";
  const where = p.store_name ? `📍 ${esc(p.store_name)}`
              : p.place ? `📍 ${esc(shortRegion(p.place))}` : "르슐랭 가이드";
  el.innerHTML = `<div class="th"><b>새 투표</b><span>·</span><span>${where}</span></div>
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
     오늘 몇 건인지는 왼쪽 "실시간 인기 투표" 쪽에 적습니다. */
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
      if (!preps.has(x.poll_id)) preps.set(x.poll_id, []);
      preps.get(x.poll_id).push(x);
    }
    if (notify) for (const p of fresh.slice(0, 2)) toast(p);
    paintBell(); renderHot();
    if (pollOn) renderPolls();
    return true;
  } catch { return false; }
}

/* ── 좌측 실시간 인기 ───────────────────────────────────── */
function renderHot() {
  const el = $("hotList"); if (!el) return;
  const top = [...polls].sort((a, b) => b.heat - a.heat || +b.id - +a.id).slice(0, 5);
  if ($("hotHint")) $("hotHint").textContent = `오늘 ${polls.length}건`;
  if (!top.length) {
    el.innerHTML = `<p class="hotempty">아직 오늘 올라온 투표가 없습니다.<br>
      오른쪽 위 <b>투표</b>에서 첫 글을 올려 보세요.</p>`;
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
    el.innerHTML = `<p class="hotempty">오늘 올라온 투표가 없습니다.<br>
      아래에 첫 질문을 올려 보세요 — 밤 12시에 새로 시작합니다.</p>`;
    return;
  }
  el.innerHTML = polls.map((p, i) => {
    const rs = preps.get(+p.id) || [];
    const isNew = +p.id > seen.poll && !p.mine;
    return `<article class="pitem${isNew ? " hot" : ""}" id="p${p.id}">
      <div class="ph">
        ${pollSort === "hot" && i < 3 ? `<span class="rk">${i + 1}</span>` : ""}
        <span>${esc(p.nickname || "익명")}</span><span>·</span><span>${ago(p.created_at)}</span>
        ${p.store_name ? `<span class="st">📍 ${esc(p.store_name)}</span>`
          : p.place ? `<span>· ${esc(shortRegion(p.place))}</span>` : ""}
      </div>
      <p class="pt">${esc(p.body)}</p>
      <div class="pf">
        <button class="vbtn${p.my_vote === 1 ? " on" : ""}"
          onclick="window.__vote(${p.id},1,'poll')">👍 ${p.ups}</button>
        <button class="vbtn dn${p.my_vote === -1 ? " on" : ""}"
          onclick="window.__vote(${p.id},-1,'poll')">👎 ${p.downs}</button>
        <button class="rbtn" onclick="window.__reply(${p.id})">답글 ${p.replies || ""}</button>
      </div>
      ${rs.length ? `<div class="plist">${rs.map(r => `<div class="prep">
          <span class="who">${esc(r.nickname || "익명")}</span>
          <span>${esc(r.body)}${r.store_name ? ` <b>📍${esc(r.store_name)}</b>` : ""}</span>
          <button class="vbtn rv${r.my_vote === 1 ? " on" : ""}"
            onclick="window.__vote(${r.id},1,'reply')">♥ ${r.ups}</button>
        </div>`).join("")}</div>` : ""}
    </article>`;
  }).join("");
}

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

window.__reply = async id => {
  const body = prompt("답글을 적어 주세요. 가게 이름을 넣으면 다른 사람이 찾기 쉽습니다.");
  if (!body || !body.trim()) return;
  try {
    const r = await fetch(`/api/polls/${id}/reply`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ session: sid, body: body.trim() }),
    });
    const d = await r.json();
    if (!r.ok) return alert(d.error || "답글을 달지 못했습니다.");
    await pullPolls(false);
  } catch { alert("답글을 달지 못했습니다."); }
};

/* ── 올리기 ─────────────────────────────────────────────── */
function pollTagText() {
  if (pollTarget) return `📍 ${pollTarget.n} 에 대해 — 좋아요·싫어요가 달립니다`;
  if (myLoc) return `📍 ${myLoc.label} 근처로 올라갑니다`;
  return "위치 없이 올라갑니다 (지도를 움직이면 그 자리 기준)";
}
function syncForm() {
  const t = $("pollText"); if (!t) return;
  $("pollTag").textContent = pollTagText();
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
    t.value = ""; pollTarget = null;
    await pullPolls(false);
    markSeen();
  } catch { alert("올리지 못했습니다."); }
  syncForm();
}

/* 위치는 지도 중심을 씁니다 — 브라우저 위치 권한을 묻지 않아도
   "내가 지금 보고 있는 동네"가 사실 더 맞습니다. 권한을 준 경우엔 그걸 씁니다. */
function locFromMap() {
  if (!kmap) return;
  const c = kmap.getCenter();
  myLoc = { lat: c.getLat(), lng: c.getLng(), label: "지도 중심" };
  const near = stores.reduce((b, s) => {
    const d = (s.lat - myLoc.lat) ** 2 + (s.lng - myLoc.lng) ** 2;
    return !b || d < b.d ? { d, s } : b;
  }, null);
  if (near) myLoc.label = shortRegion(near.s.r);
  syncForm();
}

function openPolls() {
  if (!$("pollWrap")) return;
  pollOn = true; $("pollWrap").hidden = false;
  document.body.classList.add("pollopen");
  $("bell")?.classList.add("open");
  locFromMap(); renderPolls(); markSeen();
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
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && pollOn) closePolls();
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
  $("pollText").focus();
  syncForm();
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
  ["wrong_score", "반응 수나 배지가 이상해요", "숫자나 ◆ 표시가 안 맞습니다"],
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
