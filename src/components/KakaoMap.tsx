"use client";
import { useEffect, useRef, useState } from "react";
import type { Store } from "@/lib/types";

declare global { interface Window { kakao: any } }

const SDK = (key: string) =>
  `//dapi.kakao.com/v2/maps/sdk.js?appkey=${key}&libraries=clusterer&autoload=false`;

type Props = {
  stores: Store[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onBoundsChange?: (b: { sw: [number, number]; ne: [number, number] }) => void;
};

export default function KakaoMap({ stores, selectedId, onSelect, onBoundsChange }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const clusterer = useRef<any>(null);
  const markers = useRef<Map<string, any>>(new Map());
  const [state, setState] = useState<"loading" | "ready" | "nokey" | "error">("loading");

  // SDK 로드
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;
    if (!key) { setState("nokey"); return; }
    if (window.kakao?.maps) { init(); return; }
    const s = document.createElement("script");
    s.src = SDK(key); s.async = true;
    s.onload = () => window.kakao.maps.load(init);
    s.onerror = () => setState("error");
    document.head.appendChild(s);

    function init() {
      if (!box.current) return;
      map.current = new window.kakao.maps.Map(box.current, {
        center: new window.kakao.maps.LatLng(36.5, 127.8), // 대한민국 전체
        level: 13,
      });
      clusterer.current = new window.kakao.maps.MarkerClusterer({
        map: map.current, averageCenter: true, minLevel: 6, disableClickZoom: false,
      });
      window.kakao.maps.event.addListener(map.current, "idle", () => {
        if (!onBoundsChange) return;
        const b = map.current.getBounds();
        onBoundsChange({
          sw: [b.getSouthWest().getLat(), b.getSouthWest().getLng()],
          ne: [b.getNorthEast().getLat(), b.getNorthEast().getLng()],
        });
      });
      setState("ready");
    }
  }, [onBoundsChange]);

  // 마커 갱신 — 검색 결과와 지도가 항상 같은 집합을 본다
  useEffect(() => {
    if (state !== "ready" || !clusterer.current) return;
    clusterer.current.clear();
    markers.current.clear();
    const next = stores.map((s) => {
      const m = new window.kakao.maps.Marker({
        position: new window.kakao.maps.LatLng(s.lat, s.lng),
        image: pinImage(s.creators[0]?.profileImageUrl ?? null, s.storeId === selectedId),
        title: s.storeName,
      });
      window.kakao.maps.event.addListener(m, "click", () => onSelect(s.storeId));
      markers.current.set(s.storeId, m);
      return m;
    });
    clusterer.current.addMarkers(next);
  }, [stores, selectedId, state, onSelect]);

  if (state === "nokey") return <MapNotice title="지도 키가 설정되지 않았습니다"
    body={<><code>.env.local</code>의 <code>NEXT_PUBLIC_KAKAO_MAP_KEY</code>에 카카오 JavaScript 키를 넣고 서버를 다시 시작하세요.<br />키 없이도 목록 탐색과 식당 상세는 그대로 동작합니다.</>} />;
  if (state === "error") return <MapNotice title="지도를 불러오지 못했습니다"
    body={<>네트워크 또는 도메인 등록 상태를 확인하세요. 카카오 개발자 콘솔에서 <code>localhost</code>를 플랫폼에 등록해야 합니다.</>} />;

  return (
    <div className="relative h-full w-full">
      <div ref={box} className="h-full w-full" />
      {state === "loading" && (
        <div className="absolute inset-0 grid place-items-center"
             style={{ background: "var(--surface-2)" }}>
          <span style={{ color: "var(--ink-3)", fontSize: 13 }}>지도를 불러오는 중…</span>
        </div>
      )}
    </div>
  );
}

/** 유튜버 프로필 핀. 이미지가 없으면 절제된 기본 핀으로 떨어진다. */
function pinImage(profile: string | null, active: boolean) {
  const size = active ? 52 : 44;
  const ring = active ? "var(--accent)" : "#FFFFFF";
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 8}" viewBox="0 0 ${size} ${size + 8}">
  <defs><clipPath id="c"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}"/></clipPath></defs>
  <path d="M${size / 2} ${size + 7} l-5 -8 h10 z" fill="${ring}"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${ring}"/>
  ${profile
      ? `<image href="${profile}" x="4" y="4" width="${size - 8}" height="${size - 8}" clip-path="url(#c)" preserveAspectRatio="xMidYMid slice"/>`
      : `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 4}" fill="#5B7F3A"/>
         <circle cx="${size / 2}" cy="${size / 2 - 2}" r="4" fill="#fff"/>
         <path d="M${size / 2 - 7} ${size / 2 + 8} a7 7 0 0 1 14 0z" fill="#fff"/>`}
</svg>`.trim();
  return new window.kakao.maps.MarkerImage(
    "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg))),
    new window.kakao.maps.Size(size, size + 8),
    { offset: new window.kakao.maps.Point(size / 2, size + 8) }
  );
}

function MapNotice({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div className="grid h-full w-full place-items-center px-6"
         style={{ background: "var(--surface-2)" }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <p style={{ fontWeight: 600, marginBottom: 6 }}>{title}</p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "var(--ink-2)" }}>{body}</p>
      </div>
    </div>
  );
}
