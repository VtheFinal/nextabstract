import { mkdir, writeFile } from "node:fs/promises";

const API_URL =
  process.env.NEXT_ABSTRACT_API_URL || "http://localhost:3000/api/abstract";
const TARGET_SUCCESSFUL_LOADS = Number(process.env.DIAGNOSTIC_TOTAL_LOADS || 1000);
const MAX_CONSECUTIVE_FAILURES = 10;
const RECENT_KEY_LIMIT = 50;
const RECENT_SUBFIELD_LIMIT = 15;
const JOURNEY_REPEAT_THRESHOLD = 2;
const JOURNEY_SUBFIELD_PENALTY = 1;
const REQUEST_DELAY_MS = Number(process.env.DIAGNOSTIC_REQUEST_DELAY_MS || 1500);
const OUTPUT_DIR = "outputs";
const RAW_OUTPUT_PATH = `${OUTPUT_DIR}/effective-candidate-universe-results.json`;
const REPORT_OUTPUT_PATH = `${OUTPUT_DIR}/effective-candidate-universe-report.md`;

const CURIOSITY_POSITIVE_TERMS = [
  "history",
  "archaeology",
  "archeology",
  "anthropology",
  "religion",
  "theology",
  "myth",
  "mythology",
  "folklore",
  "ritual",
  "manuscript",
  "archive",
  "ancient",
  "medieval",
  "classical",
  "literature",
  "philosophy",
  "art history",
  "cosmology"
];
const CURIOSITY_NEGATIVE_TERMS = [
  "student achievement",
  "learning outcomes",
  "curriculum",
  "employee performance",
  "customer satisfaction",
  "purchase management",
  "knowledge management",
  "service delivery",
  "tourism development",
  "neural network",
  "transfer learning",
  "optimization",
  "matrix",
  "embedding"
];

await mkdir(OUTPUT_DIR, { recursive: true });

const seen = new Map();
const selectedPapers = [];
const duplicateEvents = [];
const failures = [];
let recentKeys = [];
let recentSubfields = [];
let totalAttempts = 0;
let successfulLoads = 0;
let failedLoads = 0;
let consecutiveFailures = 0;

while (
  successfulLoads < TARGET_SUCCESSFUL_LOADS &&
  consecutiveFailures < MAX_CONSECUTIVE_FAILURES
) {
  totalAttempts += 1;
  process.stdout.write(
    `Successful loads ${successfulLoads}/${TARGET_SUCCESSFUL_LOADS}, attempts ${totalAttempts}...\r`
  );

  const result = await fetchPaper(totalAttempts, recentKeys);
  await sleep(REQUEST_DELAY_MS);

  if (!result.ok) {
    failedLoads += 1;
    consecutiveFailures += 1;
    failures.push(result);
    continue;
  }

  consecutiveFailures = 0;
  successfulLoads += 1;

  const paper = result.paper;
  const key = getPaperKey(paper);
  const tier = estimateTier(paper);
  const curiosityScore = getCuriosityScore(paper);
  const previous = seen.get(key);
  const occurrenceNumber = previous ? previous.count + 1 : 1;
  const recentSubfieldCount = countRecentSubfield(recentSubfields, paper.topicSubfield);
  const selectedPaper = {
    loadNumber: successfulLoads,
    key,
    title: paper.title,
    abstract: paper.abstract,
    publicationYear: paper.publicationYear,
    sourceName: paper.sourceName,
    topicName: paper.topicName,
    topicDomain: paper.topicDomain,
    topicField: paper.topicField,
    topicSubfield: paper.topicSubfield,
    url: paper.url,
    tier,
    curiosityScore,
    recentSubfields,
    recentSubfieldCount,
    wouldReceiveJourneyPenalty:
      recentSubfieldCount >= JOURNEY_REPEAT_THRESHOLD,
    isDuplicate: Boolean(previous),
    firstSeenAt: previous?.firstSeenAt ?? null,
    duplicateDistance: previous ? successfulLoads - previous.firstSeenAt : null,
    occurrenceNumber
  };

  recentKeys = rememberRecentKey(recentKeys, key);
  recentSubfields = rememberRecentSubfield(recentSubfields, paper.topicSubfield);
  selectedPapers.push(selectedPaper);

  if (previous) {
    const duplicateEvent = {
      key,
      duplicateLoadNumber: successfulLoads,
      firstSeenAt: previous.firstSeenAt,
      duplicateDistance: selectedPaper.duplicateDistance,
      occurrenceNumber,
      tier,
      curiosityScore,
      journeyDiagnostics: {
        recentSubfields: selectedPaper.recentSubfields,
        recentSubfieldCount: selectedPaper.recentSubfieldCount,
        wouldReceiveJourneyPenalty: selectedPaper.wouldReceiveJourneyPenalty
      },
      paper
    };

    duplicateEvents.push(duplicateEvent);
    previous.count += 1;
    previous.lastSeenAt = successfulLoads;
    previous.duplicateDistances.push(duplicateEvent.duplicateDistance);
  } else {
    seen.set(key, {
      key,
      firstSeenAt: successfulLoads,
      lastSeenAt: successfulLoads,
      count: 1,
      duplicateDistances: [],
      tier,
      curiosityScore,
      paper
    });
  }
}

