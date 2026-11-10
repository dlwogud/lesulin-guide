import { usage, accuracy, reviewStats, pipeline } from "@/lib/admin";
import { q } from "@/lib/db";

const pct = (v: number | null) => v === null ? "—" : (v * 100).toFixed(1) + "%";

function Card({ title, note, children }:
  { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl p-4"
             style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
      <div className="flex items-baseline gap-2 mb-3">
        <h2 className="text-xs font-semibold">{title}</h2>
        {note && <span className="text-[10px]" style={{ color: "var(--ink-3)" }}>{note}</span>}
      </div>
      {children}
    </section>
  );
}

function Rows({ rows, left, right }:
  { rows: Record<string, unknown>[]; left: (r: Record<string, unknown>) => string;
    right: (r: Record<string, unknown>) => string }) {
  if (!rows.length) return <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>아직 없습니다.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((r, i) => (
        <li key={i} className="flex gap-2 text-[11.5px]">
          <span className="truncate">{left(r)}</span>
          <span className="ml-auto tabular-nums shrink-0" style={{ color: "var(--ink-2)" }}>{right(r)}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function Dashboard() {
  const [u, acc, rs, runs, counts] = await Promise.all([
    usage(), accuracy(), reviewStats(), pipeline(),
    q<Record<string, string>>(`
      SELECT (SELECT count(*) FROM stores)::int           AS stores,
             (SELECT count(*) FROM videos)::int           AS videos,
             (SELECT count(*) FROM comments)::int         AS comments,
             (SELECT count(*) FROM comment_analysis
                WHERE is_visit)::int                      AS visits,
             (SELECT count(*) FROM store_stats
                WHERE guide_level IS NOT NULL)::int       AS badged,
             (SELECT count(*) FROM polls
                WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date)::int AS polls,
             (SELECT count(*) FROM feedback WHERE NOT handled)::int AS fb`),
  ]);
  const c = counts[0];
  const today = u.daily[0] as Record<string, string> | undefined;

  return (
    <div className="flex flex-col gap-4 max-w-[1100px]">
      {/* 데이터 규모 — 전부 DB에서 그 자리에 셉니다 */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        {[["식당", c.stores], ["영상", c.videos], ["댓글", c.comments],
          ["방문 명시", c.visits], ["배지", c.badged],
          ["오늘 투표", c.polls], ["미처리 신고", c.fb]].map(([k, v]) => (
          <div key={k as string} className="rounded-xl px-3 py-2.5"
               style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
            <div className="text-[15px] font-semibold tabular-nums">
              {Number(v).toLocaleString("ko-KR")}
            </div>
            <div className="text-[10px]" style={{ color: "var(--ink-3)" }}>{k}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card title="분류기 정확도" note="사람 검수와 비교 · 실시간 계산">
          {acc.n === 0 ? (
            <p className="text-[11.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
              아직 검수한 댓글이 없습니다.<br />
              <b>AI 결과 검수</b>에서 판정을 확인하면 여기 정밀도·재현율이 바로 나옵니다.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-2 mb-3">
                {[["정밀도", pct(acc.precision)], ["재현율", pct(acc.recall)], ["F1", pct(acc.f1)]]
                  .map(([k, v]) => (
                  <div key={k}>
                    <dd className="text-[15px] font-semibold tabular-nums">{v}</dd>
                    <dt className="text-[10px]" style={{ color: "var(--ink-3)" }}>{k}</dt>
                  </div>
                ))}
              </dl>
              <p className="text-[10.5px] tabular-nums" style={{ color: "var(--ink-2)" }}>
                검수 {acc.n}건 · 맞게 잡음 {acc.tp} · 잘못 잡음 {acc.fp} · 놓침 {acc.fn}
              </p>
            </>
          )}
          <p className="text-[10px] mt-2 pt-2" style={{ color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>
            검수 {rs.reviewed}건 · 애매 {rs.vague}건 · 검수자 {rs.reviewers}명
          </p>
        </Card>

        <Card title="오늘 사용 현황" note="한국 시간 기준">
          <dl className="grid grid-cols-3 gap-2">
            {[["방문자", today?.visitors], ["세션", today?.sessions], ["조회", today?.views],
              ["검색", today?.searches], ["식당 열람", today?.store_opens], ["투표 열람", today?.poll_opens]]
              .map(([k, v]) => (
              <div key={k as string}>
                <dd className="text-[15px] font-semibold tabular-nums">{Number(v ?? 0)}</dd>
                <dt className="text-[10px]" style={{ color: "var(--ink-3)" }}>{k}</dt>
              </div>
            ))}
          </dl>
          <p className="text-[10.5px] mt-3 pt-2 tabular-nums"
             style={{ color: "var(--ink-2)", borderTop: "1px solid var(--line)" }}>
            누적 방문자 {Number(u.ret?.visitors ?? 0)}명 · 재방문 {Number(u.ret?.returning ?? 0)}명
            {u.ret?.rate ? ` (${u.ret.rate}%)` : ""}
          </p>
        </Card>

        <Card title="많이 찾은 검색어">
          <Rows rows={u.terms} left={r => String(r.term)} right={r => `${r.n}회`} />
        </Card>

        <Card title="많이 열어본 식당">
          <Rows rows={u.clicked}
                left={r => String(r.name)} right={r => `${r.n}회`} />
        </Card>

        <Card title="유튜버별 열람">
          <Rows rows={u.picks} left={r => String(r.name)} right={r => `${r.n}회`} />
        </Card>

        <Card title="AI·수집 운영 로그" note="호출·소요·오류">
          {runs.length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--ink-3)" }}>기록이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {runs.slice(0, 7).map(r => {
                const x = r as Record<string, unknown>;
                const st = x.started_at ? new Date(String(x.started_at)) : null;
                const fi = x.finished_at ? new Date(String(x.finished_at)) : null;
                const sec = st && fi ? ((+fi - +st) / 1000).toFixed(1) : null;
                return (
                  <li key={String(x.id)} className="text-[11px] flex gap-2">
                    <span style={{ color: x.ok === false ? "var(--bad)" : "var(--good)" }}>
                      {x.ok === false ? "✕" : "✓"}
                    </span>
                    <span className="truncate">{String(x.step)}</span>
                    <span className="ml-auto tabular-nums shrink-0" style={{ color: "var(--ink-3)" }}>
                      {sec ? `${sec}초` : "—"}
                      {x.quota_used ? ` · 쿼터 ${x.quota_used}` : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[10px] mt-2 pt-2 leading-relaxed"
             style={{ color: "var(--ink-3)", borderTop: "1px solid var(--line)" }}>
            분류기는 규칙 기반이라 <b>토큰 비용이 없습니다(0원)</b>.
            비용 자리에는 유튜브 API 쿼터를 기록합니다.
          </p>
        </Card>
      </div>
    </div>
  );
}
