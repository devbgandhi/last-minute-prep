import { randomUUID } from "node:crypto";
import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { TranscribeClient, StartTranscriptionJobCommand, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const transcribe = new TranscribeClient({ region: "us-east-1" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const encodeS3Key = (key) => key.split("/").map(encodeURIComponent).join("/");

export const handler = async (event) => {
  try {
    const { sessionId } = event.pathParameters;
    const body = JSON.parse(event.body || "{}");
    const { questionId, mediaFormat = "webm" } = body;

    const sessionResult = await dynamo.send(new GetCommand({
      TableName: Resource.Sessions.name,
      Key: { sessionId },
    }));

    if (!sessionResult.Item) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Session not found" }),
      };
    }

    const { recordingKey } = sessionResult.Item;

    if (!recordingKey) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "No recording found for this session" }),
      };
    }

    const jobName = `session-${sessionId}-${randomUUID()}`;
    const bucketName = Resource.Recordings.name;
    const region = process.env.AWS_REGION || "us-east-1";
    const mediaFileUri = `https://${bucketName}.s3.${region}.amazonaws.com/${encodeS3Key(recordingKey)}`;

    await transcribe.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: "en-US",
      MediaFormat: mediaFormat,
      Media: {
        MediaFileUri: mediaFileUri,
      },
    }));

    let transcriptionJob;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const jobResult = await transcribe.send(new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      }));

      transcriptionJob = jobResult.TranscriptionJob;

      if (transcriptionJob.TranscriptionJobStatus === "COMPLETED") {
        break;
      }

      if (transcriptionJob.TranscriptionJobStatus === "FAILED") {
        throw new Error(transcriptionJob.FailureReason || "Transcription job failed");
      }

      await sleep(5000);
    }

    if (!transcriptionJob || transcriptionJob.TranscriptionJobStatus !== "COMPLETED") {
      return {
        statusCode: 504,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Transcription timed out" }),
      };
    }

    const transcriptUri = transcriptionJob.Transcript.TranscriptFileUri;
    const transcriptResponse = await fetch(transcriptUri);
    if (!transcriptResponse.ok) {
      throw new Error(`Failed to fetch transcript file: ${transcriptResponse.status}`);
    }

    const transcriptData = await transcriptResponse.json();
    const transcriptText = transcriptData.results?.transcripts?.[0]?.transcript || "";

    const responseId = randomUUID();

    await dynamo.send(new PutCommand({
      TableName: Resource.Responses.name,
      Item: {
        responseId,
        sessionId,
        questionId: questionId || null,
        recordingKey,
        transcriptionJobName: jobName,
        transcript: transcriptText,
        createdAt: new Date().toISOString(),
      },
    }));

    const expressionAttributeNames = questionId
      ? { "#questionId": questionId, "#s": "status" }
      : { "#s": "status" };

    await dynamo.send(new UpdateCommand({
      TableName: Resource.Sessions.name,
      Key: { sessionId },
      UpdateExpression: questionId
        ? "SET transcript = :transcript, transcripts.#questionId = :transcript, #s = :s, latestTranscript = :transcript"
        : "SET transcript = :transcript, #s = :s",
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: {
        ":transcript": transcriptText,
        ":s": "TRANSCRIBED",
      },
    }));

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        responseId,
        transcript: transcriptText,
        questionId: questionId || null,
        transcriptionJobName: jobName,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to transcribe recording" }),
    };
  }
};