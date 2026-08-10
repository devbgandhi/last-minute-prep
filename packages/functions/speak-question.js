import { PollyClient, SynthesizeSpeechCommand } from "@aws-sdk/client-polly";
import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const polly = new PollyClient({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  try {
    const { sessionId } = event.pathParameters;
    const { questionId } = JSON.parse(event.body || "{}");

    if (!questionId) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "questionId is required" }),
      };
    }

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

    const question = (sessionResult.Item.questions || []).find((item) => item.id === questionId);

    if (!question) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "Question not found" }),
      };
    }

    const speechResult = await polly.send(new SynthesizeSpeechCommand({
      Engine: "neural",
      OutputFormat: "mp3",
      Text: question.question,
      VoiceId: "Joanna",
    }));

    const audioBytes = await speechResult.AudioStream.transformToByteArray();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "audio/mpeg",
      },
      isBase64Encoded: true,
      body: Buffer.from(audioBytes).toString("base64"),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to synthesize question audio" }),
    };
  }
};