import { Resource } from "sst";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3 = new S3Client({});

export const handler = async (event) => {
  const { fileName, userId } = JSON.parse(event.body);
  const key = `${userId}/${Date.now()}-${fileName}`;

  const command = new PutObjectCommand({
    Bucket: Resource.Resumes.name,
    Key: key,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });

  return {
    statusCode: 200,
    body: JSON.stringify({ uploadUrl, key }),
  };
};