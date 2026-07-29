"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../../lib/api";

export default function ResultsPage({ params }) {
  const { sessionId } = params;
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadSession() {
      try {
        const data = await apiFetch(`/sessions/${sessionId}`, { method: "GET" });
        if (active) {
          setSessionData(data);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load results");
        }
      }
    }

    loadSession();

    return () => {
      active = false;
    };
  }, [sessionId]);

  async function generateReport() {
    setIsGenerating(true);
    setError("");

    try {
      const data = await apiFetch(`/sessions/${sessionId}/feedback`, {
        method: "POST",
      });

      setSessionData((current) => ({
        ...(current || { session: {} }),
        session: {
          ...((current && current.session) || {}),
          feedback: data.feedback,
        },
      }));
    } catch (reportError) {
      setError(reportError.message || "Failed to generate report");
    } finally {
      setIsGenerating(false);
    }
  }

  const feedback = sessionData?.session?.feedback;

  return (
    <main className="shell">
      <section className="card grid">
        <div className="eyebrow">Results</div>
        <h1 className="title" style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
          Interview report
        </h1>

        {error ? <div className="error">{error}</div> : null}

        <div className="actions">
          <button className="button primary" type="button" onClick={generateReport} disabled={isGenerating}>
            {isGenerating ? "Generating report..." : "Generate report"}
          </button>
          <Link className="button secondary" href={`/interview/${sessionId}`}>
            Back to interview
          </Link>
        </div>

        {feedback ? (
          <div className="grid two-column">
            <div className="panel stack">
              <strong>Overall score</strong>
              <div className="score-pill">{feedback.overallScore || "N/A"}</div>
              <strong>Summary</strong>
              <p style={{ margin: 0, lineHeight: 1.6 }}>{feedback.overallSummary || "No summary yet."}</p>
            </div>

            <div className="panel stack">
              <strong>Strengths</strong>
              <ul>
                {(feedback.strengths || []).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              <strong>Improvement areas</strong>
              <ul>
                {(feedback.improvements || []).map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="panel stack">
            <strong>Report not generated yet</strong>
            <div className="muted">
              Finish the interview and generate the report when transcripts are ready.
            </div>
          </div>
        )}

        <div className="panel stack">
          <strong>Question feedback</strong>
          <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(feedback?.questionFeedback || [], null, 2)}</pre>
        </div>
      </section>
    </main>
  );
}