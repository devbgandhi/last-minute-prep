import { Resource } from "sst";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  try {
    const result = await dynamo.send(new ScanCommand({
      TableName: Resource.Sessions.name,
    }));

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