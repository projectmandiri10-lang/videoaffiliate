import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);

function detectLinuxLibc() {
  if (process.platform !== "linux") {
    return null;
  }

  if (typeof process.report?.getReport === "function") {
    const report = process.report.getReport();
    if (report?.header?.glibcVersionRuntime) {
      return "gnu";
    }
  }

  return "musl";
}

function resolveRollupNativePackage() {
  const { platform, arch } = process;

  if (platform === "win32") {
    if (arch === "x64") {
      return "@rollup/rollup-win32-x64-msvc";
    }
    if (arch === "arm64") {
      return "@rollup/rollup-win32-arm64-msvc";
    }
    if (arch === "ia32") {
      return "@rollup/rollup-win32-ia32-msvc";
    }
    return null;
  }

  if (platform === "darwin") {
    if (arch === "arm64") {
      return "@rollup/rollup-darwin-arm64";
    }
    if (arch === "x64") {
      return "@rollup/rollup-darwin-x64";
    }
    return null;
  }

  if (platform === "linux") {
    const libc = detectLinuxLibc();
    if (arch === "x64") {
      return `@rollup/rollup-linux-x64-${libc}`;
    }
    if (arch === "arm64") {
      return `@rollup/rollup-linux-arm64-${libc}`;
    }
    if (arch === "arm") {
      return libc === "gnu"
        ? "@rollup/rollup-linux-arm-gnueabihf"
        : "@rollup/rollup-linux-arm-musleabihf";
    }
    if (arch === "ppc64") {
      return `@rollup/rollup-linux-ppc64-${libc}`;
    }
    if (arch === "s390x") {
      return "@rollup/rollup-linux-s390x-gnu";
    }
    if (arch === "riscv64") {
      return `@rollup/rollup-linux-riscv64-${libc}`;
    }
    if (arch === "loong64") {
      return `@rollup/rollup-linux-loong64-${libc}`;
    }
  }

  return null;
}

function ensureInstalled(packageName, version) {
  try {
    require.resolve(packageName);
    return;
  } catch {
    console.warn(`[build] Missing ${packageName}. Installing ${packageName}@${version}...`);
  }

  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["install", "--no-save", `${packageName}@${version}`],
    {
      stdio: "inherit",
      cwd: process.cwd(),
      env: process.env
    }
  );
}

const nativePackage = resolveRollupNativePackage();

if (!nativePackage) {
  process.exit(0);
}

const rollupPackageJsonPath = require.resolve("rollup/package.json");
const rollupPackageJson = require(rollupPackageJsonPath);

ensureInstalled(nativePackage, rollupPackageJson.version);
