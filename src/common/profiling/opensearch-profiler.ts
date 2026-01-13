/**
 * OpenSearch Profiling Utilities
 *
 * Provides detailed timing instrumentation for OpenSearch operations,
 * separating performance monitoring logic from core application code.
 */

/**
 * Detailed breakdown of an OpenSearch _msearch call
 */
export interface OpenSearchCallProfile {
  // Wall-clock from before msearch to after await resolves
  total_time: number;

  // OpenSearch's own reported timing for the _msearch operation
  opensearch_reported_took?: number;

  // Client-side breakdown
  client_breakdown: {
    // Time spent in HTTP round-trip (DNS + TCP + TLS + OS compute + transfer)
    http_round_trip_ms: number;

    // Time spent deserializing response and iterating through results
    response_deserialize_ms: number;
  };

  // Per-strategy execution times from OpenSearch
  subqueries: Record<string, number> & {
    max_subquery_took: number;
  };

  // Derived: everything beyond OS compute (network + client overhead)
  network_and_client_overhead_estimate: number;
}

/**
 * Optional diagnostic metrics for debugging
 */
export interface OpenSearchDiagnostics {
  // RTT to a lightweight health check endpoint
  health_check_rtt_ms?: number;
}

/**
 * Profiler for OpenSearch _msearch operations
 * Captures detailed timing breakdown to isolate network, server, and client costs
 */
export class OpenSearchProfiler {
  private msearchStartTime: number;
  private httpStartTime: number;
  private deserializeStartTime: number;

  /**
   * Start profiling an _msearch operation
   */
  startMsearch(): void {
    this.msearchStartTime = Date.now();
  }

  /**
   * Mark the start of HTTP round-trip (just before await)
   */
  startHttpRoundTrip(): void {
    this.httpStartTime = Date.now();
  }

  /**
   * Mark the end of HTTP round-trip and start of deserialization
   */
  startDeserialization(): void {
    this.deserializeStartTime = Date.now();
  }

  /**
   * Complete profiling and generate detailed breakdown
   *
   * @param response - The OpenSearch _msearch response
   * @param strategyNames - Names of search strategies in order
   * @returns Detailed timing profile
   */
  completeProfile(
    response: any,
    strategyNames: string[],
  ): OpenSearchCallProfile {
    const totalTime = Date.now() - this.msearchStartTime;
    const httpRoundTrip = this.deserializeStartTime - this.httpStartTime;
    const deserializeTime = Date.now() - this.deserializeStartTime;

    // Extract OpenSearch's own reported timing if available
    const opensearchReportedTook = response.body?.took;

    // Extract per-strategy timings
    const subqueryTimings: Record<string, number> = {};
    let maxSubqueryTook = 0;

    if (response.body?.responses) {
      response.body.responses.forEach((resp: any, index: number) => {
        if (resp.took !== undefined && strategyNames[index]) {
          subqueryTimings[strategyNames[index]] = resp.took;
          maxSubqueryTook = Math.max(maxSubqueryTook, resp.took);
        }
      });
    }

    // Calculate network + client overhead
    // Use opensearch_reported_took if available, otherwise fall back to max_subquery_took
    const serverComputeTime = opensearchReportedTook ?? maxSubqueryTook;
    const networkAndClientOverhead =
      serverComputeTime > 0
        ? totalTime - serverComputeTime
        : totalTime - maxSubqueryTook;

    return {
      total_time: totalTime,
      opensearch_reported_took: opensearchReportedTook,
      client_breakdown: {
        http_round_trip_ms: httpRoundTrip,
        response_deserialize_ms: deserializeTime,
      },
      subqueries: {
        ...subqueryTimings,
        max_subquery_took: maxSubqueryTook,
      },
      network_and_client_overhead_estimate: networkAndClientOverhead,
    };
  }

  /**
   * Measure RTT to OpenSearch health check endpoint (for diagnostics)
   *
   * @param client - OpenSearch client
   * @returns RTT in milliseconds, or undefined if check fails
   */
  static async measureHealthCheckRTT(client: any): Promise<number | undefined> {
    try {
      const start = Date.now();
      await client.cluster.health({
        level: 'cluster',
        timeout: '5s',
      });
      return Date.now() - start;
    } catch {
      // Health check failed, return undefined
      return undefined;
    }
  }
}
