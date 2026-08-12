"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch } from "../../../lib/api";
import { getFullRecording } from "../../../lib/recording-store";

export default function ResultsPage({ params }) {
  const { sessionId } = params;
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState("");

  // Create and revoke the object URL within the same effect run. Next.js
  // dev mode double-invokes effects (React Strict Mode: mount, cleanup,
  // mount again) — splitting creation (e.g. via useMemo, computed once)
  // from revocation (a separate cleanup effect) revokes the URL on the
  // phantom cleanup pass without ever recreating it, leaving the download
  // link pointing at a dead blob URL.
  useEffect(() => {
    const blob = getFullRecording(sessionId);
    if (!blob) {
      setRecordingUrl("");
      return undefined;
    }

    const url = URL.createObjectURL(blob);
    setRecordingUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [sessionId]);

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

  const session = sessionData?.session;
  const feedback = session?.feedback;
  const questions = session?.questions || [];
  const transcripts = session?.transcripts || {};

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
          <Link className="button secondary" href="/">
            Back to home
          </Link>
          {recordingUrl ? (
            <a className="button secondary" href={recordingUrl} download={`interview-${sessionId}.webm`}>
              Download full interview recording
            </a>
          ) : null}
        </div>
        {recordingUrl ? (
          <div className="muted">
            The recording is only available in this browser tab right after finishing — it isn't saved anywhere, so refreshing this page will lose it.
          </div>
        ) : null}

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
          {(feedback?.questionFeedback || []).length === 0 ? (
            <div className="muted">No question feedback yet.</div>
          ) : (
            (feedback?.questionFeedback || []).map((item, index) => {
              const questionId = questions[index]?.id;
              const answer = questionId ? transcripts[questionId] : undefined;

              return (
                <div key={`${item.question}-${index}`} className="panel stack">
                  <strong>
                    Q{index + 1}: {item.question}
                  </strong>
                  <div>Score: {item.score ?? "N/A"} / 10</div>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>
                    <em>You said:</em> {answer || "No answer recorded."}
                  </p>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>{item.feedback}</p>
                  {item.betterAnswer ? (
                    <p style={{ margin: 0, lineHeight: 1.6 }}>
                      <em>Stronger answer:</em> {item.betterAnswer}
                    </p>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}