import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  try {
    const { sessionId } = event.pathParameters;

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

    const responsesResult = await dynamo.send(new QueryCommand({
      TableName: Resource.Responses.name,
      IndexName: "BySession",
      KeyConditionExpression: "sessionId = :sessionId",
      ExpressionAttributeValues: {
        ":sessionId": sessionId,
      },
      ScanIndexForward: false,
    }));

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        session: sessionResult.Item,
        responses: responsesResult.Items || [],
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to fetch session" }),
    };
  }
};