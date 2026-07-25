"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { getGuestUserId } from "../lib/guest-user";

export default function InterviewStartForm({ compact = false }) {
  const router = useRouter();
  const [guestUserId, setGuestUserId] = useState(null);
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [file, setFile] = useState(null);
  const [jobDescription, setJobDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setGuestUserId(getGuestUserId());
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");

    if (!name.trim() || !jobTitle.trim()) {
      setError("Add your name and job title.");
      return;
    }

    if (!file) {
      setError("Choose a PDF resume first.");
      return;
    }

    if (!jobDescription.trim()) {
      setError("Add a job description.");
      return;
    }

    if (!guestUserId) {
      setError("Guest identity is still initializing. Try again in a moment.");
      return;
    }

    setIsSubmitting(true);

    try {
      const uploadData = await apiFetch("/sessions/start", {
        method: "POST",
        body: JSON.stringify({
          name,
          jobTitle,
          jobDescription,
          fileName: file.name,
          fileType: file.type || "application/pdf",
        }),
      });

      const uploadResponse = await fetch(uploadData.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/pdf",
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Resume upload failed");
      }

      await apiFetch(`/sessions/${uploadData.sessionId}/questions`, {
        method: "POST",
        body: JSON.stringify({ jobDescription }),
      });

      router.push(`/interview/${uploadData.sessionId}`);
    } catch (submitError) {
      setError(submitError.message || "Something went wrong");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className={`card ${compact ? "grid" : "grid two-column"}`}>
      <form className="form" onSubmit={handleSubmit}>
        <div className="eyebrow">Guest interview</div>
        <h1 className="title" style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
          Start your interview without signing in.
        </h1>
        <p className="lede">
          Share your name, role, job description, and resume. We’ll create a guest session and send you into the interview flow.
        </p>

        {error ? <div className="error">{error}</div> : null}

        <div className="field">
          <label className="label" htmlFor="name">
            Your name
          </label>
          <input
            id="name"
            className="input"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Jane Doe"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="jobTitle">
            Job title
          </label>
          <input
            id="jobTitle"
            className="input"
            type="text"
            value={jobTitle}
            onChange={(event) => setJobTitle(event.target.value)}
            placeholder="Frontend Engineer"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="resume">
            Resume PDF
          </label>
          <input
            id="resume"
            className="input"
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="jobDescription">
            Job description
          </label>
          <textarea
            id="jobDescription"
            className="textarea"
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="Paste the role description here"
          />
        </div>

        <button className="button primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Starting interview..." : "Create interview"}
        </button>
      </form>

      {!compact ? (
        <aside className="panel stack">
          <div className="eyebrow">Guest mode</div>
          <div className="muted">
            No account is needed right now. Your browser stores a guest id so your sessions can still be grouped.
          </div>
          {guestUserId ? <div className="success">Guest id ready: {guestUserId}</div> : <div className="muted">Preparing guest id...</div>}
          <div className="panel stack">
            <strong>Flow</strong>
            <span className="muted">1. Request signed upload URL</span>
            <span className="muted">2. Upload PDF to S3</span>
            <span className="muted">3. Generate questions</span>
            <span className="muted">4. Open interview page</span>
          </div>
        </aside>
      ) : null}
    </section>
  );
}