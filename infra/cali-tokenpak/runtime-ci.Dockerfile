FROM node:24.5.0-alpine3.22@sha256:e0a6a0687f8863d5a8a82113e0b7a14552e2bf353bafc554f63d18671c4021c4

WORKDIR /app

COPY security.mjs access-jwks.mjs access-jwks-ci.mjs egress.mjs egress-ci.mjs mock-groq.mjs runtime-ingress-smoke.mjs ./

USER 65532:65532
