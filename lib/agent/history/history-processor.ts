/**
 * History Processor
 *
 * Inspired by SWE-agent's history processing pattern:
 * - Extract key information from conversation
 * - Deduplicate similar messages
 * - Classify message types
 * - Build knowledge graph
 *
 * Pattern: Parse → Extract → Classify → Deduplicate → Index
 */

export interface ProcessedMessage {
  id: string;
  originalIndex: number;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  classification: MessageClassification;
  entities: Entity[];
  facts: Fact[];
  metadata: Record<string, unknown>;
}

export interface MessageClassification {
  type: MessageType;
  intent?: string;
  topic?: string;
  sentiment?: "positive" | "neutral" | "negative";
  importance: number; // 0-1
}

export type MessageType =
  | "query"
  | "command"
  | "response"
  | "error"
  | "confirmation"
  | "clarification"
  | "information";

export interface Entity {
  type: "token" | "amount" | "address" | "transaction" | "pool";
  value: string;
  confidence: number;
}

export interface Fact {
  subject: string;
  predicate: string;
  object: string;
  timestamp: number;
  source: string; // message ID
}

export interface KnowledgeGraph {
  facts: Fact[];
  entities: Map<string, Entity[]>;
  relationships: Array<{
    from: string;
    to: string;
    type: string;
  }>;
}

/**
 * History Processor
 * Intelligently processes conversation history
 */
export class HistoryProcessor {
  private processedMessages: Map<string, ProcessedMessage> = new Map();
  private knowledgeGraph: KnowledgeGraph = {
    facts: [],
    entities: new Map(),
    relationships: [],
  };

  /**
   * Process conversation history
   */
  processHistory(messages: Array<{ role: string; content: string; timestamp: number }>): ProcessedMessage[] {
    const processed: ProcessedMessage[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const processedMsg = this.processMessage(msg, i);
      processed.push(processedMsg);
      this.processedMessages.set(processedMsg.id, processedMsg);

      // Update knowledge graph
      this.updateKnowledgeGraph(processedMsg);
    }

    // Deduplicate similar messages
    return this.deduplicate(processed);
  }

  /**
   * Process a single message
   */
  private processMessage(
    message: { role: string; content: string; timestamp: number },
    index: number
  ): ProcessedMessage {
    const id = this.generateMessageId(index);

    // Classify message
    const classification = this.classifyMessage(message);

    // Extract entities
    const entities = this.extractEntities(message.content);

    // Extract facts
    const facts = this.extractFacts(message.content, id);

    return {
      id,
      originalIndex: index,
      role: message.role as ProcessedMessage["role"],
      content: message.content,
      timestamp: message.timestamp,
      classification,
      entities,
      facts,
      metadata: {},
    };
  }

  /**
   * Classify message type and intent
   */
  private classifyMessage(message: { role: string; content: string }): MessageClassification {
    const content = message.content.toLowerCase();
    let type: MessageType = "information";
    let intent: string | undefined;
    let topic: string | undefined;
    let importance = 0.5;

    // Classify by role
    if (message.role === "user") {
      if (this.isQuestion(content)) {
        type = "query";
        importance = 0.7;
      } else if (this.isCommand(content)) {
        type = "command";
        importance = 0.9;
      } else if (this.isConfirmation(content)) {
        type = "confirmation";
        importance = 0.6;
      }
    } else if (message.role === "assistant") {
      if (content.includes("error") || content.includes("failed")) {
        type = "error";
        importance = 0.8;
      } else if (this.isQuestion(content)) {
        type = "clarification";
        importance = 0.7;
      } else {
        type = "response";
        importance = 0.6;
      }
    }

    // Extract intent
    if (content.includes("swap")) {
      intent = "swap";
      topic = "trading";
    } else if (content.includes("liquidity")) {
      intent = "liquidity";
      topic = "pool_management";
    } else if (content.includes("price") || content.includes("alert")) {
      intent = "price_check";
      topic = "monitoring";
    }

    // Determine sentiment
    let sentiment: MessageClassification["sentiment"] = "neutral";
    if (content.includes("success") || content.includes("completed")) {
      sentiment = "positive";
    } else if (content.includes("error") || content.includes("failed")) {
      sentiment = "negative";
    }

    return {
      type,
      intent,
      topic,
      sentiment,
      importance,
    };
  }

