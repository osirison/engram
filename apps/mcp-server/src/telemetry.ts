/**
 * OpenTelemetry SDK initialisation.
 *
 * Import this module BEFORE any application code so that auto-instrumentations
 * can patch Node's built-in modules at load time.  The SDK is a no-op when
 * OTEL_EXPORTER_OTLP_ENDPOINT is absent, which keeps memory usage low.
 *
 * Activate tracing:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318 node dist/main.js
 *
 * Standard OpenTelemetry env vars are respected (OTEL_SERVICE_NAME,
 * OTEL_RESOURCE_ATTRIBUTES, OTEL_TRACES_SAMPLER, …).
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

if (endpoint) {
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'engram-mcp-server',
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    void sdk.shutdown();
  });
}
