import { randomUUID } from "node:crypto";
import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { TranscribeClient, StartTranscriptionJobCommand } from "@aws-sdk/client-transcribe";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const transcribe = new TranscribeClient({});

const encodeS3Key = (key) => key.split("/").map(encodeURIComponent).join("/");

// Starts the Transcribe job and returns immediately. AWS Transcribe jobs commonly
// take longer than API Gateway's 30s hard integration timeout, so status is polled
// separately via GET /sessions/{sessionId}/transcribe/{jobName}.
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
    const region = process.env.AWS_REGION;
    const mediaFileUri = `https://${bucketName}.s3.${region}.amazonaws.com/${encodeS3Key(recordingKey)}`;

    await transcribe.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: "en-US",
      MediaFormat: mediaFormat,
      Media: {
        MediaFileUri: mediaFileUri,
      },
    }));

    await dynamo.send(new UpdateCommand({
      TableName: Resource.Sessions.name,
      Key: { sessionId },
      UpdateExpression: "SET #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: { ":s": "TRANSCRIBING" },
    }));

    return {
      statusCode: 202,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        jobName,
        questionId: questionId || null,
        status: "IN_PROGRESS",
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to start transcription" }),
    };
  }
};