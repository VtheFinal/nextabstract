import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const INPUT_PATH = "outputs/effective-candidate-universe-results.json";
const OUTPUT_PATH = "outputs/narrative-report.md";

const CONCRETE_TERMS = [
  "city",
  "river",
  "bird",
  "mountain",
  "king",
  "church",
  "child",
  "doctor",
  "animal",
  "war",
  "book",
  "music",
  "painting",
  "planet",
  "volcano",
  "forest",
  "bridge",
  "ship",
  "family"
];

const ABSTRACT_TERMS = [
  "model",
  "framework",
  "process",
  "analysis",
  "method",
  "approach",
  "system",
  "mechanism",
  "function",
  "representation",
  "structure",
  "parameter",
  "optimization",
  "algorithm",
  "estimation"
];

const HUMAN_STORY_SIGNALS = [
  "people",
  "children",
  "women",
  "men",
  "families",
  "communities",
  "cities",
  "countries",
  "civilizations",
  "religions",
  "historical periods",
  "wars",
  "artists",
  "scientists",
  "animals",
  "plants",
  "music",
  "language",
  "food"
];

const CURIOSITY_HOOKS = [
  "why",
  "how",
  "when",
  "origins",
  "history",
  "discovery",
  "rise",
  "fall",
  "future",
  "mystery",
  "evolution",
  "birth",
  "death",
  "journey",
  "dream",
  "memory",
  "language",
  "music",
  "nature",
  "universe",
  "society"
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

const PROCEDURAL_OPENERS = [
  "this paper",
  "this study",
  "we present",
  "we propose",
  "we evaluate",
  "methods",
  "objective",
  "background",
  "results",
  "conclusion"
];

const rawData = JSON.parse(await readFile(INPUT_PATH, "utf8"));
const papers = getSelectedPapers(rawData);
const analyses = papers.map(analyzePaper);

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, buildReport(analyses));

console.log(`Analyzed ${analyses.length} papers.`);
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
  const title = getString(paper.title) || "Untitled";
  const abstract = getString(paper.abstract);
  const titleWords = getWords(title);
  const abstractWords = getWords(abstract);
  const openingSentence = getOpeningSentence(abstract);
  const titleAndOpening = `${title} ${openingSentence}`;
  const concreteCount = countTerms(abstract, CONCRETE_TERMS);
  const abstractTermCount = countTerms(abstract, ABSTRACT_TERMS);
  const numberCount = countMatches(
    abstract,
    /(?:\b\d+(?:,\d{3})*(?:\.\d+)?%?\b|[<>]=?\s*\d+(?:\.\d+)?)/g
  );
  const methodsTermCount = countTerms(abstract, METHODS_TERMS);
  const technicalDensityCount = getTechnicalDensityCount(abstract, abstractWords);
  const humanStoryCount = HUMAN_STORY_SIGNALS.reduce(
    (total, signal) => total + (containsTerm(abstract, signal) ? 1 : 0),
    0
  );
  const hookCount = CURIOSITY_HOOKS.reduce(
    (total, hook) => total + (containsTerm(titleAndOpening, hook) ? 1 : 0),
    0
  );
  const proceduralOpening = isProceduralOpening(openingSentence);
  const openingClass = classifyOpeningSentence(openingSentence);
  const readabilityGrade = getFleschKincaidGrade(abstractWords, splitSentences(abstract));
  const narrativeScore = getNarrativeScore({
    title,
    abstract,
    openingSentence,
    concreteCount,
    abstractTermCount,
    humanStoryCount,
    hookCount,
    proceduralOpening,
    numberCount,
    methodsTermCount,
    technicalDensityCount
  });

  return {
    index,
    loadNumber: paper.loadNumber ?? index + 1,
    key: getStableKey(paper),
    title,
    abstract,
    sourceName: getString(paper.sourceName) || "Unknown",
    publicationYear: paper.publicationYear ?? "Unknown",
    topicField: getString(paper.topicField) || "Unknown",
    topicSubfield: getString(paper.topicSubfield) || "Unknown",
    topicName: getString(paper.topicName) || "Unknown",
    curiosityScore:
      typeof paper.curiosityScore === "number" ? paper.curiosityScore : "Unknown",
    url: getString(paper.url),
    titleWordCount: titleWords.length,
    abstractWordCount: abstractWords.length,
    openingSentence,
    openingClass,
    readabilityGrade,
    concreteCount,
    abstractTermCount,
    humanStoryCount,
    hookCount,
    proceduralOpening,
    numberCount,
    methodsTermCount,
    technicalDensityCount,
    narrativeScore,
    titleCharacteristics: getTitleCharacteristics(title)
  };
}

