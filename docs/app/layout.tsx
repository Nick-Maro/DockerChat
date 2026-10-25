import '@/app/global.css';
import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider';
import { Inter } from 'next/font/google';

export const metadata: Metadata = {
  title: {
    default: 'DockerChat — self-hosted chat and network-security lab',
    template: '%s | DockerChat',
  },
  description:
    'Explore a Docker Compose chat lab with Preact, Bun WebSockets, Redis, NGINX, a Go traffic filter, and a Flask dashboard. Start locally and inspect the security model.',
  openGraph: {
    type: 'website',
    title: 'DockerChat — start a conversation, explore the network',
    description:
      'An educational self-hosted chat and network-security lab built with TypeScript, Go, Python, and Docker Compose.',
    images: [{
      url: 'https://raw.githubusercontent.com/Nick-Maro/DockerChat/main/docs/public/dockerchat-overview.png',
      width: 1200,
      height: 630,
      alt: 'DockerChat service architecture',
    }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'DockerChat — self-hosted chat and network-security lab',
    description: 'Start a conversation. Explore the services behind it.',
    images: ['https://raw.githubusercontent.com/Nick-Maro/DockerChat/main/docs/public/dockerchat-overview.png'],
  },
};

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}