process.stdout.write("\n");

const repeatedPapers = [...seen.values()]
  .filter((entry) => entry.count > 1)
  .sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return left.firstSeenAt - right.firstSeenAt;
  });
const sourceCounts = countBy(selectedPapers, (paper) => getSourceName(paper));
const duplicateSourceCounts = countBy(
  selectedPapers.filter((paper) => paper.isDuplicate),
  (paper) => getSourceName(paper)
);
const uniqueSourceCount = Object.keys(sourceCounts).length;
const unknownSourceCount = selectedPapers.filter(
  (paper) => getSourceName(paper) === "Unknown"
).length;
const sourceRepeatCount = Math.max(0, selectedPapers.length - uniqueSourceCount);
const sourceRepeatRate =
  selectedPapers.length > 0 ? sourceRepeatCount / selectedPapers.length : 0;
const sourceWindowRepeatStats = getRollingSourceRepeatStats(selectedPapers, 100);
const journeyStats = getJourneyStats(selectedPapers);
const rawOutput = {
  generatedAt: new Date().toISOString(),
  apiUrl: API_URL,
  simulationMode: "local-api-observational-journey",
  targetSuccessfulLoads: TARGET_SUCCESSFUL_LOADS,
  requestDelayMs: REQUEST_DELAY_MS,
  recentKeyLimit: RECENT_KEY_LIMIT,
  recentSubfieldLimit: RECENT_SUBFIELD_LIMIT,
  journeyRepeatThreshold: JOURNEY_REPEAT_THRESHOLD,
  journeySubfieldPenalty: JOURNEY_SUBFIELD_PENALTY,
  stoppedEarly: successfulLoads < TARGET_SUCCESSFUL_LOADS,
  totalAttempts,
  successfulLoads,
  failedLoads,
  uniqueAbstractCount: seen.size,
  duplicateCount: duplicateEvents.length,
  duplicateRate: successfulLoads > 0 ? duplicateEvents.length / successfulLoads : 0,
  selectedPapers,
  uniqueSourceCount,
  unknownSourceCount,
  sourceRepeatCount,
  sourceRepeatRate,
  sourceWindowRepeatStats,
  journeyStats,
  topSourcesByTotalAppearances: Object.fromEntries(
    Object.entries(sourceCounts).slice(0, 25)
  ),
  topSourcesByDuplicateEvents: Object.fromEntries(
    Object.entries(duplicateSourceCounts).slice(0, 25)
  ),
  duplicateEvents,
  mostRepeatedPapers: repeatedPapers.slice(0, 25),
  repeatsByTier: countBy(duplicateEvents, (event) => event.tier),
  repeatsBySource: countBy(duplicateEvents, (event) => event.paper.sourceName || "Unknown"),
  repeatsByTopicField: countBy(
    duplicateEvents,
    (event) => event.paper.topicField || "Unknown"
  ),
  repeatsByTopicSubfield: countBy(
    duplicateEvents,
    (event) => event.paper.topicSubfield || "Unknown"
  ),
  repeatsByTopicName: countBy(
    duplicateEvents,
    (event) => event.paper.topicName || "Unknown"
  ),
  repeatsByCuriosityScore: countBy(duplicateEvents, (event) =>
    String(event.curiosityScore)
  ),
  failures
};

