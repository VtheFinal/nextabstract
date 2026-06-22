import { mkdir, writeFile } from "node:fs/promises";

const API_URL = process.env.NEXT_ABSTRACT_API_URL || "http://localhost:3000/api/abstract";
const SAMPLE_COUNT = 200;
const REQUEST_DELAY_MS = Number(process.env.DIAGNOSTIC_REQUEST_DELAY_MS || 1000);
const OUTPUT_DIR = "outputs";
const RAW_OUTPUT_PATH = `${OUTPUT_DIR}/abstract-selection-sample.json`;
const REPORT_OUTPUT_PATH = `${OUTPUT_DIR}/abstract-selection-report.md`;

const SUBJECT_BUCKETS = [
  {
    name: "Economics/finance",
    terms: [
      "economics",
      "econometric",
      "finance",
      "financial",
      "banking",
      "accounting"
    ]
  },
  {
    name: "Politics/political science",
    terms: [
      "politics",
      "political science",
      "political",
      "government",
      "international relations",
      "public administration"
    ]
  },
  {
    name: "Organizational management/business",
    terms: [
      "business",
      "management",
      "organizational",
      "organisational",
      "marketing",
      "entrepreneurship"
    ]
  },
  {
    name: "Psychology",
    terms: ["psychology", "psychological"]
  },
  {
    name: "Sociology",
    terms: ["sociology", "sociological"]
  },
  {
    name: "Humanities/history",
    terms: [
      "arts",
      "humanities",
      "history",
      "historical",
      "literature",
      "literary",
      "philosophy",
      "anthropology"
    ]
  },
  {
    name: "Astronomy/astrophysics",
    terms: [
      "astronomy",
      "astrophysics",
      "astrophysical",
      "space",
      "planetary",
      "cosmology",
      "exoplanet",
      "galax"
    ]
  }
];

await mkdir(OUTPUT_DIR, { recursive: true });

const responses = [];

for (let index = 1; index <= SAMPLE_COUNT; index += 1) {
  process.stdout.write(`Sampling ${index}/${SAMPLE_COUNT}...\r`);

  try {
    const response = await fetch(API_URL, { cache: "no-store" });
    const data = await response.json();

    responses.push({
      sampleNumber: index,
      ok: response.ok,
      status: response.status,
      data
    });
  } catch (error) {
    responses.push({
      sampleNumber: index,
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "Unknown fetch error"
    });
  }

  await sleep(REQUEST_DELAY_MS);
}

process.stdout.write("\n");

const successfulPapers = responses
  .filter((response) => response.ok && isPaper(response.data))
  .map((response) => response.data);
const failedResponses = responses.filter(
  (response) => !response.ok || !isPaper(response.data)
);

const rawOutput = {
  generatedAt: new Date().toISOString(),
  apiUrl: API_URL,
  requestedCount: SAMPLE_COUNT,
  successCount: successfulPapers.length,
  failureCount: failedResponses.length,
  responses
};

await writeFile(RAW_OUTPUT_PATH, `${JSON.stringify(rawOutput, null, 2)}\n`);
await writeFile(REPORT_OUTPUT_PATH, buildReport(successfulPapers, failedResponses));

console.log(`Saved raw results to ${RAW_OUTPUT_PATH}`);
console.log(`Saved report to ${REPORT_OUTPUT_PATH}`);

function buildReport(papers, failures) {
  const lines = [
    "# Next Abstract Selection Diagnostic",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `API: \`${API_URL}\``,
    `Requested samples: ${SAMPLE_COUNT}`,
    `Successful abstracts: ${papers.length}`,
    `Failed responses: ${failures.length}`,
    "",
    "## Publication Years",
    "",
    formatCountTable(countBy(papers, (paper) => paper.publicationYear ?? "Unknown")),
    "",
    "## Decades",
    "",
    formatCountTable(countBy(papers, getDecade)),
    "",
    "## Sources/Journals",
    "",
    formatCountTable(countBy(papers, (paper) => paper.sourceName || "Unknown")),
    "",
    "## Topic Domains",
    "",
    formatCountTable(countBy(papers, (paper) => paper.topicDomain || "Unknown")),
    "",
    "## Topic Fields",
    "",
    formatCountTable(countBy(papers, (paper) => paper.topicField || "Unknown")),
    "",
    "## Topic Subfields",
    "",
    formatCountTable(countBy(papers, (paper) => paper.topicSubfield || "Unknown")),
    "",
    "## Topic Names",
    "",
    formatCountTable(countBy(papers, (paper) => paper.topicName || "Unknown")),
    "",
    "## Broad Subject Buckets",
    "",
    formatCountTable(countSubjectBuckets(papers)),
    "",
    "## All Sampled Abstracts",
    "",
    formatPaperList(papers)
  ];

  if (failures.length > 0) {
    lines.push(
      "",
      "## Failed Responses",
      "",
      ...failures.map((failure) => {
        const message = failure.error || failure.data?.error || "Unexpected response";
        return `- ${failure.sampleNumber}. Status ${failure.status ?? "unknown"}: ${message}`;
      })
    );
  }

  return `${lines.join("\n")}\n`;
}

function countBy(items, getKey) {
  const counts = new Map();

  for (const item of items) {
    const key = String(getKey(item) || "Unknown");
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return counts;
}

function countSubjectBuckets(papers) {
  const counts = new Map(SUBJECT_BUCKETS.map((bucket) => [bucket.name, 0]));

  for (const paper of papers) {
    const topicText = [
      paper.topicDomain,
      paper.topicField,
      paper.topicSubfield,
      paper.topicName
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    for (const bucket of SUBJECT_BUCKETS) {
      if (bucket.terms.some((term) => topicText.includes(term))) {
        counts.set(bucket.name, (counts.get(bucket.name) || 0) + 1);
      }
    }
  }

  return counts;
}

function getDecade(paper) {
  if (typeof paper.publicationYear !== "number") {
    return "Unknown";
  }

  return `${Math.floor(paper.publicationYear / 10) * 10}s`;
}

function formatCountTable(counts) {
  const rows = [...counts.entries()].sort(([leftKey, leftCount], [rightKey, rightCount]) => {
    if (rightCount !== leftCount) {
      return rightCount - leftCount;
    }

    return leftKey.localeCompare(rightKey);
  });

  if (rows.length === 0) {
    return "_No data._";
  }

  return [
    "| Value | Count |",
    "| --- | ---: |",
    ...rows.map(([key, count]) => `| ${escapeMarkdownTableCell(key)} | ${count} |`)
  ].join("\n");
}

function formatPaperList(papers) {
  if (papers.length === 0) {
    return "_No successful abstracts were sampled._";
  }

  return papers
    .map((paper, index) =>
      [
        `### ${index + 1}. ${paper.title}`,
        "",
        `- Year: ${paper.publicationYear ?? "Unknown"}`,
        `- Source: ${paper.sourceName || "Unknown"}`,
        `- Domain: ${paper.topicDomain || "Unknown"}`,
        `- Field: ${paper.topicField || "Unknown"}`,
        `- Subfield: ${paper.topicSubfield || "Unknown"}`,
        `- Topic: ${paper.topicName || "Unknown"}`,
        `- URL: ${paper.url}`
      ].join("\n")
    )
    .join("\n\n");
}

function escapeMarkdownTableCell(value) {
  return String(value).replaceAll("|", "\\|");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPaper(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.title === "string" &&
    typeof value.abstract === "string" &&
    Array.isArray(value.authors) &&
    (typeof value.publicationYear === "number" || value.publicationYear === null) &&
    typeof value.sourceName === "string" &&
    typeof value.url === "string"
  );
}
