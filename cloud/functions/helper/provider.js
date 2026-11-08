// Model provider. Disabled unless HELPER_ENABLED=true.
// Vertex Gemini uses the Cloud Functions runtime service account.
// There is no API key in this file. The region does not fall back overseas.

const REGION = "australia-southeast1";
// gemini-2.5-flash retired on Vertex on 20 October 2026.
// gemini-3.5-flash is GA and its ML processing includes australia-southeast1.
// gemini-3.8-flash is only on the global, us, and eu endpoints, so it is not used.
const DEFAULT_MODEL = "gemini-3.5-flash";

function misconfigured(message) {
  const err = new Error(message || "helper-misconfigured");
  err.code = "helper-misconfigured";
  return err;
}

export function vertexTarget(env = process.env) {
  const project = String(env.GCLOUD_PROJECT || env.GOOGLE_CLOUD_PROJECT || "");
  const location = String(env.HELPER_VERTEX_LOCATION || REGION);
  const model = String(env.HELPER_VERTEX_MODEL || DEFAULT_MODEL);
  if (!/^[a-z][a-z0-9-]{4,38}[a-z0-9]$/.test(project)) throw misconfigured("vertex-project-missing");
  if (location !== REGION) throw misconfigured("vertex-region-locked");
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(model)) throw misconfigured("vertex-model-invalid");
  return { project, location, model };
}

export function buildVertexRequest({ project, location, model, system, user }) {
  const target = vertexTarget({
    GCLOUD_PROJECT: project,
    HELPER_VERTEX_LOCATION: location,
    HELPER_VERTEX_MODEL: model,
  });
  return {
    url: `https://${target.location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(target.project)}/locations/${encodeURIComponent(target.location)}/publishers/google/models/${encodeURIComponent(target.model)}:generateContent`,
    method: "POST",
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1024,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
  };
}

async function runtimeAccessToken() {
  const { applicationDefault, getApps, initializeApp } = await import("firebase-admin/app");
  if (!getApps().length) initializeApp();
  const cred = applicationDefault();
  const token = await cred.getAccessToken();
  if (!token || !token.access_token) throw misconfigured("vertex-token-missing");
  return token.access_token;
}

export function createVertexProvider(env = process.env, deps = {}) {
  const target = vertexTarget(env);
  const fetchImpl = deps.fetch || globalThis.fetch;
  const tokenFn = deps.token || runtimeAccessToken;
  return {
    id: "vertex-gemini",
    enabled: true,
    ...target,
    async generate({ system, user }) {
      const request = buildVertexRequest({ ...target, system, user });
      if (request.body.tools || request.body.functionDeclarations) throw misconfigured("tools-not-allowed");
      const access = await tokenFn();
      const response = await fetchImpl(request.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${access}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request.body),
      });
      if (!response.ok) {
        const err = new Error("vertex-failed");
        err.code = "vertex-failed";
        throw err;
      }
      const data = await response.json();
      const parts = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
      const text = Array.isArray(parts) ? parts.map(part => part && part.text || "").join("") : "";
      if (!text.trim()) {
        const err = new Error("vertex-empty");
        err.code = "vertex-empty";
        throw err;
      }
      return text;
    },
  };
}

export function createModelProvider(env = process.env, deps = {}) {
  if (env.HELPER_ENABLED !== "true") {
    return {
      id: "disabled",
      enabled: false,
      async generate() {
        const err = new Error("helper-disabled");
        err.code = "helper-disabled";
        throw err;
      },
    };
  }
  return createVertexProvider(env, deps);
}