  /**
   * Extract entities from message
   */
  private extractEntities(content: string): Entity[] {
    const entities: Entity[] = [];

    // Extract token symbols (e.g., TKNA, TKNB, XLM)
    const tokenPattern = /\b([A-Z]{3,5})\b/g;
    let match;
    while ((match = tokenPattern.exec(content)) !== null) {
      entities.push({
        type: "token",
        value: match[1],
        confidence: 0.8,
      });
    }

    // Extract amounts (e.g., 100, 10.5)
    const amountPattern = /\b(\d+(?:\.\d+)?)\s*(?:TKNA|TKNB|XLM)?\b/g;
    while ((match = amountPattern.exec(content)) !== null) {
      entities.push({
        type: "amount",
        value: match[1],
        confidence: 0.7,
      });
    }

    // Extract Stellar addresses (56 characters starting with G)
    const addressPattern = /\b(G[A-Z0-9]{55})\b/g;
    while ((match = addressPattern.exec(content)) !== null) {
      entities.push({
        type: "address",
        value: match[1],
        confidence: 0.9,
      });
    }

    // Extract transaction hashes
    const txPattern = /\b([a-f0-9]{64})\b/g;
    while ((match = txPattern.exec(content)) !== null) {
      entities.push({
        type: "transaction",
        value: match[1],
        confidence: 0.85,
      });
    }

    return entities;
  }

  /**
   * Extract facts from message
   */
  private extractFacts(content: string, messageId: string): Fact[] {
    const facts: Fact[] = [];
    const timestamp = Date.now();

    // Extract swap facts
    const swapPattern = /swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:for|to)\s+(\w+)/i;
    const swapMatch = content.match(swapPattern);
    if (swapMatch) {
      facts.push({
        subject: swapMatch[2],
        predicate: "swap_to",
        object: swapMatch[3],
        timestamp,
        source: messageId,
      });
      facts.push({
        subject: "swap_amount",
        predicate: "equals",
        object: swapMatch[1],
        timestamp,
        source: messageId,
      });
    }

    // Extract price facts
    const pricePattern = /price.*?(\w+).*?(\d+(?:\.\d+)?)/i;
    const priceMatch = content.match(pricePattern);
    if (priceMatch) {
      facts.push({
        subject: priceMatch[1],
        predicate: "has_price",
        object: priceMatch[2],
        timestamp,
        source: messageId,
      });
    }

    // Extract pool facts
    const poolPattern = /pool.*?(\w+)\/(\w+)/i;
    const poolMatch = content.match(poolPattern);
    if (poolMatch) {
      facts.push({
        subject: poolMatch[1],
        predicate: "paired_with",
        object: poolMatch[2],
        timestamp,
        source: messageId,
      });
    }

