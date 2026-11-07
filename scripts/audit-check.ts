import { $ } from "bun";
import fs from "node:fs";

// Check files in crates/aphrody-webos-server, apps/webos, and any other landing or webos pages
const files = [
  "crates/aphrody-webos-server/src/landing.html",
  "crates/aphrody-webos-server/src/site.css",
  "crates/aphrody-webos-server/src/site.js",
  "crates/aphrody-webos-server/src/page.rs",
];

for (const file of files) {
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    console.log(`=== ${file} ===`);
    // check for letters in circles or emoji patterns
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      if (line.match(/[A-Z]<\/span>/) || line.match(/icon-avatar/) || line.match(/avatar-icon/) || line.match(/emoji/i)) {
        console.log(`  Line ${idx+1}: ${line.trim()}`);
      }
    });
  }
}
