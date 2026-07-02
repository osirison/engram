import { Module } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantService } from './qdrant.service';

@Module({
  providers: [
    {
      provide: 'QDRANT_CLIENT',
      useFactory: () => {
        // apiKey is optional: unset means an unauthenticated Qdrant (local
        // dev). Production sets QDRANT_API_KEY so the vector DB is not open to
        // anything else on the network.
        const apiKey = process.env.QDRANT_API_KEY;
        return new QdrantClient({
          url: process.env.QDRANT_URL || 'http://localhost:6333',
          checkCompatibility: false,
          ...(apiKey ? { apiKey } : {}),
        });
      },
    },
    QdrantService,
  ],
  exports: ['QDRANT_CLIENT', QdrantService],
})
export class QdrantModule {}
