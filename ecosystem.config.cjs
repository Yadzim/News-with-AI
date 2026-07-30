module.exports = {
  apps: [
    {
      name: "news-bot",
      cwd: "/var/www/news-bot",
      script: "npx",
      args: "tsx src/index.ts",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
    {
      name: "news-admin",
      cwd: "/var/www/news-bot",
      script: "npx",
      args: "tsx src/server.ts",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
