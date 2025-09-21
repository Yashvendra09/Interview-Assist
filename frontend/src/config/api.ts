// src/config/api.ts
export const API_BASE = ((): string => {
    // during development, change to your backend URL
    // e.g. "http://localhost:4000"
    return process.env.REACT_APP_API_BASE || "http://localhost:4000";
  })();
  