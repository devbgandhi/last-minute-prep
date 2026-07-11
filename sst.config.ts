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
    const resumesBucket = new sst.aws.Bucket("Resumes", {
      cors: true,
    });
    const recordingsBucket = new sst.aws.Bucket("Recordings", {
      cors: true,
    });

    // Database
    const usersTable = new sst.aws.Dynamo("Users", {
      fields: { userId: "string" },
      primaryIndex: { hashKey: "userId" },
    });
    const sessionsTable = new sst.aws.Dynamo("Sessions", {
      fields: {
        sessionId: "string",
        userId: "string",
        createdAt: "string",
      },
      primaryIndex: { hashKey: "sessionId" },
      globalIndexes: {
        ByUser: {
          hashKey: "userId",
          rangeKey: "createdAt",
        },
      },
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
    const api = new sst.aws.ApiGatewayV2("Api", {
      cors: true,
    });

    api.route("POST /resume/upload-url", {
      handler: "packages/functions/resume-upload.handler",
      link: [resumesBucket, sessionsTable, usersTable],
    });

    api.route("POST /sessions/{sessionId}/questions", {
      handler: "packages/functions/generate-questions.handler",
      link: [sessionsTable, resumesBucket],
      environment: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      },
    });

    api.route("POST /sessions/{sessionId}/recording-url", {
      handler: "packages/functions/recording-upload.handler",
      link: [recordingsBucket, sessionsTable],
    });

    api.route("POST /sessions/{sessionId}/transcribe", {
      handler: "packages/functions/transcribe.handler",
      link: [recordingsBucket, sessionsTable, responsesTable],
    });

    api.route("POST /sessions/{sessionId}/feedback", {
      handler: "packages/functions/generate-feedback.handler",
      link: [sessionsTable, responsesTable],
      environment: {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!,
      },
    });

    api.route("GET /sessions/{sessionId}", {
      handler: "packages/functions/sessions-get.handler",
      link: [sessionsTable, responsesTable],
    });

    api.route("GET /sessions", {
      handler: "packages/functions/sessions-list.handler",
      link: [sessionsTable],
    });

    // Frontend
    const web = new sst.aws.Nextjs("Web", {
      link: [api, auth, authClient, resumesBucket, recordingsBucket],
      environment: {
        NEXT_PUBLIC_API_URL: api.url,
        NEXT_PUBLIC_USER_POOL_ID: auth.id,
        NEXT_PUBLIC_USER_POOL_CLIENT_ID: authClient.id,
      },
    });

    return {
      api: api.url,
      web: web.url,
      userPoolId: auth.id,
      userPoolClientId: authClient.id,
    };
  },
});