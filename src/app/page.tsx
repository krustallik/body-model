import { checkHealth } from "@/modules/health/service";

export const dynamic = "force-dynamic";

export default async function Home() {
  const health = await checkHealth();

  return (
    <main>
      <h1>BodyCast</h1>
      <p>Backend: Online</p>
      <p>Database: {health.database === "connected" ? "Connected" : "Unavailable"}</p>
    </main>
  );
}
