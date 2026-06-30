import { readFile, writeFile } from "node:fs/promises";

const INPUT_PATH = "outputs/effective-candidate-universe-results.json";
const OUTPUT_PATH = "outputs/readability-report.md";

const LENGTH_BUCKETS = [
  ["Under 75 words", (count) => count < 75],
  ["75-149", (count) => count >= 75 && count <= 149],
  ["150-249", (count) => count >= 150 && count <= 249],
  ["250-399", (count) => count >= 250 && count <= 399],
  ["400+", (count) => count >= 400]
];
const COUNT_BUCKETS = [
  ["0", (count) => count === 0],
  ["1-2", (count) => count >= 1 && count <= 2],
  ["3-5", (count) => count >= 3 && count <= 5],
  ["6+", (count) => count >= 6]
];
const METHODS_TERMS = [
  "regression",
  "p-value",
  "confidence interval",
  "odds ratio",
  "hazard ratio",
  "coefficient",
  "estimator",
  "bayesian",
  "model",
  "dataset",
  "sample size",
  "randomized",
  "trial",
  "survey",
  "variable",
  "significance",
  "anova",
  "correlation",
  "algorithm"
];

const rawData = JSON.parse(await readFile(INPUT_PATH, "utf8"));
const papers = getSelectedPapers(rawData);
const analyses = papers.map(analyzePaper);

await writeFile(OUTPUT_PATH, buildReport(analyses));

console.log(`Analyzed ${analyses.length} abstracts.`);
console.log(`Saved report to ${OUTPUT_PATH}`);

function getSelectedPapers(data) {
  if (Array.isArray(data.selectedPapers)) {
    return data.selectedPapers;
  }

  if (Array.isArray(data.responses)) {
    return data.responses
      .filter((response) => response?.ok && response?.data)
      .map((response) => ({
        loadNumber: response.sampleNumber,
        ...response.data
      }));
  }

  return [];
}

function analyzePaper(paper, index) {
  const abstract = getString(paper.abstract);
  const sentences = splitSentences(abstract);
  const words = getWords(abstract);
  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);
  const wordCount = words.length;
  const sentenceCount = Math.max(sentences.length, 1);
  const averageSentenceLength = wordCount / sentenceCount;
  const fleschReadingEase =
    wordCount > 0
      ? 206.835 - 1.015 * averageSentenceLength - 84.6 * (syllables / wordCount)
      : 0;
  const fleschKincaidGrade =
    wordCount > 0
      ? 0.39 * averageSentenceLength + 11.8 * (syllables / wordCount) - 15.59
      : 0;
  const numberCount = countMatches(
    abstract,
    /(?:\b\d+(?:,\d{3})*(?:\.\d+)?%?\b|[<>]=?\s*\d+(?:\.\d+)?)/g
  );
  const methodsTermCount = countMethodTerms(abstract);
  const technicalDensityCount = getTechnicalDensityCount(abstract, words);
  const acronymCount = countMatches(abstract, /\b[A-Z]{2,}\b/g);
  const longWordCount = words.filter((word) => word.length >= 12).length;
  const difficultyScore =
    fleschKincaidGrade +
    wordCount / 100 +
    numberCount * 0.6 +
    methodsTermCount * 1.2 +
    technicalDensityCount * 0.8;
  const practicalDifficulty = getPracticalDifficulty({
    wordCount,
    averageSentenceLength,
    numberCount,
    methodsTermCount,
    technicalDensityCount,
    missingAbstract: abstract.trim().length === 0,
    fleschKincaidGrade
  });
  const invitingScore =
    lengthInvitingScore(wordCount) -
    Math.max(0, fleschKincaidGrade - 10) * 0.8 -
    numberCount * 0.5 -
    methodsTermCount -
    technicalDensityCount * 0.5 -
    Math.max(0, averageSentenceLength - 24) * 0.4;

  return {
    index,
    loadNumber: paper.loadNumber ?? index + 1,
    title: getString(paper.title) || "Untitled",
    sourceName: getString(paper.sourceName) || "Unknown",
    publicationYear: paper.publicationYear ?? "Unknown",
    topicField: getString(paper.topicField) || "Unknown",
    topicSubfield: getString(paper.topicSubfield) || "Unknown",
    topicName: getString(paper.topicName) || "Unknown",
    tier: getString(paper.tier) || "Unknown",
    curiosityScore:
      typeof paper.curiosityScore === "number" ? paper.curiosityScore : "Unknown",
    url: getString(paper.url),
    stableKey: getStableKey(paper),
    abstract,
    missingAbstract: abstract.trim().length === 0,
    wordCount,
    sentenceCount,
    averageSentenceLength,
    fleschReadingEase,
    fleschKincaidGrade,
    numberCount,
    methodsTermCount,
    technicalDensityCount,
    acronymCount,
    longWordCount,
    practicalDifficulty,
    difficultyScore,
    invitingScore
  };
}

