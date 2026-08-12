import { Resource } from "sst";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import pdf from "pdf-parse";

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : text;
}

function clampQuestionCount(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return 8;
  }
  return Math.min(15, Math.max(3, parsed));
}

function buildFallbackQuestions(jobTitle, jobDescription, company, questionCount) {
  const roleLabel = jobTitle || "this role";
  const companySuffix = company ? ` at ${company}` : "";

  const introPool = [
    { question: "Tell me a little about yourself and your background.", type: "intro" },
    { question: `Why are you interested in ${roleLabel}${companySuffix}?`, type: "intro" },
  ];

  const corePool = [
    { question: "Describe a project you are most proud of and your specific contribution.", type: "behavioral" },
    { question: "Tell me about a time you faced a difficult deadline and how you handled it.", type: "behavioral" },
    { question: "What core skills are most important for this role, and how have you used them?", type: "technical" },
    { question: "Walk me through how you would approach a problem you've never seen before with limited information.", type: "technical" },
    { question: "If priorities changed suddenly, how would you re-plan your work and communicate tradeoffs?", type: "situational" },
    { question: "If you disagreed with a decision from your team, how would you approach it?", type: "situational" },
    { question: "Tell me about a time you had to learn something new quickly to get a task done.", type: "behavioral" },
    { question: "How do you prioritize when everything feels urgent?", type: "situational" },
    { question: "What's a process or technical improvement you've made, and what was the impact?", type: "technical" },
  ];

  const introCount = questionCount >= 4 ? Math.min(2, introPool.length) : Math.min(1, questionCount);
  const coreCount = Math.max(0, questionCount - introCount);

  const selected = [
    ...introPool.slice(0, introCount),
    ...Array.from({ length: coreCount }, (_, index) => corePool[index % corePool.length]),
  ];

  return selected.slice(0, questionCount).map((item, index) => ({ id: String(index + 1), ...item }));
}

export const handler = async (event) => {
  try {
    const { sessionId } = event.pathParameters;
    const {
      jobDescription = "",
      company: bodyCompany = "",
      numQuestions: bodyNumQuestions,
      additionalNotes: bodyAdditionalNotes = "",
    } = JSON.parse(event.body || "{}");

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

    const {
      resumeKey,
      jobTitle = "",
      jobDescription: sessionJobDescription = "",
      company: sessionCompany = "",
      numQuestions: sessionNumQuestions,
      additionalNotes: sessionAdditionalNotes = "",
    } = sessionResult.Item;

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

    const effectiveJobDescription = jobDescription || sessionJobDescription || "";
    const company = bodyCompany || sessionCompany || "";
    const additionalNotes = bodyAdditionalNotes || sessionAdditionalNotes || "";
    const questionCount = clampQuestionCount(bodyNumQuestions ?? sessionNumQuestions);
    const introCount = questionCount >= 4 ? 2 : Math.min(1, questionCount);
    const coreCount = questionCount - introCount;
    const introInstruction = introCount === 2
      ? `Start with two warm-up questions: one asking the candidate to introduce themselves, and one asking why they're interested in this role${company ? ` at ${company}` : ""}.`
      : introCount === 1
        ? "Start with one warm-up question asking the candidate to introduce themselves."
        : "Do not include generic warm-up questions — every question should be substantive.";

    // call Claude Haiku via Bedrock
    const prompt = `You are an expert interviewer preparing a candidate for an interview${jobTitle ? ` for the role of ${jobTitle}` : ""}${company ? ` at ${company}` : ""}.

RESUME:
${resumeText}

${effectiveJobDescription ? `JOB DESCRIPTION:\n${effectiveJobDescription}\n` : ""}${company ? `COMPANY: ${company}\nIf you're familiar with how ${company} typically runs interviews (their focus areas, values, interview style, or common question themes), reflect that in the technical and situational questions below.\n` : ""}${additionalNotes ? `CANDIDATE NOTES: ${additionalNotes}\nTake this into account when choosing what to focus on, avoid, or how to phrase questions.\n` : ""}
Generate exactly ${questionCount} interview questions total:
- ${introInstruction}
- The remaining ${coreCount} questions should be a mix of behavioral, technical, and situational, grounded ONLY in specifics actually present in the resume, job title, job description, or company context above.

Do not invent or assume specific technologies, responsibilities, or achievements that aren't supported by the information given. If there isn't enough specific detail to write a well-grounded question of a given type, ask a broader but still honest question instead of fabricating specifics.

Return ONLY a JSON array of exactly ${questionCount} items, no explanation, no markdown. Example format:
[
  { "id": "1", "question": "...", "type": "intro" },
  { "id": "2", "question": "...", "type": "intro" },
  { "id": "3", "question": "...", "type": "behavioral" }
]`;

    let questions;

    try {
      const bedrockResponse = await bedrock.send(new InvokeModelCommand({
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: Math.min(4096, 300 + questionCount * 220),
          messages: [
            { role: "user", content: prompt }
          ],
        }),
      }));

      // parse Bedrock response
      const responseBody = JSON.parse(Buffer.from(bedrockResponse.body).toString());
      const responseText = responseBody.content[0].text;
      questions = JSON.parse(extractJson(responseText));
    } catch (bedrockErr) {
      console.error("Bedrock question generation failed, using fallback questions", bedrockErr);
      questions = buildFallbackQuestions(jobTitle, effectiveJobDescription, company, questionCount);
    }

    // save questions to session in DynamoDB
    await dynamo.send(new UpdateCommand({
      TableName: Resource.Sessions.name,
      Key: { sessionId },
      UpdateExpression: "SET questions = :q, jobDescription = :jd, company = :c, numQuestions = :nq, additionalNotes = :an, #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":q": questions,
        ":jd": effectiveJobDescription,
        ":c": company,
        ":nq": questionCount,
        ":an": additionalNotes,
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