await writeFile(RAW_OUTPUT_PATH, `${JSON.stringify(rawOutput, null, 2)}\n`);
await writeFile(REPORT_OUTPUT_PATH, buildReport(rawOutput));

console.log(`Successful loads: ${successfulLoads}`);
console.log(`Unique abstracts: ${seen.size}`);
console.log(`Duplicate events: ${duplicateEvents.length}`);
console.log(`Duplicate rate: ${formatPercent(rawOutput.duplicateRate)}`);
console.log(`Saved raw results to ${RAW_OUTPUT_PATH}`);
console.log(`Saved report to ${REPORT_OUTPUT_PATH}`);

async function fetchPaper(attemptNumber, recentKeysForRequest) {
  try {
    const params = new URLSearchParams();

    if (recentKeysForRequest.length > 0) {
      params.set("recent", JSON.stringify(recentKeysForRequest));
    }

    const url = `${API_URL}${params.size > 0 ? `?${params.toString()}` : ""}`;
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !isPaper(data)) {
      return {
        ok: false,
        attemptNumber,
        status: response.status,
        error: data?.error || "Unexpected API response",
        data
      };
    }

    return {
      ok: true,
      attemptNumber,
      status: response.status,
      paper: data
    };
  } catch (error) {
    return {
      ok: false,
      attemptNumber,
      status: null,
      error: error instanceof Error ? error.message : "Unknown fetch error"
    };
  }
}

function countRecentSubfield(recentSubfieldsForRequest, subfield) {
  const normalizedSubfield = normalizeTopicValue(subfield);

  if (!normalizedSubfield) {
    return 0;
  }

  return recentSubfieldsForRequest.filter(
    (recentSubfield) => recentSubfield === normalizedSubfield
  ).length;
}

