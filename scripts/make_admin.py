"""관리자 계정을 만듭니다. 심사용 계정도 이걸로 발급합니다.

  set -a; source .env.local; set +a
  .venv/bin/python scripts/make_admin.py <이메일> [역할]

비밀번호는 입력받지 않고 여기서 만들어 한 번만 보여 줍니다.
DB에는 scrypt 해시만 들어갑니다 — 평문은 저장하지 않습니다.
역할: admin(전부) / reviewer(검수만)
"""
import os, secrets, string, sys
import psycopg

ALPHA = string.ascii_letters + string.digits


def gen(n=14):
    return "".join(secrets.choice(ALPHA) for _ in range(n))


def hash_pw(pw):
    """src/lib/auth.ts 의 scrypt 형식과 같아야 합니다: scrypt$N$salt$hash"""
    import base64, hashlib
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(pw.encode(), salt=salt, n=16384, r=8, p=1, dklen=32,
                        maxmem=64 * 1024 * 1024)
    return "scrypt$16384$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(dk).decode()


def main():
    if len(sys.argv) < 2:
        sys.exit("사용법: make_admin.py <이메일> [admin|reviewer]")
    email = sys.argv[1].strip().lower()
    role = sys.argv[2] if len(sys.argv) > 2 else "admin"
    if role not in ("admin", "reviewer"):
        sys.exit("역할은 admin 또는 reviewer 입니다.")
    url = os.environ.get("DATABASE_URL", "")
    if not url.startswith(("postgres://", "postgresql://")):
        sys.exit("DATABASE_URL 이 없습니다.")

    pw = gen()
    with psycopg.connect(url, autocommit=True) as cx, cx.cursor() as cur:
        cur.execute("""INSERT INTO admin_users (email, name, role, pw_hash)
                       VALUES (%s,%s,%s,%s)
                       ON CONFLICT (email) DO UPDATE
                         SET role = EXCLUDED.role, pw_hash = EXCLUDED.pw_hash
                       RETURNING id""",
                    (email, email.split("@")[0], role, hash_pw(pw)))
        aid = cur.fetchone()[0]

    print(f"\n계정 #{aid} 준비됐습니다 — 비밀번호는 지금 한 번만 보여 줍니다.\n")
    print(f"   이메일   {email}")
    print(f"   비밀번호 {pw}")
    print(f"   역할     {role}")
    print(f"\n   로그인   /admin\n")
    print("DB에는 해시만 들어갔습니다. 잊으면 이 명령을 다시 돌려 새로 발급하세요.")


if __name__ == "__main__":
    main()
