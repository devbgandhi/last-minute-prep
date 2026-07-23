import { Resource } from "sst";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

const s3 = new S3Client({});
const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  try {
    const { fileName, userId } = JSON.parse(event.body);

    if (!fileName || !userId) {
      return {
        statusCode: 400,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ error: "fileName and userId are required" }),
      };
    }

    const sessionId = uuidv4();
    const key = `${userId}/${sessionId}/${fileName}`;

    const command = new PutObjectCommand({
      Bucket: Resource.Resumes.name,
      Key: key,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

    await dynamo.send(new PutCommand({
      TableName: Resource.Sessions.name,
      Item: {
        sessionId,
        userId,
        resumeKey: key,
        status: "RESUME_PENDING",
        createdAt: new Date().toISOString(),
      },
    }));

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ uploadUrl, key, sessionId }),
    };

  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to generate upload URL" }),
    };
  }
};W