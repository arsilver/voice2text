import type { PromptCategory } from "@shared/types";

export interface ClassificationResult {
  category: PromptCategory;
  confidence: number;
}

interface KeywordRule {
  /** Words/phrases to match (lowercased). */
  keywords: string[];
  /** Weight per match — higher for very specific terms. */
  weight: number;
}

const CATEGORY_RULES: Record<PromptCategory, KeywordRule[]> = {
  coding: [
    {
      keywords: [
        "implement", "function", "component", "endpoint", "api",
        "class", "module", "method", "variable", "const", "interface",
        "type", "enum", "hook", "route", "handler", "middleware",
        "import", "export", "return", "async", "await", "callback",
        "parameter", "argument", "constructor", "prototype", "template",
        "regex", "parser", "serializ", "deserializ", "validation",
        "webpack", "vite", "react", "vue", "angular", "svelte",
        "express", "fastify", "next.js", "nuxt", "tailwind",
      ],
      weight: 1,
    },
    {
      keywords: [
        "write code", "add feature", "create component", "build endpoint",
        "add function", "create file", "new file", "new component",
        "add a button", "add a field", "add a page", "add a form",
        "make it so", "wire up", "connect to", "integrate with",
        "add support for", "implement the", "build a", "create a",
      ],
      weight: 2,
    },
  ],
  debugging: [
    {
      keywords: [
        "bug", "error", "fix", "broken", "crash", "failing",
        "exception", "stack trace", "null", "undefined", "nan",
        "timeout", "hang", "freeze", "slow", "leak", "race condition",
        "deadlock", "segfault", "panic", "abort", "warning",
        "deprecat", "memory", "corrupt", "invalid", "unexpected",
        "wrong", "incorrect", "missing",
      ],
      weight: 1,
    },
    {
      keywords: [
        "doesn't work", "not working", "stopped working",
        "throws error", "getting error", "breaks when",
        "fails when", "crashes when", "can't figure out why",
        "keeps happening", "happening intermittently",
        "works locally but", "passes locally but",
        "used to work", "suddenly stopped", "after upgrading",
        "since updating", "regression",
      ],
      weight: 2,
    },
  ],
  planning: [
    {
      keywords: [
        "plan", "strategy", "approach", "roadmap", "milestone",
        "timeline", "prioritize", "decide", "tradeoff", "trade-off",
        "schedule", "phase", "sprint", "quarter", "deadline",
        "scope", "estimate", "capacity", "bandwidth", "backlog",
        "objective", "goal", "target", "initiative",
      ],
      weight: 1,
    },
    {
      keywords: [
        "should we", "what order", "how to approach",
        "best way to", "next steps", "action items",
        "which should come first", "what to prioritize",
        "how do we sequence", "where do we start",
        "what's the plan for", "how to break down",
      ],
      weight: 2,
    },
  ],
  brainstorming: [
    {
      keywords: [
        "ideas", "brainstorm", "explore", "possibilities",
        "creative", "alternatives", "options", "imagine",
        "hypothetical", "thought experiment", "inspiration",
        "innovative", "experiment", "prototype",
      ],
      weight: 1,
    },
    {
      keywords: [
        "what if", "how about", "could we", "what are some",
        "think of ways", "come up with", "ways to improve",
        "how might we", "wouldn't it be cool if",
        "any ideas for", "let's think about",
      ],
      weight: 2,
    },
  ],
  architecture: [
    {
      keywords: [
        "architecture", "design", "system", "scale", "microservice",
        "database", "infrastructure", "pattern", "monolith",
        "service", "layer", "schema", "migration", "pipeline",
        "queue", "cache", "cdn", "load balancer", "container",
        "kubernetes", "docker", "serverless", "lambda", "event-driven",
        "message bus", "pub sub", "grpc", "rest vs", "graphql",
        "tenant", "shard", "replica", "cluster",
      ],
      weight: 1,
    },
    {
      keywords: [
        "system design", "design pattern", "data model",
        "how should we structure", "compare approaches",
        "trade-offs between", "should we use",
        "what's the best architecture", "how to scale",
        "how do we handle", "separation of concerns",
      ],
      weight: 2,
    },
  ],
  documentation: [
    {
      keywords: [
        "document", "readme", "docs", "explain", "guide",
        "tutorial", "api docs", "docstring", "jsdoc", "comments",
        "changelog", "wiki", "specification", "spec",
        "onboarding", "runbook", "playbook",
      ],
      weight: 1,
    },
    {
      keywords: [
        "write documentation", "add docs", "document this",
        "create readme", "write guide", "write a tutorial",
        "explain how this works", "document the api",
        "add comments to", "write up",
      ],
      weight: 2,
    },
  ],
  "code-review": [
    {
      keywords: [
        "review", "feedback", "refactor", "clean up",
        "code quality", "lint", "smell", "tech debt",
        "readability", "maintainability", "complexity",
        "duplication", "dead code", "unused",
      ],
      weight: 1,
    },
    {
      keywords: [
        "pull request", "code review", "review this",
        "look at this code", "check this pr",
        "review my changes", "is this code okay",
        "what do you think of this code",
        "any issues with", "can you check",
      ],
      weight: 2,
    },
  ],
  general: [
    // General has no keywords — it's the fallback when nothing else matches.
    { keywords: [], weight: 0 },
  ],
};

const MIN_CONFIDENCE_THRESHOLD = 0.15;

/**
 * Classifies the intent of raw dictation text using keyword matching.
 * Returns the best-matching category and a confidence score (0–1).
 * Falls back to "general" if no category exceeds the threshold.
 */
export function classifyIntent(rawText: string): ClassificationResult {
  const lower = rawText.toLowerCase();
  const scores: Record<string, number> = {};
  let maxScore = 0;

  for (const [category, rules] of Object.entries(CATEGORY_RULES)) {
    if (category === "general") continue;

    let score = 0;
    for (const rule of rules) {
      for (const keyword of rule.keywords) {
        if (lower.includes(keyword)) {
          score += rule.weight;
        }
      }
    }

    scores[category] = score;
    if (score > maxScore) {
      maxScore = score;
    }
  }

  if (maxScore === 0) {
    return { category: "general", confidence: 1 };
  }

  // Normalize confidence: ratio of winner's score to total.
  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
  const confidence = totalScore > 0 ? maxScore / totalScore : 0;

  // Find the winning category.
  let bestCategory: PromptCategory = "general";
  for (const [category, score] of Object.entries(scores)) {
    if (score === maxScore) {
      bestCategory = category as PromptCategory;
      break;
    }
  }

  // If confidence is too low (scores spread evenly), fall back to general.
  if (confidence < MIN_CONFIDENCE_THRESHOLD) {
    return { category: "general", confidence };
  }

  return { category: bestCategory, confidence };
}
