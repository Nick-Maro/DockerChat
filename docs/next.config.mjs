import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  // GitHub Pages deployment
  ...(process.env.NODE_ENV === 'production' && {
    assetPrefix: '/docker-mini-network/',
    basePath: '/docker-mini-network',
  }),
};

export default withMDX(config);
