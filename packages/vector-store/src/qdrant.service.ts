import { Injectable, Inject, Logger } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';

type Distance = 'Cosine' | 'Euclid' | 'Dot' | 'Manhattan';

@Injectable()
export class QdrantService {
  private readonly logger = new Logger(QdrantService.name);

  constructor(@Inject('QDRANT_CLIENT') private readonly client: QdrantClient) {}

  /**
   * Performs a health check on the Qdrant connection
   * @returns Promise<boolean> - True if connection is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.getCollections();
      this.logger.log('Qdrant health check passed');
      return true;
    } catch (error) {
      this.logger.error('Qdrant health check failed', error);
      return false;
    }
  }

  /**
   * Creates a new collection in Qdrant
   * @param name - Collection name
   * @param vectorSize - Size of the vectors to store
   * @param distance - Distance metric (default: Cosine)
   */
  async createCollection(
    name: string,
    vectorSize: number,
    distance: Distance = 'Cosine'
  ): Promise<void> {
    try {
      this.logger.log(`Creating collection: ${name} with vector size ${vectorSize}`);
      await this.client.createCollection(name, {
        vectors: { size: vectorSize, distance },
      });
      this.logger.log(`Collection ${name} created successfully`);
    } catch (error) {
      this.logger.error(`Failed to create collection ${name}`, error);
      throw error;
    }
  }

  /**
   * Lists all collections in Qdrant
   * @returns Promise with collection names
   */
  async listCollections(): Promise<string[]> {
    try {
      const response = await this.client.getCollections();
      const collections = response.collections.map((c) => c.name);
      this.logger.log(`Found ${collections.length} collections`);
      return collections;
    } catch (error) {
      this.logger.error('Failed to list collections', error);
      throw error;
    }
  }

  /**
   * Checks if a collection exists
   * @param name - Collection name
   * @returns Promise<boolean> - True if collection exists
   */
  async collectionExists(name: string): Promise<boolean> {
    try {
      const collections = await this.listCollections();
      return collections.includes(name);
    } catch (error) {
      this.logger.error(`Failed to check if collection ${name} exists`, error);
      throw error;
    }
  }

  /**
   * Deletes a collection
   * @param name - Collection name
   */
  async deleteCollection(name: string): Promise<void> {
    try {
      this.logger.log(`Deleting collection: ${name}`);
      await this.client.deleteCollection(name);
      this.logger.log(`Collection ${name} deleted successfully`);
    } catch (error) {
      this.logger.error(`Failed to delete collection ${name}`, error);
      throw error;
    }
  }

  /**
   * Upserts points (vectors) into a collection
   * @param collectionName - Collection name
   * @param points - Array of points to upsert
   */
  async upsertPoints(
    collectionName: string,
    points: Array<{
      id: string | number;
      vector: number[];
      payload?: Record<string, unknown>;
    }>
  ): Promise<void> {
    try {
      this.logger.log(`Upserting ${points.length} points to ${collectionName}`);
      await this.client.upsert(collectionName, {
        wait: true,
        points,
      });
      this.logger.log(`Successfully upserted points to ${collectionName}`);
    } catch (error) {
      this.logger.error(`Failed to upsert points to ${collectionName}`, error);
      throw error;
    }
  }

  /**
   * Searches for similar vectors in a collection
   * @param collectionName - Collection name
   * @param vector - Query vector
   * @param limit - Maximum number of results (default: 10)
   * @returns Promise with search results
   */
  async search(
    collectionName: string,
    vector: number[],
    limit = 10
  ): Promise<
    Array<{
      id: string | number;
      score: number;
      payload?: Record<string, unknown>;
    }>
  > {
    try {
      this.logger.log(`Searching in ${collectionName} with limit ${limit}`);
      const results = await this.client.search(collectionName, {
        vector,
        limit,
      });
      this.logger.log(`Found ${results.length} results in ${collectionName}`);

      // Map results to match return type
      return results.map((result) => ({
        id: result.id,
        score: result.score,
        payload: result.payload as Record<string, unknown> | undefined,
      }));
    } catch (error) {
      this.logger.error(`Failed to search in ${collectionName}`, error);
      throw error;
    }
  }

  /**
   * Gets the Qdrant client instance for advanced operations
   * @returns QdrantClient instance
   */
  getClient(): QdrantClient {
    return this.client;
  }
}
