import { getLogger } from "@main/utils/logger";

const log = getLogger("output-sanitizer");

/**
 * Patterns that indicate the model added preamble or commentary
 * instead of outputting only the improved prompt.
 */
const PREAMBLE_PATTERNS: RegExp[] = [
  /^here(?:'s| is) the improved (?:prompt|version|text)[:\s]*\n*/i,
  /^here(?:'s| is) (?:a |the |your )?(?:cleaned[- ]up|restructured|revised|polished|improved) (?:version|prompt|text)[:\s]*\n*/i,
  /^i(?:'ve| have) (?:cleaned up|restructured|revised|improved|rewritten|polished) (?:your |the )?(?:prompt|text|input|dictation)[.:\s]*\n*/i,
  /^sure[,!]?\s*here(?:'s| is).*?[:\s]*\n*/i,
  /^(?:improved|revised|cleaned[- ]up|restructured) (?:prompt|version|text)[:\s]*\n*/i,
];

/**
 * Trailing commentary patterns the model may append.
 */
const TRAILING_PATTERNS: RegExp[] = [
  /\n+(?:note|notes|tip|additional (?:note|suggestion|context)|i (?:also|additionally))s?:.*$/is,
  /\n+---\n+(?:changes made|what i changed|modifications|summary of changes):.*$/is,
  /\n+(?:let me know|hope this helps|feel free to).*$/is,
];

/**
 * Strips model preamble and trailing commentary from CLI output.
 * Returns the cleaned text and a list of what was removed (for logging).
 */
export function sanitizeOutput(raw: string): { text: string; stripped: string[] } {
  let text = raw;
  const stripped: string[] = [];

  // Strip leading preamble
  for (const pattern of PREAMBLE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      stripped.push(`Stripped preamble: "${match[0].trim()}"`);
      text = text.slice(match[0].length);
      break; // Only one preamble match needed
    }
  }

  // Strip trailing commentary
  for (const pattern of TRAILING_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      stripped.push(`Stripped trailing commentary (${match[0].trim().slice(0, 40)}...)`);
      text = text.slice(0, match.index);
      break;
    }
  }

  // Strip wrapping quotes if the entire output is quoted
  const trimmed = text.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\u201c') && trimmed.endsWith('\u201d'))
  ) {
    text = trimmed.slice(1, -1).trim();
    stripped.push("Stripped wrapping quotes");
  }

  text = text.trim();

  if (stripped.length > 0) {
    log.info("Output sanitized", { stripped });
  }

  return { text, stripped };
}

/**
 * Checks whether the output length is reasonable relative to the input.
 * Returns a warning message if suspicious, or null if OK.
 */
export function checkOutputLength(input: string, output: string): string | null {
  const inputWords = input.trim().split(/\s+/).length;
  const outputWords = output.trim().split(/\s+/).length;

  // Skip check for very short inputs (< 5 words) — ratios are meaningless
  if (inputWords < 5) return null;

  const ratio = outputWords / inputWords;

  if (ratio < 0.3) {
    const msg = `Output is very short (${outputWords} words vs ${inputWords} input words, ratio ${ratio.toFixed(2)}). Content may have been dropped.`;
    log.warn(msg);
    return msg;
  }

  if (ratio > 4.0) {
    const msg = `Output is much longer than input (${outputWords} words vs ${inputWords} input words, ratio ${ratio.toFixed(2)}). Model may have added extra content.`;
    log.warn(msg);
    return msg;
  }

  return null;
}
