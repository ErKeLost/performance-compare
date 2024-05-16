import { spawn } from "child_process";
import { appendFile, readFileSync, writeFileSync } from "fs";
import path from "path";
import puppeteer from "puppeteer";
import kill from "tree-kill";
import {
  Logger as DefaultLogger,
  magenta,
  purple,
  green,
  yellow,
  cyan,
} from "@farmfe/core";
import { deleteCacheFiles, mergeAllVersions, getChartPic } from "./utils.mjs";

const startConsole = "console.log('Start Time', Date.now());";
// const startConsoleRegex = /Start Time (\d+)/;
const logger = new DefaultLogger();

const brandColor = new Map([
  ["Farm 1.0.0", purple],
  ["Farm 1.0.0 (Hot)", purple],
  ["Rspack 0.5.7", green],
  ["Rspack 0.5.7 (Hot)", green],
  ["Vite 5.0.5", yellow],
  ["Vite 5.0.5 (Hot)", yellow],
  ["Webpack(babel) 5.89.0", cyan],
  ["Webpack(babel) 5.89.0 (Hot)", cyan],
]);

class BuildTool {
  constructor(
    name,
    port,
    script,
    startedRegex,
    buildScript,
    buildRegex,
    binFilePath,
    skipHmr = false
  ) {
    this.name = name;
    this.port = port;
    this.script = script;
    this.startedRegex = startedRegex;
    this.buildScript = buildScript;
    this.buildRegex = buildRegex;
    this.skipHmr = skipHmr;
    this.binFilePath = path.join(process.cwd(), "node_modules", binFilePath);
    logger.info("hack bin file for", this.name, "under", this.binFilePath, {
      name: this.name,
      brandColor: brandColor.get(this.name),
    });
    this.hackBinFile();
  }

  // Add a `console.log('Farm start', Date.now())` to the bin file's second line
  hackBinFile() {
    const binFileContent = readFileSync(this.binFilePath, "utf-8");

    if (!binFileContent.includes(startConsole)) {
      const lines = binFileContent.split("\n");
      lines.splice(1, 0, startConsole);
      writeFileSync(this.binFilePath, lines.join("\n"));
    }
  }

  removeANSIColors(input) {
    return input.replace(/\x1B\[[0-9;]*[mGKH]/g, "");
  }

  async startServer() {
    return new Promise((resolve, reject) => {
      const child = spawn(`npm`, ["run", this.script], {
        stdio: "pipe",
        shell: true,
      });
      this.child = child;

      child.stdout.on("data", (data) => {
        const normalizedData = data.toString("utf8").replace(/\r\n/g, "\n");
        const match = this.startedRegex.exec(normalizedData);
        if (match) {
          // TODO REAL COMPILATION TIME
          // Adaptation windows ANSI  color
          const cleanedMatch = match.map((part) => this.removeANSIColors(part));
          let result;
          if (typeof cleanedMatch[1] === "number") {
            result = cleanedMatch[1];
          } else if (typeof cleanedMatch[1] === "string") {
            result = parseFloat(cleanedMatch[1].replace(/[a-zA-Z ]/g, ""));
          }
          resolve(result);
        }
      });
      child.on("error", (error) => {
        logger.error(`error: ${error.message}`);
        reject(error);
      });
      child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          logger.info(
            `(run ${this.script} failed) child process exited with code ${code}`,
            {
              name: this.name,
              brandColor: brandColor.get(this.name),
            }
          );
          reject(code);
        }
      });
    });
  }

  stopServer() {
    if (this.child) {
      this.child.stdin.pause();
      this.child.stdout.destroy();
      this.child.stderr.destroy();
      kill(this.child.pid);
    }
  }

  async build() {
    return new Promise(async (resolve) => {
      logger.info(`Running build command: ${this.buildScript}`, {
        name: this.name,
        brandColor: brandColor.get(this.name),
      });
      const child = spawn(`npm`, ["run", this.buildScript], {
        stdio: ["pipe"],
        shell: true,
      });
      child.stdout.on("data", (data) => {
        const match = this.buildRegex.exec(data.toString("utf8"));
        if (match) {
          const cleanedMatch = match.map((part) => this.removeANSIColors(part));
          let result;
          if (typeof cleanedMatch[1] === "number") {
            result = cleanedMatch[1];
          } else if (typeof cleanedMatch[1] === "string") {
            result = parseFloat(cleanedMatch[1].replace(/[a-zA-Z ]/g, ""));
          }
          resolve(match[2] === "s" ? result * 1000 : result);
        }
      });
      return new Promise((resolve, reject) => {
        child.on("exit", resolve);
        child.on("error", reject);
      });
    });
  }
}

