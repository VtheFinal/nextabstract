"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./page.module.css";

type Paper = {
  title: string;
  abstract: string;
  authors: string[];
  publicationYear: number | null;
  sourceName: string;
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

  return (
    <main className={styles.page}>
      <section className={styles.reader} aria-live="polite">
        {loading ? (
          <p className={styles.status}>Loading abstract...</p>
        ) : null}

        {!loading && error ? (
          <div className={styles.notice}>
            <p>{error}</p>
          </div>
        ) : null}

        {!loading && paper ? (
          <article className={styles.paper}>
            <p className={styles.meta}>
              {paper.publicationYear ?? "Year unknown"}
              {paper.sourceName ? ` / ${paper.sourceName}` : ""}
            </p>
            <h1>{paper.title}</h1>
            <p className={styles.authors}>{paper.authors.join(", ")}</p>
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
              {paper.sourceName || "Open source"}
            </a>
          </article>
        ) : null}
      </section>
    </main>
  );
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
    typeof paper.url === "string"
  );
}
