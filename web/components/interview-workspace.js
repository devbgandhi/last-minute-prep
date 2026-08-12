"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "../lib/api";
import { saveFullRecording } from "../lib/recording-store";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;

const INTERVIEWER_NAMES = ["Alex", "Jordan", "Morgan", "Taylor", "Sam", "Casey"];

function interviewerNameForSession(sessionId) {
  if (!sessionId) {
    return INTERVIEWER_NAMES[0];
  }

  let hash = 0;
  for (let i = 0; i < sessionId.length; i += 1) {
    hash = (hash * 31 + sessionId.charCodeAt(i)) >>> 0;
  }

  return INTERVIEWER_NAMES[hash % INTERVIEWER_NAMES.length];
}

export default function InterviewWorkspace({ sessionId }) {
  const router = useRouter();
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const mouthRef = useRef(null);
  const speakingAudioContextRef = useRef(null);
  const speakingAnalyserRef = useRef(null);
  const mouthAnimationFrameRef = useRef(null);
  const pendingTranscriptionsRef = useRef([]);
  const fullRecorderRef = useRef(null);
  const fullChunksRef = useRef([]);

  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAnswer, setIsProcessingAnswer] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(120);
  const [transcripts, setTranscripts] = useState({});
  const [audioAnalyserReady, setAudioAnalyserReady] = useState(false);
  const [pendingTranscriptionCount, setPendingTranscriptionCount] = useState(0);
  const [isWaitingForTranscripts, setIsWaitingForTranscripts] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const questions = useMemo(() => sessionData?.session?.questions || [], [sessionData]);
  const currentQuestion = questions[currentIndex];
  const interviewerName = useMemo(() => interviewerNameForSession(sessionId), [sessionId]);

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
    let cancelled = false;
    let acquiredStream = null;

    async function setupCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });

        // If this effect was already cleaned up (e.g. React re-running the
        // effect in dev mode) before getUserMedia resolved, don't hand a
        // fresh stream to a dead ref — stop it immediately instead of
        // leaving live tracks nothing will ever release properly.
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        acquiredStream = stream;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraReady(true);
      } catch {
        if (!cancelled) {
          setError("Camera or microphone access was denied.");
        }
      }
    }

    if (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia) {
      setupCamera();
    }

    return () => {
      cancelled = true;
      acquiredStream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === acquiredStream) {
        streamRef.current = null;
        setCameraReady(false);
      }
    };
  }, []);

  // Records the whole session (video+audio) purely for an end-of-interview
  // download — separate from the per-question audio-only recorder used for
  // Transcribe below. This one is never sent to Transcribe, so it doesn't
  // hit the "Failed to parse audio file" issue that ruled out combined
  // video+audio for transcription. It's a nice-to-have, so any failure here
  // is swallowed — it must never block the actual interview.
  useEffect(() => {
    if (!cameraReady || !streamRef.current) {
      return undefined;
    }

    let recorder;
    try {
      try {
        recorder = new MediaRecorder(streamRef.current, { mimeType: "video/webm" });
      } catch {
        recorder = new MediaRecorder(streamRef.current);
      }
    } catch {
      return undefined;
    }

    fullChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        fullChunksRef.current.push(event.data);
      }
    };

    try {
      recorder.start(1000);
      fullRecorderRef.current = recorder;
    } catch {
      fullRecorderRef.current = null;
    }

    return () => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    };
  }, [cameraReady]);

  // The <video> element only exists in the DOM once `loading` flips to
  // false, but the camera-setup effect above runs once at mount and may
  // resolve before that — leaving videoRef.current null at the moment the
  // stream was ready, so srcObject never got attached. Re-attach here once
  // the video element actually mounts.
  useEffect(() => {
    if (!loading && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [loading]);

  function ensureSpeakingAnalyser() {
    if (speakingAnalyserRef.current || !audioRef.current) {
      return speakingAnalyserRef.current;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return null;
      }

      const audioContext = new AudioContextClass();
      const source = audioContext.createMediaElementSource(audioRef.current);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      speakingAudioContextRef.current = audioContext;
      speakingAnalyserRef.current = analyser;
      setAudioAnalyserReady(true);
      return analyser;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function playQuestionAudio() {
      if (!currentQuestion || !apiBaseUrl) {
        return;
      }

      setIsSpeaking(true);

      try {
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

        if (cancelled || !audioRef.current) {
          return;
        }

        audioRef.current.onended = () => setIsSpeaking(false);
        audioRef.current.onerror = () => setIsSpeaking(false);
        audioRef.current.src = url;

        const analyser = ensureSpeakingAnalyser();
        if (analyser && speakingAudioContextRef.current?.state === "suspended") {
          await speakingAudioContextRef.current.resume();
        }

        await audioRef.current.play();
      } catch {
        if (cancelled) {
          return;
        }

        if (typeof window !== "undefined" && window.speechSynthesis && currentQuestion.question) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(currentQuestion.question);
          utterance.onend = () => setIsSpeaking(false);
          utterance.onerror = () => setIsSpeaking(false);
          window.speechSynthesis.speak(utterance);
        } else {
          setIsSpeaking(false);
        }
      }
    }

    playQuestionAudio();

    return () => {
      cancelled = true;
    };
  }, [currentQuestion, sessionId]);

  useEffect(() => {
    const analyser = speakingAnalyserRef.current;

    if (!isSpeaking || !analyser) {
      if (mouthAnimationFrameRef.current) {
        cancelAnimationFrame(mouthAnimationFrameRef.current);
        mouthAnimationFrameRef.current = null;
      }
      if (mouthRef.current) {
        mouthRef.current.style.transform = "";
      }
      return undefined;
    }

    const data = new Uint8Array(analyser.frequencyBinCount);

    function tick() {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        sum += Math.abs(data[i] - 128);
      }
      const level = sum / data.length;
      const scale = Math.min(1.4, Math.max(0.25, 0.3 + (level / 30) * 1.3));
      if (mouthRef.current) {
        mouthRef.current.style.transform = `scaleY(${scale})`;
      }
      mouthAnimationFrameRef.current = requestAnimationFrame(tick);
    }

    tick();

    return () => {
      if (mouthAnimationFrameRef.current) {
        cancelAnimationFrame(mouthAnimationFrameRef.current);
        mouthAnimationFrameRef.current = null;
      }
    };
  }, [isSpeaking, audioAnalyserReady]);

  useEffect(() => {
    return () => {
      speakingAudioContextRef.current?.close();
    };
  }, []);

  function buildAudioRecorder() {
    const audioTracks = streamRef.current?.getAudioTracks() || [];
    if (audioTracks.length === 0) {
      return null;
    }

    // Recording the combined video+audio stream (mimeType "video/webm") has
    // now failed Transcribe parsing twice with "Failed to parse audio file"
    // on different recordings, so it isn't reliable. Recording a genuine
    // audio-only stream instead — this doesn't affect the live camera
    // preview, which is driven directly by streamRef via videoRef.srcObject,
    // independent of what this recorder captures.
    const audioOnlyStream = new MediaStream(audioTracks);
    try {
      return new MediaRecorder(audioOnlyStream, { mimeType: "audio/webm;codecs=opus" });
    } catch {
      return new MediaRecorder(audioOnlyStream, { mimeType: "audio/webm" });
    }
  }

  async function startRecording() {
    if (!streamRef.current) {
      setError("Camera is not ready yet.");
      return;
    }

    if (streamRef.current.getAudioTracks().length === 0) {
      setError("No microphone track detected. Check mic permissions and try again.");
      return;
    }

    chunksRef.current = [];

    const recorder = buildAudioRecorder();
    if (!recorder) {
      setError("No microphone track detected. Check mic permissions and try again.");
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });

      if (currentQuestion?.id) {
        await uploadAndTranscribe(blob, currentQuestion.id);
      }
    };

    try {
      recorder.start();
    } catch {
      // MediaRecorder.start() occasionally fails transiently right after a
      // stream/track is created (the mic hasn't "settled" yet on some
      // browsers). Wait briefly and retry once with a fresh recorder before
      // surfacing an error, instead of crashing the whole page.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const retryRecorder = buildAudioRecorder();
      if (!retryRecorder) {
        setError("Could not start recording. Check mic permissions and try again.");
        return;
      }

      retryRecorder.ondataavailable = recorder.ondataavailable;
      retryRecorder.onstop = recorder.onstop;

      try {
        retryRecorder.start();
      } catch {
        setError("Could not start recording — please try again.");
        return;
      }

      recorderRef.current = retryRecorder;
      setSecondsLeft(120);
      setIsRecording(true);
      return;
    }

    recorderRef.current = recorder;
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
          contentType: "audio/webm",
        }),
      });

      const uploadResponse = await fetch(recordingData.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "audio/webm",
        },
        body: blob,
      });

      if (!uploadResponse.ok) {
        throw new Error("Failed to upload interview recording");
      }

      const startData = await apiFetch(`/sessions/${sessionId}/transcribe`, {
        method: "POST",
        body: JSON.stringify({
          questionId,
          mediaFormat: "webm",
        }),
      });

      // Transcribe in the background instead of blocking here — AWS
      // Transcribe's batch API has real fixed startup overhead (often
      // 15-60s+) regardless of clip length, so waiting for it made every
      // question feel slow. The job is already running server-side; move on
      // and let the transcript land whenever it's ready.
      trackBackgroundTranscription(startData.jobName, questionId);
      advanceQuestion();
    } catch (processingError) {
      setError(processingError.message || "Failed to process your recorded answer");
    } finally {
      setIsProcessingAnswer(false);
    }
  }

  function trackBackgroundTranscription(jobName, questionId) {
    setPendingTranscriptionCount((count) => count + 1);

    const promise = pollTranscriptionStatus(jobName, questionId)
      .then((transcript) => {
        setTranscripts((current) => ({
          ...current,
          [questionId]: transcript,
        }));
      })
      .catch((pollError) => {
        setError(pollError.message || "Failed to transcribe an answer");
      })
      .finally(() => {
        setPendingTranscriptionCount((count) => Math.max(0, count - 1));
        pendingTranscriptionsRef.current = pendingTranscriptionsRef.current.filter(
          (tracked) => tracked !== promise
        );
      });

    pendingTranscriptionsRef.current.push(promise);
  }

  async function pollTranscriptionStatus(jobName, questionId) {
    const maxAttempts = 40;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const statusData = await apiFetch(
        `/sessions/${sessionId}/transcribe/${jobName}?questionId=${encodeURIComponent(questionId)}`,
        { method: "GET" }
      );

      if (statusData.status === "COMPLETED") {
        return statusData.transcript;
      }

      if (statusData.status === "FAILED") {
        throw new Error(statusData.error || "Transcription failed");
      }

      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error("Transcription timed out");
  }

  async function stopFullRecording() {
    const recorder = fullRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return;
    }

    try {
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.stop();
      await stopped;

      if (fullChunksRef.current.length > 0) {
        saveFullRecording(sessionId, new Blob(fullChunksRef.current, { type: "video/webm" }));
      }
    } catch {
      // Best-effort only — losing the full-session recording must never
      // block finishing the interview.
    }
  }

  async function goToResults() {
    stopRecording();
    await stopFullRecording();

    if (pendingTranscriptionsRef.current.length > 0) {
      setIsWaitingForTranscripts(true);
      await Promise.allSettled(pendingTranscriptionsRef.current);
      setIsWaitingForTranscripts(false);
    }

    router.push(`/results/${sessionId}`);
  }

  function advanceQuestion() {
    if (currentIndex >= questions.length - 1) {
      goToResults();
      return;
    }

    setCurrentIndex((value) => value + 1);
    stopRecording();
  }

  function nextQuestion() {
    if (isProcessingAnswer) {
      return;
    }

    advanceQuestion();
  }

  async function finishInterview() {
    if (isProcessingAnswer) {
      return;
    }

    await goToResults();
  }

  if (loading) {
    return <div className="muted">Loading interview...</div>;
  }

  return (
    <section className="card grid two-column">
      <div className="stack">
        <div className="eyebrow">Interview workspace</div>
        <h1 className="title" style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)" }}>
          Question {currentIndex + 1} of {questions.length || 0}
        </h1>

        {error ? <div className="error">{error}</div> : null}

        <div className="panel stack">
          <strong>AI interviewer</strong>
          <audio ref={audioRef} hidden />
          <div className="avatar-stage">
            <div className={`avatar-face${isSpeaking ? " speaking" : ""}`}>
              <svg viewBox="0 0 100 100" aria-hidden="true">
                <ellipse className="avatar-eye left" cx="35" cy="40" rx="6" ry="7" fill="white" />
                <ellipse className="avatar-eye right" cx="65" cy="40" rx="6" ry="7" fill="white" />
                <rect
                  ref={mouthRef}
                  className={`avatar-mouth${audioAnalyserReady ? " audio-driven" : ""}`}
                  x="37"
                  y="60"
                  width="26"
                  height="7"
                  rx="3.5"
                  fill="white"
                />
              </svg>
            </div>
            <div className="avatar-copy">
              <strong>{interviewerName}</strong>
              <div className="muted">
                <span className={`avatar-status-dot${isSpeaking || isRecording ? " live" : ""}`} />
                {isSpeaking ? "Speaking..." : isRecording ? "Listening to your answer..." : "Ready for your answer"}
              </div>
              <div>{currentQuestion?.question || "No questions available yet."}</div>
            </div>
          </div>
        </div>

        <div className="panel stack">
          <strong>Question</strong>
          <p style={{ margin: 0, lineHeight: 1.6 }}>{currentQuestion?.question || "Generate questions first to begin the interview."}</p>
          <div className="muted">Type: {currentQuestion?.type || "unknown"}</div>
          <div className="muted">Time left: {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}</div>
          {isProcessingAnswer ? <div className="success">Uploading recording...</div> : null}
          {!isProcessingAnswer && pendingTranscriptionCount > 0 ? (
            <div className="muted">
              Transcribing {pendingTranscriptionCount} answer{pendingTranscriptionCount > 1 ? "s" : ""} in the background — you can keep going.
            </div>
          ) : null}
          {isWaitingForTranscripts ? <div className="success">Finishing up remaining transcripts...</div> : null}
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
          <button
            className="button secondary"
            type="button"
            onClick={finishInterview}
            disabled={isRecording || isProcessingAnswer || isWaitingForTranscripts}
          >
            {isWaitingForTranscripts ? "Finishing transcripts..." : "Finish interview"}
          </button>
        </div>
      </div>

      <div className="stack">
        <div className="panel stack">
          <strong>Camera preview</strong>
          <video ref={videoRef} autoPlay playsInline muted className="camera-preview" />
          <div className="muted">
            Your camera is shown live for your reference only. Your microphone audio is recorded and transcribed per question.
          </div>
        </div>

        <div className="panel stack">
          <strong>Session</strong>
          <div className="muted">{sessionData?.session?.name || "Interview session"}</div>
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