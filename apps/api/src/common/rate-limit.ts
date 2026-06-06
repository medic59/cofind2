export const rateLimit = (productionLimit: number, devLimit = 240) => (
  process.env.NODE_ENV === "production" ? productionLimit : devLimit
);