const buildTools = [
  new BuildTool(
    "Farm 1.1.7",
    9000,
    "start",
    /Ready\s*in\s*(.+)(s|ms)/,
    "build",
    /completed\s*in\s*(\d+)(m?ms)/,
    "@farmfe/cli/bin/farm.mjs"
  ),
  new BuildTool(
    "Farm 1.1.7 (Hot)",
    9000,
    "start",
    /Ready\s*in\s*(.+)(s|ms)/,
    "build",
    /completed\s*in\s*(\d+)(m?ms)/,
    "@farmfe/cli/bin/farm.mjs",
    true
  ),
  new BuildTool(
    "Rspack 0.6.5",
    8080,
    "start:rspack",
    /in\s+(.+) (s|ms)/,
    "build:rspack",
    /in\s+(.+) (s|ms)/,
    "@rspack/cli/bin/rspack"
  ),
  new BuildTool(
    "Rspack 0.6.5 (Hot)",
    8080,
    "start:rspack",
    /in\s+(.+) (s|ms)/,
    "build:rspack",
    /in (.+) (s|ms)/,
    "@rspack/cli/bin/rspack",
    true
  ),
  new BuildTool(
    "Vite 6.0.0-alpha",
    5173,
    "start:vite",
    /ready\s*in\s*(.+)(s|ms)/,
    "build:vite",
    /built\s*in\s*(\d*\.\d*)\s*(s|ms)/,
    "vite/bin/vite.js"
  ),
  new BuildTool(
    "Vite 6.0.0-alpha (Hot)",
    5173,
    "start:vite",
    /ready\s*in\s*(.+)(s|ms)/,
    "build:vite",
    /built\s*in\s*(\d*\.\d*)\s*(s|ms)/,
    "vite/bin/vite.js",
    true
  ),
  // new BuildTool(
  //   "Turbopack 14.0.3",
  //   3000,
  //   "start:turbopack",
  //   /\s*Ready\s*in(.+)(s|ms)/,

  //   "build:turbopack",
  //   /prerendered\s+as\s+static\s+content/,
  //   "next/dist/bin/next"
  // ),
  // new BuildTool(
  //   "Turbopack 14.0.3 (Hot)",
  //   3000,
  //   "start:turbopack",
  //   /\s*Ready\s*in(.+)(s|ms)/,
  //   "build:turbopack",
  //   /prerendered\s+as\s+static\s+content/,
  //   "next/dist/bin/next",
  //   true
  // ),
  new BuildTool(
    "Webpack(babel) 5.91.0",
    8081,
    "start:webpack",
    /compiled\s+.+\sin\s+(\d+)\s+ms/,
    "build:webpack",
    /in\s+(\d+)\s+(ms|s)/,
    "webpack-cli/bin/cli.js"
  ),
  new BuildTool(
    "Webpack(babel) 5.91.0 (Hot)",
    8081,
    "start:webpack",
    /compiled\s+.+\sin\s+(\d+)\s+ms/,
    "build:webpack",
    /in\s+(\d+)\s+(ms|s)/,

    "webpack-cli/bin/cli.js",
    true
  ),
];

const browser = await puppeteer.launch();

const n = 3;

logger.info("Running benchmark " + n + " times, please wait...", {
  brandColor: magenta,
});

const totalResults = [];

for (let i = 0; i < n; i++) {
  // delete cache
  await deleteCacheFiles();
  await runBenchmark();
}

