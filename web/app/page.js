"use client";

import InterviewStartForm from "../components/interview-start-form";

export default function HomePage() {
  return (
    <main className="shell">
      <InterviewStartForm compact={false} />
    </main>
  );
}