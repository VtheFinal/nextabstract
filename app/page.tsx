"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

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

export default function Home() {
  const [paper, setPaper] = useState<Paper | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAbstract = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/abstract", { cache: "no-store" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Unable to load an abstract.");
      }

      if (!isPaper(data)) {
        throw new Error("The API returned an unexpected response.");
      }

      setPaper(data);
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
