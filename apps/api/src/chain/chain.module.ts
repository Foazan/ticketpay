import { Global, Module } from '@nestjs/common';
import { ChainClient } from './chain.client';
import { ChainWorker } from './chain.worker';
import { MintService } from './mint.service';

@Global()
@Module({
  providers: [ChainClient, MintService, ChainWorker],
  exports: [ChainClient, MintService, ChainWorker],
})
export class ChainModule {}
