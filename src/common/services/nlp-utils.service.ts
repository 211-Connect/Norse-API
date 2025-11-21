import { Injectable, Logger } from '@nestjs/common';
import * as nlp from 'wink-nlp-utils';
import nlpCompromise from 'compromise';
import * as genericNounsConfig from '../../suggestion/generic-nouns.json';

/**
 * Shared NLP utility service for POS tagging, noun extraction, and stemming
 * Used across hybrid search and suggestion services
 */
@Injectable()
export class NlpUtilsService {
  private readonly logger = new Logger(NlpUtilsService.name);
  private readonly genericNounsStemmed: Set<string>;

  constructor() {
    // Load stemmed generic nouns for filtering
    this.genericNounsStemmed = new Set(
      genericNounsConfig.stemmed_generic_nouns,
    );

    this.logger.log(
      `NLP utility service initialized with compromise (${this.genericNounsStemmed.size} generic nouns loaded)`,
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

    try {
      const doc = nlpCompromise(text);
      // Get nouns and normalize them (lowercase, etc.)
      // compromise's .nouns() returns a View of just the nouns
      // .out('array') returns an array of strings
      // We use .normalize() to handle punctuation/case if needed, but .out('array') usually gives clean text
      // However, we might want to ensure we get individual terms.
      // Let's use .terms() on the nouns view to be safe if it returns phrases.
      // Actually doc.nouns().out('array') returns noun phrases like "half day preschool".
      // We probably want individual nouns if that's what the previous one did.
      // The previous one: t.out(this.its.normal) on tokens filtered by POS=NOUN/PROPN.
      // So it returned individual words.
      // compromise .nouns() returns "preschool" or "half day preschool" (if it sees it as a compound).
      // Let's check the test output:
      // Text: half day preschool
      // Nouns: ["half day preschool"]
      // Tags: [{"half":["Adjective"],"day":["Date","Noun","Duration","Singular"],"preschool":["Noun","Singular"]}]
      //
      // If I use doc.nouns().out('array'), I get ["half day preschool"].
      // If I want individual nouns, I should probably iterate terms and check tags.
      
      const nouns: string[] = [];
      doc.terms().forEach((term) => {
        const tags = term.out('tags')[0]; // tags for the term
        // Check if any of the tags for this term include 'Noun'
        // term.out('tags') returns an array of sets of tags, one for each term in the phrase.
        // But here we are iterating terms.
        // Actually doc.terms() returns a View of all terms.
        // term.tags is a Set in internal model, but via API:
        // term.has('#Noun') is the way.
        
        if (term.has('#Noun')) {
           nouns.push(term.text('normal')); // 'normal' gives lowercase, trimmed, etc.
        }
      });
      
      return nouns;
    } catch (error) {
      this.logger.warn(
        `POS tagging failed: ${error.message}, skipping noun extraction`,
      );
      return [];
    }
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
