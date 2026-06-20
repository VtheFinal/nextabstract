import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OPENALEX_URL = "https://api.openalex.org/works";
const RESULTS_PER_PAGE = 20;
const MAX_RANDOM_PAGE = 500;
const MIN_ABSTRACT_WORDS = 20;
const FILTER_DIAGNOSTICS = false;
const HUMANITIES_QUERY_CHANCE = 0.25;
const SPACE_QUERY_CHANCE = 0.1;
const EXCLUDED_SOURCE_NAMES = [
  "the annals of eugenics",
];
const GENERAL_WORK_FILTER =
  "language:en,has_abstract:true,type:article|preprint|dissertation";
const HUMANITIES_WORK_FILTER =
  "language:en,has_abstract:true,primary_topic.field.id:12,type:article|preprint|dissertation";
const SPACE_WORK_FILTER =
  "language:en,has_abstract:true,type:article|preprint|dissertation,primary_topic.id:T10039|T10095|T10325|T10406|T10477|T12788|T10026";

export async function GET() {
  try {
    const data = await fetchOpenAlexWorks();
    const candidates = Array.isArray(data.results)
      ? applyCandidateFilters(data.results.map(normalizeWork))
      : [];
    const historyCandidates = candidates.filter(isHistoryTopic);
    const preferredCandidates = candidates.filter(
      (paper) => isPreferredTopic(paper) && !isPsychologyTopic(paper)
    );
    const paper = randomItem(
      historyCandidates.length > 0
        ? historyCandidates
        : preferredCandidates.length > 0
          ? preferredCandidates
          : candidates
    );

    if (!paper) {
      return NextResponse.json(
        { error: "No usable English abstract was found." },
        { status: 404 }
      );
    }

    return NextResponse.json(paper);
  } catch (error) {
    console.error("Failed to load /api/abstract:", error);

    return NextResponse.json(
      { error: "Unable to load an abstract from OpenAlex." },
      { status: 502 }
    );
  }
}

async function fetchOpenAlexWorks() {
  const params = new URLSearchParams({
    filter: getOpenAlexWorkFilter(),
    per_page: String(RESULTS_PER_PAGE),
    page: String(randomPage()),
    select: [
      "id",
      "doi",
      "display_name",
      "title",
      "authorships",
      "publication_year",
      "primary_topic",
      "primary_location",
      "locations",
      "abstract_inverted_index"
    ].join(",")
  });

  const response = await fetch(`${OPENALEX_URL}?${params.toString()}`, {
    headers: {
      Accept: "application/json"
    },
    next: { revalidate: 0 }
  });

  if (!response.ok) {
    throw new Error(`OpenAlex request failed with status ${response.status}.`);
  }

  return response.json();
}

function getOpenAlexWorkFilter() {
  const queryMode = Math.random();

  if (queryMode < HUMANITIES_QUERY_CHANCE) {
    return HUMANITIES_WORK_FILTER;
  }

  if (queryMode < HUMANITIES_QUERY_CHANCE + SPACE_QUERY_CHANCE) {
    return SPACE_WORK_FILTER;
  }

  return GENERAL_WORK_FILTER;
}

function randomPage() {
  return Math.floor(Math.random() * MAX_RANDOM_PAGE) + 1;
}

function normalizeWork(work: unknown) {
  if (!work || typeof work !== "object") {
    return null;
  }

  const openAlexWork = work as OpenAlexWork;
  const title = decodeHtmlEntities(
    getString(openAlexWork.display_name) || getString(openAlexWork.title)
  );
  const abstract = decodeHtmlEntities(
    restoreAbstract(openAlexWork.abstract_inverted_index)
  );
  const authors = formatAuthors(openAlexWork.authorships);
  const url = getPaperUrl(openAlexWork);

  if (!title || !abstract || authors.length === 0 || !url) {
    return null;
  }

  return {
    title,
    abstract,
    authors,
    publicationYear:
      typeof openAlexWork.publication_year === "number"
        ? openAlexWork.publication_year
        : null,
    sourceName: decodeHtmlEntities(getSourceName(openAlexWork)),
    topicName: decodeHtmlEntities(
      getString(openAlexWork.primary_topic?.display_name)
    ),
    topicDomain: decodeHtmlEntities(
      getString(openAlexWork.primary_topic?.domain?.display_name)
    ),
    topicField: decodeHtmlEntities(
      getString(openAlexWork.primary_topic?.field?.display_name)
    ),
    topicSubfield: decodeHtmlEntities(
      getString(openAlexWork.primary_topic?.subfield?.display_name)
    ),
    url
  };
}

