import type { Metadata } from "next";
import { Archivo_Black, Black_Han_Sans } from "next/font/google";
import PresenceProvider from "@/components/PresenceProvider";
import { ReduxProvider } from "@/store/provider";
import { Toaster } from "sonner";
import ElasticCursor from "@/components/effects/ElasticCursor";
import RemoteCursors from "@/components/effects/RemoteCursors";
import RadialMenu from "@/components/effects/RadialMenu";
import "./globals.css";

const archivoBlack = Archivo_Black({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-archivo-black",
  display: "swap",
});

const blackHanSans = Black_Han_Sans({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-black-han-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "KERO",
  description: "WebRTC Real-time Karaoke",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${archivoBlack.variable} ${blackHanSans.variable}`}>
      <body className="antialiased">
        <PresenceProvider>
          <RemoteCursors />
          <RadialMenu />
          <ReduxProvider>{children}</ReduxProvider>
        </PresenceProvider>
        <Toaster 
          theme="dark" 
          position="top-center"
          toastOptions={{
            style: {
              background: 'rgba(0, 0, 0, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              color: 'white',
              backdropFilter: 'blur(12px)',
            },
          }}
        />
        <ElasticCursor />
      </body>
    </html>
  );
}
