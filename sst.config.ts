/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "last-minute-prep",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage),
      home: "aws",
    };
  },
  async run() {
    // Storage
    const resumesBucket = new sst.aws.Bucket("Resumes");
    const recordingsBucket = new sst.aws.Bucket("Recordings");

    // Database
    const usersTable = new sst.aws.Dynamo("Users", {
      fields: { userId: "string" },
      primaryIndex: { hashKey: "userId" },
    });
    const sessionsTable = new sst.aws.Dynamo("Sessions", {
      fields: { sessionId: "string", userId: "string" },
      primaryIndex: { hashKey: "sessionId" },
      globalIndexes: { ByUser: { hashKey: "userId" } },
    });
    const questionBankTable = new sst.aws.Dynamo("QuestionBank", {
      fields: { questionId: "string", role: "string" },
      primaryIndex: { hashKey: "questionId" },
      globalIndexes: { ByRole: { hashKey: "role" } },
    });
    const responsesTable = new sst.aws.Dynamo("Responses", {
      fields: { responseId: "string", sessionId: "string" },
      primaryIndex: { hashKey: "responseId" },
      globalIndexes: { BySession: { hashKey: "sessionId" } },
    });

    // Auth
    const auth = new sst.aws.CognitoUserPool("Auth", {});
    const authClient = auth.addClient("WebClient");

    // API
    const api = new sst.aws.ApiGatewayV2("Api", {});
    api.route("POST /resume/upload-url", {
      handler: "packages/functions/resume-upload.handler",
      link: [resumesBucket, usersTable],
    });

    return {
      api: api.url,
      userPoolId: auth.id,
      userPoolClientId: authClient.id,
    };
  },
});