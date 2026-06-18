import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const OPENALEX_URL = "https://api.openalex.org/works";
const RESULTS_PER_PAGE = 20;
const MAX_RANDOM_PAGE = 500;
const HUMANITIES_QUERY_CHANCE = 0.25;
const GENERAL_WORK_FILTER = "language:en,has_abstract:true";
const HUMANITIES_WORK_FILTER =
  "language:en,has_abstract:true,primary_topic.field.id:12";

export async function GET() {
  try {
    const data = await fetchOpenAlexWorks();
    const candidates = Array.isArray(data.results)
      ? data.results
          .map(normalizeWork)
          .filter(isPaper)
          .filter((paper) => !containsExcludedMethodTerm(paper.abstract))
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
  return Math.random() < HUMANITIES_QUERY_CHANCE
    ? HUMANITIES_WORK_FILTER
    : GENERAL_WORK_FILTER;
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

function containsExcludedMethodTerm(abstract: string) {
  return /\b(p[- ]?value|confidence interval|hazard ratio|odds ratio|logistic regression|cox regression|kaplan[- ]meier|randomized controlled trial|systematic review|meta-analysis)\b/i.test(
    abstract
  );
}

function isHistoryTopic(paper: Paper) {
  const topicText = [
    paper.topicField,
    paper.topicSubfield,
    paper.topicName,
    paper.topicDomain
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