async function runBenchmark() {
  const results = {};

  for (const buildTool of buildTools) {
    const time = await buildTool.startServer();
    const page = await browser.newPage();
    const start = Date.now();

    page.on("load", () => {
      const loadTime = Date.now() - start;
      logger.info(": startup time: " + (time + loadTime) + "ms", {
        name: buildTool.name,
        brandColor: brandColor.get(buildTool.name),
      });

      if (!results[buildTool.name]) {
        results[buildTool.name] = {};
      }

      results[buildTool.name]["startup(serverStartTime + onLoadTime)"] =
        time + loadTime;
      results[buildTool.name].serverStartTime = time;
      results[buildTool.name].onLoadTime = loadTime;
    });

    logger.info("Navigating to", `http://localhost:${buildTool.port}`, {
      name: buildTool.name,
      brandColor: brandColor.get(buildTool.name),
    });

    await page.goto(`http://localhost:${buildTool.port}`, {
      timeout: 60000,
    });

    // if (!buildTool.skipHmr) {
    let waitResolve = null;
    const waitPromise = new Promise((resolve) => {
      waitResolve = resolve;
    });

    let hmrRootStart = -1;
    let hmrLeafStart = -1;

    page.on("console", (event) => {
      const isFinished = () => {
        return (
          results[buildTool.name]?.rootHmr && results[buildTool.name]?.leafHmr
        );
      };
      if (event.text().includes("root hmr")) {
        const clientDateNow = /(\d+)/.exec(event.text())[1];
        const hmrTime = clientDateNow - hmrRootStart;
        logger.info(" Root HMR time: " + hmrTime + "ms", {
          name: buildTool.name,
          brandColor: brandColor.get(buildTool.name),
        });

        results[buildTool.name].rootHmr = hmrTime;
        if (isFinished()) {
          page.close();
          waitResolve();
        }
      } else if (event.text().includes("leaf hmr")) {
        const hmrTime = Date.now() - hmrLeafStart;
        logger.info(" Leaf HMR time: " + hmrTime + "ms", {
          name: buildTool.name,
          brandColor: brandColor.get(buildTool.name),
        });
        results[buildTool.name].leafHmr = hmrTime;
        if (isFinished()) {
          page.close();
          waitResolve();
        }
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const originalRootFileContent = readFileSync(
      path.resolve("src", "comps", "triangle.jsx"),
      "utf-8"
    );

    appendFile(
      path.resolve("src", "comps", "triangle.jsx"),
      `
      console.log('root hmr', Date.now());
      `,
      (err) => {
        if (err) throw err;
        hmrRootStart = Date.now();
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const originalLeafFileContent = readFileSync(
      path.resolve("src", "comps", "triangle_1_1_2_1_2_2_1.jsx"),
      "utf-8"
    );
    appendFile(
      path.resolve("src", "comps", "triangle_1_1_2_1_2_2_1.jsx"),
      `
        console.log('leaf hmr', Date.now());
        `,
      (err) => {
        if (err) throw err;
        hmrLeafStart = Date.now();
      }
    );

    await waitPromise;

    // restore files
    writeFileSync(
      path.resolve("src", "comps", "triangle.jsx"),
      originalRootFileContent
    );
    writeFileSync(
      path.resolve("src", "comps", "triangle_1_1_2_1_2_2_1.jsx"),
      originalLeafFileContent
    );

    buildTool.stopServer();
    // } else {
    //   logger.warn("The Second BuildTools Skip HMR");
    // }

    await new Promise((resolve) => setTimeout(resolve, 500));
    logger.info("close Server", {
      brandColor: brandColor.get(buildTool.name),
    });
    logger.info("prepare build", {
      brandColor: brandColor.get(buildTool.name),
    });
    const buildTime = await buildTool.build();
    logger.info(": build time: " + buildTime + "ms", {
      name: buildTool.name,
      brandColor: brandColor.get(buildTool.name),
    });
    results[buildTool.name].buildTime = buildTime;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  totalResults.push(results);
}

const averageResults = {};
const chart = {};
const chartData = {};
for (const result of totalResults) {
  for (const [name, values] of Object.entries(result)) {
    if (!averageResults[name]) {
      averageResults[name] = {};
    }

    if (!chartData[name]) {
      chartData[name] = {};
    }

    if (!chart[name]) {
      chart[name] = {};
    }

    for (const [key, value] of Object.entries(values)) {
      if (!averageResults[name][key]) {
        averageResults[name][key] = "Calculation error Time ！";
      }

      if (!chartData[name][key]) {
        chartData[name][key] = 0;
        chart[name][key] = 0;
      }

      chartData[name][key] += Number(value);
      averageResults[name][key] =
        Math.floor(chartData[name][key] / totalResults.length) + "ms";
      chart[name][key] = Math.floor(chartData[name][key] / totalResults.length);
    }
  }
}

mergeAllVersions(chart);

logger.info("average results of " + totalResults.length + " runs:", {
  brandColor: magenta,
});
const benchmarkData = { ...chart };
await getChartPic(benchmarkData);
console.table(averageResults);

process.exit(0);