function restoreAbstract(index: Record<string, number[]> | null | undefined) {
  if (!index || typeof index !== "object") {
    return "";
  }

  const words = Object.entries(index)
    .filter((entry): entry is [string, number[]] => Array.isArray(entry[1]))
    .flatMap(([word, positions]) =>
      positions.map((position) => [position, word] as const)
    )
    .reduce<string[]>((result, [position, word]) => {
      if (Number.isInteger(position) && position >= 0) {
        result[position] = word;
      }

      return result;
    }, []);

  return words.filter(Boolean).join(" ");
}

function formatAuthors(authorships: unknown) {
  if (!Array.isArray(authorships)) {
    return [];
  }

  return authorships
    .map((authorship) => authorship.author?.display_name)
    .filter((name): name is string => typeof name === "string" && Boolean(name))
    .map(decodeHtmlEntities);
}

function getSourceName(work: OpenAlexWork) {
  const locations = [
    work.primary_location,
    ...(Array.isArray(work.locations) ? work.locations : [])
  ].filter(Boolean);

  return (
    getString(
      locations.find((location) => location?.source?.display_name)?.source
        ?.display_name
    ) || ""
  );
}

function getPaperUrl(work: OpenAlexWork) {
  if (typeof work.doi === "string" && work.doi) {
    return work.doi;
  }

  const locations = [
    work.primary_location,
    ...(Array.isArray(work.locations) ? work.locations : [])
  ].filter(Boolean);

  return (
    getString(
      locations.find((location) => location?.landing_page_url)
        ?.landing_page_url
    ) ||
    getString(locations.find((location) => location?.pdf_url)?.pdf_url) ||
    getString(work.id) ||
    ""
  );
}

function randomItem<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)] || null;
}

function isPaper(value: ReturnType<typeof normalizeWork>): value is Paper {
  return Boolean(value);
}

function applyCandidateFilters(normalizedPapers: ReturnType<typeof normalizeWork>[]) {
  const validPapers = normalizedPapers.filter(isPaper);
  logFilterDiagnostics("isPaper", normalizedPapers.length, validPapers.length);

  let candidates = validPapers;
  candidates = applyPaperFilter("minimumAbstractLength", candidates, (paper) =>
    hasMinimumAbstractLength(paper.abstract)
  );
  candidates = applyPaperFilter("excludedSource", candidates, (paper) =>
    !isExcludedSource(paper.sourceName)
  );
  candidates = applyPaperFilter("excludedMethodTerms", candidates, (paper) =>
    !containsExcludedMethodTerm(paper.abstract)
  );
  candidates = applyPaperFilter("tableOfContents", candidates, (paper) =>
    !looksLikeTableOfContents(paper.abstract)
  );
  candidates = applyPaperFilter("extractedText", candidates, (paper) =>
    !looksLikeExtractedText(paper.title, paper.abstract)
  );
  candidates = applyPaperFilter("bibliography", candidates, (paper) =>
    !looksLikeBibliography(paper.abstract)
  );
  candidates = applyPaperFilter("publisherChrome", candidates, (paper) =>
    !looksLikePublisherChrome(paper.abstract)
  );
  candidates = applyPaperFilter("bookReview", candidates, (paper) =>
    !looksLikeBookReview(paper.abstract, paper.sourceName)
  );
  candidates = applyPaperFilter("abstractUnavailable", candidates, (paper) =>
    !saysAbstractUnavailable(paper.abstract)
  );
  candidates = applyPaperFilter("articleBodyExtraction", candidates, (paper) =>
    !looksLikeArticleBodyExtraction(paper.abstract)
  );

  return candidates;
}

function applyPaperFilter(
  name: string,
  candidates: Paper[],
  keepCandidate: (paper: Paper) => boolean
) {
  const filteredCandidates = candidates.filter(keepCandidate);
  logFilterDiagnostics(name, candidates.length, filteredCandidates.length);

  return filteredCandidates;
}

