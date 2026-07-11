import { Resource } from "sst";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import pdf from "pdf-parse";

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });

export const handler = async (event) => {
  try {
    const { sessionId } = event.pathParameters;
    const { jobDescription } = JSON.parse(event.body);

    if (!jobDescription) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "jobDescription is required" }),
      };
    }

    // get session from DynamoDB to find the resume key
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

    const { resumeKey } = sessionResult.Item;

    // fetch resume PDF from S3
    const s3Response = await s3.send(new GetObjectCommand({
      Bucket: Resource.Resumes.name,
      Key: resumeKey,
    }));

    // convert PDF to text
    const pdfBuffer = Buffer.from(
      await s3Response.Body.transformToByteArray()
    );
    const pdfData = await pdf(pdfBuffer);
    const resumeText = pdfData.text;

    // call Claude Haiku via Bedrock
    const prompt = `You are an expert technical interviewer. Based on this resume and job description, generate 8 interview questions.

RESUME:
${resumeText}

JOB DESCRIPTION:
${jobDescription}

Generate a mix of:
- 3 behavioral questions (based on their past experience)
- 3 technical questions (based on the role requirements)
- 2 situational questions (hypothetical scenarios)

Return ONLY a JSON array, no explanation, no markdown. Example format:
[
  { "id": "1", "question": "...", "type": "behavioral" },
  { "id": "2", "question": "...", "type": "technical" }
]`;

    const bedrockResponse = await bedrock.send(new InvokeModelCommand({
      modelId: "anthropic.claude-haiku-4-5-20251001-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        messages: [
          { role: "user", content: prompt }
        ],
      }),
    }));

    // parse Bedrock response
    const responseBody = JSON.parse(Buffer.from(bedrockResponse.body).toString());
    const responseText = responseBody.content[0].text;
    const questions = JSON.parse(responseText);

    // save questions to session in DynamoDB
    await dynamo.send(new UpdateCommand({
      TableName: Resource.Sessions.name,
      Key: { sessionId },
      UpdateExpression: "SET questions = :q, jobDescription = :jd, #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":q": questions,
        ":jd": jobDescription,
        ":s": "QUESTIONS_READY",
      },
    }));

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ questions }),
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to generate questions" }),
    };
  }
};