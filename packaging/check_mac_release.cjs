const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

const fail = (message) => { console.error(`Mac release blocked: ${message}`); process.exit(1); };
if (process.platform !== "darwin") fail("Build the Mac installer on macOS.");

const bridge = path.join(__dirname, "..", "web", "build", "solver", "mital-solver-bridge", "mital-solver-bridge");
if (!existsSync(bridge)) fail("Build the current solver first: run python ../packaging/build_solver.py from web/.");

let identities = "";
try { identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], { encoding: "utf8" }); } catch { /* no usable keychain */ }
if (!process.env.CSC_LINK && !identities.includes("Developer ID Application:"))
  fail("No Developer ID Application certificate is available. Install it in Keychain or set CSC_LINK and CSC_KEY_PASSWORD.");

const appleId = process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID;
const apiKey = process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER;
const keychain = process.env.APPLE_KEYCHAIN_PROFILE;
if (!appleId && !apiKey && !keychain)
  fail("Apple notarization credentials are missing. Configure an App Store Connect API key, Apple ID app-specific password, or notarytool Keychain profile.");
