import { Global, Module } from '@nestjs/common';
import { CancelService } from './cancel.service';
import { ChainClient } from './chain.client';
import { ChainWorker } from './chain.worker';
import { MintService } from './mint.service';
import { RedeemService } from './redeem.service';

@Global()
@Module({
  providers: [ChainClient, MintService, RedeemService, CancelService, ChainWorker],
  exports: [ChainClient, MintService, RedeemService, CancelService, ChainWorker],
})
export class ChainModule {}
