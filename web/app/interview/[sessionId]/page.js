"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/api";

export default function InterviewSessionPage({ params }) {
  const { sessionId } = params;
  const [sessionData, setSessionData] = useState(null);
  const [error, setError] = useState("");

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
          setError(loadError.message || "Failed to load session");
        }
      }
    }

    loadSession();

    return () => {
      active = false;
    };
  }, [sessionId]);

  return (
    <main className="shell">
      <section className="card grid">
        <div className="eyebrow">Interview session</div>
        <h1 className="title" style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
          Session {sessionId}
        </h1>

        {error ? <div className="error">{error}</div> : null}

        {sessionData ? (
          <div className="grid two-column">
            <div className="panel stack">
              <strong>Status</strong>
              <div className="muted">{sessionData.session?.status || "Unknown"}</div>
              <strong>Questions</strong>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(sessionData.session?.questions || [], null, 2)}</pre>
            </div>

            <div className="panel stack">
              <strong>Responses</strong>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(sessionData.responses || [], null, 2)}</pre>
            </div>
          </div>
        ) : (
          <div className="muted">Loading session...</div>
        )}
      </section>
    </main>
  );
}