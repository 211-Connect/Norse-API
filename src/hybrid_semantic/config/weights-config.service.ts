import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, watchFile } from 'fs';
import { join } from 'path';

/**
 * Configuration structure for search weights
 */
export interface WeightsConfig {
  version: string;
  description?: string;
  last_updated?: string;
  semantic: {
    service: number;
    taxonomy: number;
    organization: number;
  };
  strategies: {
    semantic_search: number;
    keyword_search: number;
    intent_driven: number;
  };
  geospatial: {
    weight: number;
    decay_scale: number;
    decay_offset: number;
  };
  keyword_variations?: {
    nouns_multiplier: number;
    stemmed_nouns_multiplier: number;
  };
  metadata?: {
    tuning_notes?: string;
    evaluation_metrics?: {
      ndcg?: number | null;
      mrr?: number | null;
      precision_at_10?: number | null;
    };
  };
}

/**
 * Service for loading and managing search weight configurations
 * Supports hot-reloading when the configuration file changes
 */
@Injectable()
export class WeightsConfigService implements OnModuleInit {
  private readonly logger = new Logger(WeightsConfigService.name);
  private config: WeightsConfig;
  private readonly configPath: string;

  constructor() {
    this.configPath = join(__dirname, 'default-weights.json');
  }

  /**
   * Initialize the service and load the configuration
   */
  onModuleInit() {
    this.loadConfig();
    this.watchConfig();
  }

  /**
   * Load configuration from JSON file
   */
  private loadConfig(): void {
    try {
      const configData = readFileSync(this.configPath, 'utf-8');
      this.config = JSON.parse(configData);
      this.validateConfig(this.config);
      this.logger.log(
        `Loaded weights configuration v${this.config.version} from ${this.configPath}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to load weights configuration: ${error.message}`,
        error.stack,
      );
      // Fall back to hardcoded defaults
      this.config = this.getDefaultConfig();
      this.logger.warn('Using hardcoded default configuration');
    }
  }

  /**
   * Watch configuration file for changes and hot-reload
   */
  private watchConfig(): void {
    watchFile(this.configPath, { interval: 5000 }, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        this.logger.log('Configuration file changed, reloading...');
        this.loadConfig();
      }
    });
  }

  /**
   * Validate configuration structure and values
   */
  private validateConfig(config: WeightsConfig): void {
    if (!config.version) {
      throw new Error('Configuration must have a version');
    }

    // Validate semantic weights
    if (!config.semantic) {
      throw new Error('Configuration must have semantic weights');
    }
    this.validateWeight(config.semantic.service, 'semantic.service', 0, 10);
    this.validateWeight(config.semantic.taxonomy, 'semantic.taxonomy', 0, 10);
    this.validateWeight(
      config.semantic.organization,
      'semantic.organization',
      0,
      10,
    );

    // Validate strategy weights
    if (!config.strategies) {
      throw new Error('Configuration must have strategy weights');
    }
    this.validateWeight(
      config.strategies.semantic_search,
      'strategies.semantic_search',
      0,
      10,
    );
    this.validateWeight(
      config.strategies.keyword_search,
      'strategies.keyword_search',
      0,
      10,
    );
    this.validateWeight(
      config.strategies.intent_driven,
      'strategies.intent_driven',
      0,
      10,
    );

    // Validate geospatial weights
    if (!config.geospatial) {
      throw new Error('Configuration must have geospatial weights');
    }
    this.validateWeight(config.geospatial.weight, 'geospatial.weight', 0, 10);
    this.validateWeight(
      config.geospatial.decay_scale,
      'geospatial.decay_scale',
      1,
      200,
    );
    this.validateWeight(
      config.geospatial.decay_offset,
      'geospatial.decay_offset',
      0,
      50,
    );

    // Validate keyword variations if present
    // Note: These are multiplicative boosts, not fractional reductions.
    // Values > 1.0 mean the variation is weighted MORE than the original query.
    // This can be valid if noun-focused queries perform better than full queries.
    if (config.keyword_variations) {
      this.validateWeight(
        config.keyword_variations.nouns_multiplier,
        'keyword_variations.nouns_multiplier',
        0,
        10,
      );
      this.validateWeight(
        config.keyword_variations.stemmed_nouns_multiplier,
        'keyword_variations.stemmed_nouns_multiplier',
        0,
        10,
      );
    }
  }

  /**
   * Validate a single weight value
   */
  private validateWeight(
    value: number,
    name: string,
    min: number,
    max: number,
  ): void {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error(`${name} must be a number`);
    }
    if (value < min || value > max) {
      throw new Error(`${name} must be between ${min} and ${max}`);
    }
  }

  /**
   * Get hardcoded default configuration (fallback)
   */
  private getDefaultConfig(): WeightsConfig {
    return {
      version: '1.0.0',
      description: 'Hardcoded fallback configuration',
      semantic: {
        service: 1.0,
        taxonomy: 1.0,
        organization: 1.0,
      },
      strategies: {
        semantic_search: 1.0,
        keyword_search: 1.0,
        intent_driven: 1.0,
      },
      geospatial: {
        weight: 2.0,
        decay_scale: 50,
        decay_offset: 0,
      },
      keyword_variations: {
        nouns_multiplier: 0.95,
        stemmed_nouns_multiplier: 0.85,
      },
    };
  }

  /**
   * Get the current configuration
   */
  getConfig(): WeightsConfig {
    return { ...this.config };
  }

  /**
   * Get semantic weights
   */
  getSemanticWeights() {
    return { ...this.config.semantic };
  }

  /**
   * Get strategy weights
   */
  getStrategyWeights() {
    return { ...this.config.strategies };
  }

  /**
   * Get geospatial weights
   */
  getGeospatialWeights() {
    return { ...this.config.geospatial };
  }

  /**
   * Get keyword variation multipliers
   */
  getKeywordVariationMultipliers() {
    return (
      this.config.keyword_variations || {
        nouns_multiplier: 0.95,
        stemmed_nouns_multiplier: 0.85,
      }
    );
  }

  /**
   * Get configuration version
   */
  getVersion(): string {
    return this.config.version;
  }

  /**
   * Get configuration metadata
   */
  getMetadata() {
    return this.config.metadata;
  }
}
