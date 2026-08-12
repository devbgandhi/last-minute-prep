import { Resource } from "sst";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  try {
    const { sessionId: requestedSessionId, name, jobTitle, jobDescription, company, numQuestions, additionalNotes, fileName, fileType } = JSON.parse(event.body || "{}");

    if (!name || !jobTitle || !fileName) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "name, jobTitle and fileName are required" }),
      };
    }

    const sessionId = requestedSessionId || randomUUID();
    const resumeKey = `resumes/${sessionId}/${fileName}`;
    const parsedNumQuestions = Number.parseInt(numQuestions, 10);
    const clampedNumQuestions = Number.isFinite(parsedNumQuestions)
      ? Math.min(15, Math.max(3, parsedNumQuestions))
      : 8;

    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: Resource.Resumes.name,
        Key: resumeKey,
        ContentType: fileType || "application/pdf",
      }),
      { expiresIn: 300 }
    );

    await dynamo.send(new PutCommand({
      TableName: Resource.Sessions.name,
      Item: {
        sessionId,
        name,
        jobTitle,
        jobDescription: jobDescription || "",
        company: company || "",
        numQuestions: clampedNumQuestions,
        additionalNotes: additionalNotes || "",
        resumeKey,
        status: "STARTED",
        transcripts: {},
        createdAt: new Date().toISOString(),
      },
    }));

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ uploadUrl, sessionId, resumeKey }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        error: "Failed to start session",
        detail: err?.message || String(err),
      }),
    };
  }
};