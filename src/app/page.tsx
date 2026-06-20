import Link from "next/link";

export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>TriTrainer</h1>
      <p>Next.js App Router scaffold is running.</p>
      <ul>
        <li>
          <Link href="/signup">Sign up</Link>
        </li>
        <li>
          <Link href="/login">Log in</Link>
        </li>
        <li>
          <Link href="/dashboard">Dashboard</Link> (protected)
        </li>
        <li>
          <Link href="/plans">Training plans</Link> (protected)
        </li>
        <li>
          <a href="/api/health">/api/health</a> (health probe)
        </li>
      </ul>
    </main>
  );
}
