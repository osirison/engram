import { Test, TestingModule } from '@nestjs/testing';
import { QdrantService } from './qdrant.service';
import type { QdrantClient } from '@qdrant/js-client-rest';

describe('QdrantService', () => {
  let service: QdrantService;
  let mockClient: jest.Mocked<QdrantClient>;

  beforeEach(async () => {
    mockClient = {
      getCollections: jest.fn(),
      createCollection: jest.fn(),
      deleteCollection: jest.fn(),
      upsert: jest.fn(),
      search: jest.fn(),
    } as unknown as jest.Mocked<QdrantClient>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QdrantService,
        {
          provide: 'QDRANT_CLIENT',
          useValue: mockClient,
        },
      ],
    }).compile();

    service = module.get<QdrantService>(QdrantService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('healthCheck', () => {
    it('should return true when connection is healthy', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [],
      } as never);

      const result = await service.healthCheck();

      expect(result).toBe(true);
      expect(mockClient.getCollections).toHaveBeenCalled();
    });

    it('should return false when connection fails', async () => {
      mockClient.getCollections.mockRejectedValue(new Error('Connection failed'));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });
  });

  describe('createCollection', () => {
    it('should create a collection with default distance metric', async () => {
      mockClient.createCollection.mockResolvedValue(true as never);

      await service.createCollection('test-collection', 1536);

      expect(mockClient.createCollection).toHaveBeenCalledWith('test-collection', {
        vectors: { size: 1536, distance: 'Cosine' },
      });
    });

    it('should create a collection with custom distance metric', async () => {
      mockClient.createCollection.mockResolvedValue(true as never);

      await service.createCollection('test-collection', 768, 'Euclid');

      expect(mockClient.createCollection).toHaveBeenCalledWith('test-collection', {
        vectors: { size: 768, distance: 'Euclid' },
      });
    });
  });

  describe('listCollections', () => {
    it('should return list of collection names', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [
          { name: 'collection1' },
          { name: 'collection2' },
        ],
      } as never);

      const result = await service.listCollections();

      expect(result).toEqual(['collection1', 'collection2']);
    });
  });

  describe('collectionExists', () => {
    it('should return true if collection exists', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [
          { name: 'existing-collection' },
        ],
      } as never);

      const result = await service.collectionExists('existing-collection');

      expect(result).toBe(true);
    });

    it('should return false if collection does not exist', async () => {
      mockClient.getCollections.mockResolvedValue({
        collections: [],
      } as never);

      const result = await service.collectionExists('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('deleteCollection', () => {
    it('should delete a collection', async () => {
      mockClient.deleteCollection.mockResolvedValue(true as never);

      await service.deleteCollection('test-collection');

      expect(mockClient.deleteCollection).toHaveBeenCalledWith('test-collection');
    });
  });

  describe('upsertPoints', () => {
    it('should upsert points to a collection', async () => {
      const points = [
        { id: '1', vector: [0.1, 0.2], payload: { text: 'test' } },
        { id: '2', vector: [0.3, 0.4], payload: { text: 'test2' } },
      ];

      mockClient.upsert.mockResolvedValue({ status: 'completed' } as never);

      await service.upsertPoints('test-collection', points);

      expect(mockClient.upsert).toHaveBeenCalledWith('test-collection', {
        wait: true,
        points,
      });
    });
  });

  describe('search', () => {
    it('should search for similar vectors', async () => {
      const searchResults = [
        { id: '1', score: 0.95, payload: { text: 'test' } },
        { id: '2', score: 0.85, payload: { text: 'test2' } },
      ];

      mockClient.search.mockResolvedValue(searchResults as never);

      const result = await service.search('test-collection', [0.1, 0.2], 5);

      expect(mockClient.search).toHaveBeenCalledWith('test-collection', {
        vector: [0.1, 0.2],
        limit: 5,
      });
      expect(result).toEqual(searchResults);
    });

    it('should use default limit when not provided', async () => {
      mockClient.search.mockResolvedValue([] as never);

      await service.search('test-collection', [0.1, 0.2]);

      expect(mockClient.search).toHaveBeenCalledWith('test-collection', {
        vector: [0.1, 0.2],
        limit: 10,
      });
    });
  });

  describe('getClient', () => {
    it('should return the client instance', () => {
      const client = service.getClient();

      expect(client).toBe(mockClient);
    });
  });
});
