import { Injectable, Logger } from '@nestjs/common';
import { SearchRequestDto } from '../dto/search-request.dto';
import { NlpUtilsService } from 'src/common/services/nlp-utils.service';
import * as nlp from 'wink-nlp-utils';

/**
 * Service responsible for processing search results
 * Handles combining, deduplicating, and enriching results
 */
@Injectable()
export class ResultProcessor {
  private readonly logger = new Logger(ResultProcessor.name);

  constructor(private readonly nlpUtilsService: NlpUtilsService) {}

  /**
   * Combine and deduplicate results from all search strategies
   * Keeps the best score for each unique document and tracks detailed source contributions
   * Returns both the combined results and the total count of unique matching documents
   */
  combineAndDeduplicate(
    responses: any[],
    strategyNames: string[],
  ): { results: any[]; totalResults: number } {
    // First pass: normalize scores within each strategy to 0-1 scale
    const normalizedResponses = this.normalizeStrategyScores(
      responses,
      strategyNames,
    );

    const resultMap = new Map<string, any>();

    normalizedResponses.forEach((response, index) => {
      if (!response.hits?.hits) return;

      const strategyName = strategyNames[index];

      response.hits.hits.forEach((hit: any) => {
        const existingHit = resultMap.get(hit._id);

        // Track detailed source contributions with normalized scores
        const sourceContributions = existingHit?._source_contributions || [];
        sourceContributions.push({
          strategy: strategyName,
          pre_weight_score: hit._normalized_score, // Normalized 0-1 score
          original_score: hit._original_score, // Original raw score for reference
          strategy_weight: 1.0, // Placeholder, will be set in main service
          weighted_score: hit._score, // Final weighted score
        });

        // Keep the hit with the highest weighted score
        if (!existingHit || hit._score > existingHit._score) {
          resultMap.set(hit._id, {
            ...hit,
            _source_contributions: sourceContributions,
          });
        } else {
          // Update source contributions even if we're not replacing the hit
          existingHit._source_contributions = sourceContributions;
        }
      });
    });

    // Convert map to array and sort by score
    const results = Array.from(resultMap.values()).sort(
      (a, b) => b._score - a._score,
    );

    // The total is the number of unique documents that matched across all strategies
    let totalResults = 0;

    responses.forEach((response) => {
      const value = response?.hits?.total?.value;
      if (typeof value === 'number' && value > totalResults) {
        totalResults = value;
      }
    });

    return { results, totalResults };
  }

