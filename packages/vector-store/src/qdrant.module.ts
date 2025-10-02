import { Module } from '@nestjs/common';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantService } from './qdrant.service';

@Module({
  providers: [
    {
      provide: 'QDRANT_CLIENT',
      useFactory: () => {
        return new QdrantClient({
          url: process.env.QDRANT_URL || 'http://localhost:6333',
        });
      },
    },
    QdrantService,
  ],
  exports: ['QDRANT_CLIENT', QdrantService],
})
export class QdrantModule {}
