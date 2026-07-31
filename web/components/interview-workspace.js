"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;

export default function InterviewWorkspace({ sessionId }) {
  const router = useRouter();
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);

  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAnswer, setIsProcessingAnswer] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState("");
  const [transcripts, setTranscripts] = useState({});

  const questions = useMemo(() => sessionData?.session?.questions || [], [sessionData]);
  const currentQuestion = questions[currentIndex];

  useEffect(() => {
    let active = true;

    async function loadSession() {
      try {
        const data = await apiFetch(`/sessions/${sessionId}`, { method: "GET" });
        if (active) {
          setSessionData(data);
          setCurrentIndex(0);
          setTranscripts(data.session?.transcripts || {});
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message || "Failed to load session");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadSession();

    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    let timerId;

    if (isRecording) {
      timerId = window.setInterval(() => {
        setSecondsLeft((value) => {
          if (value <= 1) {
            stopRecording();
            return 120;
          }

          return value - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerId) {
        window.clearInterval(timerId);
      }
    };
  }, [isRecording]);

  useEffect(() => {
    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch {
        setError("Camera or microphone access was denied.");
      }
    }

    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      setupCamera();
    }

    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    async function playQuestionAudio() {
      if (!currentQuestion || !apiBaseUrl) {
        return;
      }

      try {
        setIsSpeaking(true);
        const response = await fetch(`${apiBaseUrl}/sessions/${sessionId}/speak-question`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ questionId: currentQuestion.id }),
        });

        if (!response.ok) {
          throw new Error("Question audio generation failed");
        }

        const arrayBuffer = await response.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);

        if (audioRef.current) {
          audioRef.current.src = url;
          await audioRef.current.play();
        }
      } catch {
        if (typeof window !== "undefined" && window.speechSynthesis && currentQuestion.question) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(currentQuestion.question);
          window.speechSynthesis.speak(utterance);
        }
      } finally {
        setIsSpeaking(false);
      }
    }

    playQuestionAudio();
  }, [currentQuestion, sessionId]);

  function startRecording() {
    if (!streamRef.current) {
      setError("Camera is not ready yet.");
      return;
    }

    chunksRef.current = [];
    let recorder;
    try {
      recorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
    } catch {
      recorder = new MediaRecorder(streamRef.current);
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      const url = URL.createObjectURL(blob);
      setRecordedBlobUrl(url);

      if (currentQuestion?.id) {
        await uploadAndTranscribe(blob, currentQuestion.id);
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setSecondsLeft(120);
    setIsRecording(true);
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    setIsRecording(false);
  }

  async function uploadAndTranscribe(blob, questionId) {
    try {
      setError("");
      setIsProcessingAnswer(true);

      const recordingData = await apiFetch(`/sessions/${sessionId}/recording-url`, {
        method: "POST",
        body: JSON.stringify({
          fileName: `question-${questionId}-${Date.now()}.webm`,
          contentType: "video/webm",
        }),
      });

      const uploadResponse = await fetch(recordingData.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "video/webm",
        },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload interview recording");
      }

      const transcriptionData = await apiFetch(`/sessions/${sessionId}/transcribe`, {
        method: "POST",
        body: JSON.stringify({
          questionId,
          mediaFormat: "webm",
        }),
      });

      setTranscripts((current) => ({
        ...current,
        [questionId]: transcriptionData.transcript,
      }));
    } catch (processingError) {
      setError(processingError.message || "Failed to process your recorded answer");
    } finally {
      setIsProcessingAnswer(false);
    }
  }

  function nextQuestion() {
    if (isProcessingAnswer) {
      return;
    }

    if (currentIndex >= questions.length - 1) {
      stopRecording();
      router.push(`/results/${sessionId}`);
      return;
    }

    setCurrentIndex((value) => value + 1);
    stopRecording();
    setRecordedBlobUrl("");
  }

  async function finishInterview() {
    if (isProcessingAnswer) {
      return;
    }

    stopRecording();
    router.push(`/results/${sessionId}`);
  }

  if (loading) {
    return <div className="muted">Loading interview...</div>;
  }

  return (
    <section className="card grid two-column">
      <div className="stack">
        <div className="eyebrow">Live interview</div>
        <h1 className="title" style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
          Question {currentIndex + 1} of {questions.length || 0}
        </h1>

        {error ? <div className="error">{error}</div> : null}

        <div className="panel stack">
          <strong>AI interviewer</strong>
          <audio ref={audioRef} hidden />
          <div className="avatar-stage">
            <div className="avatar-face">AI</div>
            <div className="avatar-copy">
              <div className="muted">Static avatar + AWS Polly voice</div>
              <div>{currentQuestion?.question || "No questions available yet."}</div>
              <div className="muted">{isSpeaking ? "Speaking question..." : "Question audio ready"}</div>
            </div>
          </div>
        </div>

        <div className="panel stack">
          <strong>Question</strong>
          <p style={{ margin: 0, lineHeight: 1.6 }}>{currentQuestion?.question || "Generate questions first to begin the interview."}</p>
          <div className="muted">Type: {currentQuestion?.type || "unknown"}</div>
          <div className="muted">Time left: {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</div>
          {isProcessingAnswer ? <div className="success">Uploading and transcribing answer...</div> : null}
        </div>

        <div className="actions">
          {!isRecording ? (
            <button className="button primary" type="button" onClick={startRecording} disabled={!currentQuestion || isProcessingAnswer}>
              Start answer recording
            </button>
          ) : (
            <button className="button secondary" type="button" onClick={stopRecording}>
              Stop recording
            </button>
          )}
          <button className="button secondary" type="button" onClick={nextQuestion} disabled={!questions.length || isRecording || isProcessingAnswer}>
            Next question
          </button>
          <button className="button secondary" type="button" onClick={finishInterview} disabled={isRecording || isProcessingAnswer}>
            Finish interview
          </button>
        </div>

        {recordedBlobUrl ? (
          <a className="button secondary" href={recordedBlobUrl} download={`session-${sessionId}.webm`}>
            Download last recording
          </a>
        ) : null}
      </div>

      <div className="stack">
        <div className="panel stack">
          <strong>Camera preview</strong>
          <video ref={videoRef} autoPlay playsInline muted className="camera-preview" />
          <div className="muted">
            Your recording is uploaded per question and transcribed automatically after you stop recording.
          </div>
        </div>

        <div className="panel stack">
          <strong>Session</strong>
          <div className="muted">{sessionData?.session?.name || "Guest interview"}</div>
          <div className="muted">{sessionData?.session?.jobTitle || "Job title unknown"}</div>
          <div className="muted">Status: {sessionData?.session?.status || "Unknown"}</div>
          <div className="muted">Session id: {sessionId}</div>
        </div>

        <div className="panel stack">
          <strong>Question progress</strong>
          <ol className="question-list">
            {questions.map((question, index) => (
              <li key={question.id || index} className={index === currentIndex ? "question-item active" : "question-item"}>
                <div>{question.question}</div>
                <div className="muted">
                  {transcripts[question.id] ? "Transcript captured" : "Pending transcript"}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}