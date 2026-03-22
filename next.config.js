/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // face-api.js uses 'fs', 'crypto', etc., which are only available in Node.js
    if (!isServer) {
        config.resolve.fallback = {
            ...config.resolve.fallback,
            fs: false,
            crypto: false,
            path: false,
            os: false,
            encoding: false,
        };
    }
    return config;
  },
};

module.exports = nextConfig;
