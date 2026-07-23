import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  try {
    const userId = event.queryStringParameters?.userId;

    let result;

    if (userId) {
      result = await dynamo.send(new QueryCommand({
        TableName: Resource.Sessions.name,
        IndexName: "ByUser",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": userId,
        },
        ScanIndexForward: false,
      }));
    } else {
      result = await dynamo.send(new ScanCommand({
        TableName: Resource.Sessions.name,
      }));
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({
        sessions: (result.Items || []).sort((a, b) => {
          const aCreatedAt = a.createdAt || "";
          const bCreatedAt = b.createdAt || "";
          return bCreatedAt.localeCompare(aCreatedAt);
        }),
      }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to list sessions" }),
    };
  }
};