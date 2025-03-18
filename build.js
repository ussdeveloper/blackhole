#!/usr/bin/env node

const os = require("os");
const { execSync } = require("child_process");

const platform = os.platform();
let target;
let output;

// Jeśli Windows:
if (platform === "win32") {
  target = "node22-win-x64";
  output = "blackhole.exe";
} else {
  // Dla uproszczenia – zakładamy, że każda inna platforma to Linux:
  target = "node22-linux-x64";
  output = "blackhole";
}

console.log(`Building for platform: ${platform}. Target = ${target}, output = ${output}.`);

// Wywołujemy pkg z odpowiednimi argumentami
execSync(`pkg . --targets ${target} --output ${output}`, { stdio: "inherit" });
