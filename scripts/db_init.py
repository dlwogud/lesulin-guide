"""db/schema.sql 을 실행해 테이블을 만듭니다.

  set -a; source .env.local; set +a
  .venv/bin/python scripts/db_init.py
  .venv/bin/python scripts/db_init.py --check    # 연결·테이블만 확인

psql 을 따로 설치하지 않아도 되게 psycopg 로 넣습니다.
스키마는 전부 IF NOT EXISTS 라서 여러 번 돌려도 안전합니다.
"""
import os, pathlib, sys
import psycopg

ROOT = pathlib.Path(__file__).parent.parent
TABLES = ["creators", "stores", "videos", "store_videos", "comments",
          "comment_analysis", "comment_aspects", "admin_users", "admin_reviews",
          "store_stats", "pipeline_runs", "access_log", "feedback",
          "polls", "poll_replies", "poll_votes", "reply_votes"]


def connect():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        sys.exit("DATABASE_URL 이 비어 있습니다. .env.local 을 채우고\n"
                 "  set -a; source .env.local; set +a\n"
                 "후 다시 실행하세요.")
    if not url.startswith(("postgres://", "postgresql://")):
        # 값을 찍지 않습니다. 비밀번호가 들어 있을 수 있고, 찍으면 기록에 남습니다.
        sys.exit("DATABASE_URL 이 postgresql:// 로 시작하지 않습니다.\n"
                 "  Supabase → Connect → Connection string → URI 전체를 넣어야 합니다.\n"
                 "  비밀번호만 넣으면 안 됩니다.")
    try:
        return psycopg.connect(url, autocommit=True, connect_timeout=15)
    except Exception as e:
        sys.exit(f"연결 실패: {type(e).__name__}\n  {str(e)[:300]}")


def report(cur):
    cur.execute("SELECT version()")
    print("서버:", cur.fetchone()[0].split(",")[0])
    cur.execute("""SELECT table_name FROM information_schema.tables
                   WHERE table_schema='public' ORDER BY table_name""")
    have = {r[0] for r in cur.fetchall()}
    print(f"\n테이블 {len(have & set(TABLES))}/{len(TABLES)}")
    for t in TABLES:
        if t in have:
            cur.execute(f"SELECT count(*) FROM {t}")
            print(f"   ✓ {t:<18}{cur.fetchone()[0]:>10,}행")
        else:
            print(f"   · {t:<18}{'없음':>10}")
    extra = have - set(TABLES)
    if extra:
        print("   (그 외:", ", ".join(sorted(extra)) + ")")


def main():
    check = "--check" in sys.argv
    files = [sys.argv[i + 1] for i, a in enumerate(sys.argv) if a == "--file"] or ["db/schema.sql"]
    with connect() as cx, cx.cursor() as cur:
        if not check:
            for f in files:
                cur.execute((ROOT / f).read_text(encoding="utf-8"))
                print(f"{f} 적용 완료")
            print()
        report(cur)


if __name__ == "__main__":
    main()