  /**
   * Normalize scores within each strategy to 0-1 scale using min-max normalization
   * This ensures all strategies (semantic KNN, keyword BM25, etc.) are comparable
   */
  private normalizeStrategyScores(
    responses: any[],
    strategyNames: string[],
  ): any[] {
    return responses.map((response, index) => {
      if (!response.hits?.hits || response.hits.hits.length === 0) {
        return response;
      }

      const hits = response.hits.hits;
      const strategyName = strategyNames[index];

      // Check if this is browse mode (scores are null or all equal to 1.0)
      const hasNullScores = hits.some(
        (hit: any) => hit._score === null || hit._score === undefined,
      );

      if (hasNullScores || strategyName === 'browse_match_all') {
        // Browse mode: no score normalization needed, assign uniform scores
        const normalizedHits = hits.map((hit: any) => ({
          ...hit,
          _original_score: hit._score ?? 1.0,
          _normalized_score: 1.0,
          _score: 1.0, // All results have equal score in browse mode
        }));

        this.logger.debug(
          `[${strategyName}] Browse mode - skipping score normalization, all scores set to 1.0`,
        );

        return {
          ...response,
          hits: {
            ...response.hits,
            hits: normalizedHits,
          },
        };
      }

      // Find min and max scores for this strategy
      const scores = hits.map((hit: any) => hit._score);
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);
      const scoreRange = maxScore - minScore;

      // Normalize each hit's score to 0-1 range
      const normalizedHits = hits.map((hit: any) => {
        let normalizedScore: number;

        if (scoreRange === 0) {
          // All scores are the same, set to 1.0
          normalizedScore = 1.0;
        } else {
          // Min-max normalization: (score - min) / (max - min)
          normalizedScore = (hit._score - minScore) / scoreRange;
        }

        this.logger.debug(
          `[${strategyName}] Normalized score: ${hit._score.toFixed(4)} -> ${normalizedScore.toFixed(4)} (range: ${minScore.toFixed(4)}-${maxScore.toFixed(4)})`,
        );

        return {
          ...hit,
          _original_score: hit._score, // Keep original for reference
          _normalized_score: normalizedScore, // Normalized 0-1 score
          _score: normalizedScore, // Use normalized score for ranking
        };
      });

      return {
        ...response,
        hits: {
          ...response.hits,
          hits: normalizedHits,
        },
      };
    });
  }

  /**
   * Add distance information to search results if location is provided
   */
  addDistanceInfo(hits: any[], searchRequest: SearchRequestDto): any[] {
    if (!searchRequest.lat || !searchRequest.lon) {
      return hits;
    }

    return hits.map((hit) => {
      const enhancedHit = { ...hit };

      // Calculate distance if location exists
      if (
        hit._source?.location?.point?.lat &&
        hit._source?.location?.point?.lon
      ) {
        const distance = this.calculateDistance(
          searchRequest.lat,
          searchRequest.lon,
          hit._source.location.point.lat,
          hit._source.location.point.lon,
        );

        enhancedHit._source.distance_from_user =
          Math.round(distance * 100) / 100; // Round to 2 decimal places
      }

      return enhancedHit;
    });
  }

  /**
   * Calculate distance between two points using Haversine formula
   * Returns distance in miles
   */
  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 3959; // Earth's radius in miles
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  /**
   * Add relevant text snippets to results to explain why they were surfaced
   * Extracts sentences containing query nouns to help users understand relevance
   */
  addRelevantTextSnippets(results: any[], query: string): any[] {
    if (!query || results.length === 0) {
      return results;
    }

    // Extract nouns from the query
    const queryNouns = this.nlpUtilsService.extractNouns(query);
    if (queryNouns.length === 0) {
      return results;
    }

    this.logger.debug(
      `Extracting relevant text snippets for nouns: [${queryNouns.join(', ')}]`,
    );

    return results.map((result) => {
      const relevantSnippets = this.findRelevantSnippets(
        result._source,
        queryNouns,
      );

      if (relevantSnippets.length > 0) {
        return {
          ...result,
          relevant_text: relevantSnippets,
        };
      }

      return result;
    });
  }

  /**
   * Find sentences in the document that contain query nouns
   * Returns up to 3 most relevant snippets
   */
  private findRelevantSnippets(source: any, queryNouns: string[]): string[] {
    const snippets: Array<{ text: string; score: number }> = [];

    // Fields to search for relevant text (in priority order)
    const fieldsToSearch = [
      { path: 'description', weight: 3 },
      { path: 'service.description', weight: 3 },
      { path: 'summary', weight: 2 },
      { path: 'service.summary', weight: 2 },
      { path: 'schedule', weight: 1 },
    ];

    for (const field of fieldsToSearch) {
      const text = this.getNestedValue(source, field.path);
      if (!text || typeof text !== 'string') continue;

      // Split into sentences (simple approach)
      const sentences = text
        .split(/[.!?]\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 20); // Filter out very short fragments

      for (const sentence of sentences) {
        const lowerSentence = sentence.toLowerCase();
        let matchCount = 0;

        // Count how many query nouns appear in this sentence
        for (const noun of queryNouns) {
          const lowerNoun = noun.toLowerCase();
          // Check for exact match or stemmed match
          if (
            lowerSentence.includes(lowerNoun) ||
            lowerSentence.includes(nlp.string.stem(lowerNoun))
          ) {
            matchCount++;
          }
        }

        if (matchCount > 0) {
          // Score based on match count and field weight
          const score = matchCount * field.weight;
          snippets.push({ text: sentence, score });
        }
      }
    }

    // Sort by score (descending) and return top 3 unique snippets
    const sortedSnippets = snippets.sort((a, b) => b.score - a.score);
    const uniqueSnippets = Array.from(
      new Set(sortedSnippets.map((s) => s.text)),
    ).slice(0, 3);

    return uniqueSnippets;
  }

  /**
   * Get nested value from object using dot notation path
   */
  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  /**
   * Post-process results: remove embeddings and optionally remove service area
   */
  postProcess(hits: any[], searchRequest: SearchRequestDto): any[] {
    return hits.map((hit) => {
      const source = { ...hit._source };

      // Remove all embedding fields to reduce response size
      this.removeEmbeddings(source);

      // Remove service area if requested
      if (searchRequest.exclude_service_area && source.serviceArea) {
        delete source.serviceArea;
      }

      return {
        ...hit,
        _source: source,
      };
    });
  }

  /**
   * Recursively remove all embedding fields from the document
   */
  private removeEmbeddings(obj: any): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    // Remove embedding field if present
    if ('embedding' in obj) {
      delete obj.embedding;
    }

    // Recursively process nested objects and arrays
    Object.values(obj).forEach((value) => {
      if (Array.isArray(value)) {
        value.forEach((item) => this.removeEmbeddings(item));
      } else if (typeof value === 'object' && value !== null) {
        this.removeEmbeddings(value);
      }
    });
  }
}
