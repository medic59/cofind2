const { randomBytes } = require("node:crypto");

const secrets = {
  JWT_ACCESS_SECRET: token(),
  JWT_REFRESH_SECRET: token(),
  MEILISEARCH_MASTER_KEY: token(),
  PAYMENT_WEBHOOK_SECRET: token(),
  MAIL_WEBHOOK_SECRET: token(),
  POSTGRES_PASSWORD: token(24)
};

for (const [key, value] of Object.entries(secrets)) {
  console.log(`${key}=${value}`);
}

function token(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}
