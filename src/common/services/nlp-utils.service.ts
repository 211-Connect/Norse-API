import { Injectable, Logger } from '@nestjs/common';
import * as nlp from 'wink-nlp-utils';
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';
import * as genericNounsConfig from '../../suggestion/generic-nouns.json';

/**
 * Shared NLP utility service for POS tagging, noun extraction, and stemming
 * Used across hybrid search and suggestion services
 */
@Injectable()
export class NlpUtilsService {
  private readonly logger = new Logger(NlpUtilsService.name);
  private readonly nlpEngine: any;
  private readonly its: any;
  private readonly genericNounsStemmed: Set<string>;

  constructor() {
    // Initialize wink-nlp for POS tagging
    this.nlpEngine = winkNLP(model);
    this.its = this.nlpEngine.its;
    
    // Load stemmed generic nouns for filtering
    this.genericNounsStemmed = new Set(
      genericNounsConfig.stemmed_generic_nouns,
    );
    
    this.logger.log(
      `NLP utility service initialized with wink-nlp (${this.genericNounsStemmed.size} generic nouns loaded)`,
    );
  }

  /**
   * Extract nouns from text using POS tagging
   * Returns nouns in their normalized form
   */
  extractNouns(text: string): string[] {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const nouns: string[] = [];
    try {
      const doc = this.nlpEngine.readDoc(text);
      doc
        .tokens()
        .filter(
          (t: any) =>
            !t.parentEntity() &&
            (t.out(this.its.pos) === 'NOUN' || t.out(this.its.pos) === 'PROPN'),
        )
        .each((t: any) => nouns.push(t.out(this.its.normal)));
    } catch (posError) {
      this.logger.warn(
        `POS tagging failed: ${posError.message}, skipping noun extraction`,
      );
    }
    return nouns;
  }

  /**
   * Stem a single word using wink-nlp-utils
   * Post-processes stems ending in 'i' by removing the trailing 'i'
   * This helps with autocomplete prefix matching (e.g., "laundri" -> "laundr")
   */
  stemWord(word: string): string {
    if (!word || word.trim().length === 0) {
      return word;
    }
    try {
      let stemmed = nlp.string.stem(word);

      // Remove trailing 'i' from stems for better prefix matching
      // e.g., "laundri" -> "laundr" (matches "laundry" better)
      if (stemmed.endsWith('i') && stemmed.length > 2) {
        stemmed = stemmed.slice(0, -1);
      }

      return stemmed;
    } catch (error) {
      this.logger.warn(`Stemming failed for word "${word}": ${error.message}`);
      return word;
    }
  }

  /**
   * Stem an array of words
   */
  stemWords(words: string[]): string[] {
    return words.map((word) => this.stemWord(word));
  }

  /**
   * Filter out generic nouns from a stemmed noun array
   * Uses the pre-loaded list of stemmed generic nouns
   * @param stemmedNouns - Array of stemmed nouns to filter
   * @returns Filtered array with generic nouns removed
   */
  filterGenericNouns(stemmedNouns: string[]): string[] {
    const filtered = stemmedNouns.filter(
      (noun) => !this.genericNounsStemmed.has(noun),
    );

    if (filtered.length < stemmedNouns.length) {
      const removed = stemmedNouns.filter((noun) =>
        this.genericNounsStemmed.has(noun),
      );
      this.logger.debug(
        `Filtered generic nouns: [${removed.join(', ')}] -> kept: [${filtered.join(', ')}]`,
      );
    }

    return filtered;
  }

  /**
   * Process text for search: extract nouns and stem them
   * Returns both original nouns and stemmed versions
   */
  processTextForSearch(text: string): {
    original: string;
    nouns: string[];
    stemmedNouns: string[];
    stemmedText: string;
  } {
    if (!text || text.trim().length === 0) {
      return { original: text, nouns: [], stemmedNouns: [], stemmedText: '' };
    }

    try {
      // Extract nouns using POS tagging
      const nouns = this.extractNouns(text);
      const stemmedNouns = this.stemWords(nouns);

      // Also create a stemmed version of the full text
      const words = text.toLowerCase().split(/\s+/);
      const stemmedWords = this.stemWords(words);
      const stemmedText = stemmedWords.join(' ');

      return {
        original: text,
        nouns,
        stemmedNouns,
        stemmedText,
      };
    } catch (error) {
      this.logger.warn(
        `Text processing failed: ${error.message}, using original text`,
      );
      return {
        original: text,
        nouns: [],
        stemmedNouns: [],
        stemmedText: text,
      };
    }
  }

  /**
   * Stem a query for suggestion/autocomplete purposes
   * For longer queries (sentences), extracts nouns first then stems them
   * For short queries (single words), stems the word directly
   * Handles partial words gracefully - if stemming fails, returns original
   * Filters out generic nouns to improve search relevance
   */
  stemQueryForSuggestion(query: string): {
    original: string;
    stemmed: string;
    shouldUseStemmed: boolean;
    extractedNouns?: string[];
  } {
    if (!query || query.trim().length === 0) {
      return { original: query, stemmed: query, shouldUseStemmed: false };
    }

    try {
      // For very short queries (< 3 chars), don't stem
      if (query.trim().length < 3) {
        return { original: query, stemmed: query, shouldUseStemmed: false };
      }

      const words = query.trim().split(/\s+/);

      // If query has multiple words (likely a sentence), extract nouns first
      if (words.length > 2) {
        const nouns = this.extractNouns(query);

        if (nouns.length > 0) {
          // Stem the extracted nouns
          const stemmedNouns = this.stemWords(nouns);
          
          // Filter out generic nouns
          const filteredNouns = this.filterGenericNouns(stemmedNouns);
          
          // If all nouns were filtered out, return empty stemmed result
          if (filteredNouns.length === 0) {
            this.logger.debug(
              `All nouns from "${query}" were generic, returning empty stemmed result`,
            );
            return {
              original: query,
              stemmed: '',
              shouldUseStemmed: false,
              extractedNouns: nouns,
            };
          }
          
          const stemmed = filteredNouns.join(' ');

          this.logger.debug(
            `Extracted nouns from "${query}": [${nouns.join(', ')}] -> stemmed: [${stemmedNouns.join(', ')}] -> filtered: [${filteredNouns.join(', ')}]`,
          );

          return {
            original: query,
            stemmed,
            shouldUseStemmed: stemmed.length >= 3,
            extractedNouns: nouns,
          };
        }

        // No nouns found, fall through to word-by-word stemming
      }

      // For short queries or when no nouns found, stem all words
      const stemmedWords = words.map((word) => {
        try {
          // Only stem if the word is reasonably complete (>= 3 chars)
          if (word.length >= 3) {
            return this.stemWord(word);
          }
          return word;
        } catch {
          return word; // Fallback to original on error
        }
      });

      const stemmed = stemmedWords.join(' ');

      // Use stemmed version if it's different and meaningful
      const shouldUseStemmed = stemmed !== query && stemmed.length >= 3;

      return { original: query, stemmed, shouldUseStemmed };
    } catch (error) {
      this.logger.warn(
        `Query stemming failed: ${error.message}, using original query`,
      );
      return { original: query, stemmed: query, shouldUseStemmed: false };
    }
  }
}
