"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

export default function InterviewStartForm({ compact = false }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [company, setCompany] = useState("");
  const [file, setFile] = useState(null);
  const [jobDescription, setJobDescription] = useState("");
  const [numQuestions, setNumQuestions] = useState(8);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

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

    setIsSubmitting(true);

    try {
      const clientSessionId = crypto.randomUUID();

      const uploadData = await apiFetch("/sessions/start", {
        method: "POST",
        body: JSON.stringify({
          sessionId: clientSessionId,
          name,
          jobTitle,
          jobDescription,
          company,
          numQuestions,
          additionalNotes,
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
        body: JSON.stringify({ jobDescription, company, numQuestions, additionalNotes }),
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
          Resume-based interview practice for real roles.
        </h1>
        <p className="lede">
          Upload your resume, add the role title, and start a structured interview. The job description is optional.
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
          <label className="label" htmlFor="company">
            Company <span className="muted">(optional)</span>
          </label>
          <input
            id="company"
            className="input"
            type="text"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            placeholder="Company Name"
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
            Job description <span className="muted">(optional)</span>
          </label>
          <textarea
            id="jobDescription"
            className="textarea"
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="Paste the role description here, or leave it blank"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="numQuestions">
            Number of questions: {numQuestions}
          </label>
          <input
            id="numQuestions"
            type="range"
            min="3"
            max="15"
            step="1"
            value={numQuestions}
            onChange={(event) => setNumQuestions(Number(event.target.value))}
            style={{ "--fill": `${((numQuestions - 3) / (15 - 3)) * 100}%` }}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="additionalNotes">
            Anything else the interviewer should know? <span className="muted">(optional)</span>
          </label>
          <textarea
            id="additionalNotes"
            className="textarea"
            value={additionalNotes}
            onChange={(event) => setAdditionalNotes(event.target.value)}
            placeholder="e.g. focus more on leadership questions, go easy on system design, this is a career switch, etc."
          />
        </div>

        <button className="button primary" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Starting interview..." : "Start interview"}
        </button>
      </form>

      {!compact ? (
        <aside className="panel stack">
          <div className="eyebrow">How it works</div>
          <div className="muted">
            Upload your resume and tell us about the role — we'll get your practice interview ready in seconds.
          </div>
          <div className="panel stack">
            <strong>What happens next</strong>
            <span className="muted">1. Upload your resume</span>
            <span className="muted">2. We prepare questions based on your background and the role</span>
            <span className="muted">3. Answer out loud, just like a real interview</span>
            <span className="muted">4. Get instant feedback on how you did</span>
          </div>
        </aside>
      ) : null}
    </section>
  );
}