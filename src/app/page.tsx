import Explorer from "@/components/Explorer";
import { getCreators, getRegions, getStores } from "@/lib/data";

export default function Home() {
  return (
    <Explorer
      initialStores={getStores()}
      creators={getCreators()}
      regions={getRegions().slice(0, 12)}
    />
  );
}
