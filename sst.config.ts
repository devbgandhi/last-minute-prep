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
      cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
        allowHeaders: ["*"],
      },
    });
    const recordingsBucket = new sst.aws.Bucket("Recordings", {
      cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
        allowHeaders: ["*"],
      },
    });

    // Database
    const sessionsTable = new sst.aws.Dynamo("Sessions", {
      fields: {
        sessionId: "string",
        createdAt: "string",
      },
      primaryIndex: { hashKey: "sessionId" },
    });
    const responsesTable = new sst.aws.Dynamo("Responses", {
      fields: { responseId: "string", sessionId: "string" },
      primaryIndex: { hashKey: "responseId" },
      globalIndexes: { BySession: { hashKey: "sessionId" } },
    });

    // API
    const api = new sst.aws.ApiGatewayV2("Api", {
      cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "HEAD", "POST", "PUT", "DELETE"],
        allowHeaders: ["*"],
      },
    });

    api.route("POST /sessions/start", {
      handler: "packages/functions/sessions-start.handler",
      link: [resumesBucket, sessionsTable],
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

    api.route("POST /sessions/{sessionId}/speak-question", {
      handler: "packages/functions/speak-question.handler",
      link: [sessionsTable],
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
      link: [api, resumesBucket, recordingsBucket],
      environment: {
        NEXT_PUBLIC_API_URL: api.url,
      },
    });

    return {
      api: api.url,
      web: web.url,
    };
  },
});