function buildReport(items) {
  const uniqueItems = getUniquePapers(items);

  return [
    "# NextAbstract Narrative Report",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    `Input: \`${INPUT_PATH}\``,
    "",
    "## 1. Summary",
    "",
    `- Total papers analyzed: ${items.length}`,
    `- Unique papers: ${uniqueItems.length}`,
    `- Average title length: ${formatNumber(average(items, "titleWordCount"))} words`,
    `- Average abstract length: ${formatNumber(average(items, "abstractWordCount"))} words`,
    "",
    "## 2. Title Characteristics",
    "",
    formatTitleCharacteristics(items),
    "",
    "### Most Common Opening Words",
    "",
    formatCountTable(getOpeningWordCounts(items), 20, "Opening word"),
    "",
    "## 3. Opening Sentence Analysis",
    "",
    formatCountTable(countBy(items, "openingClass"), 20, "Opening type", items.length),
    "",
    "## 4. Concrete vs Abstract Language",
    "",
    `- Average concrete words: ${formatNumber(average(items, "concreteCount"))}`,
    `- Average abstract words: ${formatNumber(average(items, "abstractTermCount"))}`,
    "",
    "### Top Concrete Papers",
    "",
    formatNarrativeTable(
      getUniquePapers([...items].sort((left, right) => right.concreteCount - left.concreteCount)),
      20
    ),
    "",
    "### Top Abstract-Language Papers",
    "",
    formatNarrativeTable(
      getUniquePapers(
        [...items].sort((left, right) => right.abstractTermCount - left.abstractTermCount)
      ),
      20
    ),
    "",
    "## 5. Human Story Signals",
    "",
    formatSignalTable(items, HUMAN_STORY_SIGNALS, "Signal"),
    "",
    "## 6. Curiosity Hooks",
    "",
    formatHookTable(items),
    "",
    "## 7. Procedural Language",
    "",
    formatProceduralLanguage(items),
    "",
    "## 8. Narrative Potential Score",
    "",
    "This exploratory score rewards question-like, concrete, human, historical, person, and place signals, while penalizing method-first openings, procedural language, heavy numbers, methods vocabulary, and technical density.",
    "",
    `- Average Narrative score: ${formatNumber(average(items, "narrativeScore"))}`,
    `- Median Narrative score: ${formatNumber(median(items.map((item) => item.narrativeScore)))}`,
    `- Highest score: ${formatNumber(Math.max(...items.map((item) => item.narrativeScore)))}`,
    `- Lowest score: ${formatNumber(Math.min(...items.map((item) => item.narrativeScore)))}`,
    "",
    "## 9. Highest Narrative Potential Papers",
    "",
    formatNarrativeTable(
      getUniquePapers([...items].sort((left, right) => right.narrativeScore - left.narrativeScore)),
      50
    ),
    "",
    "## 10. Lowest Narrative Potential Papers",
    "",
    formatNarrativeTable(
      getUniquePapers([...items].sort((left, right) => left.narrativeScore - right.narrativeScore)),
      50
    ),
    "",
    "## 11. Narrative Potential by Field",
    "",
    formatGroupMetrics(items, "topicField"),
    "",
    "## 12. Relationship to Curiosity Score",
    "",
    formatGroupMetrics(items, "curiosityScore"),
    ""
  ].join("\n");
}