function getPaperKey(paper) {
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

function rememberRecentKey(keys, key) {
  return [key, ...keys.filter((recentKey) => recentKey !== key)].slice(
    0,
    RECENT_KEY_LIMIT
  );
}

function rememberRecentSubfield(subfields, subfield) {
  const normalizedSubfield = normalizeTopicValue(subfield);

  if (!normalizedSubfield) {
    return subfields;
  }

  return [
    normalizedSubfield,
    ...subfields.filter((recentSubfield) => recentSubfield !== normalizedSubfield)
  ].slice(0, RECENT_SUBFIELD_LIMIT);
}

function normalizeTopicValue(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function estimateTier(paper) {
  if (isHistoryTopic(paper)) {
    return "historyCandidate";
  }

  if (
    isPreferredTopic(paper) &&
    !isPsychologyTopic(paper) &&
    !isLowCuriosityAppliedTopic(paper)
  ) {
    return "preferredCandidate";
  }

  return "fallbackCandidate";
}

function isHistoryTopic(paper) {
  return getTopicText(paper).includes("history");
}

function isPsychologyTopic(paper) {
  return getTopicText(paper).includes("psychology");
}

function isLowCuriosityAppliedTopic(paper) {
  const topicText = getTopicText(paper);

  return [
    "education",
    "curriculum",
    "teaching",
    "learning outcomes",
    "student achievement",
    "employee performance",
    "customer satisfaction",
    "purchase management",
    "knowledge management",
    "tourism development",
    "e-government",
    "service delivery",
    "local government finance"
  ].some((term) => topicText.includes(term));
}

function isPreferredTopic(paper) {
  const topicText = getTopicText(paper);

  return [
    "arts",
    "humanities",
    "history",
    "literature",
    "literary",
    "philosophy",
    "anthropology",
    "sociology",
    "political science",
    "archaeology",
    "archeology",
    "religion",
    "religious studies",
    "theology",
    "art history",
    "classics",
    "classical",
    "classical studies",
    "folklore",
    "mythology",
    "linguistics"
  ].some((term) => topicText.includes(term));
}

function getTopicText(paper) {
  return [paper.topicField, paper.topicSubfield, paper.topicName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getCuriosityScore(paper) {
  const text = [
    paper.title,
    paper.abstract,
    paper.topicName,
    paper.topicField,
    paper.topicSubfield
  ]
    .join(" ")
    .toLowerCase();
  let score = 0;

  if (matchesAny(text, CURIOSITY_POSITIVE_TERMS)) {
    score += 1;
  }

  if (matchesAny(text, CURIOSITY_NEGATIVE_TERMS)) {
    score -= 1;
  }

  return score;
}

function matchesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function buildReport(results) {
  const lines = [
    "# Effective Candidate Universe Diagnostic",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `API: \`${results.apiUrl}\``,
    `Target successful loads: ${results.targetSuccessfulLoads}`,
    `Request delay: ${results.requestDelayMs}ms`,
    `Recent key limit: ${results.recentKeyLimit}`,
    `Stopped early: ${results.stoppedEarly ? "Yes" : "No"}`,
    "",
    "## Summary",
    "",
    `- Total attempts: ${results.totalAttempts}`,
    `- Successful loads: ${results.successfulLoads}`,
    `- Failed loads: ${results.failedLoads}`,
    `- Unique abstracts: ${results.uniqueAbstractCount}`,
    `- Duplicate events: ${results.duplicateCount}`,
    `- Duplicate rate: ${formatPercent(results.duplicateRate)}`,
    `- Unique sources: ${results.uniqueSourceCount}`,
    `- Unknown/blank source appearances: ${results.unknownSourceCount}`,
    `- Source repeat rate: ${formatPercent(results.sourceRepeatRate)}`,
    "",
    "## Source Diversity",
    "",
    `- Top 10 sources by total appearances: ${sumTopCounts(results.topSourcesByTotalAppearances, 10)}`,
    `- Top 10 sources by duplicate events: ${sumTopCounts(results.topSourcesByDuplicateEvents, 10)}`,
    `- Rolling 100-load average source repeat rate: ${formatPercent(results.sourceWindowRepeatStats.averageRepeatRate)}`,
    `- Rolling 100-load maximum source repeat rate: ${formatPercent(results.sourceWindowRepeatStats.maxRepeatRate)}`,
    "",
    "### Top Sources by Total Appearances",
    "",
    formatCountTable(results.topSourcesByTotalAppearances, 10),
    "",
    "### Top Sources by Duplicate Events",
    "",
    formatCountTable(results.topSourcesByDuplicateEvents, 10),
    "",
    "### Rolling 100-Load Source Repeats",
    "",
    formatRollingSourceWindows(results.sourceWindowRepeatStats.windows),
    "",
    "## Journey Report",
    "",
    "### Field-to-Field Transitions",
    "",
    formatCountTable(results.journeyStats.fieldTransitions, 15),
    "",
    "### Subfield-to-Subfield Transitions",
    "",
    formatCountTable(results.journeyStats.subfieldTransitions, 15),
    "",
    "### Transition Distance",
    "",
    formatTransitionDistance(results.journeyStats.transitionDistance),
    "",
    "### Longest Runs",
    "",
    `- Longest same-field run: ${results.journeyStats.longestSameFieldRun.label} (${results.journeyStats.longestSameFieldRun.length})`,
    `- Longest same-subfield run: ${results.journeyStats.longestSameSubfieldRun.label} (${results.journeyStats.longestSameSubfieldRun.length})`,
    "",
    "### Rolling-Window Concentration",
    "",
    formatJourneyWindowSummary(results.journeyStats.rollingWindows),
    "",
    "### Intellectual Exposure Distribution",
    "",
    "#### 10-Paper Dominant Field Exposure",
    "",
    formatExposureBucketTable(
      results.journeyStats.rollingWindows["10"].dominantFieldExposureBuckets,
      results.journeyStats.rollingWindows["10"].windowCount
    ),
    "",
    "#### 20-Paper Dominant Field Exposure",
    "",
    formatExposureBucketTable(
      results.journeyStats.rollingWindows["20"].dominantFieldExposureBuckets,
      results.journeyStats.rollingWindows["20"].windowCount
    ),
    "",
    "#### 10-Paper Dominant Subfield Exposure",
    "",
    formatExposureBucketTable(
      results.journeyStats.rollingWindows["10"].dominantSubfieldExposureBuckets,
      results.journeyStats.rollingWindows["10"].windowCount
    ),
    "",
    "#### 20-Paper Dominant Subfield Exposure",
    "",
    formatExposureBucketTable(
      results.journeyStats.rollingWindows["20"].dominantSubfieldExposureBuckets,
      results.journeyStats.rollingWindows["20"].windowCount
    ),
    "",
    "### Journey Penalty Observation",
    "",
    `- Selected papers that would have received a Journey penalty: ${results.journeyStats.penaltyObservation.penalizedCount}`,
    `- Share of selected papers: ${formatPercent(results.journeyStats.penaltyObservation.penalizedRate)}`,
    "",
    "#### Top Penalized Subfields",
    "",
    formatCountTable(results.journeyStats.penaltyObservation.penalizedSubfields, 10),
    "",
    "## Most Repeated Papers",
    "",
    formatRepeatedPapers(results.mostRepeatedPapers),
    "",
    "## Repeats by Estimated Tier",
    "",
    formatCountTable(results.repeatsByTier),
    "",
    "## Repeats by Curiosity Score",
    "",
    formatCountTable(results.repeatsByCuriosityScore),
    "",
    "## Repeats by Source",
    "",
    formatCountTable(results.repeatsBySource, 25),
    "",
    "## Repeats by Topic Field",
    "",
    formatCountTable(results.repeatsByTopicField),
    "",
    "## Repeats by Topic Subfield",
    "",
    formatCountTable(results.repeatsByTopicSubfield, 25),
    "",
    "## Repeats by Topic Name",
    "",
    formatCountTable(results.repeatsByTopicName, 25),
    "",
    "## Duplicate Events",
    "",
    formatDuplicateEvents(results.duplicateEvents.slice(0, 100))
  ];

  if (results.failures.length > 0) {
    lines.push(
      "",
      "## Failures",
      "",
      ...results.failures.slice(0, 50).map((failure) => {
        const message = failure.error || failure.data?.error || "Unexpected response";
        return `- Attempt ${failure.attemptNumber}: status ${failure.status ?? "unknown"} - ${message}`;
      })
    );
  }

  return `${lines.join("\n")}\n`;
}

function formatRepeatedPapers(repeatedPapers) {
  if (repeatedPapers.length === 0) {
    return "_No repeated papers._";
  }

  return repeatedPapers
    .map((entry, index) => {
      const paper = entry.paper;

      return [
        `### ${index + 1}. ${paper.title}`,
        "",
        `- Occurrences: ${entry.count}`,
        `- First seen at successful load: ${entry.firstSeenAt}`,
        `- Last seen at successful load: ${entry.lastSeenAt}`,
        `- Duplicate distances: ${entry.duplicateDistances.join(", ") || "None"}`,
        `- Tier: ${entry.tier}`,
        `- Curiosity score: ${entry.curiosityScore}`,
        `- Year: ${paper.publicationYear ?? "Unknown"}`,
        `- Source: ${paper.sourceName || "Unknown"}`,
        `- Field: ${paper.topicField || "Unknown"}`,
        `- Subfield: ${paper.topicSubfield || "Unknown"}`,
        `- Topic: ${paper.topicName || "Unknown"}`,
        `- URL: ${paper.url || "Unknown"}`
      ].join("\n");
    })
    .join("\n\n");
}

function formatDuplicateEvents(events) {
  if (events.length === 0) {
    return "_No duplicate events._";
  }

  return [
    "| Duplicate load | First seen | Distance | Tier | Score | Title |",
    "| ---: | ---: | ---: | --- | ---: | --- |",
    ...events.map((event) =>
      [
        event.duplicateLoadNumber,
        event.firstSeenAt,
        event.duplicateDistance,
        event.tier,
        event.curiosityScore,
        escapeMarkdownTableCell(event.paper.title)
      ].join(" | ")
    )
  ].join("\n");
}

function countBy(items, getKey) {
  const counts = {};

  for (const item of items) {
    const key = String(getKey(item) || "Unknown");
    counts[key] = (counts[key] || 0) + 1;
  }

  return sortCounts(counts);
}

function sortCounts(counts) {
  return Object.fromEntries(
    Object.entries(counts).sort(([leftKey, leftCount], [rightKey, rightCount]) => {
      if (rightCount !== leftCount) {
        return rightCount - leftCount;
      }

      return leftKey.localeCompare(rightKey);
    })
  );
}

function getSourceName(paper) {
  return typeof paper.sourceName === "string" && paper.sourceName.trim()
    ? paper.sourceName.trim()
    : "Unknown";
}

function getRollingSourceRepeatStats(papers, windowSize) {
  if (papers.length < windowSize) {
    return {
      windowSize,
      averageRepeatRate: 0,
      maxRepeatRate: 0,
      windows: []
    };
  }

  const windows = [];

  for (let startIndex = 0; startIndex <= papers.length - windowSize; startIndex += 1) {
    const windowPapers = papers.slice(startIndex, startIndex + windowSize);
    const uniqueSources = new Set(windowPapers.map(getSourceName)).size;
    const repeatCount = windowSize - uniqueSources;

    windows.push({
      startLoad: windowPapers[0].loadNumber,
      endLoad: windowPapers[windowPapers.length - 1].loadNumber,
      uniqueSources,
      repeatCount,
      repeatRate: repeatCount / windowSize
    });
  }

  const repeatRates = windows.map((window) => window.repeatRate);

  return {
    windowSize,
    averageRepeatRate:
      repeatRates.reduce((total, value) => total + value, 0) / repeatRates.length,
    maxRepeatRate: Math.max(...repeatRates),
    windows
  };
}

function getJourneyStats(papers) {
  return {
    fieldTransitions: countTransitions(papers, (paper) =>
      getTopicValue(paper.topicField)
    ),
    subfieldTransitions: countTransitions(papers, (paper) =>
      getTopicValue(paper.topicSubfield)
    ),
    transitionDistance: getTransitionDistance(papers),
    longestSameFieldRun: getLongestRun(papers, (paper) =>
      getTopicValue(paper.topicField)
    ),
    longestSameSubfieldRun: getLongestRun(papers, (paper) =>
      getTopicValue(paper.topicSubfield)
    ),
    rollingWindows: {
      10: getRollingTopicConcentration(papers, 10),
      20: getRollingTopicConcentration(papers, 20)
    },
    penaltyObservation: getPenaltyObservation(papers)
  };
}

function countTransitions(papers, getValue) {
  const transitions = {};

  for (let index = 1; index < papers.length; index += 1) {
    const from = getValue(papers[index - 1]);
    const to = getValue(papers[index]);
    const transition = `${from} -> ${to}`;

    transitions[transition] = (transitions[transition] || 0) + 1;
  }

  return sortCounts(transitions);
}

function getTransitionDistance(papers) {
  const counts = {
    "Same subfield": 0,
    "Same field, different subfield": 0,
    "Different field": 0,
    "Unknown / missing metadata": 0
  };
  const totalTransitions = Math.max(0, papers.length - 1);

  for (let index = 1; index < papers.length; index += 1) {
    const previousField = normalizeTopicValue(papers[index - 1].topicField);
    const currentField = normalizeTopicValue(papers[index].topicField);
    const previousSubfield = normalizeTopicValue(papers[index - 1].topicSubfield);
    const currentSubfield = normalizeTopicValue(papers[index].topicSubfield);

    if (!previousField || !currentField || !previousSubfield || !currentSubfield) {
      counts["Unknown / missing metadata"] += 1;
    } else if (previousSubfield === currentSubfield) {
      counts["Same subfield"] += 1;
    } else if (previousField === currentField) {
      counts["Same field, different subfield"] += 1;
    } else {
      counts["Different field"] += 1;
    }
  }

  return {
    totalTransitions,
    counts
  };
}

function getLongestRun(papers, getValue) {
  if (papers.length === 0) {
    return {
      label: "None",
      length: 0,
      startLoad: null,
      endLoad: null
    };
  }

  let bestLabel = getValue(papers[0]);
  let bestLength = 1;
  let bestStartIndex = 0;
  let currentLabel = bestLabel;
  let currentLength = 1;
  let currentStartIndex = 0;

  for (let index = 1; index < papers.length; index += 1) {
    const label = getValue(papers[index]);

    if (label === currentLabel) {
      currentLength += 1;
    } else {
      currentLabel = label;
      currentLength = 1;
      currentStartIndex = index;
    }

    if (currentLength > bestLength) {
      bestLabel = currentLabel;
      bestLength = currentLength;
      bestStartIndex = currentStartIndex;
    }
  }

  return {
    label: bestLabel,
    length: bestLength,
    startLoad: papers[bestStartIndex].loadNumber,
    endLoad: papers[bestStartIndex + bestLength - 1].loadNumber
  };
}

function getRollingTopicConcentration(papers, windowSize) {
  if (papers.length < windowSize) {
    return {
      windowSize,
      windowCount: 0,
      averageDominantFieldConcentration: 0,
      maximumDominantFieldConcentration: 0,
      averageDominantSubfieldConcentration: 0,
      maximumDominantSubfieldConcentration: 0,
      fieldAtLeast70Count: 0,
      subfieldAtLeast50Count: 0,
      dominantFieldExposureBuckets: getEmptyExposureBuckets(),
      dominantSubfieldExposureBuckets: getEmptyExposureBuckets()
    };
  }

  const windows = [];

  for (let startIndex = 0; startIndex <= papers.length - windowSize; startIndex += 1) {
    const windowPapers = papers.slice(startIndex, startIndex + windowSize);
    const fieldCounts = countBy(windowPapers, (paper) =>
      getTopicValue(paper.topicField)
    );
    const subfieldCounts = countBy(windowPapers, (paper) =>
      getTopicValue(paper.topicSubfield)
    );
    const dominantFieldCount = getTopCount(fieldCounts);
    const dominantSubfieldCount = getTopCount(subfieldCounts);

    windows.push({
      dominantFieldConcentration: dominantFieldCount / windowSize,
      dominantSubfieldConcentration: dominantSubfieldCount / windowSize
    });
  }

  return {
    windowSize,
    windowCount: windows.length,
    averageDominantFieldConcentration: average(
      windows.map((window) => window.dominantFieldConcentration)
    ),
    maximumDominantFieldConcentration: Math.max(
      ...windows.map((window) => window.dominantFieldConcentration)
    ),
    averageDominantSubfieldConcentration: average(
      windows.map((window) => window.dominantSubfieldConcentration)
    ),
    maximumDominantSubfieldConcentration: Math.max(
      ...windows.map((window) => window.dominantSubfieldConcentration)
    ),
    fieldAtLeast70Count: windows.filter(
      (window) => window.dominantFieldConcentration >= 0.7
    ).length,
    subfieldAtLeast50Count: windows.filter(
      (window) => window.dominantSubfieldConcentration >= 0.5
    ).length,
    dominantFieldExposureBuckets: getExposureBuckets(
      windows.map((window) => window.dominantFieldConcentration)
    ),
    dominantSubfieldExposureBuckets: getExposureBuckets(
      windows.map((window) => window.dominantSubfieldConcentration)
    )
  };
}

function getEmptyExposureBuckets() {
  return Object.fromEntries(
    getExposureBucketLabels().map((label) => [label, 0])
  );
}

function getExposureBuckets(concentrations) {
  const buckets = getEmptyExposureBuckets();

  for (const concentration of concentrations) {
    const label = getExposureBucketLabel(concentration);
    buckets[label] += 1;
  }

  return buckets;
}

function getExposureBucketLabels() {
  return [
    "20-29%",
    "30-39%",
    "40-49%",
    "50-59%",
    "60-69%",
    "70-79%",
    "80-89%",
    "90-100%"
  ];
}

function getExposureBucketLabel(concentration) {
  if (concentration < 0.3) {
    return "20-29%";
  }

  if (concentration < 0.4) {
    return "30-39%";
  }

  if (concentration < 0.5) {
    return "40-49%";
  }

  if (concentration < 0.6) {
    return "50-59%";
  }

  if (concentration < 0.7) {
    return "60-69%";
  }

  if (concentration < 0.8) {
    return "70-79%";
  }

  if (concentration < 0.9) {
    return "80-89%";
  }

  return "90-100%";
}

function getPenaltyObservation(papers) {
  const penalizedPapers = papers.filter((paper) => paper.wouldReceiveJourneyPenalty);

  return {
    penalizedCount: penalizedPapers.length,
    penalizedRate: papers.length > 0 ? penalizedPapers.length / papers.length : 0,
    penalizedSubfields: countBy(penalizedPapers, (paper) =>
      getTopicValue(paper.topicSubfield)
    )
  };
}

function getTopicValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "Unknown";
}

function getTopCount(counts) {
  return Number(Object.values(counts)[0] || 0);
}

function average(values) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sumTopCounts(counts, limit) {
  return Object.values(counts)
    .slice(0, limit)
    .reduce((total, count) => total + count, 0);
}

function formatRollingSourceWindows(windows) {
  if (windows.length === 0) {
    return "_Not enough selected papers for a 100-load window._";
  }

  const notableWindows = [...windows]
    .sort((left, right) => right.repeatRate - left.repeatRate)
    .slice(0, 10);

  return [
    "| Window | Unique sources | Source repeats | Repeat rate |",
    "| --- | ---: | ---: | ---: |",
    ...notableWindows.map((window) =>
      [
        `${window.startLoad}-${window.endLoad}`,
        window.uniqueSources,
        window.repeatCount,
        formatPercent(window.repeatRate)
      ].join(" | ")
    )
  ].join("\n");
}

function formatTransitionDistance(transitionDistance) {
  const total = transitionDistance.totalTransitions;
  const rows = Object.entries(transitionDistance.counts);

  if (total === 0) {
    return "_No adjacent transitions._";
  }

  return [
    "| Transition type | Count | Share |",
    "| --- | ---: | ---: |",
    ...rows.map(
      ([label, count]) => `| ${label} | ${count} | ${formatPercent(count / total)} |`
    )
  ].join("\n");
}

function formatJourneyWindowSummary(rollingWindows) {
  return [
    "| Window | Avg dominant field | Max dominant field | Avg dominant subfield | Max dominant subfield | Field >= 70% windows | Subfield >= 50% windows |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    formatJourneyWindowRow(10, rollingWindows["10"]),
    formatJourneyWindowRow(20, rollingWindows["20"])
  ].join("\n");
}

function formatJourneyWindowRow(label, summary) {
  return [
    label,
    formatPercent(summary.averageDominantFieldConcentration),
    formatPercent(summary.maximumDominantFieldConcentration),
    formatPercent(summary.averageDominantSubfieldConcentration),
    formatPercent(summary.maximumDominantSubfieldConcentration),
    `${summary.fieldAtLeast70Count}/${summary.windowCount}`,
    `${summary.subfieldAtLeast50Count}/${summary.windowCount}`
  ].join(" | ");
}

function formatExposureBucketTable(buckets, totalWindows) {
  return [
    "| Concentration bucket | Windows | Share of windows |",
    "| --- | ---: | ---: |",
    ...getExposureBucketLabels().map((label) => {
      const count = buckets[label] || 0;
      const share = totalWindows > 0 ? count / totalWindows : 0;

      return `| ${label} | ${count} | ${formatPercent(share)} |`;
    })
  ].join("\n");
}

function formatCountTable(counts, limit = Infinity) {
  const rows = Object.entries(counts).slice(0, limit);

  if (rows.length === 0) {
    return "_No duplicate data._";
  }

  return [
    "| Value | Count |",
    "| --- | ---: |",
    ...rows.map(([key, count]) => `| ${escapeMarkdownTableCell(key)} | ${count} |`)
  ].join("\n");
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function escapeMarkdownTableCell(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
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
    typeof value.topicName === "string" &&
    typeof value.topicField === "string" &&
    typeof value.topicSubfield === "string" &&
    typeof value.url === "string"
  );
}
