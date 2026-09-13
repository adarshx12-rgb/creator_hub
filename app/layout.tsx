import type { Metadata } from "next";
import { IBM_Plex_Mono, Public_Sans, Space_Grotesk } from "next/font/google";
import { Sidebar } from "@/components/shell/Sidebar";
import { MobileTabBar } from "@/components/shell/MobileTabBar";
import { RouteTransition } from "@/components/motion/RouteTransition";
import { PRODUCT_NAME } from "@/lib/constants";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — find the moment, not just the video`,
  description:
    "Search for a person, subject, or topic, discover real footage with clear sources, save moments, and trim authorized media.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${publicSans.variable} ${plexMono.variable}`}>
      <body className="antialiased">
        <div className="flex min-h-dvh">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <main className="flex-1 pb-16 md:pb-0">
              <RouteTransition>{children}</RouteTransition>
            </main>
          </div>
        </div>
        <MobileTabBar />
      </body>
    </html>
  );
}
