import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "TriTrainer",
  description: "Triathlon training app",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
