import { Injectable, Logger } from '@nestjs/common';
import * as nlp from 'wink-nlp-utils';
import winkNLP from 'wink-nlp';
import model from 'wink-eng-lite-web-model';

/**
 * Shared NLP utility service for POS tagging, noun extraction, and stemming
 * Used across hybrid search and suggestion services
 */
@Injectable()
export class NlpUtilsService {
  private readonly logger = new Logger(NlpUtilsService.name);
  private readonly nlpEngine: any;
  private readonly its: any;

  constructor() {
    // Initialize wink-nlp for POS tagging
    this.nlpEngine = winkNLP(model);
    this.its = this.nlpEngine.its;
    this.logger.log('NLP utility service initialized with wink-nlp');
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
   * Handles partial words gracefully - if stemming fails, returns original
   */
  stemQueryForSuggestion(query: string): {
    original: string;
    stemmed: string;
    shouldUseStemmed: boolean;
  } {
    if (!query || query.trim().length === 0) {
      return { original: query, stemmed: query, shouldUseStemmed: false };
    }

    try {
      // For very short queries (< 3 chars), don't stem
      if (query.trim().length < 3) {
        return { original: query, stemmed: query, shouldUseStemmed: false };
      }

      // Split into words and stem each
      const words = query.toLowerCase().trim().split(/\s+/);
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
