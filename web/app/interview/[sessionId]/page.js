import InterviewWorkspace from "../../../components/interview-workspace";

export default function InterviewSessionPage({ params }) {
  return (
    <main className="shell">
      <InterviewWorkspace sessionId={params.sessionId} />
    </main>
  );
}