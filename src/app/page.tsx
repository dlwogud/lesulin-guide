import { redirect } from "next/navigation";

/* 서비스의 첫 화면은 지도입니다.
 *
 * 전에는 여기에 초기 프로토타입(가짜 시드 30곳·가상 유튜버 3명)이 있었고,
 * vercel.json 의 "/" → "/map.html" 리라이트가 이 페이지에 밀려서
 * 배포된 주소를 열면 옛 화면이 나왔습니다. 그 파일들은 지웠습니다. */
export default function Home() {
  redirect("/map.html");
}
