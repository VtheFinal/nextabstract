"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

const RECENT_ABSTRACT_KEYS_STORAGE_KEY = "next-abstract-recent-keys";
const RECENT_TOPICS_STORAGE_KEY = "next-abstract-recent-topics";
const MAX_RECENT_ABSTRACT_KEYS = 50;
const RECENT_TOPIC_LIMIT = 20;

type Paper = {
  title: string;
  abstract: string;
  authors: string[];
  publicationYear: number | null;
  sourceName: string;
  topicName?: string;
  topicDomain?: string;
  topicField?: string;
  topicSubfield?: string;
  url: string;
};

type RecentTopic = {
  topicField: string;
  topicSubfield: string;
};

export default function Home() {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const loadAbstract = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const recentKeys = getRecentAbstractKeys();
      const recentTopics = getRecentTopics();
      const params = new URLSearchParams();

      if (recentKeys.length > 0) {
        params.set("recent", JSON.stringify(recentKeys));
      }

      if (recentTopics.length > 0) {
        params.set("recentTopics", JSON.stringify(recentTopics));
      }

      const response = await fetch(
        `/api/abstract${params.size > 0 ? `?${params.toString()}` : ""}`,
        { cache: "no-store" }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to load an abstract.");
      }

      if (!isPaper(data)) {
        throw new Error("The API returned an unexpected response.");
      }

      setPaper(data);
      rememberAbstractKey(getPaperKey(data));
      rememberRecentTopic(data);
      setCopied(false);
      window.scrollTo({ top: 0 });
    } catch (caughtError) {
      setPaper(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to load an abstract."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAbstract();
  }, [loadAbstract]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isInteractiveElement =
        target instanceof HTMLElement &&
        ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
      const isNextShortcut =
        event.key.toLowerCase() === "n" || event.key === " ";

      if (loading || isInteractiveElement || !isNextShortcut) {
        return;
      }

      if (event.key === " ") {
        event.preventDefault();
      }

      void loadAbstract();
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [loadAbstract, loading]);

  return (
    <main className={styles.page}>
      <section className={styles.reader} aria-live="polite">
        {loading && !paper ? (
          <p className={styles.status}>Loading abstract...</p>
        ) : null}

        {!loading && error ? (
          <div className={styles.notice}>
            <p>{error}</p>
          </div>
        ) : null}

        {paper ? (
          <article className={styles.paper}>
            <header className={styles.siteHeader}>
              <p className={styles.siteTitle}>NEXT ABSTRACT</p>
              <p className={styles.tagline}>
                Randomly selected from millions of scholarly abstracts.
              </p>
            </header>
            <p className={styles.meta}>
              {paper.publicationYear ?? "Year unknown"}
              {paper.sourceName ? ` / ${paper.sourceName}` : ""}
            </p>
            <h1>
              <a
                className={styles.titleLink}
                href={paper.url}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.currentTarget.blur()}
              >
                {paper.title}
              </a>
            </h1>
            <p className={styles.authors}>{formatAuthors(paper.authors)}</p>
            <button
              className={styles.nextButton}
              type="button"
              onClick={loadAbstract}
              disabled={loading}
            >
              {loading ? "Loading..." : "Next Abstract"}
            </button>
            <p className={styles.abstract}>{paper.abstract}</p>
            <a
              className={styles.sourceLink}
              href={paper.url}
              target="_blank"
              rel="noreferrer"
            >
              {formatCitation(paper)}
            </a>
            <button
              className={styles.copyButton}
              type="button"
              onClick={() => copyCitation(paper, setCopied)}
            >
              {copied ? "Copied" : "Copy citation"}
            </button>
          </article>
        ) : null}
      </section>
    </main>
  );
}

function formatAuthors(authors: string[]) {
  if (authors.length <= 3) {
    return authors.join(", ");
  }

  return `${authors.slice(0, 3).join(", ")} et al.`;
}

