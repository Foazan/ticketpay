import { Global, Module } from '@nestjs/common';
import { ChainClient } from './chain.client';
import { ChainWorker } from './chain.worker';
import { MintService } from './mint.service';
import { RedeemService } from './redeem.service';

@Global()
@Module({
  providers: [ChainClient, MintService, RedeemService, ChainWorker],
  exports: [ChainClient, MintService, RedeemService, ChainWorker],
})
export class ChainModule {}