function getTitleCharacteristics(title) {
  const trimmed = title.trim();

  return {
    questionMark: trimmed.includes("?"),
    beginsWhy: /^why\b/i.test(trimmed),
    beginsHow: /^how\b/i.test(trimmed),
    beginsWhen: /^when\b/i.test(trimmed),
    beginsWhat: /^what\b/i.test(trimmed),
    colon: trimmed.includes(":"),
    quotationMarks: /["'“”‘’]/.test(trimmed),
    datesOrYears: /\b(?:1[5-9]\d{2}|20\d{2}|\d{1,2}(?:st|nd|rd|th)\s+century)\b/i.test(trimmed),
    properNames: hasProperNameSignal(trimmed),
    beginsThe: /^the\b/i.test(trimmed)
  };
}

function formatTitleCharacteristics(items) {
  const definitions = [
    ["Titles with question mark", "questionMark"],
    ["Titles beginning with Why", "beginsWhy"],
    ["Titles beginning with How", "beginsHow"],
    ["Titles beginning with When", "beginsWhen"],
    ["Titles beginning with What", "beginsWhat"],
    ["Titles containing a colon", "colon"],
    ["Titles containing quotation marks", "quotationMarks"],
    ["Titles containing dates or years", "datesOrYears"],
    ["Titles containing proper names", "properNames"],
    ["Titles beginning with The", "beginsThe"]
  ];

  return [
    "| Characteristic | Count | Percent |",
    "|---|---:|---:|",
    ...definitions.map(([label, key]) => {
      const count = items.filter((item) => item.titleCharacteristics[key]).length;
      return `| ${escapeMarkdown(label)} | ${count} | ${formatPercent(count, items.length)} |`;
    })
  ].join("\n");
}

function formatProceduralLanguage(items) {
  const proceduralItems = items.filter((item) => item.proceduralOpening);

  return [
    `- Papers with procedural opening language: ${proceduralItems.length} (${formatPercent(
      proceduralItems.length,
      items.length
    )})`,
    "",
    formatSignalTable(
      items.map((item) => ({ ...item, abstract: item.openingSentence })),
      PROCEDURAL_OPENERS,
      "Opening phrase"
    )
  ].join("\n");
}

function formatSignalTable(items, signals, label) {
  return [
    `| ${label} | Count | Percent |`,
    "|---|---:|---:|",
    ...signals.map((signal) => {
      const count = items.filter((item) => containsTerm(item.abstract, signal)).length;
      return `| ${escapeMarkdown(signal)} | ${count} | ${formatPercent(count, items.length)} |`;
    })
  ].join("\n");
}

function formatHookTable(items) {
  return [
    "| Hook | Count | Percent |",
    "|---|---:|---:|",
    ...CURIOSITY_HOOKS.map((hook) => {
      const count = items.filter((item) =>
        containsTerm(`${item.title} ${item.openingSentence}`, hook)
      ).length;
      return `| ${escapeMarkdown(hook)} | ${count} | ${formatPercent(count, items.length)} |`;
    })
  ].join("\n");
}

function formatNarrativeTable(items, limit) {
  const rows = items.slice(0, limit);

  if (rows.length === 0) {
    return "_No papers available._";
  }

  return [
    "| Rank | Title | Source | Field | Subfield | Narrative score | Word count | Numbers | Methods terms | Technical density | URL |",
    "|---:|---|---|---|---|---:|---:|---:|---:|---:|---|",
    ...rows.map(
      (item, index) =>
        `| ${index + 1} | ${escapeMarkdown(item.title)} | ${escapeMarkdown(
          item.sourceName
        )} | ${escapeMarkdown(item.topicField)} | ${escapeMarkdown(
          item.topicSubfield
        )} | ${formatNumber(item.narrativeScore)} | ${item.abstractWordCount} | ${
          item.numberCount
        } | ${item.methodsTermCount} | ${item.technicalDensityCount} | ${formatUrl(
          item.url
        )} |`
    )
  ].join("\n");
}

function formatGroupMetrics(items, groupKey) {
  const groups = groupItems(items, (item) => String(item[groupKey] ?? "Unknown"));
  const rows = [...groups.entries()]
    .map(([group, groupItemsForKey]) => ({
      group,
      count: groupItemsForKey.length,
      averageNarrativeScore: average(groupItemsForKey, "narrativeScore"),
      averageReadability: average(groupItemsForKey, "readabilityGrade"),
      averageTechnicalDensity: average(groupItemsForKey, "technicalDensityCount"),
      averageNumbers: average(groupItemsForKey, "numberCount")
    }))
    .filter((row) => groupKey !== "topicField" || row.count >= 10)
    .sort((left, right) => right.count - left.count);

  if (rows.length === 0) {
    return "_No groups available._";
  }

  return [
    "| Group | Count | Average Narrative score | Average readability grade | Average technical density | Average numbers |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows.map(
      (row) =>
        `| ${escapeMarkdown(row.group)} | ${row.count} | ${formatNumber(
          row.averageNarrativeScore
        )} | ${formatNumber(row.averageReadability)} | ${formatNumber(
          row.averageTechnicalDensity
        )} | ${formatNumber(row.averageNumbers)} |`
    )
  ].join("\n");
}