function logFilterDiagnostics(name: string, before: number, after: number) {
  if (!FILTER_DIAGNOSTICS) {
    return;
  }

  console.log(
    `[abstract filters] ${name}: removed ${before - after}, remaining ${after}`
  );
}

function hasMinimumAbstractLength(abstract: string) {
  return abstract.trim().split(/\s+/).filter(Boolean).length >= MIN_ABSTRACT_WORDS;
}

function isExcludedSource(sourceName: string) {
  return /\beugenics\b/i.test(sourceName);
}

function containsExcludedMethodTerm(abstract: string) {
  return /\b(p[- ]?value|confidence interval|hazard ratio|odds ratio|logistic regression|cox regression|kaplan[- ]meier|randomized controlled trial|systematic review|meta-analysis)\b/i.test(
    abstract
  );
}

function looksLikeTableOfContents(abstract: string) {
  const numberedSectionMatches =
    abstract.match(/\b\d+\.\s+[A-Z][^\n.]{2,100}/g) || [];
  const numberedHeadingMarkers = abstract.match(/\b\d+\.\s+[A-Z]/g) || [];
  const dotHyphenSeparators = abstract.match(/\.-\s+[A-Z]/g) || [];
  const appendixMatches = abstract.match(/\bAppendix\s+[A-Z]\b/g) || [];
  const partMatches =
    abstract.match(
      /\bPart\s+(?:[IVXLC]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi
    ) || [];
  const tocSignalMatches =
    abstract.match(/\b(Preface|Index|Notes and references|Abbreviations)\b/gi) || [];
  const expandedTocSignalMatches =
    abstract.match(
      /\b(Acknowledgments|Appendix|Notes|Bibliography|Index)\b/gi
    ) || [];
  const hasPreface = /\bPreface\b/i.test(abstract);

  return (
    numberedSectionMatches.length >= 4 ||
    dotHyphenSeparators.length >= 5 ||
    (numberedHeadingMarkers.length >= 4 &&
      expandedTocSignalMatches.length >= 2) ||
    appendixMatches.length >= 2 ||
    (numberedSectionMatches.length >= 3 &&
      (partMatches.length >= 2 || hasPreface)) ||
    (partMatches.length >= 3 && tocSignalMatches.length >= 2)
  );
}

function looksLikeExtractedText(title: string, abstract: string) {
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, " ").trim();
  const normalizedAbstract = abstract.toLowerCase().replace(/\s+/g, " ").trim();
  const trimmedAbstract = abstract.trim();
  const plainTitle = normalizedTitle
    .replace(/<[^>]+>/g, " ")
    .replace(/^[ivxlcdm]+\.\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const plainAbstract = normalizedAbstract
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titleWords = normalizedTitle.split(" ").filter(Boolean);
  const substantialTitlePhrase = titleWords.slice(0, 8).join(" ");
  const citationSignals =
    /\b(volume|issue|pages?|public opinion quarterly|journal|quarterly|;)\b/i.test(
      abstract
    ) || /\b\d+[-–]\d+\b/.test(abstract);
  const singleCitationSignals =
    /^\(?[12]\d{3}\)?\./.test(trimmedAbstract) &&
    /\bVol\.\s*\d+/i.test(abstract) &&
    /\bNo\.\s*\d+/i.test(abstract) &&
    /\bpp\.\s*\d+/i.test(abstract);

  return (
    (normalizedTitle.length > 20 &&
      normalizedAbstract.startsWith(normalizedTitle.slice(0, 60))) ||
    (titleWords.length >= 6 &&
      substantialTitlePhrase.length > 30 &&
      normalizedAbstract.includes(substantialTitlePhrase)) ||
    (titleWords.length >= 3 &&
      normalizedTitle.length > 15 &&
      normalizedAbstract.includes(normalizedTitle) &&
      citationSignals) ||
    (plainTitle.length > 25 &&
      plainAbstract.includes(plainTitle.slice(0, 60)) &&
      singleCitationSignals) ||
    /^(by|edited by|reviewed by)\b/i.test(trimmedAbstract)
  );
}

function looksLikeBibliography(abstract: string) {
  const numberedCitationMatches = abstract.match(/\b\d{1,3}\.\s+[A-Z][^.]+/g) || [];
  const journalCitationMatches =
    abstract.match(/\b[A-Z][A-Za-z&.,' -]+,\s*\d{1,4},\s*\d{1,5}[-–]\d{1,5}\s*\(\d{4}\)/g) || [];
  const authorYearMatches =
    abstract.match(/\b[A-Z][a-z]+,\s+[A-Z](?:\\.\\s*)+(?:\([12]\d{3}\)|[12]\d{3})/g) || [];

  return (
    numberedCitationMatches.length >= 5 ||
    journalCitationMatches.length >= 3 ||
    authorYearMatches.length >= 5
  );
}

function looksLikePublisherChrome(abstract: string) {
  const chromeMatches =
    abstract.match(
      /\b(search for other works by this author|share facebook twitter linkedin|download citation file|download citation|zotero|mendeley|endnote|refworks|bibtex|search advanced search|pdf first page preview|you do not currently have access to this content|permissions|cite icon|share icon|advertisement|return to issue|prev article next|cite this|publication date|publication history|published online|request reuse permissions|article views|altmetric|learn about these metrics|pubs\.acs\.org|get access|google scholar|oxford academic|published:)\b/gi
    ) || [];

  return chromeMatches.length >= 3;
}

function looksLikeBookReview(abstract: string, sourceName: string) {
  if (sourceName.toLowerCase().includes("choice reviews online")) {
    return true;
  }

  const reviewSignals =
    abstract.match(
      /\b(this book|the book|the author|the authors|chapters?|chapter one|edition|volume|pages?|soft cover|hardcover|isbn|bibliographic data|audience|well-written|puzzling book)\b/gi
    ) || [];

  return reviewSignals.length >= 3;
}

function saysAbstractUnavailable(abstract: string) {
  return /\b(abstract is not available|abstract is unavailable|no abstract is available|preview has been provided|preview is provided|content preview)\b/i.test(
    abstract
  );
}

function looksLikeArticleBodyExtraction(abstract: string) {
  return (
    /\bfootnotes continued on next page\b/i.test(abstract) ||
    /<\/?h[1-4]\b[^>]*>/i.test(abstract) ||
    /^<h[1-4]\b[^>]*>\s*Introduction\s*<\/h[1-4]>/i.test(abstract.trim())
  );
}

function isHistoryTopic(paper: Paper) {
  const topicText = [
    paper.topicField,
    paper.topicSubfield,
    paper.topicName
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return topicText.includes("history");
}

function isPsychologyTopic(paper: Paper) {
  const topicText = [
    paper.topicField,
    paper.topicSubfield,
    paper.topicName,
    paper.topicDomain
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return topicText.includes("psychology");
}

function isPreferredTopic(paper: Paper) {
  const topicText = [
    paper.topicField,
    paper.topicSubfield,
    paper.topicName,
    paper.topicDomain
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

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
    "social sciences"
  ].some((term) => topicText.includes(term));
}

function getString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'");
}

type OpenAlexWork = {
  id?: string;
  doi?: string;
  display_name?: string;
  title?: string;
  authorships?: OpenAlexAuthorship[];
  publication_year?: number;
  primary_topic?: OpenAlexTopic | null;
  primary_location?: OpenAlexLocation | null;
  locations?: OpenAlexLocation[];
  abstract_inverted_index?: Record<string, number[]>;
};

type Paper = {
  title: string;
  abstract: string;
  authors: string[];
  publicationYear: number | null;
  sourceName: string;
  topicName: string;
  topicDomain: string;
  topicField: string;
  topicSubfield: string;
  url: string;
};

type OpenAlexAuthorship = {
  author?: {
    display_name?: string;
  };
};

type OpenAlexLocation = {
  landing_page_url?: string;
  pdf_url?: string;
  source?: {
    display_name?: string;
  };
};

type OpenAlexTopic = {
  display_name?: string;
  domain?: {
    display_name?: string;
  };
  field?: {
    display_name?: string;
  };
  subfield?: {
    display_name?: string;
  };
};
