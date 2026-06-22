import type { Metadata } from "next";
import { Archivo, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { headers } from "next/headers";

import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
  variable: "--font-archivo",
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

export const metadata: Metadata = {
  title: "TriTrainer",
  description: "Plan your build, sync from Strava, and see exactly where you stand.",
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
    <html lang="en" className={`${archivo.variable} ${hanken.variable} ${jetbrains.variable}`}>
      <body>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        {children}
      </body>
    </html>
  );
}
