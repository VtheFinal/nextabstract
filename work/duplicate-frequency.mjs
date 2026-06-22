import { mkdir, writeFile } from "node:fs/promises";

const API_URL = process.env.NEXT_ABSTRACT_API_URL || "http://localhost:3000/api/abstract";
const TRIAL_COUNT = 5;
const MAX_LOADS_PER_TRIAL = 200;
const REQUEST_DELAY_MS = Number(process.env.DIAGNOSTIC_REQUEST_DELAY_MS || 1000);
const OUTPUT_DIR = "outputs";
const RAW_OUTPUT_PATH = `${OUTPUT_DIR}/duplicate-frequency-results.json`;
const REPORT_OUTPUT_PATH = `${OUTPUT_DIR}/duplicate-frequency-report.md`;

await mkdir(OUTPUT_DIR, { recursive: true });

const trials = [];
let totalSuccessfulApiCalls = 0;
let totalFailedApiCalls = 0;

for (let trialNumber = 1; trialNumber <= TRIAL_COUNT; trialNumber += 1) {
  const seen = new Map();
  let recentKeys = [];
  const trial = {
    trialNumber,
    duplicateLoadNumber: 0,
    successfulApiCalls: 0,
    failedApiCalls: 0,
    duplicate: null,
    failures: []
  };

  for (let loadNumber = 1; loadNumber <= MAX_LOADS_PER_TRIAL; loadNumber += 1) {
    process.stdout.write(
      `Trial ${trialNumber}/${TRIAL_COUNT}, load ${loadNumber}/${MAX_LOADS_PER_TRIAL}...\r`
    );

    const result = await fetchPaper(loadNumber, recentKeys);
    await sleep(REQUEST_DELAY_MS);

    if (!result.ok) {
      trial.failedApiCalls += 1;
      totalFailedApiCalls += 1;
      trial.failures.push(result);
      continue;
    }

    trial.successfulApiCalls += 1;
    totalSuccessfulApiCalls += 1;

    const key = getDuplicateKey(result.paper);
    const previous = seen.get(key);
    recentKeys = rememberRecentKey(recentKeys, key);

    if (previous) {
      trial.duplicateLoadNumber = loadNumber;
      trial.duplicate = {
        key,
        firstSeenAt: previous.loadNumber,
        duplicatedAt: loadNumber,
        paper: result.paper
      };
      break;
    }

    seen.set(key, {
      loadNumber,
      paper: result.paper
    });
  }

  trials.push(trial);
}

process.stdout.write("\n");

for (const trial of trials) {
  console.log(`Trial ${trial.trialNumber}: ${trial.duplicateLoadNumber}`);
}

const rawOutput = {
  generatedAt: new Date().toISOString(),
  apiUrl: API_URL,
  trialCount: TRIAL_COUNT,
  maxLoadsPerTrial: MAX_LOADS_PER_TRIAL,
  totalSuccessfulApiCalls,
  totalFailedApiCalls,
  trials
};

await writeFile(RAW_OUTPUT_PATH, `${JSON.stringify(rawOutput, null, 2)}\n`);
await writeFile(REPORT_OUTPUT_PATH, buildReport(rawOutput));

console.log(`Saved raw results to ${RAW_OUTPUT_PATH}`);
console.log(`Saved report to ${REPORT_OUTPUT_PATH}`);

async function fetchPaper(loadNumber, recentKeys) {
  try {
    const params = new URLSearchParams();

    if (recentKeys.length > 0) {
      params.set("recent", JSON.stringify(recentKeys));
    }

    const url = `${API_URL}${params.size > 0 ? `?${params.toString()}` : ""}`;
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !isPaper(data)) {
      return {
        ok: false,
        loadNumber,
        status: response.status,
        error: data?.error || "Unexpected API response",
        data
      };
    }

    return {
      ok: true,
      loadNumber,
      status: response.status,
      paper: data
    };
  } catch (error) {
    return {
      ok: false,
      loadNumber,
      status: null,
      error: error instanceof Error ? error.message : "Unknown fetch error"
    };
  }
}

function getDuplicateKey(paper) {
  if (typeof paper.url === "string" && paper.url.trim()) {
    return `url:${paper.url.trim().toLowerCase()}`;
  }

  return [
    "metadata",
    paper.title,
    paper.publicationYear ?? "unknown-year",
    paper.sourceName || "unknown-source"
  ]
    .join(":")
    .toLowerCase();
}

function rememberRecentKey(recentKeys, key) {
  return [
    key,
    ...recentKeys.filter((recentKey) => recentKey !== key)
  ].slice(0, 50);
}

function buildReport(results) {
  const duplicateTrials = results.trials.filter((trial) => trial.duplicate);
  const lines = [
    "# Duplicate Frequency Diagnostic",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `API: \`${results.apiUrl}\``,
    `Trials: ${results.trialCount}`,
    `Max loads per trial: ${results.maxLoadsPerTrial}`,
    `Total successful API calls: ${results.totalSuccessfulApiCalls}`,
    `Failed API calls: ${results.totalFailedApiCalls}`,
    "",
    "## Trial Results",
    "",
    "| Trial | Duplicate appeared at load |",
    "| --- | ---: |",
    ...results.trials.map(
      (trial) => `| ${trial.trialNumber} | ${trial.duplicateLoadNumber} |`
    ),
    "",
    "## Duplicated Abstracts",
    "",
    duplicateTrials.length > 0
      ? duplicateTrials.map(formatDuplicate).join("\n\n")
      : "_No duplicates appeared within the trial limits._",
    "",
    "## Assessment",
    "",
    assessDuplicateConcern(results)
  ];

  return `${lines.join("\n")}\n`;
}

function formatDuplicate(trial) {
  const paper = trial.duplicate.paper;

  return [
    `### Trial ${trial.trialNumber}`,
    "",
    `- Duplicate appeared at load: ${trial.duplicate.duplicatedAt}`,
    `- First seen at load: ${trial.duplicate.firstSeenAt}`,
    `- Title: ${paper.title}`,
    `- Year: ${paper.publicationYear ?? "Unknown"}`,
    `- Source: ${paper.sourceName || "Unknown"}`,
    `- URL: ${paper.url || "Unknown"}`,
    `- Field: ${paper.topicField || "Unknown"}`,
    `- Subfield: ${paper.topicSubfield || "Unknown"}`,
    `- Topic: ${paper.topicName || "Unknown"}`
  ].join("\n");
}

function assessDuplicateConcern(results) {
  const duplicateLoads = results.trials
    .map((trial) => trial.duplicateLoadNumber)
    .filter((loadNumber) => loadNumber > 0);

  if (duplicateLoads.length === 0) {
    return "No duplicates appeared in these trials, so duplicates do not look like a meaningful concern in this sample.";
  }

  const earliestDuplicate = Math.min(...duplicateLoads);
  const duplicateTrialCount = duplicateLoads.length;

  if (earliestDuplicate <= 25 || duplicateTrialCount >= 3) {
    return "Duplicates may be a meaningful concern in this sample because they appeared early or in several trials.";
  }

  return "Duplicates appeared in this sample, but not often enough here to clearly indicate a major concern.";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPaper(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.title === "string" &&
    Array.isArray(value.authors) &&
    (typeof value.publicationYear === "number" || value.publicationYear === null) &&
    typeof value.sourceName === "string"
  );
}
