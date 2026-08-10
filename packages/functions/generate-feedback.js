import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const bedrock = new BedrockRuntimeClient({ region: "us-east-1" });

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : text;
}

function buildFallbackFeedback(qaPairs) {
  const answered = qaPairs.filter((item) => item.answer && item.answer !== "No answer recorded");
  const coverageScore = Math.min(10, Math.max(3, Math.round((answered.length / Math.max(qaPairs.length, 1)) * 10)));

  return {
    overallScore: coverageScore,
    overallSummary: "This is a fallback report generated without model evaluation. Complete, specific answers with clear examples will improve your score.",
    strengths: [
      "You completed the interview flow and recorded responses.",
      "Your answers are captured for each question.",
      "You can iterate quickly by re-running the interview.",
    ],
    improvements: [
      "Use structured STAR-style examples in behavioral answers.",
      "Include measurable outcomes and technical depth in responses.",
      "Keep answers concise and aligned to the role requirements.",
    ],
    questionFeedback: qaPairs.map((item) => ({
      question: item.question,
      score: item.answer && item.answer !== "No answer recorded" ? 7 : 4,
      feedback: item.answer && item.answer !== "No answer recorded"
        ? "Answer captured. Improve by adding concrete impact, tradeoffs, and implementation details."
        : "No answer was recorded for this question.",
      betterAnswer: "Use a concise structure: context, your action, technical decisions, and measurable outcome.",
    })),
  };
}

export const handler = async (event) => {
  try {
    const { sessionId } = event.pathParameters;

    // get session from DynamoDB
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

    const { questions = [], transcripts, transcript, latestTranscript, jobDescription } = sessionResult.Item;

    const sessionTranscript = latestTranscript || transcript || "";

    // build Q&A pairs for Claude to evaluate
    const qaPairs = questions.map((q) => ({
      question: q.question,
      type: q.type,
      answer: transcripts?.[q.id] || sessionTranscript || "No answer recorded",
    }));

    const transcriptContext = qaPairs.length > 0
      ? JSON.stringify(qaPairs, null, 2)
      : sessionTranscript;

    const prompt = `You are an expert interview coach. Evaluate these interview answers and provide detailed feedback.

JOB DESCRIPTION:
${jobDescription}

QUESTIONS AND ANSWERS:
${transcriptContext}

Return ONLY a JSON object in this exact format, no markdown:
{
  "overallScore": 7,
  "overallSummary": "Brief overall assessment in 2-3 sentences",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "improvements": ["area 1", "area 2", "area 3"],
  "questionFeedback": [
    {
      "question": "the question text",
      "score": 8,
      "feedback": "specific feedback on this answer",
      "betterAnswer": "a brief example of what a stronger answer would include"
    }
  ]
}`;

    let feedback;

    try {
      // call Claude Haiku via Bedrock
      const bedrockResponse = await bedrock.send(new InvokeModelCommand({
        modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 2048,
          messages: [
            { role: "user", content: prompt }
          ],
        }),
      }));

      // parse Bedrock response
      const responseBody = JSON.parse(Buffer.from(bedrockResponse.body).toString());
      const responseText = responseBody.content[0].text;
      feedback = JSON.parse(extractJson(responseText));
    } catch (bedrockErr) {
      console.error("Bedrock feedback generation failed, using fallback feedback", bedrockErr);
      feedback = buildFallbackFeedback(qaPairs);
    }

    // save feedback to DynamoDB
    await dynamo.send(new UpdateCommand({
      TableName: Resource.Sessions.name,
      Key: { sessionId },
      UpdateExpression: "SET feedback = :f, #s = :s",
      ExpressionAttributeNames: { "#s": "status" },
      ExpressionAttributeValues: {
        ":f": feedback,
        ":s": "COMPLETED",
      },
    }));

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ feedback }),
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to generate feedback" }),
    };
  }
};