    return facts;
  }

  /**
   * Update knowledge graph with new message
   */
  private updateKnowledgeGraph(message: ProcessedMessage): void {
    // Add facts
    this.knowledgeGraph.facts.push(...message.facts);

    // Add entities
    for (const entity of message.entities) {
      const existing = this.knowledgeGraph.entities.get(entity.value) || [];
      existing.push(entity);
      this.knowledgeGraph.entities.set(entity.value, existing);
    }

    // Build relationships from facts
    for (const fact of message.facts) {
      this.knowledgeGraph.relationships.push({
        from: fact.subject,
        to: fact.object,
        type: fact.predicate,
      });
    }
  }

  /**
   * Deduplicate similar messages
   */
  private deduplicate(messages: ProcessedMessage[]): ProcessedMessage[] {
    const unique: ProcessedMessage[] = [];
    const seen = new Set<string>();

    for (const msg of messages) {
      const signature = this.getMessageSignature(msg);

      if (!seen.has(signature)) {
        unique.push(msg);
        seen.add(signature);
      }
    }

    return unique;
  }

  /**
   * Get message signature for deduplication
   */
  private getMessageSignature(message: ProcessedMessage): string {
    // Use classification type + intent + first 50 chars
    const contentSnippet = message.content.slice(0, 50).toLowerCase().trim();
    return `${message.classification.type}:${message.classification.intent || "none"}:${contentSnippet}`;
  }

  /**
   * Check if message is a question
   */
  private isQuestion(content: string): boolean {
    return content.includes("?") || content.startsWith("what") || content.startsWith("how") || content.startsWith("why");
  }

  /**
   * Check if message is a command
   */
  private isCommand(content: string): boolean {
    const commandWords = ["swap", "add", "remove", "create", "delete", "cancel"];
    return commandWords.some((word) => content.includes(word));
  }

  /**
   * Check if message is a confirmation
   */
  private isConfirmation(content: string): boolean {
    const confirmWords = ["yes", "ok", "confirm", "proceed", "agree"];
    return confirmWords.some((word) => content.includes(word));
  }

  /**
   * Get knowledge graph
   */
  getKnowledgeGraph(): KnowledgeGraph {
    return this.knowledgeGraph;
  }

  /**
   * Query facts by subject
   */
  queryFacts(subject: string): Fact[] {
    return this.knowledgeGraph.facts.filter((f) => f.subject === subject);
  }

  /**
   * Get entities by type
   */
  getEntitiesByType(type: Entity["type"]): Entity[] {
    const entities: Entity[] = [];
    for (const entityList of this.knowledgeGraph.entities.values()) {
      entities.push(...entityList.filter((e) => e.type === type));
    }
    return entities;
  }

  /**
   * Get message statistics
   */
  getStatistics(): {
    totalMessages: number;
    byType: Record<MessageType, number>;
    byTopic: Record<string, number>;
    totalEntities: number;
    totalFacts: number;
  } {
    const messages = Array.from(this.processedMessages.values());

    const byType: Record<MessageType, number> = {
      query: 0,
      command: 0,
      response: 0,
      error: 0,
      confirmation: 0,
      clarification: 0,
      information: 0,
    };

    const byTopic: Record<string, number> = {};

    for (const msg of messages) {
      byType[msg.classification.type]++;
      if (msg.classification.topic) {
        byTopic[msg.classification.topic] = (byTopic[msg.classification.topic] || 0) + 1;
      }
    }

    return {
      totalMessages: messages.length,
      byType,
      byTopic,
      totalEntities: this.knowledgeGraph.entities.size,
      totalFacts: this.knowledgeGraph.facts.length,
    };
  }

  /**
   * Generate message ID
   */
  private generateMessageId(index: number): string {
    return `msg_${index}_${Date.now()}`;
  }

  /**
   * Clear all processed data
   */
  clear(): void {
    this.processedMessages.clear();
    this.knowledgeGraph = {
      facts: [],
      entities: new Map(),
      relationships: [],
    };
  }
}

/**
 * Global history processor instance
 */
export const historyProcessor = new HistoryProcessor();

/**
 * Usage example:
 *
 * const messages = [
 *   { role: "user", content: "Swap 10 TKNA for TKNB", timestamp: Date.now() },
 *   { role: "assistant", content: "Simulating swap...", timestamp: Date.now() },
 *   { role: "assistant", content: "Swap completed successfully", timestamp: Date.now() },
 * ];
 *
 * const processed = historyProcessor.processHistory(messages);
 * console.log("Processed messages:", processed.length);
 *
 * // Get knowledge graph
 * const graph = historyProcessor.getKnowledgeGraph();
 * console.log("Facts:", graph.facts);
 * console.log("Entities:", graph.entities);
 *
 * // Query facts
 * const swapFacts = historyProcessor.queryFacts("TKNA");
 * console.log("TKNA facts:", swapFacts);
 *
 * // Get statistics
 * const stats = historyProcessor.getStatistics();
 * console.log("Statistics:", stats);
 */
