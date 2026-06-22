import { redirect } from "next/navigation";

export default function Home() {
  // Authenticated users land on the dashboard; the (app) layout redirects
  // unauthenticated visitors to /login.
  redirect("/dashboard");
}