function classifyOpeningSentence(sentence) {
  const text = sentence.trim();
  const lower = text.toLowerCase();

  if (!text) return "Unknown";
  if (text.includes("?")) return "Question";
  if (/^this paper\b/i.test(text)) return "This paper...";
  if (/^this study\b/i.test(text)) return "This study...";
  if (/^we\b/i.test(text)) return "We...";
  if (/^(methods?|objective|background|results?|conclusions?)\b/i.test(text)) {
    return "Method-focused";
  }
  if (/\b(review|systematic review|meta-analysis)\b/i.test(text)) return "Review article";
  if (/\b(observe|observed|observation|measured|detected|discovered)\b/i.test(text)) {
    return "Scientific observation";
  }
  if (/\b(century|war|revolution|empire|kingdom|dynasty|medieval|ancient|colonial|modern)\b/i.test(text)) {
    return "Historical event";
  }
  if (/\b(he|she|his|her|person|people|man|woman|child|author|artist|king|queen|scientist)\b/i.test(text)) {
    return "Person-focused";
  }
  if (/\b(city|town|village|country|region|river|mountain|island|church|temple|museum)\b/i.test(text)) {
    return "Place-focused";
  }
  if (/\b(problem|challenge|question|debate|controversy|issue|lack|gap)\b/i.test(lower)) {
    return "Problem statement";
  }

  return "Unknown";
}

function getNarrativeScore({
  title,
  abstract,
  openingSentence,
  concreteCount,
  abstractTermCount,
  humanStoryCount,
  hookCount,
  proceduralOpening,
  numberCount,
  methodsTermCount,
  technicalDensityCount
}) {
  let score = 0;

  if (hasProperNameSignal(title)) score += 2;
  if (/\b(city|country|region|river|mountain|island|church|temple|village|empire|kingdom)\b/i.test(`${title} ${abstract}`)) {
    score += 1;
  }
  if (/\b(ancient|medieval|century|war|revolution|dynasty|colonial|renaissance|victorian)\b/i.test(`${title} ${abstract}`)) {
    score += 1;
  }
  if (title.includes("?") || openingSentence.includes("?")) score += 2;
  score += Math.min(3, concreteCount);
  score += Math.min(3, humanStoryCount);
  score += Math.min(3, hookCount);

  if (proceduralOpening) score -= 3;
  if (abstractTermCount >= concreteCount + 2) score -= 1;
  if (numberCount >= 6) score -= 2;
  else if (numberCount >= 3) score -= 1;
  if (methodsTermCount >= 6) score -= 3;
  else if (methodsTermCount >= 3) score -= 2;
  else if (methodsTermCount >= 1) score -= 1;
  if (technicalDensityCount >= 10) score -= 3;
  else if (technicalDensityCount >= 5) score -= 2;
  else if (technicalDensityCount >= 2) score -= 1;

  return score;
}

