import { spawnSync } from "node:child_process";

const commands = [
  ["typecheck", ["run", "typecheck"]],
  ["lint", ["run", "lint"]],
  ["test", ["run", "test"]],
  ["build", ["run", "build"]],
];

for (const [name, args] of commands) {
  console.log(`\n[verify] npm ${args.join(" ")}\n`);

  const result = spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.error) {
    console.error(`[verify] ${name} could not start: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[verify] ${name} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\n[verify] all checks passed");
