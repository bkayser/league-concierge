import type { NextConfig } from "next";

const OYSA_FRAME_ANCESTORS =
  "frame-ancestors 'self' https://oregonyouthsoccer.org https://www.oregonyouthsoccer.org;";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Allow the chat widget to be embedded on OYSA's website.
        source: "/",
        headers: [
          {
            key: "Content-Security-Policy",
            value: OYSA_FRAME_ANCESTORS,
          },
        ],
      },
      {
        // Prevent the admin page from being embedded anywhere.
        source: "/admin",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none';",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