function buildReport(items) {
  const nonBlank = items.filter((item) => !item.missingAbstract);
  const uniqueItems = getUniquePapers(items);
  const nonBlankUnique = uniqueItems.filter((item) => !item.missingAbstract);
  const analyzable = nonBlank.filter((item) => item.wordCount >= 20);
  const analyzableUnique = getUniquePapers(analyzable);
  const veryShort = nonBlank.filter((item) => item.wordCount < 20);

  return `${[
    "# NextAbstract Readability Report",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `Input: \`${INPUT_PATH}\``,
    "",
    "## Data Availability Note",
    "",
    getDataAvailabilityNote(items),
    "",
    "## Summary",
    "",
    `- Total abstracts analyzed: ${items.length}`,
    `- Abstracts with missing/blank abstract text: ${items.length - nonBlank.length}`,
    `- Average word count: ${formatNumber(average(nonBlank, "wordCount"))}`,
    `- Median word count: ${formatNumber(median(nonBlank.map((item) => item.wordCount)))}`,
    `- Average sentence length: ${formatNumber(average(nonBlank, "averageSentenceLength"))}`,
    `- Median sentence length: ${formatNumber(median(nonBlank.map((item) => item.averageSentenceLength)))}`,
    "",
    "## Unique Paper Summary",
    "",
    `- Total selected records analyzed: ${items.length}`,
    `- Unique papers analyzed: ${uniqueItems.length}`,
    `- Duplicate selected records: ${items.length - uniqueItems.length}`,
    `- Abstracts with missing/blank text: ${items.length - nonBlank.length}`,
    `- Abstracts with fewer than 20 words: ${veryShort.length}`,
    "",
    "## Readability Scores",
    "",
    `- Average Flesch Reading Ease: ${formatNumber(average(nonBlank, "fleschReadingEase"))}`,
    `- Median Flesch Reading Ease: ${formatNumber(median(nonBlank.map((item) => item.fleschReadingEase)))}`,
    `- Average Flesch-Kincaid Grade Level: ${formatNumber(average(nonBlank, "fleschKincaidGrade"))}`,
    `- Median Flesch-Kincaid Grade Level: ${formatNumber(median(nonBlank.map((item) => item.fleschKincaidGrade)))}`,
    "",
    "_Note: Very high grade levels may reflect formatting artifacts, unusual punctuation, or sentence-splitting limitations. Ranked lists use raw grade levels for diagnostic visibility._",
    "",
    "### Hardest 20 Abstracts by Grade Level",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...nonBlank].sort((left, right) => right.fleschKincaidGrade - left.fleschKincaidGrade)
      ),
      20
    ),
    "",
    "### Easiest 20 Abstracts by Grade Level",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...analyzable].sort((left, right) => left.fleschKincaidGrade - right.fleschKincaidGrade)
      ),
      20
    ),
    "",
    "## Readability Score Warnings",
    "",
    `- Abstracts with grade level above 30: ${nonBlank.filter((item) => item.fleschKincaidGrade > 30).length}`,
    `- Abstracts with grade level above 50: ${nonBlank.filter((item) => item.fleschKincaidGrade > 50).length}`,
    `- Abstracts with grade level above 80: ${nonBlank.filter((item) => item.fleschKincaidGrade > 80).length}`,
    "",
    "### Highest Grade-Level Outliers",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...nonBlank].sort((left, right) => right.fleschKincaidGrade - left.fleschKincaidGrade)
      ),
      10
    ),
    "",
    "## Length Distribution",
    "",
    formatBucketTable(countBuckets(nonBlank, "wordCount", LENGTH_BUCKETS), nonBlank.length),
    "",
    "## Numerical Density",
    "",
    formatBucketTable(countBuckets(nonBlank, "numberCount", COUNT_BUCKETS), nonBlank.length),
    "",
    "### Top 20 Most Number-Heavy Abstracts",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...nonBlank].sort((left, right) => right.numberCount - left.numberCount)
      ),
      20
    ),
    "",
    "## Statistical / Methods Vocabulary",
    "",
    formatBucketTable(
      countBuckets(nonBlank, "methodsTermCount", COUNT_BUCKETS),
      nonBlank.length
    ),
    "",
    "### Top 20 Most Methods-Heavy Abstracts",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...nonBlank].sort((left, right) => right.methodsTermCount - left.methodsTermCount)
      ),
      20
    ),
    "",
    "## Technical / Scientific Density",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...nonBlank].sort((left, right) => right.technicalDensityCount - left.technicalDensityCount)
      ),
      20
    ),
    "",
    "## Jargon / Acronym Density",
    "",
    `- Average acronyms per abstract: ${formatNumber(average(nonBlank, "acronymCount"))}`,
    `- Average long words per abstract: ${formatNumber(average(nonBlank, "longWordCount"))}`,
    "",
    "### Top 20 Jargon-Heavy Abstracts",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...nonBlank].sort(
          (left, right) =>
            right.acronymCount + right.longWordCount -
            (left.acronymCount + left.longWordCount)
        )
      ),
      20
    ),
    "",
    "## Very Short / Possibly Non-Abstract Records",
    "",
    formatShortRecordsTable(
      getUniquePapers([...veryShort].sort((left, right) => left.wordCount - right.wordCount)),
      25
    ),
    "",
    "## Practical Difficulty Distribution",
    "",
    formatPracticalDifficultyTable(nonBlank),
    "",
    "## Field and Subfield Breakdown",
    "",
    "### By Topic Field",
    "",
    formatGroupMetrics(groupByMinimum(nonBlank, "topicField", 10)),
    "",
    "### By Topic Subfield",
    "",
    formatGroupMetrics(groupByMinimum(nonBlank, "topicSubfield", 10)),
    "",
    "## Candidate Tier Breakdown",
    "",
    formatGroupMetrics(groupByMinimum(nonBlank, "tier", 1)),
    "",
    "## Curiosity Score Breakdown",
    "",
    formatGroupMetrics(groupByMinimum(nonBlank, "curiosityScore", 1)),
    "",
    "## Most Concerning Abstracts",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...nonBlank].sort((left, right) => right.difficultyScore - left.difficultyScore)
      ),
      25
    ),
    "",
    "## Most Inviting Abstracts",
    "",
    formatPaperMetricTable(
      getUniquePapers(
        [...analyzableUnique].sort((left, right) => right.invitingScore - left.invitingScore)
      ),
      25
    )
  ].join("\n")}\n`;
}

function getDataAvailabilityNote(items) {
  const missingCount = items.filter((item) => item.missingAbstract).length;

  if (items.length === 0) {
    return "The input file did not contain a recognized selected-paper sequence.";
  }

  if (missingCount === 0) {
    return "The input file includes abstract text for all selected papers.";
  }

  if (missingCount === items.length) {
    return "The input file includes selected-paper metadata, but not abstract text. Readability metrics require an `abstract` field on each selected paper, so this report can only document that limitation until the raw diagnostic stores abstracts.";
  }

  return `The input file is missing abstract text for ${missingCount} of ${items.length} selected papers. Metrics below are based only on papers with abstract text.`;
}

function splitSentences(text) {
  return text
    .split(/[.!?]+(?:\s+|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function getWords(text) {
  return text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
}

function countSyllables(word) {
  const normalized = word.toLowerCase().replace(/[^a-z]/g, "");

  if (!normalized) {
    return 0;
  }

  const withoutSilentE = normalized.replace(/e\b/, "");
  const groups = withoutSilentE.match(/[aeiouy]+/g);

  return Math.max(1, groups ? groups.length : 1);
}

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function countMethodTerms(text) {
  const normalized = text.toLowerCase();

  return METHODS_TERMS.reduce((count, term) => {
    const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = normalized.match(new RegExp(`\\b${escapedTerm}\\b`, "g"));

    return count + (matches ? matches.length : 0);
  }, 0);
}

function getTechnicalDensityCount(text, words) {
  const equationSymbols = countMatches(text, /[=<>±×÷∑√≈≤≥→←↔]/g);
  const greekLetters = countMatches(text, /[α-ωΑ-Ω]/g);
  const geneProteinTokens = countMatches(text, /\b[A-Z]{2,}[A-Z0-9-]*\d+[A-Z0-9-]*\b/g);
  const chemicalFormulas = countMatches(text, /\b(?:[A-Z][a-z]?\d*){2,}\b/g);
  const acronyms = countMatches(text, /\b[A-Z]{2,}\b/g);
  const bracketedCitations = countMatches(text, /\[[^\]]*\d{4}[^\]]*\]|\([A-Z][A-Za-z]+(?: et al\.)?,? \d{4}\)/g);
  const heavyPunctuation = countMatches(text, /[;:()[\]{}]/g);
  const longHyphenatedTerms = words.filter(
    (word) => word.includes("-") && word.length >= 12
  ).length;

  return (
    equationSymbols +
    greekLetters +
    geneProteinTokens +
    chemicalFormulas +
    acronyms +
    bracketedCitations +
    Math.floor(heavyPunctuation / 5) +
    longHyphenatedTerms
  );
}

function lengthInvitingScore(wordCount) {
  if (wordCount >= 90 && wordCount <= 220) {
    return 10;
  }

  if (wordCount >= 75 && wordCount <= 280) {
    return 7;
  }

  if (wordCount >= 50 && wordCount <= 350) {
    return 4;
  }

  return 0;
}

function getPracticalDifficulty({
  wordCount,
  averageSentenceLength,
  numberCount,
  methodsTermCount,
  technicalDensityCount,
  missingAbstract,
  fleschKincaidGrade
}) {
  if (missingAbstract || wordCount < 20) {
    return "Possibly Broken / Non-Abstract";
  }

  if (
    wordCount >= 400 ||
    averageSentenceLength >= 45 ||
    fleschKincaidGrade > 30 ||
    numberCount >= 12 ||
    methodsTermCount >= 8 ||
    technicalDensityCount >= 35
  ) {
    return "Very Dense";
  }

  if (
    wordCount >= 250 ||
    averageSentenceLength >= 30 ||
    fleschKincaidGrade > 18 ||
    numberCount >= 6 ||
    methodsTermCount >= 4 ||
    technicalDensityCount >= 18
  ) {
    return "Dense";
  }

  if (
    wordCount >= 75 &&
    wordCount <= 220 &&
    averageSentenceLength <= 24 &&
    fleschKincaidGrade <= 13 &&
    numberCount <= 2 &&
    methodsTermCount <= 1 &&
    technicalDensityCount <= 8
  ) {
    return "Inviting";
  }

  return "Manageable";
}

function getStableKey(paper) {
  const url = getString(paper.url).trim().toLowerCase();

  if (url) {
    return `url:${url}`;
  }

  return [
    "metadata",
    getString(paper.title).trim().toLowerCase(),
    paper.publicationYear ?? "unknown-year",
    getString(paper.sourceName).trim().toLowerCase() || "unknown-source"
  ].join(":");
}

function getUniquePapers(items) {
  const seen = new Set();
  const uniqueItems = [];

  for (const item of items) {
    if (seen.has(item.stableKey)) {
      continue;
    }

    seen.add(item.stableKey);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

function countBuckets(items, key, buckets) {
  return Object.fromEntries(
    buckets.map(([label, includes]) => [
      label,
      items.filter((item) => includes(item[key])).length
    ])
  );
}

function formatBucketTable(counts, total) {
  return [
    "| Bucket | Count | Share |",
    "| --- | ---: | ---: |",
    ...Object.entries(counts).map(([label, count]) =>
      `| ${escapeTable(label)} | ${count} | ${formatPercent(total > 0 ? count / total : 0)} |`
    )
  ].join("\n");
}

function formatShortRecordsTable(items, limit) {
  const rows = items.slice(0, limit);

  if (rows.length === 0) {
    return "_No very short records found._";
  }

  return [
    "| Rank | Title | Source | Year | Words | Field | Subfield | URL |",
    "| ---: | --- | --- | ---: | ---: | --- | --- | --- |",
    ...rows.map((item, index) =>
      [
        index + 1,
        escapeTable(item.title),
        escapeTable(item.sourceName),
        item.publicationYear,
        item.wordCount,
        escapeTable(item.topicField),
        escapeTable(item.topicSubfield),
        item.url ? `[link](${item.url})` : ""
      ].join(" | ")
    )
  ].join("\n");
}

function formatPracticalDifficultyTable(items) {
  const order = [
    "Inviting",
    "Manageable",
    "Dense",
    "Very Dense",
    "Possibly Broken / Non-Abstract"
  ];

  return [
    "| Bucket | Count | Share | Avg words | Avg numbers | Avg methods terms | Avg technical density |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...order.map((bucket) => {
      const bucketItems = items.filter((item) => item.practicalDifficulty === bucket);

      return [
        bucket,
        bucketItems.length,
        formatPercent(items.length > 0 ? bucketItems.length / items.length : 0),
        formatNumber(average(bucketItems, "wordCount")),
        formatNumber(average(bucketItems, "numberCount")),
        formatNumber(average(bucketItems, "methodsTermCount")),
        formatNumber(average(bucketItems, "technicalDensityCount"))
      ].join(" | ");
    })
  ].join("\n");
}

function formatPaperMetricTable(items, limit) {
  const rows = items.slice(0, limit);

  if (rows.length === 0) {
    return "_No abstracts available._";
  }

  return [
    "| Rank | Title | Source | Year | Field | Subfield | Words | Grade | Numbers | Methods | Technical | URL |",
    "| ---: | --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((item, index) =>
      [
        index + 1,
        escapeTable(item.title),
        escapeTable(item.sourceName),
        item.publicationYear,
        escapeTable(item.topicField),
        escapeTable(item.topicSubfield),
        item.wordCount,
        formatNumber(item.fleschKincaidGrade),
        item.numberCount,
        item.methodsTermCount,
        item.technicalDensityCount,
        item.url ? `[link](${item.url})` : ""
      ].join(" | ")
    )
  ].join("\n");
}

function groupByMinimum(items, key, minimumCount) {
  const groups = new Map();

  for (const item of items) {
    const value = String(item[key] ?? "Unknown");

    if (!groups.has(value)) {
      groups.set(value, []);
    }

    groups.get(value).push(item);
  }

  return [...groups.entries()]
    .filter(([, groupItems]) => groupItems.length >= minimumCount)
    .sort((left, right) => right[1].length - left[1].length);
}

function formatGroupMetrics(groups) {
  if (groups.length === 0) {
    return "_No groups met the minimum count._";
  }

  return [
    "| Group | Count | Avg words | Avg grade | Avg numbers | Avg methods terms | Dense / Very Dense | Possibly Broken / Non-Abstract |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...groups.map(([group, items]) =>
      [
        escapeTable(group),
        items.length,
        formatNumber(average(items, "wordCount")),
        formatNumber(average(items, "fleschKincaidGrade")),
        formatNumber(average(items, "numberCount")),
        formatNumber(average(items, "methodsTermCount")),
        formatPercent(getDifficultyShare(items, ["Dense", "Very Dense"])),
        formatPercent(getDifficultyShare(items, ["Possibly Broken / Non-Abstract"]))
      ].join(" | ")
    )
  ].join("\n");
}

function getDifficultyShare(items, buckets) {
  if (items.length === 0) {
    return 0;
  }

  return (
    items.filter((item) => buckets.includes(item.practicalDifficulty)).length /
    items.length
  );
}

function average(items, key) {
  if (items.length === 0) {
    return 0;
  }

  return items.reduce((total, item) => total + Number(item[key] || 0), 0) / items.length;
}

function median(values) {
  const sorted = values
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (sorted.length === 0) {
    return 0;
  }

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "0.0";
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function getString(value) {
  return typeof value === "string" ? value : "";
}

function escapeTable(value) {
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}
