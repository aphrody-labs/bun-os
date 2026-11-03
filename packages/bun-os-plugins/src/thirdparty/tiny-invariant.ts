// Fallback module "tiny-invariant"
// API-compatible with https://github.com/alexreardon/tiny-invariant 1.x
// MIT License, Copyright (c) 2019 Alexander Reardon

// Read once at load, like the npm build. Through a local so the builtin bundler does not inline NODE_ENV.
const env = process.env;
const isProduction = env.NODE_ENV === "production";
const prefix = "Invariant failed";

function invariant(condition: unknown, message?: string | (() => string)): asserts condition {
  if (condition) return;
  if (isProduction) throw new Error(prefix);
  const provided = typeof message === "function" ? message() : message;
  throw new Error(provided ? `${prefix}: ${provided}` : prefix);
}

export default invariant;