function getOpeningSentence(text) {
  const normalized = getString(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const match = normalized.match(/^.{1,400}?[.!?](?:\s|$)/);
  return match ? match[0].trim() : normalized.slice(0, 400).trim();
}

function getOpeningWordCounts(items) {
  const counts = new Map();

  for (const item of items) {
    const firstWord = getWords(item.title)[0]?.toLowerCase();
    if (!firstWord) continue;
    counts.set(firstWord, (counts.get(firstWord) || 0) + 1);
  }

  return counts;
}

function isProceduralOpening(sentence) {
  return PROCEDURAL_OPENERS.some((phrase) => containsTerm(sentence, phrase));
}

function hasProperNameSignal(text) {
  const cleaned = text.replace(/[^\p{L}\s'-]/gu, " ");
  const matches = cleaned.match(/\b[A-Z][a-z]+(?:\s+(?:de|da|del|van|von|of|the|[A-Z][a-z]+)){1,3}\b/g) || [];
  return matches.some((match) => !/^(The|This|These|Those|A|An)\b/.test(match));
}

function getFleschKincaidGrade(words, sentences) {
  if (words.length === 0) {
    return 0;
  }

  const sentenceCount = Math.max(sentences.length, 1);
  const syllables = words.reduce((total, word) => total + countSyllables(word), 0);

  return 0.39 * (words.length / sentenceCount) + 11.8 * (syllables / words.length) - 15.59;
}

function getTechnicalDensityCount(text, words) {
  return (
    countMatches(text, /[=<>±∑√∞≈≠≤≥]/g) +
    countMatches(text, /\b[A-Z]{2,}\b/g) +
    countMatches(text, /\[[0-9,\s-]+\]/g) +
    countMatches(text, /\b[a-z]+-[a-z]+(?:-[a-z]+)+\b/gi) +
    words.filter((word) => /[A-Za-z]+\d+|\d+[A-Za-z]+/.test(word)).length
  );
}

function countTerms(text, terms) {
  return terms.reduce((total, term) => total + countTerm(text, term), 0);
}

function countTerm(text, term) {
  const escaped = escapeRegExp(term).replace(/\\ /g, "\\s+");
  return countMatches(text, new RegExp(`\\b${escaped}\\b`, "gi"));
}

function containsTerm(text, term) {
  return countTerm(text, term) > 0;
}

function countMatches(text, regex) {
  return getString(text).match(regex)?.length || 0;
}

function splitSentences(text) {
  return getString(text)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function getWords(text) {
  return getString(text).match(/\b[\p{L}\p{N}'-]+\b/gu) || [];
}

function countSyllables(word) {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!cleaned) return 0;
  const groups = cleaned.match(/[aeiouy]+/g);
  let count = groups ? groups.length : 1;
  if (cleaned.endsWith("e") && count > 1) count -= 1;
  return Math.max(count, 1);
}

function groupItems(items, getKey) {
  const groups = new Map();

  for (const item of items) {
    const key = getKey(item) || "Unknown";
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(item);
  }

  return groups;
}

function countBy(items, key) {
  const counts = new Map();

  for (const item of items) {
    const value = String(item[key] ?? "Unknown");
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return counts;
}

function formatCountTable(counts, limit, label, total = sumCounts(counts)) {
  const rows = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);

  if (rows.length === 0) {
    return "_No values available._";
  }

  return [
    `| ${label} | Count | Percent |`,
    "|---|---:|---:|",
    ...rows.map(
      ([value, count]) => `| ${escapeMarkdown(value)} | ${count} | ${formatPercent(count, total)} |`
    )
  ].join("\n");
}

function getUniquePapers(items) {
  const seen = new Set();
  const uniqueItems = [];

  for (const item of items) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    uniqueItems.push(item);
  }

  return uniqueItems;
}

function getStableKey(paper) {
  const url = getString(paper.url).trim().toLowerCase();
  if (url) {
    return `url:${url}`;
  }

  return `paper:${getString(paper.title).trim().toLowerCase()}|${paper.publicationYear ?? ""}|${getString(
    paper.sourceName
  )
    .trim()
    .toLowerCase()}`;
}

function average(items, key) {
  if (items.length === 0) return 0;
  return items.reduce((total, item) => total + Number(item[key] || 0), 0) / items.length;
}

function median(values) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (sorted.length === 0) return 0;

  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function sumCounts(counts) {
  return [...counts.values()].reduce((total, count) => total + count, 0);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(1);
}

function formatPercent(count, total) {
  if (!total) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function formatUrl(url) {
  return url ? `[Link](${url})` : "";
}

function escapeMarkdown(value) {
  return getString(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getString(value) {
  return typeof value === "string" ? value : "";
}
