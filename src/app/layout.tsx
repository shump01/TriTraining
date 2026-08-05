import type { Metadata } from "next";
import {
  Anton,
  Archivo,
  Fraunces,
  Hanken_Grotesk,
  IBM_Plex_Mono,
  JetBrains_Mono,
  Space_Grotesk,
} from "next/font/google";
import { headers } from "next/headers";

import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-archivo",
  display: "swap",
});
// Landing-page display faces (marketing home only).
const anton = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-anton",
  display: "swap",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["italic"],
  variable: "--font-fraunces",
  display: "swap",
});
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});
// Fonts for the login "journey" animation (login page brand panel only).
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TriTrainer",
  description: "Plan your build, sync from Strava, and see exactly where you stand.",
  // iOS Safari's native install banner (renders <meta name="apple-itunes-app">)
  // on every page — the lightest possible "get the app" surface.
  itunes: { appId: "6791479511" },
};

// Applies the saved theme before first paint to avoid a flash. Dark is the
// default (no attribute); only "light" sets data-theme.
const themeBootstrap = `(function(){try{if(localStorage.getItem('theme')==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce minted per-request in proxy.ts — required for inline scripts under CSP.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${anton.variable} ${fraunces.variable} ${hanken.variable} ${jetbrains.variable} ${spaceGrotesk.variable} ${ibmPlexMono.variable}`}
    >
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        {children}
      </body>
    </html>
  );
}
