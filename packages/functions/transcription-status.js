import { randomUUID } from "node:crypto";
import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { TranscribeClient, GetTranscriptionJobCommand } from "@aws-sdk/client-transcribe";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const transcribe = new TranscribeClient({});

// Single, fast status check (no polling loop) so this always stays well under
// API Gateway's 30s integration timeout. The frontend calls this repeatedly.
export const handler = async (event) => {
  try {
    const { sessionId, jobName } = event.pathParameters;
    const questionId = event.queryStringParameters?.questionId || null;

    const jobResult = await transcribe.send(new GetTranscriptionJobCommand({
      TranscriptionJobName: jobName,
    }));

    const transcriptionJob = jobResult.TranscriptionJob;

    if (transcriptionJob.TranscriptionJobStatus === "FAILED") {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          status: "FAILED",
          error: transcriptionJob.FailureReason || "Transcription job failed",
        }),
      };
    }

    if (transcriptionJob.TranscriptionJobStatus !== "COMPLETED") {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
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
        questionId,
        transcriptionJobName: jobName,
        transcript: transcriptText,
        createdAt: new Date().toISOString(),
      },
    }));

    // Multiple questions can be transcribing concurrently (transcription now
    // runs in the background while the candidate keeps answering), so this
    // must not read-modify-write the whole transcripts map — two completions
    // landing close together would race and silently drop one. Sessions
    // always start with transcripts: {} (see sessions-start.js), so this
    // atomic nested-path update is safe and race-free.
    const updateExpressionParts = ["transcript = :transcript", "latestTranscript = :transcript", "#s = :s"];
    const expressionAttributeNames = { "#s": "status" };

    if (questionId) {
      updateExpressionParts.push("transcripts.#questionId = :transcript");
      expressionAttributeNames["#questionId"] = questionId;
    }

    await dynamo.send(new UpdateCommand({
      TableName: Resource.Sessions.name,
      Key: { sessionId },
      UpdateExpression: `SET ${updateExpressionParts.join(", ")}`,
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
        status: "COMPLETED",
        responseId,
        transcript: transcriptText,
        questionId,
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to check transcription status" }),
    };
  }
};
