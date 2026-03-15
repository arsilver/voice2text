const BLANK_AUDIO_TOKEN = "[BLANK_AUDIO]";
const WORD_SPLIT_RE = /\s+/;
const EDGE_PUNCTUATION_RE = /^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu;

export function cleanTranscriptText(value: string) {
  return value
    .replaceAll(BLANK_AUDIO_TOKEN, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function mergeTranscriptText(previous: string, incoming: string) {
  const left = cleanTranscriptText(previous);
  const right = cleanTranscriptText(incoming);

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const leftWords = left.split(WORD_SPLIT_RE);
  const rightWords = right.split(WORD_SPLIT_RE);
  const overlapLength = findWordOverlap(leftWords, rightWords);

  if (overlapLength === 0) {
    return `${left} ${right}`.trim();
  }

  return [...leftWords, ...rightWords.slice(overlapLength)].join(" ").trim();
}

export function getPromptTail(text: string, maxCharacters = 240) {
  const cleaned = cleanTranscriptText(text);

  if (cleaned.length <= maxCharacters) {
    return cleaned;
  }

  const sliced = cleaned.slice(-maxCharacters).trim();
  const firstSpaceIndex = sliced.indexOf(" ");
  return firstSpaceIndex === -1 ? sliced : sliced.slice(firstSpaceIndex + 1).trim();
}

function findWordOverlap(previousWords: string[], incomingWords: string[]) {
  const maxLength = Math.min(previousWords.length, incomingWords.length);

  for (let length = maxLength; length > 0; length -= 1) {
    let matches = true;

    for (let index = 0; index < length; index += 1) {
      if (normalizeWord(previousWords[previousWords.length - length + index]) !== normalizeWord(incomingWords[index])) {
        matches = false;
        break;
      }
    }

    if (!matches) {
      continue;
    }

    if (length > 1) {
      return length;
    }

    const normalized = normalizeWord(incomingWords[0]);
    if (normalized.length >= 5) {
      return 1;
    }
  }

  return 0;
}

function normalizeWord(word: string) {
  return word.trim().toLowerCase().replace(EDGE_PUNCTUATION_RE, "");
}