function formatCitation(paper: Paper) {
  if (paper.sourceName && paper.publicationYear) {
    return `${paper.sourceName} · ${paper.publicationYear}`;
  }

  return paper.sourceName || "Open source";
}

function getPaperKey(paper: Paper) {
  if (paper.url.trim()) {
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

function getRecentAbstractKeys() {
  try {
    const storedKeys = window.sessionStorage.getItem(
      RECENT_ABSTRACT_KEYS_STORAGE_KEY
    );
    const parsedKeys = storedKeys ? JSON.parse(storedKeys) : [];

    return Array.isArray(parsedKeys)
      ? parsedKeys.filter((key): key is string => typeof key === "string")
      : [];
  } catch {
    return [];
  }
}

function rememberAbstractKey(key: string) {
  try {
    const recentKeys = getRecentAbstractKeys();
    const updatedKeys = [
      key,
      ...recentKeys.filter((recentKey) => recentKey !== key)
    ].slice(0, MAX_RECENT_ABSTRACT_KEYS);

    window.sessionStorage.setItem(
      RECENT_ABSTRACT_KEYS_STORAGE_KEY,
      JSON.stringify(updatedKeys)
    );
  } catch {
    // Ignore storage failures so abstract loading keeps working.
  }
}

function getRecentTopics() {
  try {
    const storedTopics = window.sessionStorage.getItem(
      RECENT_TOPICS_STORAGE_KEY
    );
    const parsedTopics = storedTopics ? JSON.parse(storedTopics) : [];

    return Array.isArray(parsedTopics)
      ? parsedTopics
          .map(normalizeRecentTopic)
          .filter((topic): topic is RecentTopic => Boolean(topic))
          .slice(0, RECENT_TOPIC_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function rememberRecentTopic(paper: Paper) {
  try {
    const recentTopics = getRecentTopics();
    const updatedTopics = [
      {
        topicField: paper.topicField || "",
        topicSubfield: paper.topicSubfield || ""
      },
      ...recentTopics
    ].slice(0, RECENT_TOPIC_LIMIT);

    window.sessionStorage.setItem(
      RECENT_TOPICS_STORAGE_KEY,
      JSON.stringify(updatedTopics)
    );
  } catch {
    // Ignore storage failures so abstract loading keeps working.
  }
}

function normalizeRecentTopic(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const topic = value as Partial<RecentTopic>;

  return {
    topicField: typeof topic.topicField === "string" ? topic.topicField : "",
    topicSubfield:
      typeof topic.topicSubfield === "string" ? topic.topicSubfield : ""
  };
}

async function copyCitation(
  paper: Paper,
  setCopied: (copied: boolean) => void
) {
  const citationParts = [
    paper.title,
    formatAuthors(paper.authors),
    paper.sourceName,
    paper.publicationYear,
    paper.url
  ].filter(Boolean);

  await navigator.clipboard.writeText(citationParts.join(". "));
  setCopied(true);

  window.setTimeout(() => {
    setCopied(false);
  }, 1800);
}

function isPaper(value: unknown): value is Paper {
  if (!value || typeof value !== "object") {
    return false;
  }

  const paper = value as Partial<Paper>;

  return (
    typeof paper.title === "string" &&
    typeof paper.abstract === "string" &&
    Array.isArray(paper.authors) &&
    paper.authors.every((author) => typeof author === "string") &&
    (typeof paper.publicationYear === "number" ||
      paper.publicationYear === null) &&
    typeof paper.sourceName === "string" &&
    (typeof paper.topicName === "string" ||
      typeof paper.topicName === "undefined") &&
    (typeof paper.topicDomain === "string" ||
      typeof paper.topicDomain === "undefined") &&
    (typeof paper.topicField === "string" ||
      typeof paper.topicField === "undefined") &&
    (typeof paper.topicSubfield === "string" ||
      typeof paper.topicSubfield === "undefined") &&
    typeof paper.url === "string"
  );
}
